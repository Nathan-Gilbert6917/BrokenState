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
// cart walks 180 kg at the felt cost of 36 (plus the cart's own 22 × 0.2).
//   Terrain (cartTerrain; parties.js offroadStep / cartStep, the planner too): roads ×1; off them by the ground stepped
//     onto: a hand cart farmland ×0.85, suburbs and city ×0.9, forest and hills ×0.6, mountains ×0.4; a wheelbarrow
//     ×0.95, ×0.95, ×0.85, ×0.7. The team goes at its slowest cart's.
//   Two on a hand cart (cart.twoMan; carry.js setCartHelp: s.cartHelp / s.cartHelper): a helper halves the pusher's
//     felt share and the drag (a pace m becomes 1 - (1 - m) / 2). The helper's arms are full too (nothing in them; in a
//     fight a pistol one-handed at most). The helper takes no weight: the cost is a second pair of hands.
//   Bike trailer (teamLoad on bikes): each bike tows one cart; its weight and load are off its rider, its free kg added
//     to the racks' (out.trailer).
//   Wear (cartWearStep, from parties.js moveHour): every step on foot off a road wears the wheels (CART_WEAR: farmland
//     0.5, forest and hills 1, mountains 2; GEAR dur 60 and 80). At 0 a wheel is off (cartBroken): it no longer rolls;
//     dragged, its pusher feels cart.broken.frac (75%) and the team goes at half pace everywhere until it is repaired
//     (repair.js "cart wheel": 1 part and 1 scrap at a workbench, or a field repair kit). A broken cart helps no job.
//   Noise: a team searching with a cart makes CART_NOISE.search (×1.05) the Heat (fieldheat.js searchHeatMult).
//   Route wear (cartRouteWear): what a way costs the carts, shown by the planner (estimateTrip cartWearOut / Back) and
//     the team's map menu (moveEstimate cartWear): "this route costs the carts ~12 wear".
//   The base's jobs (baseCarts: its armory's and its people's carts, not broken): the first woodcutters (woodcutting.js
//     woodTrip) and then the builders (buildings.js buildRate) haul CART_JOB (10%) more, one a cart.
//
// THE GROUND (State Map). Set down (carry.js dropBag / dropHands / dropItemToGround) or left after a fight, a cart lies
// on the tile's ground (state.deathSites, one item with everything in it: carry.js cartToGround: its share of the pool
// leaves it as lots). The marker names it with its weight ("Cargo left behind: Hand cart (84 kg)", markers.js). Any team
// on the tile picks it up (pickUpGround: into someone's free arms, else the cargo); the Recover mission and the
// governor fetch it the same way (parties.js recover: cartToArms first). A new world has a few carts abandoned on the
// roads near towns (seedRoadCarts: site.abandoned, "Abandoned cart: ...", seen when a team or a base sees the tile). Scavengers strip it as they strip a site
// (economy.js deathSitesDaily: the most valuable thing in it first, then the cart itself, which the nearest group keeps:
// f.carts).
//
// FIGHTS (tactical, the iso view). A cart is a 1x1 object on the battle map: a container of the loot layer (raidloot.js
// lootLayer, ground.js) { kind: "ground", cart: <the item>, x, y, f, sid, side, contents: { sup, gear } }: a pile for
// every rule (reach, the search window, fire and blasts on what is in it, the enemy snatching a gun out of it) but drawn
// as the cart (ui/ground.js drawCartIso) and never the pile an item is dropped on (ground.js groundAt skips it).
//   Held (u.bag is the cart): it rolls with its pusher, drawn beside them; pushing alone costs CART_FIGHT.mob tiles a
//     move (carrykit.js weighPlayer; a helper next to them: full pace) and the pusher's battle kg counts it at frac.
//     It rattles: every move, the unaware within CART_FIGHT.rattle come to look and the dead within CART_FIGHT.wake
//     wake. A pistol fires one-handed (Shoot only, CART_FIGHT.oneHandAim off the aim; no reload, no overwatch, no long
//     gun): the pusher and a helper alike.
//   Park cart (parkCart, CART_FIGHT.park = 1 action): on one of the four cells beside its pusher, left, right, in front
//     or behind (no corner, nothing further; the UI highlights the free ones). Let go (letGoCart, free; Drop carried
//     does the same) is the emergency drop: the free side cell nearest the other side, else under their feet (no
//     barricade). Its items and supplies stay in it (the supplies leave the pool, as a load set down does). Its cell is
//     a barricade (the user's pick): CELL cart, nobody walks through it (both sides' pathing and the dead's go round),
//     low cover (1) for whoever stands beside it, sight passes. Knocked out of the way (cartKnocked), the cell is open
//     again and the cart stays there with all in it: battered over by the dead (c.hp: cart.hp 10 and 16; their siege
//     field counts it; CART_WEAR.bash), smashed aside by a brute in one blow (zombietypes.js; CART_WEAR.brute 15),
//     driven through by a vehicle (combat.js driveTo, RAMMING.WEAR.cart 3 to the vehicle; CART_WEAR.ram 25: wrecked).
//     It can plug a doorway (a doorway, a broken door, a breach are parkable).
//   What is in a cart is had only through the cart (the user's rule): Load cart (the search window on the cart) or
//     Take cart; never off the ground (ground.js pilesNear skips carts: the Ground window and Pick up do not list it),
//     never spilled (its grid's slots and kg are checked going in, boxRefusal, so it always packs back in). On the
//     State Map the same: take the cart whole, or open it there (carry.js takeFromGroundCart: one thing out of it at a
//     time); scavengers open it too (economy.js: the best thing in it first, then the cart).
//   Take cart (takeCart, 1 action, next to it, free arms): back in the arms, what is in it back in its grid and lots
//     (the pool again), what no longer fits stays on the cell as a pile; the cell is what it was.
//   The enemy's raiders park theirs (enemyCartsLetGo, an action as yours) on the side cell facing your people, and fight
//     from behind it.
//   Two on a hand cart: a pair from the State Map starts the fight so (cartHelpStart) when they stand side by side; the
//     helper follows each move of the pusher (1 action) onto a free cell next to them, or lets go; moving off alone or
//     Let go ends it.
//   Loading: anyone next to it opens it in the search window (Load cart / Ground) and drags things in or out: park it,
//     loot the bodies and piles round it into it (boxFree: its kg; raidloot.js checks).
//   Found on the map (placeMapCarts, its own dice): a raid's barns, garages, workshops, warehouses and farmhouses (now
//     and then a house or a store) and a fight by a road (12%) may have an abandoned cart standing (MAP_CARTS). Taken,
//     it is the team's; untouched, it stays part of the place.
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
// not strip it faster); a party lost is its carts lost. Their own land yields up to CART_JOB more with carts
// (aiWorkMult). In a fight with their scavengers (conflicts.js startFight: setup.enemy.carts) as many of their fighters
// push a cart loaded with part of their haul, drawn as yours; they let go when their side first moves
// (enemyCartsLetGo, your battle AI's rule); beaten, the carts and what is left in them are yours; else they keep them.
// What stays abstract: their caravans carry no carts, and a group's base jobs are not per worker.
import { GEAR, SUPPLIES, supWeight, supValue } from "./data.js";
import { itemLoad, itemKg, ensurePack, ensureInv, lootItem } from "./inventory.js";
import { siteSource } from "./itemcond.js";
import { CELL, alertNear, evacAt } from "./combat.js"; // the battle map's cells (a cart parked: CELL cart); noise
import { noiseAt } from "./stealth.js"; // a cart pushed rattles
import { survivorById, baseById, log, newId } from "./world.js";
import { lootLayer, fieldLayer } from "./raidloot.js"; // call-time only (safe in the import cycle)
import { settlePile, groundAt as pileAt } from "./ground.js";
import { say } from "./combat.js";
import { gunLeavesTeam } from "./gunload.js";
import { weighPlayer } from "./carrykit.js";
import { partyMembers, addGearToCargo } from "./parties.js";
import { holdsOwn, settleHold, cartSupOut, cartOnTile, cartToArms, groundGearOf } from "./carry.js";
import { hash01 } from "./skills.js";
import { itemDur, wear } from "./crafting.js"; // a cart's wear (a broken wheel at 0)
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
// Worn to 0 (crafting.js itemDur): a wheel off. It no longer rolls: dragged, its pusher feels cart.broken.frac of it
// and the team goes at cart.broken.pace everywhere, roads too, until it is repaired (repair.js "cart").
export const cartBroken = (item) => { if (!isCart(item)) return false; const d = itemDur(item); return d != null && d <= 0; };
// Someone helping push this survivor's cart (two-person carts, cartHelp): the helper's id, or null.
export const helperOf = (s) => (s && s.cartHelper != null && cartOf(s) && cartSpec(cartOf(s)).twoMan ? s.cartHelper : null);
// The share of a cart its pusher feels: its own (broken: dragged), half with a helper.
export function cartFrac(item, s = null) {
  const sp = cartSpec(item);
  if (!sp) return 1;
  const f = cartBroken(item) ? (sp.broken ? sp.broken.frac : 1) : sp.frac;
  return s && helperOf(s) != null && s.gear && s.gear.carry === item ? f / 2 : f;
}
// What its pusher feels of it (itself, its items, its lots). s: the pusher (a helper halves it).
export const feltKg = (item, s = null) => (isCart(item) ? itemLoad(item) * cartFrac(item, s) : itemLoad(item));
// What an item someone has weighs on them: a cart in their arms at its share (load.js wornLoad, carrykit.js battleKg).
export const itemOnKg = (s, it) => (it && s && s.gear && it === s.gear.carry && isCart(it) ? feltKg(it, s) : itemLoad(it));
// × the pace of a step onto terrain `ter` (road: on a road) for this pusher's cart: 1 on roads, its terrain's off them; a
// helper halves what it costs; broken: its broken pace everywhere.
export function cartPace(item, ter, road = false, helped = false) {
  const sp = cartSpec(item);
  if (!sp) return 1;
  if (cartBroken(item)) return sp.broken ? sp.broken.pace : 0.5;
  const m = road ? 1 : (sp.terrain && sp.terrain[ter]) ?? 1;
  return helped ? 1 - (1 - m) / 2 : m;
}
const TERS = ["plains", "forest", "hills", "mountain", "suburb", "city"];
// The team on foot's pace by terrain with these people's carts, the slowest cart's: { road, plains, forest, ... }, or
// null with no cart (load.js burdenRecord: p.burden.cartTer; parties.js offroadStep). Towed by bikes: no drag (null).
export function cartTerrain(members) {
  const carts = (members || []).filter((s) => cartOf(s));
  if (!carts.length) return null;
  const out = { road: Math.min(...carts.map((s) => cartPace(cartOf(s), null, true, helperOf(s) != null))) };
  for (const t of TERS) out[t] = Math.min(...carts.map((s) => cartPace(cartOf(s), t, false, helperOf(s) != null)));
  return Object.values(out).some((v) => v < 1) ? out : null;
}
// Wear a step wears a cart by the ground (CART_WEAR; a road nothing); a blow on its cell in a fight: bash.
export const CART_WEAR = { road: 0, plains: 0.5, suburb: 0.5, city: 0.5, forest: 1, hills: 1, mountain: 2, bash: 3, brute: 15, ram: 25 }; // bash: battered over by the dead; brute: a brute's one blow; ram: driven through

