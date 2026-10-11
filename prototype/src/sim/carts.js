// @ts-check
// Carts: a wheelbarrow and a hand cart (data-carts.js), pushed or pulled by one person so a survivor alone can walk
// off with a big haul (the user's ask, 2026-10-11).
//
// IN THE ARMS ONLY. A cart is an item that goes in the In arms slot (inventory.js EQUIP_SLOTS carry, s.gear.carry) and
// nowhere else on a person (fitReason: not a pack, a pocket or the back); a team's cargo, a base's armory and the ground
// take it like any item. It is a bag in the arms for every rule of carry.js: hands full (no gun, blade, reload, throw or
// treat in a fight until it is let go), carryBag picks it up, Set down puts it on the tile's ground whole.
//
// WHAT IT HOLDS. Three things, all within GEAR cart.cap kg:
//   items   its own grid (item.contents, GEAR slots: 10 and 16), addressed "s:<id>:bag:<i>" like a carried bag's;
//           bulky things and packs go in too (inventory.js fitReason "bag" on a cart: only its kg limits).
//   the team's supplies  water, food, firewood, game, fuel cans... (carry.js HOLD): with a team the pool stays one pool
//           (parties.js) and the cart is a place for it like the car, owned by its pusher (p.hold.by[sid].cart, carry.js
//           settleHold: the car first, then the carts, then packs, pockets, hands; cartFree kg of room).
//   lots    item.held [{ k, q, left?, egg?, eggs? }]: the supplies it carries when no team holds it (set down on a
//           tile, left on a battle map, in a cargo or an armory). itemLoad counts them. Picked up by a team, they go
//           into its pool and are placed in the cart again (settleHold, absorbHeld), food with its shelf left.
//
// THE WEIGHT. The pusher feels cart.frac of the cart's whole weight (itself, its items, its lots: feltKg) and of the
// team's supplies placed in it (load.js teamLoad: the pool fills the carts first, each kg there felt at frac by its
// pusher; parties.js weighTeam passes where the supplies really are, carry.js cartSupOf). So a lone survivor with a hand
// cart walks 180 kg at the felt cost of 36 (plus the cart's own 22 × 0.2). On foot off the roads the team goes at the
// slowest cart's cart.offroad pace (parties.js offroadStep: a wheelbarrow ×0.9, a hand cart ×0.7; roads ×1).
//
// THE GROUND (State Map). Set down (carry.js dropBag / dropHands / dropItemToGround) or left after a fight, a cart lies
// on the tile's ground (state.deathSites, one item with everything in it: carry.js cartToGround: its share of the pool
// leaves it as lots). The marker names it with its weight ("Cargo left behind: Hand cart (84 kg)", markers.js). Any team
// on the tile picks it up (pickUpGround: into someone's free arms, else the cargo); the Recover mission and the
// governor fetch it the same way (parties.js recover: cartToArms first). Scavengers strip it as they strip a site
// (economy.js deathSitesDaily: the most valuable thing in it first, then the cart itself, which the nearest group keeps:
// f.carts).
//
// FIGHTS (tactical, the iso view). A cart is a 1x1 object on the battle map: a container of the loot layer (raidloot.js
// lootLayer, ground.js) { kind: "ground", cart: <the item>, x, y, f, sid, contents: { sup, gear } }: a pile for every
// rule (reach, the search window, fire and blasts on what is in it, the enemy snatching a gun out of it) but drawn as
// the cart (ui/ground.js drawCartIso) and never the pile an item is dropped on (ground.js groundAt skips it).
//   Held (u.bag is the cart): it rolls with its pusher, drawn beside them; pushing costs CART_FIGHT.mob tiles a move
//     (carrykit.js weighPlayer) and the pusher's battle kg counts it at frac (battleKg).
//   Let go (letGoCart, free; Drop carried does the same): it stays on the pusher's cell, its items and supplies in it
//     (the supplies leave the pool, as a load set down does). Hands free.
//   Take cart (takeCart, 1 action, on its cell or next to it, free arms): back in the arms, what is in it back in its
//     grid and lots (the pool again), what no longer fits stays on the cell as a pile.
//   Loading: anyone next to it opens it in the search window (Load cart / Ground) and drags things in or out: park it,
//     loot the bodies and piles round it into it (cartFree: its kg; raidloot.js checks).
//   Movement and cover (decided): it does not block a cell (units walk past it like a pile) and gives no cover: a
//     wheelbarrow's tray stops nothing worth counting.
//   The battle AI on your side lets go at once (carry.js autoDrop). A fight the team starts (stageLoads): into the
//     vehicle if it has room, else let go where its pusher starts.
//   The end (cartsEnd, from carry.js armsDropsEnd and settleCarried): won, a cart on the map goes back to its pusher's
//     arms (alive, arms free), else someone's free arms, the team's cargo, the base's armory, the ground; as bags do.
//     Not won (a retreat, broken off, beaten, an evac), only a cart held in someone's arms leaves with them (u.left: the
//     ones who got out keep what they hold); a cart on the map is left on the tile's ground with all in it, to find
//     and take back later. By the numbers: a retreat keeps the carts held, a defeat sets them down (carry.js
//     settleCarried).
//
// AI PARITY (coarse, cheap). Groups own carts as a count (f.carts): scavengers who take one off a tile's ground keep it,
// a scavenging party on foot finds one now and then at a farm or a hardware store (CART_FINDS), and trade carries them
// as items on a trader's table (loot.js WARE_CARTS). A scavenging party on foot takes up to CART_AI.most of the
// group's carts and brings home CART_AI.haul more a cart (aiscav.js scavSearchHour: it picks the site cleaner, it does
// not strip it faster); a party lost is its carts lost. Their battle units never hold one (an AI fighter would drop it
// at once: autoDrop's rule), so it stays abstract: no cart sprites on their side, no carts in their caravans' cargo.
import { GEAR, SUPPLIES, supWeight, supValue } from "./data.js";
import { itemLoad, itemKg, ensurePack, ensureInv } from "./inventory.js";
import { survivorById, baseById } from "./world.js";
import { lootLayer, fieldLayer } from "./raidloot.js"; // call-time only (safe in the import cycle)
import { settlePile, groundAt as pileAt } from "./ground.js";
import { say } from "./combat.js";
import { gunLeavesTeam } from "./gunload.js";
import { weighPlayer } from "./carrykit.js";
import { partyMembers, addGearToCargo } from "./parties.js";
import { holdsOwn, settleHold, cartSupOut, cartOnTile, cartToArms } from "./carry.js";
import { hash01 } from "./skills.js";
import { CART_FINDS } from "./loot.js";
import { AISCAV } from "./aiscav.js";

