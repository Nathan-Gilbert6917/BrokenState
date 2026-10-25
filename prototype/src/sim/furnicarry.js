// @ts-check
// Carrying furniture and appliances in a fight (issue #12, the user's request 2026-10-25: "Some appliances, furniture
// etc can be picked up and put into carried and making you very slow due to weight and some will require two
// survivors to carry to a vehicle. […] Takes 2 actions to pick up the appliance, furniture etc and uses 2 actions from
// both survivors when using another to help. Sharing the weight reduces the weight in half for both survivors making
// them be able to move faster. They are now tethered to each other and must be in adjacent tiles until they set it
// down or put in a vehicle. […] You can place the appliance, furniture etc in an adjacent tile your survivor can see.
// For group of two it goes to the left or right of the two so it's parallel to them you choose.").
//
//   The pieces (liftDef): the catalogue's (data-furniture.js pieceDef, issue #8) weight, carry class ("one": one
//     survivor, very slow, or two sharing; "two": two survivors needed; "fixed": never lifted) and footprint, and the
//     item it becomes in the arms (data-furniture.js itemKey: a bulky, both-arms GEAR row `f_<kind>` with
//     `furniture: <kind>`, merged into GEAR by data.js; the Refrigerator its own GEAR.fridge).
//   Lift (combatAct "liftPiece", LIFT.AP: both actions; a helper LIFT.AP too): a survivor with both hands free right
//     next to a piece (or to a piece item lying on a ground pile within reach), never a fixed one, one someone stands
//     on or one on fire. The cell goes back to open floor (or the door frame it stood in: barricade.js pieceOff); a
//     container on it is emptied first (its contents rolled if nobody had opened it, combat.js searchBox) onto a ground
//     pile on the cell. The piece is an item in the carrier's arms (u.bag, s.gear.carry: hands full as for any twoHands
//     item, carry.js handsCount). A helper (any teammate with free hands right next to the piece or the carrier) makes
//     it a pair: both tethered (u.tether: the other's unit id), both weighed at half its kg (u.shareKg), u.piece the kind
//     on both.
//   The weight (carrykit.js weighPlayer: pieceAdjKg, crushMob): the piece counts its full kg on the one alone, its
//     half on each of a pair; past MAX_LOAD (40 kg) the overloaded band and LIFT.CRUSH: mob = max(1, floor(mob × 40 /
//     kg)), so a 60 kg fridge alone is 2 tiles an action and a 120 kg piece 1. A pair moves at the slower one's pace.
//     Never a dash (combat.js dashRange: one action's move), never a vault (canVault), never sneaking (sneakAct), the
//     stairs LIFT.STAIRS_AP (both actions, each of a pair: pieceStairs).
//   The tether (tetherMoveRefusal, followTether, tetherRound): either of a pair may move (the lead for that move, as the
//     siege ram's crew follows its lead: siege.js followLead); the other steps along for free onto a cell next to where
//     the lead ends. A move the other cannot follow (walled in, a closed door, someone in the way) is refused. Neither
//     can shoot, open a door or search (carry.js HAND_ACTS, PIECE_ACTS here). One of them down, gripped by the dead or
//     parted (a shove, a forced move): the piece is set down (dropPiece) and the tether ends.
//   Set down (combatAct "setPiece", LIFT.SET_AP: 1 action, each of a pair): onto a free cell (barricade.js
//     freeForPiece: open floor or a door frame, nobody on it, not burning, no cart) next to the carrier that they can
//     see (combat.js canSeeAt); a 2-cell piece needs both cells (the second straight on from the carrier). A pair sets
//     it to the left or right of the two (act.side), parallel to the line between them: the cells beside them on that
//     side (a 1-cell piece the one beside its carrier; standing diagonally, the cell next to both). The cell is the
//     piece again (barricade.js pieceOn: its hp, c.moved), its container (if it had one, or a lootable kind) with it,
//     empty and searched.
//   Into the vehicle (combatAct "stowPiece", LIFT.STOW_AP: 1 action): from the vehicle (raidloot.js atVehicle, a field
//     battle's evac strip: carriers.js carHere) into the team's cargo (parties.js addGearToCargo), the full item; refused
//     with "No room in the car for the refrigerator (60 kg over)" when it does not fit (bikes: their racks).
//   Drop carried (carry.js dropCarried, free) and every forced drop: the piece onto a free cell next to the carrier (the
//     one they face first; seen or not), else as the item on a ground pile on the carrier's own cell (lifted again from
//     there: Lift). Taking a piece item off a pile or out of the vehicle by hand is refused (raidloot.js takeRule,
//     ground.js pickUpFromGround): it is lifted.
//   AI parity (docs/adr/0001-ai-parity.md): the human AI never lifts a piece in a fight (it shoves: barricade.js
//     aiBarricade); the battle AI on your side and the raid bot set one down to fight (carry.js autoDrop,
//     botDropToFight) and never lift one; other groups' abstract raids (grouppois.js raidPoiAsGroup opts.vehicle) carry
//     a flag on the haul when they came by vehicle.
import { GEAR } from "./data.js";
import { FURNITURE_KINDS, pieceDef, itemKey } from "./data-furniture.js"; // the catalogue: weight, carry class, footprint, item form
import { newItem, itemLoad, ensureInv } from "./inventory.js";
import { survivorById } from "./world.js";
import { MAX_LOAD } from "./load.js";
import { CELL, active, unitAt, unitById, canSeeAt, say, reachable, pathTo, moveAlong, moveToFloor, alertNear, searchBox } from "./combat.js"; // call-time only: the modules load in a circle
import { handsCount, handsBusy } from "./carry.js"; // call-time only
import { freeForPiece, pieceOff, pieceOn } from "./barricade.js"; // call-time only
import { groundPile, groundPiles, pileCount, settlePile } from "./ground.js"; // call-time only
import { lootLayer, atVehicle, trunkVehicle, trunkSpace, raidParty } from "./raidloot.js"; // call-time only
import { carHere, carRoom } from "./carriers.js"; // call-time only
import { addGearToCargo } from "./parties.js";
import { isBike } from "./vehicles.js";
import { weighPlayer } from "./carrykit.js"; // call-time only
import { gripOf } from "./shoving.js"; // call-time only