// The wear a way costs the carts of a team on foot (the planner, the team's map menu): every step off a road by its
// ground (CART_WEAR), as cartWearStep wears them.
export function cartRouteWear(state, path) {
  let n = 0;
  for (let i = 1; i < (path || []).length; i++) {
    const a = state.tiles[path[i - 1]], t = state.tiles[path[i]];
    if (!t) continue;
    if (a && a.roadLinks && a.roadLinks.includes(path[i])) continue;
    n += CART_WEAR[t.terrain] ?? 0.5;
  }
  return Math.round(n * 10) / 10;
}
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

// A cart rattles: a team searching with one makes CART_NOISE.search × the Heat (fieldheat.js searchHeatMult); in a fight
// see CART_FIGHT.rattle / wake.
export const CART_NOISE = { search: 1.05 };

// ---------- wear (the State Map) ----------
// A team on foot steps from tile `from` onto `to` (parties.js moveHour): every cart pushed wears by the ground
// (CART_WEAR: a road nothing, rough ground more). Worn to 0 a wheel is off (cartBroken: it drags). Returns true when one
// broke on this step (the team is weighed again: its pace drops at once).
export function cartWearStep(state, p, from, to) {
  if (from == null || to == null || !state.tiles[to]) return false;
  const road = !!(state.tiles[from] && state.tiles[from].roadLinks && state.tiles[from].roadLinks.includes(to));
  const n = road ? CART_WEAR.road : CART_WEAR[state.tiles[to].terrain] ?? 0.5;
  if (!(n > 0)) return false;
  let broke = false;
  for (const s of partyMembers(state, p)) {
    const c = cartOf(s);
    if (!c || cartBroken(c) || itemDur(c) == null) continue;
    if (wear(c, n)) { broke = true; log(state, `The wheel of ${s.name.split(" ")[0]}'s ${c.name.toLowerCase()} gives out on the rough ground: it drags now (half pace). A workbench or a field repair kit mends it (parts).`, "warn"); }
  }
  return broke;
}

