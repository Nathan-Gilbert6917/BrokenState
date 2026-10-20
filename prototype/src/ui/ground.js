// The battle screen's side of sim/ground.js: Search a body where it fell (a field battle, Shift+S), Ground (Shift+X:
// put things down, pick them up), the piles on the map (the iso view). The moving itself is the search window's
// (ui/inventory.js raidModal: the survivor, the body or pile, the ground under them).
import { bodiesNear, bodyBoxOf, pilesNear, pileCount, searchBody, fieldReady, downedFoe } from "../sim/ground.js";
import { searchableNear } from "../sim/combat.js";
import { SEARCH } from "../sim/search.js";
import { HAUL } from "../sim/raidloot.js";
import { GEAR, supWeight } from "../sim/data.js"; // a cart's look (sim/data-carts.js), what its load weighs
import { cartSpec, cartBroken } from "../sim/carts.js"; // a cart: its kg, a wheel off
import { itemDur, itemDurMax } from "../sim/crafting.js"; // its wear
import { itemLoad } from "../sim/inventory.js";
import { cartCanvas, cartPoint } from "./cartmodel.js"; // the carts' low-poly models
import { facesBox, faceRefusal } from "../sim/vision.js"; // looting needs the looter facing it

const first = (u) => u.name.split(" ")[0];

// The buttons (ui/combat.js unit orders): Search body in a field battle (a raid's dead are containers: its own Search),
// Ground everywhere.
export function groundButtons(state, b, u, btn) {
  let html = "";
  const near = bodiesNear(b, u);
  if (!b.raid || near.length) { // a raid: only the downed (its dead are searched as containers: Search)
    const t = near[0];
    const fresh = t && !bodyBoxOf(b, t);
    const who = (o) => (downedFoe(o) ? o.name : o.side === "player" ? `${o.name}'s body` : `the body of ${o.name}`);
    const tip = t ? `${fresh ? `${SEARCH.ap} action` : "Free (searched already)"}: go through ${who(t)}${downedFoe(t) ? " (down, alive: what they carry is taken off them; if they get up again they fight bare-handed)" : ""}: their gun, rounds, magazines, armour, what is in their rig and pack. Take what ${first(u)} can carry (the first ${HAUL.free} kg a turn are free to haul, then ${HAUL.per} kg an action); what is left stays on the body and is loot after a won fight.${near.length > 1 ? ` ${near.length} bodies within reach: click the one to search.` : ""}`
      : "Stand on or next to a body to search it: the dead of any side, the enemy's downed (knocked out, surrendered, tied, wounded), and of the walking dead only those that carried something (a soldier in their kit, one who walks in what they died in).";
    const why = !t ? "Stand on or next to a body to search it." : !facesBox(u, { x: t.x, y: t.y }) ? faceRefusal("the body") : fresh && u.ap < SEARCH.ap ? "No actions left this turn." : ""; // the sim's own refusals (sim/ground.js searchBody)
    html += btn(b.raid ? "searchBody" : "search", "Search body", tip, !why, b.raid ? "" : "⇧S", { why, ap: fresh ? SEARCH.ap : 0 });
  }
  const piles = pilesNear(b, u);
  const n = piles.reduce((a, p) => a + pileCount(p), 0);
  html += btn("ground", n ? `Ground (${n})` : "Ground", `Free: put things down where ${first(u)} stands, or pick up what lies here or next to them (${n ? `${n} thing${n === 1 ? "" : "s"} within reach` : "nothing within reach now"}). Picking up is hauling: the first ${HAUL.free} kg a turn are free, then ${HAUL.per} kg an action. Things on the ground stay there; after a won fight they are part of the loot, after a retreat they are left behind.`, true, "⇧X");
  return html;
}