// The numbers. AP, HELP_AP: the user's (2 actions to lift, 2 from each of two); SHARE: the user's (half the weight
// each); the rest picked here (docs/features/travel.md "Carrying furniture and appliances").
export const LIFT = { AP: 2, HELP_AP: 2, SET_AP: 1, STOW_AP: 1, STAIRS_AP: 2, SHARE: 0.5, NOISE: 0.5, RADIUS: 2 };

// The one accessor for a piece (every reader goes through it), from the catalogue (data-furniture.js pieceDef, issue #8):
// { kind, name, kg, carry, size, item (its item key: data-furniture.js itemKey, null when fixed), hp, loot } or null.
export function liftDef(k) {
  const d = k ? pieceDef(k) : null;
  if (!d) return null;
  const item = itemKey(k);
  const kg = item && GEAR[item] && Number.isFinite(GEAR[item].weight) ? GEAR[item].weight : d.kg;
  return { kind: k, name: d.name, kg, carry: d.carry, size: d.size, item, hp: d.hp, loot: d.loot };
}
// Every kind with a liftDef (the codex's list).
export const liftKinds = () => Object.keys(FURNITURE_KINDS);
// The kind a carried item is as a piece ("" when it is none): GEAR furniture (the f_<kind> rows), the fridge's own item.
export function pieceKindOf(it) {
  const d = it && GEAR[it.key];
  if (!d) return "";
  const k = d.furniture || (it.key === "fridge" ? "fridge" : "");
  return k && pieceDef(k) && itemKey(k) === it.key ? k : "";
}
export const isPieceItem = (it) => !!pieceKindOf(it);
const first = (u) => String((u && u.name) || "").split(" ")[0];
const word = (def) => def.name.toLowerCase();
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const cellOf = (b, x, y) => (x < 0 || y < 0 || x >= b.w || y >= b.h ? null : b.cells[y * b.w + x]);
const burning = (b, x, y) => !!(b.fires && b.fires.some((f) => f.x === x && f.y === y));
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
const COMPASS = { "1,0": "east", "-1,0": "west", "0,1": "south", "0,-1": "north", "1,1": "south-east", "-1,-1": "north-west", "1,-1": "north-east", "-1,1": "south-west" };

// ---------- who holds what ----------
// The one holding the piece's item (u itself, or its tethered partner holding it), or null.
export function carrierOf(b, u) {
  if (!u || !u.piece) return null;
  if (u.bag && isPieceItem(u.bag)) return u;
  const o = u.tether != null ? unitById(b, u.tether) : null;
  return o && o.bag && isPieceItem(o.bag) ? o : null;
}
export const partnerOf = (b, u) => (u && u.tether != null ? unitById(b, u.tether) || null : null);
// The piece carried by u (alone or as one of a pair): { def, item, carrier, partner } or null.
export function carriedPiece(b, u) {
  const c = carrierOf(b, u);
  if (!c) return null;
  const def = liftDef(pieceKindOf(c.bag));
  return def ? { def, item: c.bag, carrier: c, partner: partnerOf(b, c) } : null;
}
// The words for the hands (carry.js armsText / handsWord): "the refrigerator (with Pat)".
export function pieceText(b, u) {
  const P = b ? carriedPiece(b, u) : null;
  if (!P) return "";
  const other = P.carrier === u ? P.partner : P.carrier;
  return `the ${word(P.def)}${other ? ` (with ${first(other)})` : ""}`;
}