// ---------- fights ----------
// mob: tiles less a move while pushing one alone; take: actions to take one back; oneHandAim: aim off a one-handed
// pistol shot while holding a cart (pushing or helping); rattle / wake: tiles a cart pushed is heard (the unaware come
// to look) and wakes the dead outright.
export const CART_FIGHT = { mob: 1, take: 1, park: 1, oneHandAim: 15, rattle: 6, wake: 2 }; // park: actions to park it on a chosen side cell
const cheb = (u, c) => Math.max(Math.abs(u.x - c.x), Math.abs(u.y - c.y));
const battleParty = (state, b) => (state && b && b.setup && b.setup.partyId != null ? state.parties.find((x) => x.id === b.setup.partyId) || null : null);
// The carts on the battle map (not held).
export const cartBoxes = (b) => { const L = lootLayer(b); return L ? L.containers.filter((c) => c.cart) : []; };
// The carts on or next to the unit, its own cell first.
export const cartsNear = (b, u) => (u ? cartBoxes(b).filter((c) => (c.f || 0) === (u.f || 0) && cheb(u, c) <= 1).sort((a, c) => cheb(u, a) - cheb(u, c)) : []);
export const holdsCart = (u) => !!(u && isCart(u.bag));
// The kg in a cart on the map (its items and supplies) and the kg more it takes.
export const boxKg = (c) => (c && c.contents ? c.contents.gear.reduce((a, g) => a + itemLoad(g), 0) + Object.entries(c.contents.sup).reduce((a, [k, v]) => a + (v > 0 ? v * supWeight(k) : 0), 0) : 0);
export const boxFree = (c) => (c && c.cart ? Math.max(0, cartSpec(c.cart).cap - boxKg(c)) : Infinity);
// A move into a cart on the map that would overfill it (raidloot.js): "" or why not.
// item: an item going in (its grid has GEAR slots: what is in a cart always fits back into it, nothing spills).
export const boxRefusal = (c, kg, item = false) => (!c || !c.cart ? "" : kg > boxFree(c) + EPS ? `The ${c.cart.name} is full (${r1(boxFree(c))} kg more fits).` : item && c.contents.gear.length >= ((GEAR[c.cart.key] && GEAR[c.cart.key].slots) || 0) ? `The ${c.cart.name} is full (all ${GEAR[c.cart.key].slots} slots taken).` : "");
function reweigh(state, u) {
  if (u.sid == null) { // the enemy's (enemyCarts): its tile back when it lets go
    if (!holdsCart(u) && u.cartMobCut) { u.mob += CART_FIGHT.mob; u.cartMobCut = false; }
    return;
  }
  const s = state ? survivorById(state, u.sid) : null;
  if (s && u.mob0 == null && u.dragMob == null) weighPlayer(u, s); // carriers.js / medics.js keep their own mob while carrying someone
}
// A pistol (a handgun) held while a hand is on a cart: shot one-handed (Shoot only, CART_FIGHT.oneHandAim off the aim; no
// reload, no overwatch, nothing two-handed). The pusher and a helper alike; not with supplies in the arms too.
const isPistol = (key) => !!(GEAR[key] && GEAR[key].cat === "pistol");
export const oneHandOk = (u) => !!(u && (holdsCart(u) || u.cartHelp != null) && !u.hands && u.carrying == null && u.dragging == null && isPistol(u.weapon));