const EPS = 1e-6;
const r1 = (x) => Math.round(x * 10) / 10;
const first = (n) => String(n || "").split(" ")[0];

// ---------- the item ----------
export const isCart = (item) => !!(item && GEAR[item.key] && GEAR[item.key].cart);
export const cartSpec = (item) => (isCart(item) ? GEAR[item.key].cart : null);
// The cart someone pushes (In arms), or null.
export const cartOf = (s) => (s && s.gear && isCart(s.gear.carry) ? s.gear.carry : null);
// Kg of the lots a cart carries away from a team (item.held).
export const heldKg = (item) => (item && Array.isArray(item.held) ? item.held.reduce((a, l) => a + (l && l.q > 0 ? l.q * supWeight(l.k) : 0), 0) : 0);
// Kg in it besides itself (its items and its lots).
export const cartInKg = (item) => (isCart(item) ? Math.max(0, itemLoad(item) - itemKg(item)) : 0);
// Kg more it takes (of items and lots; a team's supplies placed in it use the same room: carry.js).
export const cartFree = (item) => (isCart(item) ? Math.max(0, cartSpec(item).cap - cartInKg(item)) : 0);
// What its pusher feels of it (itself, its items, its lots).
export const feltKg = (item) => (isCart(item) ? itemLoad(item) * cartSpec(item).frac : itemLoad(item));
// What an item someone has weighs on them: a cart in their arms at its share (load.js wornLoad, carrykit.js battleKg).
export const itemOnKg = (s, it) => (it && s && s.gear && it === s.gear.carry && isCart(it) ? feltKg(it) : itemLoad(it));
// The pace off the roads of a team on foot with these people: its slowest cart's (1: no cart).
export const cartOffroad = (members) => Math.min(1, ...(members || []).map((s) => (cartOf(s) ? cartSpec(cartOf(s)).offroad : 1)));
// What it is worth on the ground (economy.js deathSitesDaily takes the most valuable first): itself, its items, its lots.
export function cartWorth(item) {
  const own = Math.round(((GEAR[item.key] && GEAR[item.key].value) || 0) * (item.quality || 1));
  const items = (item.contents || []).filter(Boolean).reduce((a, it) => a + Math.round(((GEAR[it.key] && GEAR[it.key].value) || 0) * (it.quality || 1)), 0);
  const lots = (item.held || []).reduce((a, l) => a + (l.q > 0 ? l.q * supValue(l.k) : 0), 0);
  return own + items + Math.round(lots);
}
// Adds q of supply k to a cart's lots (food: its shelf left kept, averaged).
export function addLot(item, k, q, extra = {}) {
  if (!(q > EPS) || !SUPPLIES[k]) return;
  item.held = item.held || [];
  const cur = item.held.find((l) => l.k === k && !!l.egg === !!extra.egg);
  if (cur) {
    if (extra.left != null || cur.left != null) cur.left = ((cur.left ?? extra.left ?? 0) * cur.q + (extra.left ?? cur.left ?? 0) * q) / (cur.q + q);
    cur.q += q;
  } else item.held.push({ k, q, ...(extra.left != null ? { left: extra.left } : {}), ...(extra.egg ? { egg: true } : {}), ...(extra.eggs != null ? { eggs: extra.eggs } : {}) });
}
export const lotsText = (item) => (item.held || []).filter((l) => l.q > 0.05).map((l) => `${r1(l.q)} ${String((SUPPLIES[l.k] && SUPPLIES[l.k].name) || l.k).toLowerCase()}`).join(", ");
// What is in it, in words.
export function cartText(item) {
  const things = [...(item.contents || []).filter(Boolean).map((it) => it.name), lotsText(item)].filter(Boolean);
  return things.length ? things.join(", ") : "empty";
}