// ---------- the weight (carrykit.js weighPlayer) ----------
// The kg weighPlayer adds to a unit's battle kg (battleKg counts the item in s.gear.carry in full): a pair's carrier
// sheds the other half, its partner takes its half on.
export function pieceAdjKg(u, s) {
  if (!u || !u.piece || u.shareKg == null) return 0;
  const it = s && s.gear && s.gear.carry;
  return it && isPieceItem(it) ? u.shareKg - itemLoad(it) : u.shareKg;
}
// The piece's own kg on this unit (full alone, its share in a pair), 0 for none.
export function pieceKg(u, s) {
  if (!u || !u.piece) return 0;
  if (u.shareKg != null) return u.shareKg;
  const it = s && s.gear && s.gear.carry;
  return it && isPieceItem(it) ? itemLoad(it) : 0;
}
// LIFT.CRUSH: past MAX_LOAD the move shrinks with the piece's kg (at least a tile).
export const crushMob = (mob, kg) => (kg > MAX_LOAD ? Math.max(1, Math.floor((mob * MAX_LOAD) / kg)) : mob);
// Weighs a unit of yours again (keeps the mob a body carried, a drag or the ram set); a pair both, at the slower pace.
export function reweigh(state, b, u) {
  const one = (x) => {
    if (!x || x.sid == null || x.mob0 != null || x.dragMob != null || x.ram != null) return;
    const s = survivorById(state, x.sid);
    if (s) weighPlayer(x, s);
  };
  one(u);
  const o = b && u && u.tether != null ? unitById(b, u.tether) : null;
  if (o) { one(o); const m = Math.min(u.mob, o.mob); u.mob = o.mob = m; }
}

// combat.js refitUnit (the kit changed in the search window): the unit weighed again with its piece, a pair at the
// slower pace.
export function refitPiece(b, u, s) {
  if (!u || u.mob0 != null || u.dragMob != null) return;
  weighPlayer(u, s);
  const o = partnerOf(b, u);
  if (o) { const m = Math.min(u.mob, o.mob); u.mob = o.mob = m; }
}