// The cells of floor f (a building's storeys: buildingmaps.js) and a cell's index.
const cellsOf = (b, f = 0) => (b.floors && (f || 0) !== (b.floor || 0) && b.floors[f] ? b.floors[f].cells : b.cells);
const NOPARK = new Set(["gate", "tanktrap", "vehicle", "cart"]);
// Can a cart stand on this cell as a barricade: plain ground or an opening (a doorway, a broken door, a breach), no
// trap, no height, nothing on it (a unit, a body, another cart).
function parkable(b, x, y, f) {
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return false;
  const c = cellsOf(b, f)[y * b.w + x];
  const d = c && CELL[c.k];
  if (!d || !d.walk || d.trap || d.h || d.climb || d.perch || c.h || NOPARK.has(c.k)) return false;
  if (b.units.some((o) => o.x === x && o.y === y && (o.f || 0) === f && !o.left && !o.off && !o.fled && !o.aboard && !o.burnt)) return false;
  return !cartBoxes(b).some((o) => o.x === x && o.y === y && (o.f || 0) === f);
}
// The four cells beside a unit a cart can stand on: left, right, in front, behind (no corner, nothing further).
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const isSide = (u, x, y) => Math.abs(x - u.x) + Math.abs(y - u.y) === 1;
// Where a let-go cart stands: the side cell asked if it can, else the free side cell nearest the other side (the
// barricade goes between, it covers its pusher from there: coverAgainst counts sides only), else under their feet
// without blocking (no room). [x, y, blocks].
function parkAt(b, u, at = null) {
  const f = u.f || 0;
  if (at && isSide(u, at[0], at[1]) && parkable(b, at[0], at[1], f)) return [at[0], at[1], true];
  const foes = b.units.filter((o) => o.side !== u.side && !o.dead && !o.left && !o.fled && !o.off && (o.f || 0) === f && (o.kind === "human" || o.kind === "zombie"));
  const near = (x, y) => (foes.length ? Math.min(...foes.map((o) => Math.hypot(o.x - x, o.y - y))) : 0);
  const cand = SIDES.map(([dx, dy]) => [u.x + dx, u.y + dy]).filter(([x, y]) => parkable(b, x, y, f));
  if (!cand.length) return [u.x, u.y, false];
  cand.sort((a, c) => near(a[0], a[1]) - near(c[0], c[1]) || a[1] - c[1] || a[0] - c[0]);
  return [cand[0][0], cand[0][1], true];
}
// The cart's cell a barricade (CELL cart: no walking through, low cover; the dead batter it over, cart.hp), what was
// there kept to put back.
function block(b, box) {
  const c = cellsOf(b, box.f || 0)[box.y * b.w + box.x];
  box.under = { k: c.k, ...(c.hp != null ? { hp: c.hp } : {}), ...(c.mhp != null ? { mhp: c.mhp } : {}) };
  c.k = "cart";
  c.hp = c.mhp = cartSpec(box.cart).hp || 10;
  box.blocking = true;
  if (b.losCache) b.losCache.fill(0);
}
function unblock(b, box) {
  if (!box.blocking) return;
  const c = cellsOf(b, box.f || 0)[box.y * b.w + box.x];
  if (c && c.k === "cart") {
    const u = box.under || { k: "open" };
    c.k = u.k;
    if (u.hp != null) c.hp = u.hp; else delete c.hp;
    if (u.mhp != null) c.mhp = u.mhp; else delete c.mhp;
  }
  box.blocking = false;
  delete box.under;
  if (b.losCache) b.losCache.fill(0);
}
// A cart on its cell knocked out of the way: battered over by the dead (combat.js breakCell, how "bash"), smashed by a
// brute in one blow (zombietypes.js bruteTurn, "brute"), driven through by a vehicle (combat.js driveTo, "ram"). Its
// cell is open again; the cart stays there with everything still in it (nothing spills: what is in a cart is had only
// through the cart, Load cart or Take cart), worn by CART_WEAR[how] (a ram or a brute may break a wheel).
export function cartKnocked(b, x, y, how = "bash") {
  const box = cartBoxes(b).find((c) => c.blocking && c.x === x && c.y === y && (c.f || 0) === (b.floor || 0));
  if (!box) { const c = b.cells[y * b.w + x]; c.k = "open"; delete c.hp; delete c.mhp; return; }
  const c = b.cells[y * b.w + x];
  c.k = "cart"; // unblock puts back what was there
  unblock(b, box);
  if (itemDur(box.cart) != null) wear(box.cart, CART_WEAR[how] ?? CART_WEAR.bash);
  const what = box.cart.name.toLowerCase(), broke = cartBroken(box.cart) ? " A wheel is off." : "";
  say(b, how === "brute" ? `A brute smashes the ${what} aside in one blow: the way is open.${broke}` : how === "ram" ? `The vehicle rams through the ${what}, wrecking it: the way is open.${broke}` : `The ${what} is shoved over: the way is open.${broke}`, "danger");
}