// ---------- fights ----------
export const CART_FIGHT = { mob: 1, take: 1 }; // tiles less a move while pushing one; actions to take one back
const cheb = (u, c) => Math.max(Math.abs(u.x - c.x), Math.abs(u.y - c.y));
const battleParty = (state, b) => (b && b.setup && b.setup.partyId != null ? state.parties.find((x) => x.id === b.setup.partyId) || null : null);
// The carts on the battle map (not held).
export const cartBoxes = (b) => { const L = lootLayer(b); return L ? L.containers.filter((c) => c.cart) : []; };
// The carts on or next to the unit, its own cell first.
export const cartsNear = (b, u) => (u ? cartBoxes(b).filter((c) => (c.f || 0) === (u.f || 0) && cheb(u, c) <= 1).sort((a, c) => cheb(u, a) - cheb(u, c)) : []);
export const holdsCart = (u) => !!(u && isCart(u.bag));
// The kg in a cart on the map (its items and supplies) and the kg more it takes.
export const boxKg = (c) => (c && c.contents ? c.contents.gear.reduce((a, g) => a + itemLoad(g), 0) + Object.entries(c.contents.sup).reduce((a, [k, v]) => a + (v > 0 ? v * supWeight(k) : 0), 0) : 0);
export const boxFree = (c) => (c && c.cart ? Math.max(0, cartSpec(c.cart).cap - boxKg(c)) : Infinity);
// A move into a cart on the map that would overfill it (raidloot.js): "" or why not.
export const boxRefusal = (c, kg) => (c && c.cart && kg > boxFree(c) + EPS ? `The ${c.cart.name} is full (${r1(boxFree(c))} kg more fits).` : "");
function reweigh(state, u) {
  const s = survivorById(state, u.sid);
  if (s && u.mob0 == null && u.dragMob == null) weighPlayer(u, s); // carriers.js / medics.js keep their own mob while carrying someone
}
// Let go (free): the cart stays on the pusher's cell with everything in it. opts.staged: a fight the team starts
// (carry.js stageLoads); opts.quiet: no line. Returns "" or why not.
export function letGoCart(state, b, u, opts = {}) {
  const cart = u && isCart(u.bag) ? u.bag : null;
  if (!cart) return "Not pushing a cart.";
  const s = u.sid != null ? survivorById(state, u.sid) : null;
  const p = battleParty(state, b);
  const box = { id: b.nextId++, x: u.x, y: u.y, f: u.f || 0, kind: "ground", drop: true, cart, sid: u.sid ?? null, area: null, searched: true, partial: false, label: cart.name, contents: { sup: {}, gear: [] }, ...(opts.staged ? { staged: true } : {}) };
  const cells = ensurePack(cart) || [];
  cells.forEach((it, i) => { if (it) { box.contents.gear.push(it); cells[i] = null; gunLeavesTeam(b, it); } }); // gunload.js: a gun in it goes out loaded
  if (s && holdsOwn(p) && s.gear.carry === cart) for (const l of cartSupOut(state, p, s)) box.contents.sup[l.k] = (box.contents.sup[l.k] || 0) + l.q; // the team's supplies in it leave the pool (as a load set down)
  for (const l of cart.held || []) if (l.q > 0) box.contents.sup[l.k] = (box.contents.sup[l.k] || 0) + l.q;
  delete cart.held;
  fieldLayer(b).containers.push(settlePile(box));
  if (s && s.gear && s.gear.carry === cart) s.gear.carry = null;
  u.bag = null;
  reweigh(state, u);
  if (!opts.quiet) say(b, `${u.name} lets go of the ${cart.name.toLowerCase()}${box.contents.gear.length || Object.keys(box.contents.sup).length ? " (what is in it stays in it)" : ""}: hands free.`, "info");
  return "";
}
// Puts what a cart on the map holds back into the cart item (its grid, its lots) as far as it fits. Returns what did
// not fit: { gear, sup } (still in the box).
function packBox(box) {
  const cart = box.cart;
  const cells = ensurePack(cart) || [];
  for (const it of [...box.contents.gear]) {
    const i = cells.indexOf(null);
    if (i < 0 || itemLoad(it) > cartFree(cart) + EPS || isCart(it)) continue;
    cells[i] = it;
    box.contents.gear.splice(box.contents.gear.indexOf(it), 1);
  }
  for (const [k, v] of Object.entries(box.contents.sup)) {
    if (!(v > EPS) || !SUPPLIES[k]) continue;
    const n = Math.min(v, cartFree(cart) / Math.max(1e-6, supWeight(k)));
    if (n > EPS) { addLot(cart, k, n); box.contents.sup[k] = v - n; if (box.contents.sup[k] <= EPS) delete box.contents.sup[k]; }
  }
  return box.contents;
}
// The box off the map: what is left in it becomes a pile on its cell (the cell's pile if there is one).
function unbox(b, box) {
  const L = lootLayer(b);
  const left = box.contents.gear.length || Object.values(box.contents.sup).some((v) => v > EPS);
  if (left) {
    const pile = pileAt(b, box.x, box.y, box.f || 0);
    if (pile) {
      pile.contents.gear.push(...box.contents.gear);
      for (const [k, v] of Object.entries(box.contents.sup)) if (v > EPS) pile.contents.sup[k] = (pile.contents.sup[k] || 0) + v;
      settlePile(pile);
    } else {
      const loose = { ...box, cart: undefined, label: "On the ground" };
      delete loose.cart;
      L.containers.splice(L.containers.indexOf(box), 1, settlePile(loose));
      return;
    }
  }
  const i = L.containers.indexOf(box);
  if (i >= 0) L.containers.splice(i, 1);
}
// Why this unit cannot take the cart back now ("" when it can).
export function takeRefusal(state, b, u, box) {
  if (!box || !box.cart) return "No cart within reach.";
  if (!u || u.side !== "player" || u.sid == null) return "Only your people take a cart.";
  if ((box.f || 0) !== (u.f || 0) || cheb(u, box) > 1) return `${first(u.name)} has to be next to the ${box.cart.name.toLowerCase()}.`;
  if (u.bag || u.hands) return `Hands full: ${first(u.name)} sets down what they carry first.`;
  if (u.carrying != null || u.dragging != null) return "Hands full: put the body down first.";
  const s = survivorById(state, u.sid);
  if (!s || !s.alive) return "Nobody to push it.";
  ensureInv(s);
  if (s.gear.carry) return `${first(u.name)} already carries the ${s.gear.carry.name}.`;
  if ((u.ap || 0) < CART_FIGHT.take) return "No actions left this turn.";
  return "";
}
// Take cart (CART_FIGHT.take actions): the nearest cart (or `box`) back in the unit's arms, what is in it with it.
export function takeCart(state, b, u, box = null) {
  box = box || cartsNear(b, u)[0] || null;
  const why = takeRefusal(state, b, u, box);
  if (why) return why;
  const s = survivorById(state, u.sid);
  const cart = box.cart;
  packBox(box);
  unbox(b, box);
  s.gear.carry = cart;
  u.bag = cart;
  u.ap -= CART_FIGHT.take;
  u.hunker = false;
  const p = battleParty(state, b);
  if (holdsOwn(p) && partyMembers(state, p).includes(s)) settleHold(state, p); // its lots back in the team's pool, placed in it
  reweigh(state, u);
  say(b, `${u.name} takes the ${cart.name.toLowerCase()} (${r1(itemLoad(cart))} kg): hands full until it is let go.`, "info");
  return "";
}
// combatAct: { type: "letGoCart", unit } (free) and { type: "takeCart", unit, box? } (1 action). Returns "" or an error.
export function cartAct(state, b, act) {
  if (b.phase !== "player") return "Wait for the enemy turn to finish.";
  const u = b.units.find((x) => x.id === act.unit);
  if (!u || u.side !== "player" || u.dead) return "That unit cannot act.";
  if (act.type === "letGoCart") return letGoCart(state, b, u);
  const box = act.box != null ? cartBoxes(b).find((c) => c.id === act.box) || null : null;
  return takeCart(state, b, u, box);
}
// The end of a fight (carry.js armsDropsEnd, settleCarried; before the piles become loot): every cart on the map packed
// again (what does not fit stays a pile), then won: back to its pusher's arms, someone's free arms, the cargo, the
// base's armory, the tile's ground; not won: on the tile's ground. Returns the carts left on the ground.
export function cartsEnd(state, b, outcome) {
  const boxes = cartBoxes(b);
  if (!boxes.length) return [];
  const p = battleParty(state, b);
  const own = holdsOwn(p) ? p : null;
  const home = !p && b.setup && b.setup.baseId != null ? baseById(state, b.setup.baseId) : null;
  const tile = b.tileId ?? (home ? home.tile : null);
  const left = [];
  for (const box of boxes) {
    const cart = box.cart;
    packBox(box);
    unbox(b, box);
    if (outcome === "victory") {
      const s = box.sid != null ? survivorById(state, box.sid) : null;
      const mine = !!(s && s.alive && (own ? partyMembers(state, own).includes(s) : !p));
      if (mine && !(s.gear && s.gear.carry)) { ensureInv(s); s.gear.carry = cart; continue; }
      if (own && cartToArms(state, own, cart)) continue;
      if (own && addGearToCargo(state, own, cart)) continue;
      if (home) { home.armory.push(cart); continue; }
    }
    if (tile != null) { cartOnTile(state, tile, cart); left.push(cart); }
  }
  if (own) settleHold(state, own);
  return left;
}