// ---------- lifting ----------
// The acts a piece in the arms refuses besides carry.js HAND_ACTS (shooting, doors, windows...): searching, taking
// things, getting into the vehicle, dragging, shoving, setting it over cover, a cart.
const PIECE_ACTS = new Set(["search", "searchBody", "pickUp", "board", "drag", "shove", "setOver", "takeCart", "pickCarried", "pickspear", "stash", "subdue", "tie", "lights"]);
export function pieceRefusal(b, u, type) {
  if (!u || !u.piece || !PIECE_ACTS.has(type)) return "";
  return `Hands full: ${first(u)} is carrying ${pieceText(b, u) || "a piece of furniture"}. Set it down first (Set down: ${LIFT.SET_AP} action), or put it in the vehicle.`;
}
// Free hands for a lift: on their feet, one of your people, nothing carried, not carrying or dragging anyone.
const freeHands = (u) => !!u && u.kind === "human" && !u.ztype && !u.aboard && !u.gunner && u.carrying == null && u.dragging == null && u.ram == null && !u.piece && handsCount(u) === 0 && !handsBusy(u);
// A container standing on the piece's cell (a raid's shelf, cabinet, locker...), or null.
const boxOn = (b, x, y, f) => { const L = lootLayer(b); return L ? L.containers.find((c) => c.x === x && c.y === y && (c.f || 0) === f && !c.w && c.kind !== "ground" && c.kind !== "body" && !c.cart) || null : null; };
// The other cell of a 2-cell piece at (x, y): the cell right beside it (not diagonally) of the same kind, free, not
// burning; null when there is none (half a bed lifts as a bed).
function otherHalf(b, x, y, k) {
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const c = cellOf(b, x + dx, y + dy);
    if (c && c.k === k && !unitAt(b, x + dx, y + dy) && !burning(b, x + dx, y + dy)) return c;
  }
  return null;
}
// What the unit could lift: the pieces next to it (any side, the same floor) and the piece items on a ground pile on its
// cell or next to it: [{ x, y, def, cell?, pile?, item? }].
export function liftTargets(b, u) {
  const out = [];
  if (!b || !u) return out;
  for (const [dx, dy] of DIRS) {
    const x = u.x + dx, y = u.y + dy, c = cellOf(b, x, y);
    const def = c && CELL[c.k] ? liftDef(c.k) : null;
    if (def) out.push({ x, y, def, cell: c });
  }
  for (const p of groundPiles(b)) {
    if ((p.f || 0) !== (u.f || 0) || cheb(u.x, u.y, p.x, p.y) > 1 || !pileCount(p)) continue;
    for (const it of p.contents.gear) { const def = liftDef(pieceKindOf(it)); if (def) out.push({ x: p.x, y: p.y, def, pile: p, item: it }); }
  }
  return out;
}
// The teammates who can take the other end of the piece at t: yours, on their feet with free hands and LIFT.HELP_AP
// actions, the same floor, right next to the piece or to the lifter.
export function liftHelpers(b, u, t) {
  if (!u || !t) return [];
  return b.units.filter((o) => o !== u && o.side === u.side && o.sid != null && (o.f || 0) === (u.f || 0) && active(o) && freeHands(o) && o.ap >= LIFT.HELP_AP && !gripOf(b, o) && (cheb(o.x, o.y, t.x, t.y) <= 1 || cheb(o.x, o.y, u.x, u.y) <= 1));
}
// Why u cannot lift now ("" when it can): the general rules, before a piece is picked.
export function liftRefusal(b, u) {
  if (!u || !active(u)) return "That unit cannot act.";
  if (u.side !== "player" || u.sid == null || u.kind !== "human") return "Only your people lift furniture.";
  if (u.piece) return `Already carrying ${pieceText(b, u)}: set it down first.`;
  if (!freeHands(u)) return "Both hands must be free to lift a piece (nothing carried, nobody carried or dragged).";
  if (gripOf(b, u)) return `Something has hold of ${first(u)}: shove it off or kill it first.`;
  if (!liftTargets(b, u).length) return "Stand right next to a piece of furniture or an appliance (a shelf, a cabinet, a table, a bed, a crate, a locker...).";
  if (u.ap < LIFT.AP) return `Lifting takes both actions (${LIFT.AP}).`;
  return "";
}
// What a lift of target t costs and who helps: { helper, why }. helperId: the one asked (-1: alone), else a "two" piece
// takes the first helper there is and a "one" piece is lifted alone.
export function liftPlan(b, u, t, helperId = null) {
  if (!t) return { helper: null, why: "Lift which piece?" };
  const d = t.def;
  if (d.carry === "fixed") return { helper: null, why: `The ${word(d)} is fixed in place: it cannot be lifted (shove it, or leave it).` };
  if (t.cell) {
    if (unitAt(b, t.x, t.y)) return { helper: null, why: `Someone is on the ${word(d)}.` };
    if (burning(b, t.x, t.y)) return { helper: null, why: `The ${word(d)} is on fire.` };
    const box = boxOn(b, t.x, t.y, u.f || 0);
    if (box && box.lock && !box.lock.open) return { helper: null, why: `The ${word(d)} is locked: open it first (Force lock), its contents come out before it is lifted.` };
  }
  const helpers = liftHelpers(b, u, t);
  const alone = helperId != null && Number(helperId) < 0;
  const helper = alone ? null : helperId != null ? helpers.find((o) => o.id === Number(helperId)) || null : d.carry === "two" ? helpers[0] || null : null;
  if (helperId != null && !alone && !helper) return { helper: null, why: "That teammate cannot take the other end (free hands, both actions, right next to the piece or to the lifter)." };
  if (d.carry === "two" && !helper) return { helper: null, why: `The ${word(d)} (${d.kg} kg) takes two: a teammate with free hands and both actions right next to it or to ${first(u)} takes the other end (${LIFT.HELP_AP} actions each).` };
  if (u.ap < LIFT.AP) return { helper, why: `Lifting takes both actions (${LIFT.AP}).` };
  return { helper, why: "" };
}
// act: { type: "liftPiece", unit, x, y (the piece's cell, or the pile's), item? (the item's index on that pile), helper?
// (a teammate's unit id; -1 alone) }. Returns "" or an error.
export function liftAct(state, b, u, act) {
  const why = liftRefusal(b, u);
  if (why) return why;
  const list = liftTargets(b, u);
  const at = act.x != null ? list.filter((t) => t.x === Number(act.x) && t.y === Number(act.y)) : list;
  const t = act.item != null ? at.find((o) => o.pile && o.pile.contents.gear.indexOf(o.item) === Number(act.item)) || null : at.find((o) => o.cell) || (at.length === 1 ? at[0] : null);
  if (!t) return at.length > 1 || list.length > 1 ? "Several pieces within reach: say which." : "Stand right next to the piece.";
  const plan = liftPlan(b, u, t, act.helper);
  if (plan.why) return plan.why;
  const d = t.def, s = survivorById(state, u.sid);
  if (!s) return "That unit cannot act.";
  let item = null, emptied = 0;
  if (t.cell) {
    // A 2-cell piece (a bed laid as two cells) takes its other cell along: the one beside it of the same kind.
    const other = Math.max(d.size[0], d.size[1]) > 1 ? otherHalf(b, t.x, t.y, t.cell.k) : null;
    if (other) pieceOff(other);
    // A container on it: its contents onto a pile on the cell (rolled first if nobody had looked inside).
    const box = boxOn(b, t.x, t.y, u.f || 0);
    if (box) {
      if (!box.contents && b.raid) searchBox(state, b, u, box, true);
      const c = box.contents || { sup: {}, gear: [] };
      const n = c.gear.length + Object.values(c.sup).filter((v) => v > 0).length;
      pieceOff(t.cell);
      if (n) {
        const pile = groundPile(b, t.x, t.y, u.f || 0);
        for (const it of c.gear.splice(0)) pile.contents.gear.push(it);
        for (const [k, v] of Object.entries(c.sup)) if (v > 0) pile.contents.sup[k] = (pile.contents.sup[k] || 0) + v;
        settlePile(pile);
        emptied = n;
      }
      box.contents = { sup: {}, gear: [] };
      box.searched = true; box.partial = false; box.hidden = null; box.quick = false;
      box.lifted = true; // carried off with its piece (setAct puts it down with it)
      u.pieceBox = box.id;
    } else pieceOff(t.cell);
    item = d.item ? newItem(d.item) : null;
    if (!item) return `The ${word(d)} cannot be carried.`;
    if (t.cell.hp > 0 && t.cell.hp < d.hp) item.pieceHp = t.cell.hp; // battered before: it stays so
    b.losCache.fill(0);
  } else {
    item = t.item;
    const g = t.pile.contents.gear, i = g.indexOf(item);
    if (i >= 0) g.splice(i, 1);
    for (const r of b.armsDrops || []) if (r.item === item) r.item = null; // carry.js: a load set down here is taken back
    settlePile(t.pile);
  }
  ensureInv(s);
  s.gear.carry = item;
  u.bag = item;
  u.piece = d.kind;
  u.tether = null; u.shareKg = null;
  u.ap -= LIFT.AP;
  u.hunker = false; u.ow = false;
  u.face = [Math.sign(t.x - u.x), Math.sign(t.y - u.y)];
  const h = plan.helper;
  if (h) {
    h.piece = d.kind;
    h.tether = u.id; u.tether = h.id;
    h.shareKg = u.shareKg = Math.round(d.kg * LIFT.SHARE * 100) / 100;
    h.ap -= LIFT.HELP_AP;
    h.hunker = false; h.ow = false;
    h.face = [Math.sign(t.x - h.x), Math.sign(t.y - h.y)];
  }
  reweigh(state, b, u);
  b.noise = (b.noise || 0) + LIFT.NOISE;
  alertNear(b, t.x, t.y, LIFT.RADIUS, "Something heavy scrapes and thuds nearby.");
  say(b, `${u.name}${h ? ` and ${h.name}` : ""} lift${h ? "" : "s"} the ${word(d)} (${d.kg} kg${h ? `, ${u.shareKg} kg each: tethered, they stay side by side` : ""})${emptied ? `, its contents tipped out onto the floor (${emptied} thing${emptied === 1 ? "" : "s"})` : ""}: ${u.mob} tile${u.mob === 1 ? "" : "s"} an action, no shooting, no doors.`, "info");
  return "";
}