// ---------- two on a hand cart (twoMan) ----------
// A helper (u.cartHelp: the pusher's unit id; the pusher's u.cartHelped: theirs) next to the pusher: the pusher
// moves at full pace, and the helper's hands are full (one-handed pistol at most). When the pusher moves the helper
// follows onto a free cell next to them (1 action), or lets go if they cannot; moving off on their own, letting go or
// the pusher letting go ends it. The team's pair on the State Map (survivors' cartHelp / cartHelper) starts it.
export function cartHelpStart(state, b) {
  for (const u of b.units) {
    if (u.side !== "player" || u.sid == null || u.cartHelp != null) continue;
    const s = survivorById(state, u.sid);
    if (!s || s.cartHelp == null) continue;
    const pu = b.units.find((o) => o.side === "player" && o.sid === s.cartHelp && holdsCart(o) && cartSpec(o.bag).twoMan && o.cartHelped == null);
    if (!pu || cheb(u, pu) !== 1 || u.bag || u.hands) continue;
    u.cartHelp = pu.id; pu.cartHelped = u.id;
    reweigh(state, pu);
  }
}
export function endHelp(state, b, u) {
  const pu = u && u.cartHelp != null ? b.units.find((o) => o.id === u.cartHelp) : u && u.cartHelped != null ? u : null;
  const hu = pu && pu.cartHelped != null ? b.units.find((o) => o.id === pu.cartHelped) : null;
  if (hu) hu.cartHelp = null;
  if (pu) { pu.cartHelped = null; reweigh(state, pu); }
}
// After a unit moved (combat.js "move"): a pusher's helper follows; a helper who moved on their own lets go; a cart
// pushed rattles (the unaware within CART_FIGHT.rattle come to look, the dead within CART_FIGHT.wake wake).
export function cartMoved(state, b, u) {
  if (u.cartHelp != null) endHelp(state, b, u);
  if (u.cartHelped != null) {
    const hu = b.units.find((o) => o.id === u.cartHelped);
    let spot = null;
    if (hu && !hu.dead && !hu.down && (hu.ap || 0) >= 1) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = u.x + dx, y = u.y + dy;
        if ((!dx && !dy) || !parkable(b, x, y, u.f || 0)) continue;
        const d = Math.max(Math.abs(hu.x - x), Math.abs(hu.y - y));
        if (!spot || d < spot.d) spot = { x, y, d };
      }
    }
    if (spot) { hu.x = spot.x; hu.y = spot.y; hu.f = u.f || 0; hu.ap -= 1; hu.hunker = false; }
    else endHelp(state, b, u);
  }
  if (holdsCart(u)) {
    noiseAt(b, u.x, u.y, CART_FIGHT.rattle, "cart");
    alertNear(b, u.x, u.y, CART_FIGHT.wake, `The rattle of ${u.name.split(" ")[0]}'s ${u.bag.name.toLowerCase()} wakes the dead close by.`);
  }
}

