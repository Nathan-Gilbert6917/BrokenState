// The battle screen's side of sim/ground.js: Search a body where it fell (a field battle, Shift+S), Ground (Shift+X:
// put things down, pick them up), the piles on the map (the iso view). The moving itself is the search window's
// (ui/inventory.js raidModal: the survivor, the body or pile, the ground under them).
import { bodiesNear, bodyBoxOf, pilesNear, pileCount, searchBody, fieldReady, downedFoe } from "../sim/ground.js";
import { searchableNear } from "../sim/combat.js";
import { SEARCH } from "../sim/search.js";
import { HAUL } from "../sim/raidloot.js";
import { GEAR } from "../sim/data.js"; // a cart's look (sim/data-carts.js)

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
    html += btn(b.raid ? "searchBody" : "search", "Search body", tip, !!t && (!fresh || u.ap >= SEARCH.ap), b.raid ? "" : "⇧S");
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
// A cart (sim/carts.js): a wheelbarrow (a green steel tray on one wheel, two handles) or a hand cart (a plank bed on
// two spoked wheels, a T handle), at screen X, Y (its feet), with a mound in it when it holds something and the count
// over it as a pile's. Drawn on its cell when it stands on the map, beside its pusher when held (ui/isoview.js).
export function drawCartIso(ctx, cart, X, Y, S, n = 0) {
  const look = (GEAR[cart.key] && GEAR[cart.key].cart && GEAR[cart.key].cart.look) || "barrow";
  ctx.save();
  ctx.lineJoin = "round";
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath(); ctx.ellipse(X, Y + 0.6 * S, (look === "cart" ? 9.5 : 7.5) * S, 3 * S, 0, 0, Math.PI * 2); ctx.fill();
  const poly = (pts, fill, stroke = "#1a1712") => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(X + x * S, Y + y * S) : ctx.moveTo(X + x * S, Y + y * S))); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, 0.5 * S); ctx.stroke(); };
  const line = (x0, y0, x1, y1, col, w) => { ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, w * S); ctx.beginPath(); ctx.moveTo(X + x0 * S, Y + y0 * S); ctx.lineTo(X + x1 * S, Y + y1 * S); ctx.stroke(); };
  const wheel = (x, y, r, spokes) => {
    ctx.fillStyle = "#1f1d1a"; ctx.beginPath(); ctx.ellipse(X + x * S, Y + y * S, r * 0.62 * S, r * S, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#6d6a64"; ctx.lineWidth = Math.max(1, 0.45 * S); ctx.stroke();
    if (spokes) for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 4; line(x - Math.cos(a) * r * 0.55, y - Math.sin(a) * r * 0.9, x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.9, "#8a6a44", 0.35); }
    ctx.fillStyle = "#a9a59c"; ctx.beginPath(); ctx.arc(X + x * S, Y + y * S, 0.6 * S, 0, Math.PI * 2); ctx.fill();
  };
  const mound = (x, y, rx, ry) => { if (!n) return; ctx.fillStyle = "#8a7350"; ctx.strokeStyle = "#2a2118"; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(X + x * S, Y + y * S, rx * S, ry * S, 0, Math.PI, 0); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#5d6066"; ctx.fillRect(X + (x - rx * 0.5) * S, Y + (y - ry * 0.6) * S, rx * 0.7 * S, 0.9 * S); };
  if (look === "cart") {
    wheel(-4.2, -2.4, 3.4, true); // the far wheel
    line(5.5, -5.2, 11.5, -2.2, "#5b3d22", 1.1); // the T handle
    line(10.6, -3.6, 12.4, -0.8, "#5b3d22", 1);
    poly([[-7.5, -7.4], [5.8, -7.4], [7.4, -3.6], [-5.9, -3.6]], "#7a5532");
    line(-6.9, -6.2, 6.3, -6.2, "#5e4027", 0.4); line(-6.3, -4.9, 6.9, -4.9, "#5e4027", 0.4); // the planks
    poly([[-7.5, -7.4], [5.8, -7.4], [5.8, -8.6], [-7.5, -8.6]], "#8d6640"); // the side board
    mound(-0.8, -7.6, 5.2, 2.6);
    wheel(3.6, -1.6, 3.4, true); // the near wheel
  } else {
    line(-3.6, -3.4, -9.8, -5.6, "#6b4a2a", 1.1); // the handles
    line(-2.4, -2.4, -8.6, -3.2, "#6b4a2a", 1.1);
    line(-3.2, -2.6, -3.6, 0.2, "#3a3a38", 0.7); // a leg
    wheel(5.4, -1.8, 2.6, false);
    poly([[-6.4, -7], [5.2, -7], [3.4, -2.4], [-4.4, -2.4]], "#3f6b4a");
    line(-6.4, -7, 5.2, -7, "#6d9a76", 0.6); // the tray's rolled rim
    mound(-0.6, -7.2, 4.4, 2.2);
  }
  if (n) {
    ctx.font = `700 ${Math.max(9, Math.round(3.4 * S))}px Segoe UI, sans-serif`;
    ctx.textAlign = "center"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.strokeText(String(n), X, Y - 11 * S); ctx.fillStyle = "#e0a84f"; ctx.fillText(String(n), X, Y - 11 * S);
  }
  ctx.restore();
}
// One cart standing on the map (a loot-layer container, sim/carts.js), on its cell.
export function drawCartBoxIso(ctx, c, project, zAt, S) {
  const [X, Y] = project(c.x + 0.5, c.y + 0.6, zAt(c.x, c.y));
  drawCartIso(ctx, c.cart, X, Y, S, pileCount(c));
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