// ---------- setting it down ----------
// The cells a piece of footprint size takes when its first cell is (x, y) and it runs on along (dx, dy) (the second
// cell of a 2-cell piece), then out along (ox, oy) for its width.
function footprint(def, x, y, dx, dy, ox, oy) {
  const long = Math.max(def.size[0], def.size[1]), wide = Math.min(def.size[0], def.size[1]);
  const out = [];
  for (let i = 0; i < long; i++) for (let j = 0; j < wide; j++) out.push([x + dx * i + ox * j, y + dy * i + oy * j]);
  return out;
}
const cellsFree = (b, cells) => cells.every(([x, y]) => freeForPiece(b, x, y) && !unitAt(b, x, y));
const cellsSeen = (b, cells, eyes) => cells.every(([x, y]) => eyes.some((e) => canSeeAt(b, e, x, y)));
// Where the carried piece can be set down: alone, [{ x, y, cells, word }] (each free cell next to the carrier they can
// see, a 2-cell piece running on straight from them); a pair, [{ side: "left" | "right", cells, word }] (the cells
// beside the two on that side, parallel to them). opts.blind: seen or not (a drop).
/** @returns {any[]} */
export function setTargets(b, u, opts = {}) {
  const P = carriedPiece(b, u);
  if (!P) return [];
  const c = P.carrier, o = P.partner, d = P.def;
  const eyes = [c, o].filter((x) => x && active(x));
  const ok = (cells) => cellsFree(b, cells) && (opts.blind || cellsSeen(b, cells, eyes));
  const out = [];
  if (!o) {
    for (const [dx, dy] of DIRS) {
      const cells = footprint(d, c.x + dx, c.y + dy, dx, dy, dy ? 1 : 0, dx ? 1 : 0);
      if (ok(cells)) out.push({ x: c.x + dx, y: c.y + dy, cells, word: `${COMPASS[`${dx},${dy}`]} of ${first(c)}` });
    }
    return out;
  }
  // The line from the carrier to the partner; its left (turned a quarter anticlockwise, y down) and right.
  const lx = o.x - c.x, ly = o.y - c.y;
  for (const side of ["left", "right"]) {
    const [px, py] = side === "left" ? [ly, -lx] : [-ly, lx];
    let cells;
    if (lx && ly) { // diagonal: the one cell beside both on that side (a 2-cell piece needs them side by side)
      if (Math.max(d.size[0], d.size[1]) > 1) continue;
      // The two cells next to both: (c.x + lx, c.y) lies off the middle of the pair by (lx, −ly) / 2, the other opposite.
      cells = [px * lx - py * ly > 0 ? [c.x + lx, c.y] : [c.x, c.y + ly]];
    } else {
      const sx = Math.sign(px), sy = Math.sign(py);
      const long = Math.max(d.size[0], d.size[1]), wide = Math.min(d.size[0], d.size[1]);
      if (long > 2) continue;
      cells = [];
      for (let j = 0; j < wide; j++) {
        cells.push([c.x + sx * (1 + j), c.y + sy * (1 + j)]);
        if (long > 1) cells.push([o.x + sx * (1 + j), o.y + sy * (1 + j)]);
      }
    }
    if (ok(cells)) out.push({ side, cells, word: `${side} of the two (${COMPASS[`${Math.sign(cells[0][0] - c.x) || 0},${Math.sign(cells[0][1] - c.y) || 0}`] || "beside them"})` });
  }
  return out;
}
// Why the piece cannot be set down now ("" when it can).
export function setRefusal(b, u) {
  const P = carriedPiece(b, u);
  if (!P) return "Not carrying a piece of furniture.";
  if (!active(u) || u.ap < LIFT.SET_AP) return "No action left.";
  if (P.partner) { const other = P.carrier === u ? P.partner : P.carrier; if (!active(other) || other.ap < LIFT.SET_AP) return `${first(other)} needs an action left too (${LIFT.SET_AP} each).`; }
  if (!setTargets(b, u).length) return P.partner ? "No room beside the two on either side that they can see (free open floor or a door frame)." : `No free cell next to ${first(u)} they can see (open floor or a door frame, nobody on it).`;
  return "";
}
// Puts the piece on cells (the first is its own: the cell kind; a second cell of a 2-cell piece the same kind) and
// ends the carry: the item out of the arms, the tether gone, both weighed again.
function placePiece(state, b, P, cells) {
  const d = P.def, c = P.carrier;
  const hp = P.item.pieceHp > 0 ? P.item.pieceHp : d.hp;
  for (const [x, y] of cells) { if (!CELL[d.kind]) break; pieceOn(cellOf(b, x, y), d.kind, hp, d.hp); }
  const [x, y] = cells[0];
  const L = lootLayer(b);
  const box = c.pieceBox != null && L ? L.containers.find((k) => k.id === c.pieceBox) : null;
  if (box) { box.x = x; box.y = y; box.f = c.f || 0; delete box.lifted; }
  else if (d.loot && L && b.raid) L.containers.push({ id: b.nextId++, x, y, f: c.f || 0, kind: d.kind, area: null, searched: true, partial: false, label: d.name, contents: { sup: {}, gear: [] } });
  endCarry(state, b, P);
  b.losCache.fill(0);
}
// The item leaves the arms (it is on the map now, or in the vehicle); the tether ends.
function endCarry(state, b, P) {
  const c = P.carrier, s = c.sid != null ? survivorById(state, c.sid) : null;
  if (s && s.gear && s.gear.carry === P.item) s.gear.carry = null;
  c.bag = null;
  c.pieceBox = null;
  for (const x of [c, P.partner]) if (x) { x.piece = null; x.tether = null; x.shareKg = null; }
  reweigh(state, b, c);
  if (P.partner) reweigh(state, b, P.partner);
}
// act: { type: "setPiece", unit, x, y (alone: the cell) | side ("left" | "right": a pair) }. Returns "" or an error.
export function setAct(state, b, u, act) {
  const why = setRefusal(b, u);
  if (why) return why;
  const P = carriedPiece(b, u);
  const list = setTargets(b, u);
  const t = P.partner ? (act.side ? list.find((o) => o.side === act.side) : list.length === 1 ? list[0] : null) : act.x != null ? list.find((o) => o.x === Number(act.x) && o.y === Number(act.y)) : list.length === 1 ? list[0] : null;
  if (!t) return P.partner ? (act.side ? `No room ${act.side} of the two that they can see.` : "Say which side: left or right of the two.") : act.x != null ? "Not there: a free cell right next to them that they can see." : "Say where: a free cell right next to them that they can see.";
  const other = P.partner ? (P.carrier === u ? P.partner : P.carrier) : null;
  placePiece(state, b, P, t.cells);
  u.ap -= LIFT.SET_AP; u.hunker = false;
  if (other) { other.ap -= LIFT.SET_AP; other.hunker = false; }
  say(b, `${u.name}${other ? ` and ${other.name}` : ""} set${other ? "" : "s"} the ${word(P.def)} down ${t.word}.`, "info");
  return "";
}