// The orders (ui/combat.js cb-act and its keys). Returns true when handled.
export function groundCbAct(state, b, u, v, cui, act) {
  if (v === "ground") {
    fieldReady(b, state);
    const p = pilesNear(b, u)[0];
    cui.lootReq = { uid: u.id, box: p ? p.id : null };
    return true;
  }
  if ((v === "search" && (!b.raid || (!searchableNear(b, u).length && bodiesNear(b, u).length))) || v === "searchBody") {
    const near = bodiesNear(b, u);
    if (!near.length) { cui.msg = "Stand on or next to a body to search it."; return true; }
    if (near.length > 1 && cui.mode !== "searchBody") { cui.mode = "searchBody"; cui.msg = "Click the body to search (or Search again for the nearest)."; return true; }
    openBody(state, b, u, near[0], cui, act);
    return true;
  }
  return false;
}
// A click on the map while picking a body (mode "searchBody"). Returns true when handled.
export function groundClick(state, b, u, c, cui, act) {
  if (cui.mode !== "searchBody" || !u) return false;
  const t = bodiesNear(b, u).find((o) => o.x === c.x && o.y === c.y);
  cui.mode = "move";
  if (!t) { cui.msg = "No body to search there: it must be on or next to the unit."; return true; }
  openBody(state, b, u, t, cui, act);
  return true;
}
function openBody(state, b, u, t, cui, act) {
  cui.mode = "move";
  if (!bodyBoxOf(b, t)) {
    if (u.ap < SEARCH.ap) { cui.msg = "No actions left this turn."; return; }
    if (!act(state, { type: "searchBody", unit: u.id, target: t.id })) return;
  } else {
    const why = searchBody(state, b, u, t); // searched already: free, nothing rolled
    if (why) { cui.msg = why; return; }
  }
  const box = bodyBoxOf(b, t);
  if (box && pileCount(box)) cui.lootReq = { uid: u.id, box: box.id };
  else cui.msg = `Nothing useful on ${downedFoe(t) ? t.name : t.side === "player" ? `${t.name}'s body` : `the body of ${t.name}`}.`;
}