// Let go (free): the cart stands on a cell next to its pusher (opts.at: the one asked; else the free one nearest the
// other side) as a barricade, everything in it; with no free cell, under their feet (no barricade). A helper letting
// go just lets go. opts.staged: a fight the team starts (carry.js stageLoads); opts.quiet: no line.
export function letGoCart(state, b, u, opts = {}) {
  if (u && u.cartHelp != null && !holdsCart(u)) { endHelp(state, b, u); if (!opts.quiet) say(b, `${u.name} lets go of the cart: hands free.`, "info"); return ""; }
  const cart = u && isCart(u.bag) ? u.bag : null;
  if (!cart) return "Not pushing a cart.";
  if (u.cartHelped != null) endHelp(state, b, u);
  const s = u.sid != null && state ? survivorById(state, u.sid) : null;
  const p = battleParty(state, b);
  const [x, y, blocks] = u.dead ? [u.x, u.y, false] : parkAt(b, u, opts.at || null);
  const box = { id: b.nextId++, x, y, f: u.f || 0, kind: "ground", drop: true, cart, sid: u.sid ?? null, side: u.side, area: null, searched: true, partial: false, label: cart.name, contents: { sup: {}, gear: [] }, ...(opts.staged ? { staged: true } : {}), ...(u.cartParty != null ? { aiParty: u.cartParty } : {}) };
  const cells = ensurePack(cart) || [];
  cells.forEach((it, i) => { if (it) { box.contents.gear.push(it); cells[i] = null; gunLeavesTeam(b, it); } }); // gunload.js: a gun in it goes out loaded
  if (s && holdsOwn(p) && s.gear.carry === cart) for (const l of cartSupOut(state, p, s)) box.contents.sup[l.k] = (box.contents.sup[l.k] || 0) + l.q; // the team's supplies in it leave the pool (as a load set down)
  for (const l of cart.held || []) if (l.q > 0) box.contents.sup[l.k] = (box.contents.sup[l.k] || 0) + l.q;
  delete cart.held;
  fieldLayer(b).containers.push(settlePile(box));
  if (blocks) block(b, box);
  if (s && s.gear && s.gear.carry === cart) s.gear.carry = null;
  u.bag = null;
  reweigh(state, u);
  if (!opts.quiet) say(b, `${u.name} lets go of the ${cart.name.toLowerCase()}${blocks ? " (it stands as low cover in the way)" : ""}${box.contents.gear.length || Object.keys(box.contents.sup).length ? ", what is in it stays in it" : ""}: hands free.`, u.side === "player" ? "info" : "danger");
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
// The box off the map (its cell open again): what is left in it becomes a pile on its cell (the cell's pile if any).
function unbox(b, box) {
  unblock(b, box);
  const L = lootLayer(b);
  const left = box.contents.gear.length || Object.values(box.contents.sup).some((v) => v > EPS);
  if (left) {
    const pile = pileAt(b, box.x, box.y, box.f || 0);
    if (pile) {
      pile.contents.gear.push(...box.contents.gear);
      for (const [k, v] of Object.entries(box.contents.sup)) if (v > EPS) pile.contents.sup[k] = (pile.contents.sup[k] || 0) + v;
      settlePile(pile);
    } else {
      const loose = { ...box, label: "On the ground" };
      for (const k of ["cart", "blocking", "under", "found", "aiParty", "side", "sid", "staged"]) delete loose[k];
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
  if (u.bag || u.hands || u.cartHelp != null) return `Hands full: ${first(u.name)} sets down what they carry first.`;
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
  const theirs = box.aiParty != null;
  packBox(box);
  unbox(b, box);
  if (theirs) { const q = state.parties.find((x) => x.id === box.aiParty); if (q && q.scav && q.scav.carts > 0) q.scav.carts--; } // the scavengers' cart, taken off them
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
// combatAct: { type: "letGoCart", unit } (free, the emergency: the nearest free side cell, else under their feet),
// { type: "parkCart", unit, x, y } (CART_FIGHT.park actions: on the side cell asked: left, right, in front or behind)
// and { type: "takeCart", unit, box? } (1 action). Returns "" or an error.
export function cartAct(state, b, act) {
  if (b.phase !== "player") return "Wait for the enemy turn to finish.";
  const u = b.units.find((x) => x.id === act.unit);
  if (!u || u.side !== "player" || u.dead) return "That unit cannot act.";
  if (act.type === "letGoCart") return letGoCart(state, b, u);
  if (act.type === "parkCart") {
    if (!holdsCart(u)) return "Not pushing a cart.";
    const x = Number(act.x), y = Number(act.y);
    if (!isSide(u, x, y) || !parkable(b, x, y, u.f || 0)) return "Park it on a free cell beside them: left, right, in front or behind (open ground or a doorway, nobody on it).";
    if ((u.ap || 0) < CART_FIGHT.park) return "No actions left this turn (parking takes one; Let go is free).";
    u.ap -= CART_FIGHT.park;
    return letGoCart(state, b, u, { at: [x, y] });
  }
  const box = act.box != null ? cartBoxes(b).find((c) => c.id === act.box) || null : null;
  return takeCart(state, b, u, box);
}
// The free side cells a unit could park its cart on (the UI's Park cart: the four highlighted).
export const parkCells = (b, u) => (holdsCart(u) ? SIDES.map(([dx, dy]) => [u.x + dx, u.y + dy]).filter(([x, y]) => parkable(b, x, y, u.f || 0)) : []);

// ---------- carts found on the map ----------
// A raid's barns, garages, workshops and warehouses (now and then a house or a store), and a fight by a road: an
// abandoned cart stands there as a cart on the map (a barricade on its cell), its own dice (hash01: nothing else of the
// map changes). Taken (Take cart) it is the team's; untouched it stays part of the place when the fight ends.
export const MAP_CARTS = { areas: { barn: 0.35, garage: 0.25, workshop: 0.2, warehouse: 0.25, farmhouse: 0.2, house: 0.05, store: 0.05 }, road: 0.12 };
function foundCart(state, b, x, y, f, key, tag) {
  if (!parkable(b, x, y, f) || x < 2 || y < 1 || x > b.w - 3 || y > b.h - 2 || evacAt(b, x, y)) return null; // not on the way out (the evac strip, the edges)
  const roll = (...k) => hash01(state.seed, "mapcart", b.tileId ?? 0, tag, ...k);
  const cart = lootItem(key, siteSource(key === "handcart" ? "farm" : "hardware"), roll("q"));
  const box = { id: b.nextId++, x, y, f, kind: "ground", drop: true, cart, sid: null, side: null, found: true, area: null, searched: true, partial: false, label: `${cart.name} (abandoned)`, contents: { sup: {}, gear: [] } };
  if (roll("load") < 0.4) box.contents.sup.scrap = 1 + Math.floor(roll("n") * 4);
  if (roll("wood") < 0.25) box.contents.sup.wood = 20 + Math.floor(roll("w") * 60);
  fieldLayer(b).containers.push(settlePile(box));
  block(b, box);
  return box;
}
// createBattle / createRaid (after the units are placed): the carts found on this map. Returns how many.
export function placeMapCarts(state, b) {
  if (!state || !b || b.setup && b.setup.baseId != null) return 0;
  let n = 0;
  const R = b.raid;
  if (R && Array.isArray(R.areas)) {
    for (const a of R.areas) {
      const p = MAP_CARTS.areas[a.type];
      if (!p || a.x0 == null || hash01(state.seed, "mapcart", b.tileId ?? 0, "area", a.id) >= p) continue;
      const cells = [];
      for (let y = a.y0; y < a.y0 + (a.h || 1); y++) for (let x = a.x0; x < a.x0 + (a.w || 1); x++) cells.push([x, y]);
      const start = Math.floor(hash01(state.seed, "mapcart", b.tileId ?? 0, "cell", a.id) * cells.length);
      for (let i = 0; i < cells.length; i++) {
        const [x, y] = cells[(start + i) % cells.length];
        if (R.zones && R.zones.some((z) => x >= z.x0 && x < z.x0 + z.w && y >= z.y0 && y < z.y0 + z.h)) continue;
        if (R.containers.some((c) => !c.cart && x >= c.x && x < c.x + (c.w || 1) && y >= c.y && y < c.y + (c.h || 1))) continue;
        const key = hash01(state.seed, "mapcart", b.tileId ?? 0, "kind", a.id) < (a.type === "barn" || a.type === "farmhouse" || a.type === "warehouse" ? 0.55 : 0.2) ? "handcart" : "wheelbarrow";
        if (foundCart(state, b, x, y, a.f || 0, key, `a${a.id}`)) { n++; break; }
      }
    }
  } else if (!R && b.tileId != null && state.tiles[b.tileId] && state.tiles[b.tileId].road && hash01(state.seed, "mapcart", b.tileId, "road", state.hour) < MAP_CARTS.road) {
    const road = [];
    for (let i = 0; i < b.cells.length; i++) if (b.cells[i].f === "road") road.push(i);
    const start = Math.floor(hash01(state.seed, "mapcart", b.tileId, "roadcell", state.hour) * Math.max(1, road.length));
    for (let j = 0; j < road.length; j++) {
      const i = road[(start + j) % road.length], x = i % b.w, y = Math.floor(i / b.w);
      let done = false;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h || b.cells[ny * b.w + nx].f === "road") continue; // the roadside, not the road
        if (b.units.some((o) => Math.max(Math.abs(o.x - nx), Math.abs(o.y - ny)) <= 2)) continue; // not on top of anyone
        if (foundCart(state, b, nx, ny, 0, hash01(state.seed, "mapcart", b.tileId, "roadkind", state.hour) < 0.5 ? "handcart" : "wheelbarrow", "road")) { n++; done = true; break; }
      }
      if (done) break;
    }
  }
  if (n) say(b, `${n === 1 ? "An abandoned cart stands" : `${n} abandoned carts stand`} on this map (low cover; Take cart, next to it, to push it off with you).`, "info");
  return n;
}

// ---------- the enemy's carts (AI parity) ----------
// A scavenging party with carts (aiscav.js q.scav.carts; conflicts.js setup.enemy.carts / cartPartyId): that many of its
// fighters start pushing one, each carrying a share of its haul (q.scav.got: half of it, split). They let go when
// their side first moves (enemyCartsLetGo), the battle AI's rule as yours; their carts stand on the map like yours (the
// search window, Take cart: yours then). Beaten, what is left of them is yours (cartsEnd); you lose or pull out, they
// keep them and what is in them (back into the party's haul).
export function enemyCarts(state, b) {
  const e = b.setup && b.setup.enemy;
  if (!e || !(e.carts > 0) || e.cartPartyId == null) return 0;
  const q = state.parties.find((x) => x.id === e.cartPartyId && x.scav);
  if (!q) return 0;
  const who = b.units.filter((u) => u.side === "enemy" && u.kind === "human" && !u.aboard && !u.dead).slice(0, e.carts);
  for (const [i, u] of who.entries()) {
    const key = hash01(state.seed, "aicart", q.id, i) < 0.5 ? "handcart" : "wheelbarrow";
    const cart = lootItem(key, siteSource("farm"), hash01(state.seed, "aicartq", q.id, i));
    for (const [k, v] of Object.entries(q.scav.got || {})) {
      if (!SUPPLIES[k] || !(v >= 1)) continue;
      const n = Math.min(Math.floor((v * 0.5) / (who.length - i)), Math.floor(cartFree(cart) / Math.max(1e-6, supWeight(k))));
      if (n >= 1) { addLot(cart, k, n); q.scav.got[k] = v - n; }
    }
    u.bag = cart; u.cartParty = q.id;
    u.mob = Math.max(2, u.mob - CART_FIGHT.mob); u.cartMobCut = true;
  }
  if (who.length) say(b, `${who.length === 1 ? "One of them pushes a cart" : `${who.length} of them push carts`} loaded with what they found.`, "info");
  return who.length;
}
// The enemy's side moves (combat.js endPlayerTurn, after their actions are given out): every one of theirs holding a cart
// parks it as cover (1 action, as yours: on the side cell facing you, parkAt; then they fight from behind it); the dead
// let go where they lie. Returns the living who parked (combat.js takes the action off them).
export function enemyCartsLetGo(state, b) {
  const parked = [];
  for (const u of b.units) {
    if (u.side === "player" || !holdsCart(u)) continue;
    const live = !u.dead && !u.down;
    letGoCart(state, b, u, { quiet: !live });
    if (live) { parked.push(u); const box = cartBoxes(b).find((c) => c.aiParty != null && c.blocking && isSide(u, c.x, c.y)); if (box) say(b, `${u.name} shoves the ${box.cart.name.toLowerCase()} out in front as cover.`, "danger"); }
  }
  return parked;
}

// The end of a fight (carry.js armsDropsEnd, settleCarried; before the piles become loot): every cart on the map packed
// again (what does not fit stays a pile), then:
//   found on the map and never taken: it stays part of the place (gone with the map);
//   the enemy's: won, yours (as below); else back to them, what is in it back in their haul;
//   yours: won, back to its pusher's arms, someone's free arms, the cargo, the base's armory, the tile's ground; not
//   won, on the tile's ground. Returns the carts left on the ground.
export function cartsEnd(state, b, outcome) {
  for (const u of b.units) if (u.side !== "player" && holdsCart(u)) letGoCart(state, b, u, { quiet: true }); // never let go: where they are
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
    if (box.found) continue;
    if (box.aiParty != null) {
      const q = state.parties.find((x) => x.id === box.aiParty && x.scav);
      if (outcome !== "victory") { if (q) { for (const l of cart.held || []) q.scav.got[l.k] = (q.scav.got[l.k] || 0) + l.q; } continue; }
      if (q && q.scav.carts > 0) q.scav.carts--;
    }
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

// ---------- abandoned on the State Map ----------
// A new world (world.js createWorld): road tiles near towns and cities (ROAD_CARTS.range tiles of one) now and then
// have a cart abandoned on them (ROAD_CARTS.p a tile, its own dice: nothing else of the world changes), sometimes with a
// little in it (scrap, firewood, a fuel can). A ground site like any (state.deathSites, site.abandoned: its marker reads
// "Abandoned cart: ..."), seen when a team or a base sees the tile (markers.js live markers), taken as any cart on the
// ground (pickUpGround, the Recover mission). The groups' scavengers find them too, slowly (economy.js deathSitesDaily:
// ×ROAD_CARTS.scav its chance a day): the nearest group keeps the cart (f.carts).
export const ROAD_CARTS = { p: 0.08, range: 2, scav: 0.05 }; // scav: × the scavengers' chance a day (no ageing: a cart on a road is not a fresh death site)
export function seedRoadCarts(state) {
  const towns = state.tiles.filter((t) => t.loc && (t.loc.type === "town" || t.loc.type === "city"));
  if (!towns.length) return 0;
  let n = 0;
  for (const t of state.tiles) {
    if (!t.road || t.loc || t.terrain === "water" || state.bases.some((b) => b.tile === t.id)) continue;
    if (!towns.some((w) => state.grid.distance(w.id, t.id) <= ROAD_CARTS.range)) continue;
    const roll = (...k) => hash01(state.seed, "roadcart", t.id, ...k);
    if (roll("p") >= ROAD_CARTS.p) continue;
    const cart = lootItem(roll("kind") < 0.6 ? "wheelbarrow" : "handcart", siteSource("town"), roll("q"));
    const r = roll("load");
    if (r < 0.25) addLot(cart, "scrap", 2 + Math.floor(roll("n") * 5));
    else if (r < 0.45) addLot(cart, "wood", 30 + Math.floor(roll("n") * 70));
    else if (r < 0.55) addLot(cart, "fuel", 1 + Math.floor(roll("n") * 2));
    const site = { id: newId(), tile: t.id, items: [], day: 0, names: [], lastConfirmed: 0, abandoned: true };
    site.items.push(groundGearOf(cart));
    state.deathSites.push(site);
    n++;
  }
  return n;
}

// ---------- the base's jobs ----------
// Carts at a base (its armory, its people's arms; not broken): a woodcutter or a builder with one hauls CART_JOB more
// (woodcutting.js woodTrip: the first woodcutters; buildings.js buildRate: the builders after them).
export const CART_JOB = 0.1;
export function baseCarts(state, base) {
  const inArmory = (base.armory || []).filter((it) => isCart(it) && !cartBroken(it)).length;
  const held = (state.survivors || []).filter((s) => s.alive && s.location && s.location.kind === "base" && s.location.baseId === base.id && cartOf(s) && !cartBroken(cartOf(s))).length;
  return inArmory + held;
}
// AI groups (coarse): × their own land's yield a day (aiscav.js: what their people haul in): up to +CART_JOB with two
// carts or more.
export const aiWorkMult = (f) => 1 + CART_JOB * Math.min(1, ((f && f.carts) || 0) / 2);

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