// ---------- forced: Drop carried, someone down, the tether broken ----------
// The piece goes onto a free cell next to the carrier (between the two first; the one faced first), seen or not; else
// it lies as the item on a ground pile on the carrier's cell. Free. Returns the words ("" when nothing was carried).
export function dropPiece(state, b, u, why = "") {
  const P = carriedPiece(b, u);
  if (!P) return "";
  const c = P.carrier, o = P.partner;
  const f = c.face ? [Math.round(c.face[0]), Math.round(c.face[1])] : [1, 0];
  const cand = [];
  if (o && cheb(c.x, c.y, o.x, o.y) <= 2) for (const [dx, dy] of DIRS) { const x = c.x + dx, y = c.y + dy; if (cheb(x, y, o.x, o.y) <= 1) cand.push([dx, dy]); } // between them
  cand.push(f, ...DIRS);
  let cells = null, at = "";
  for (const [dx, dy] of cand) {
    if (!dx && !dy) continue;
    const fp = footprint(P.def, c.x + dx, c.y + dy, dx, dy, dy ? 1 : 0, dx ? 1 : 0);
    if (CELL[P.def.kind] && cellsFree(b, fp)) { cells = fp; at = COMPASS[`${dx},${dy}`]; break; }
  }
  const name = word(P.def);
  if (cells) placePiece(state, b, P, cells);
  else {
    const L = lootLayer(b);
    const box = c.pieceBox != null && L ? L.containers.find((k) => k.id === c.pieceBox) : null;
    if (box) delete box.lifted; // left where the piece stood, empty
    const pile = groundPile(b, c.x, c.y, c.f || 0);
    pile.contents.gear.push(P.item);
    settlePile(pile);
    endCarry(state, b, P);
  }
  const line = `${why ? `${why} ` : ""}The ${name} ${cells ? `is set down ${at} of ${first(c)}` : `drops where ${first(c)} stands (lift it again from the ground: ${LIFT.AP} actions)`}${o ? "; the tether ends" : ""}.`;
  say(b, line, "info");
  return line;
}
// combat.js, after each order and at the start of your turn: a pair parted (one down, gripped by the dead, shoved or
// dragged apart, on another floor) or a lone carrier down sets the piece down.
export function tetherRound(state, b) {
  if (!b || !b.units) return;
  for (const u of b.units) {
    if (u.side !== "player" || !u.piece) continue;
    const P = carriedPiece(b, u);
    if (!P) { u.piece = null; u.tether = null; u.shareKg = null; u.pieceBox = null; reweigh(state, b, u); continue; } // the item left the arms another way (the inventory window): the flags go, the weight with them
    if (P.carrier !== u) continue; // looked at from the one holding it
    const o = P.partner;
    const out = (x) => !!(x.left || x.fled); // off the map with it (extracted together: issue #18's to settle)
    if (out(u) && (!o || out(o))) continue;
    const down = (x) => x.dead || x.down;
    if (down(u) || (o && down(o))) { dropPiece(state, b, u, `${down(u) ? first(u) : first(o)} ${(down(u) ? u : o).dead ? "is killed" : "goes down"}.`); continue; }
    if (o && (out(u) !== out(o) || (o.f || 0) !== (u.f || 0) || cheb(u.x, u.y, o.x, o.y) > 1)) { dropPiece(state, b, u, `${first(u)} and ${first(o)} are pulled apart.`); continue; }
    const g = gripOf(b, u) || (o ? gripOf(b, o) : null);
    if (g) dropPiece(state, b, u, `${g.name} gets hold of ${gripOf(b, u) ? first(u) : first(o)}.`);
  }
}