// The same in the iso view: project(x, y, z) → [X, Y] screen; zAt(x, y): the ground's height there (art px); S: zoom.
// One pile, drawn in the painter's pass with the units of its diagonal (ui/isoview.js), so a car in front hides it.
export function drawPileIso(ctx, p, project, zAt, S) {
  const n = pileCount(p);
  if (!n) return;
  const [X, Y] = project(p.x + 0.35, p.y + 0.65, zAt(p.x, p.y));
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath(); ctx.ellipse(X, Y + 0.6 * S, 5.5 * S, 2.4 * S, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#8a7350"; ctx.strokeStyle = "#2a2118"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(X, Y - 1.6 * S, 4 * S, 2.8 * S, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#5d6066"; ctx.fillRect(X - 4.5 * S, Y - 0.6 * S, 5 * S, 1.1 * S);
  ctx.font = `700 ${Math.max(9, Math.round(3.4 * S))}px Segoe UI, sans-serif`;
  ctx.textAlign = "center"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.8)";
  ctx.strokeText(String(n), X, Y - 6 * S); ctx.fillStyle = "#e0a84f"; ctx.fillText(String(n), X, Y - 6 * S);
}
// A cart (sim/carts.js): a wheelbarrow or a hand cart as its low-poly model (ui/cartmodel.js: the figures' and the
// props' look), facing yaw (the figures' degrees), what it holds heaped in it (cartLoad) and the count over it as a
// pile's; worn, rusted; broken, sagging with a wheel off. held: rolled by its pusher (X, Y their feet: the wheelbarrow
// pushed ahead of them, the hand cart pulled behind, ui/isoview.js drawBody draws it before or after the figure);
// else parked, X, Y its cell's centre. fog: under the fog of war (greyed as the props are).
export function drawCartIso(ctx, cart, X, Y, S, o = {}) {
  const look = (GEAR[cart.key] && GEAR[cart.key].cart && GEAR[cart.key].cart.look) || "barrow";
  const L = o.load || cartLoad(cart, null);
  const yaw = o.yaw ?? 300;
  const cv = cartCanvas(look, yaw, { held: !!o.held, kind: L.kind, level: L.level, broken: cartBroken(cart), wear: L.wear, seed: cart.id || 1, fog: !!o.fog });
  if (!o.held) { // its shadow on the ground (a held one stands in its pusher's)
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(X, Y + 0.6 * S, (look === "cart" ? 11 : 9.5) * S, 4 * S, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (cv) {
    const g = cv.figure;
    ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cv, X - g.ox * S, Y - g.oy * S, g.w * S, g.h * S);
    ctx.restore();
  }
  const n = L.n;
  if (n && !o.fog) {
    const [px, py] = cartPoint(look, yaw, !!o.held);
    const tx = X + px * S, ty = Y + (py - 5) * S;
    ctx.save();
    ctx.font = `700 ${Math.max(9, Math.round(3.4 * S))}px Segoe UI, sans-serif`;
    ctx.textAlign = "center"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.strokeText(String(n), tx, ty); ctx.fillStyle = "#e0a84f"; ctx.fillText(String(n), tx, ty);
    ctx.restore();
  }
}
// What a cart holds, for its picture: the things counted (n, a pile's count), the main kind of load by weight
// (firewood, scrap and parts, fuel, water, else goods), how full (level 0..3 of its kg) and its wear (0 new, 1 worn
// out). box: a parked cart's loot-layer container (its contents), else the item's own grid and lots.
const LOAD_KIND = { wood: "wood", scrap: "scrap", parts: "scrap", carparts: "scrap", gunparts: "scrap", electronics: "scrap", buildmat: "scrap", fuel: "fuel", water: "water", rawwater: "water" };
export function cartLoad(cart, box = null) {
  const kg = {};
  const addKg = (k, w) => { if (w > 0) kg[k] = (kg[k] || 0) + w; };
  let n = 0, total = 0;
  if (box) {
    n = pileCount(box);
    for (const g of box.contents.gear) addKg("goods", itemLoad(g));
    for (const [k, v] of Object.entries(box.contents.sup)) if (v > 0) addKg(LOAD_KIND[k] || "goods", v * supWeight(k));
  } else {
    const items = (cart.contents || []).filter(Boolean);
    n = items.length;
    for (const g of items) addKg("goods", itemLoad(g));
    for (const l of cart.held || []) if (l && l.q > 0) { addKg(LOAD_KIND[l.k] || "goods", l.q * supWeight(l.k)); n++; }
  }
  for (const v of Object.values(kg)) total += v;
  const cap = (cartSpec(cart) || { cap: 100 }).cap, f = total / cap;
  const kind = Object.keys(kg).sort((a, c) => kg[c] - kg[a])[0] || "";
  const level = !n && !total ? 0 : f >= 0.66 ? 3 : f >= 0.3 ? 2 : 1;
  const d = itemDur(cart), max = itemDurMax(cart);
  return { n, kind, level, wear: d != null && max ? Math.max(0, Math.min(1, 1 - d / max)) : 0 };
}
// One cart standing on the map (a loot-layer container, sim/carts.js), on its cell, facing its way (cartYaw).
export function drawCartBoxIso(ctx, c, project, zAt, S, o = {}) {
  const [X, Y] = project(c.x + 0.5, c.y + 0.5, zAt(c.x, c.y));
  drawCartIso(ctx, c.cart, X, Y, S, { yaw: o.yaw, fog: o.fog, load: cartLoad(c.cart, c) });
}
// The bodies searched in a field battle with things still on them: a small orange tag over them (with the markers).
export function drawGroundIso(ctx, b, project, zAt, S, floor = 0) {
  if (!b.raid && b.fieldLoot) for (const c of b.fieldLoot.containers) {
    if (c.kind !== "body" || !pileCount(c) || (c.f || 0) !== floor) continue;
    const [X, Y] = project(c.x + 0.5, c.y + 0.5, zAt(c.x, c.y) + 6);
    const s = Math.max(5, 2.4 * S);
    ctx.fillStyle = "#e08a4f"; ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = 1;
    ctx.fillRect(X - s / 2, Y - s, s, s); ctx.strokeRect(X - s / 2, Y - s, s, s);
  }
}