// ---------- AI groups (coarse) ----------
export const CART_AI = { haul: 0.15, most: 2, find: 1, cap: 0.5 };
// A scavenging party on foot sets out (aiscav.js sendParty): it takes up to CART_AI.most of the group's carts.
export function aiCartsOut(f, q) {
  if (!f || !q || !q.scav || q.vehicle || !(f.carts > 0)) return 0;
  const n = Math.min(f.carts, CART_AI.most, Math.max(1, Math.floor((q.strength || 2) / 2)));
  f.carts -= n;
  q.scav.carts = n;
  return n;
}
// × what a scavenging party brings home an hour (aiscav.js scavSearchHour): its carts.
export const aiCartMult = (p) => 1 + CART_AI.haul * Math.min(CART_AI.most, (p && p.scav && p.scav.carts) || 0);
// Home (aiscav.js scavArrived): its carts back, and now and then one more found where carts are kept (CART_FINDS, over
// the hours it searched; up to CART_AI.cap a person in the group). Returns the carts found.
export function aiCartsHome(state, f, p) {
  if (!f || !p || !p.scav) return 0;
  f.carts = (f.carts || 0) + (p.scav.carts || 0);
  const t = state.tiles[p.scav.site];
  const site = t && t.loc ? CART_FINDS[t.loc.type] : null;
  if (!site || p.vehicle || (f.carts || 0) >= Math.max(1, f.pop * CART_AI.cap)) return 0;
  const hours = AISCAV.searchHours || 4;
  const chance = 1 - Math.pow(1 - Math.min(1, site.p * CART_AI.find), hours);
  if (hash01(state.seed, "aicart", f.id, p.id, state.hour) >= chance) return 0;
  f.carts = (f.carts || 0) + 1;
  return 1;
}

// ---------- saves ----------
// Every load (save.js): carts kept tidy: their grids sized, their lots only real supplies with something in them, a
// cart on a battle map still a cart. Nothing in a save from before carts needs changing.
export function tidyCarts(state) {
  const fix = (it) => {
    if (!isCart(it)) return;
    ensurePack(it);
    if (it.held) { it.held = (Array.isArray(it.held) ? it.held : []).filter((l) => l && SUPPLIES[l.k] && l.q > EPS); if (!it.held.length) delete it.held; }
  };
  for (const s of state.survivors || []) if (s.gear) for (const it of Object.values(s.gear)) fix(it);
  for (const site of state.deathSites || []) for (const e of site.items || []) fix(e.item);
  for (const p of state.parties || []) for (const it of (p.cargo && p.cargo.gear) || []) fix(it);
  for (const b of state.bases || []) for (const it of b.armory || []) fix(it);
  const L = state.combat ? lootLayer(state.combat) : null;
  if (L) for (const c of L.containers) if (c.cart !== undefined && !isCart(c.cart)) delete c.cart;
  for (const f of state.factions || []) if (f.carts != null && !(f.carts >= 0)) f.carts = 0;
}