// ---------- the tether on the move (combat.js "move") ----------
// The free cell next to (x, y) the partner can walk to in budget tiles (its own cell if it is next to it already), or
// null. The mover is put on (x, y) while it is worked out.
function followSpot(b, o, mover, x, y, budget) {
  const ox = mover.x, oy = mover.y;
  mover.x = x; mover.y = y;
  try {
    if (cheb(o.x, o.y, x, y) === 1) return { x: o.x, y: o.y, path: [] };
    const r = reachable(b, o, budget);
    let best = -1;
    for (const [dx, dy] of DIRS) {
      const cx = x + dx, cy = y + dy;
      if (cx < 0 || cy < 0 || cx >= b.w || cy >= b.h) continue;
      const i = cy * b.w + cx;
      if (!isFinite(r.dist[i]) || unitAt(b, cx, cy)) continue;
      if (best < 0 || r.dist[i] < r.dist[best]) best = i;
    }
    if (best < 0) return null;
    const bx = best % b.w, by = (best / b.w) | 0;
    return { x: bx, y: by, path: pathTo(r, bx, by) };
  } finally { mover.x = ox; mover.y = oy; }
}
const followBudget = (u, cost) => Math.max(2, (cost || 0) + 2);
// A move to (x, y) costing `cost` tiles by one of a pair: "" when the other can step along to stay next to them.
export function tetherMoveRefusal(b, u, x, y, cost) {
  const o = u && u.piece ? partnerOf(b, u) : null;
  if (!o) return "";
  if (!active(o)) return "";
  if (gripOf(b, o)) return `${first(o)} is held fast: the two cannot move with the piece.`;
  return followSpot(b, o, u, x, y, followBudget(u, cost)) ? "" : `${first(o)} cannot keep up there: tethered by ${pieceText(b, u)}, they must stay right next to each other. Move where they can follow, or set it down.`;
}
// After the lead's move: the partner steps onto a free cell next to them (no actions spent); if they cannot, the piece
// is set down at the next check (tetherRound).
export function followTether(state, b, u, cost) {
  const o = u && u.piece ? partnerOf(b, u) : null;
  if (!o || !active(o) || !active(u)) return;
  const spot = followSpot(b, o, u, u.x, u.y, followBudget(u, cost));
  if (spot && spot.path.length) moveAlong(b, o, spot.path);
}

