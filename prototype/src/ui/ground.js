// The battle screen's side of sim/ground.js: Search a body where it fell (a field battle, Shift+S), Ground (Shift+X:
// put things down, pick them up), the piles on the map (the iso view). The moving itself is the search window's
// (ui/inventory.js raidModal: the survivor, the body or pile, the ground under them).
import { bodiesNear, bodyBoxOf, pilesNear, pileCount, searchBody, fieldReady, downedFoe } from "../sim/ground.js";
import { searchableNear } from "../sim/combat.js";
import { SEARCH } from "../sim/search.js";
import { HAUL } from "../sim/raidloot.js";
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