// ---------- the stairs (combat.js "goup" / "godown") ----------
// What the stairs cost a unit (LIFT.STAIRS_AP with a piece), and why they cannot go ("" when they can): a pair both,
// the partner next to the stairwell with LIFT.STAIRS_AP actions too.
export const stairsAp = (u) => (u && u.piece ? LIFT.STAIRS_AP : 1);
export function pieceStairsRefusal(b, u, to) {
  if (!u || !u.piece) return "";
  if (u.ap < LIFT.STAIRS_AP) return `The stairs take both actions with ${pieceText(b, u)} (${LIFT.STAIRS_AP}).`;
  const o = partnerOf(b, u);
  if (!o) return "";
  if (!active(o) || o.ap < LIFT.STAIRS_AP) return `${first(o)} needs both actions too to take the stairs with the ${pieceText(b, u).replace(/^the /, "")}.`;
  return landing(b, u, to) ? "" : `No room for ${first(o)} at the top or bottom of the stairs.`;
}
// A free walkable cell next to the stairwell on floor `to` for the partner, or null.
function landing(b, u, to) {
  const F = b.floors && b.floors[to];
  if (!F) return null;
  for (const [dx, dy] of DIRS) {
    const x = u.x + dx, y = u.y + dy;
    if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
    const c = F.cells[y * b.w + x];
    if (!c || !CELL[c.k] || !CELL[c.k].walk || c.k === "stairs") continue;
    if (b.units.some((o) => (o.f || 0) === to && !o.dead && !o.left && !o.off && o.x === x && o.y === y)) continue;
    return [x, y];
  }
  return null;
}
// After moveToFloor (the lead on floor `to`): the partner comes along onto the landing, both actions spent.
export function pieceStairs(b, u, to) {
  if (!u || !u.piece) return;
  const o = partnerOf(b, u);
  if (!o) return;
  const at = landing(b, u, to);
  if (!at) return;
  o.x = at[0]; o.y = at[1];
  moveToFloor(b, o, to);
  o.ap = Math.max(0, o.ap - LIFT.STAIRS_AP);
  o.hunker = false;
}

// ---------- into the vehicle ----------
// Is u at the team's vehicle, and how much room it has: { v, room } or null.
function vehicleAt(state, b, u) {
  if (b.raid || b.vehicle) {
    const v = trunkVehicle(state, b);
    if (!v || !atVehicle(b, u)) return null;
    const space = trunkSpace(state, b);
    return { v, room: Math.min(space == null ? Infinity : space, carRoom(state, b)) };
  }
  if (!carHere(state, b, u)) return null;
  const p = raidParty(state, b);
  return { v: p ? p.vehicle : null, room: carRoom(state, b) };
}
export function stowRefusal(state, b, u) {
  const P = carriedPiece(b, u);
  if (!P) return "Not carrying a piece of furniture.";
  if (!active(u) || u.ap < LIFT.STOW_AP) return "No action left.";
  const at = vehicleAt(state, b, u);
  if (!at) return b.raid ? "Walk to the vehicle (its zone, or next to it) to load it." : "Carry it onto the green evac strip, where the team's car waits.";
  const kg = itemLoad(P.item);
  if (kg > at.room + 1e-6) {
    const vv = trunkVehicle(state, b);
    const what = vv && isBike(vv) ? "on the bicycle racks" : "in the car";
    return `No room ${what} for the ${word(P.def)} (${Math.round(kg - Math.max(0, at.room))} kg over).`;
  }
  return "";
}
// act: { type: "stowPiece", unit }. The full item into the team's cargo; the tether ends. Returns "" or an error.
export function stowAct(state, b, u) {
  const why = stowRefusal(state, b, u);
  if (why) return why;
  const P = carriedPiece(b, u);
  const p = raidParty(state, b);
  if (!p || !addGearToCargo(state, p, P.item)) return `No room in the car for the ${word(P.def)}.`;
  const L = lootLayer(b);
  const box = P.carrier.pieceBox != null && L ? L.containers.find((k) => k.id === P.carrier.pieceBox) : null;
  if (box) delete box.lifted; // its record stays where the piece stood, empty
  const other = P.partner ? (P.carrier === u ? P.partner : P.carrier) : null;
  endCarry(state, b, P);
  u.ap -= LIFT.STOW_AP; u.hunker = false;
  say(b, `${u.name}${other ? ` and ${other.name}` : ""} load${other ? "" : "s"} the ${word(P.def)} into the vehicle (${Math.round(itemLoad(P.item))} kg of the cargo).`, "good");
  return "";
}
