// A base's defence plan: where each defender stands when the base is attacked, laid out ahead of time (a drill on the
// base's own battle map, from the Defence tab) and taken up by itself at the deploy step of every attack on that
// base (a horde breaking in, raiders at the gates, outsiders, a rescue: defences.js "baseDefence"). In the deploy
// step it can still be changed for that fight, and saved back as the plan.
//
// base.defencePlan = { [map]: { w0, h0, posts: [[survivor id, x, y]…], lit, day } }
//   map: the base battle's first map (b.tier.map): "fort" (a walled base on land, fort.js: the whole fight on one
//   map that does not turn, so the cells are the map's own), "wall" (a bridge barricade's wall map, deploy.js) or
//   "interior" (no walls: the yard and buildings map, interior.js). Those two are turned to face the attack, so their
//   cells are kept as on the east-facing layout (deploy.js sideUntf) and turned with the map each time.
//   w0 × h0: the map's size when the plan was made. A base that has grown (a longer wall, a bigger yard) has a new
//   map: the old plan no longer fits and the defaults are used until it is planned again.
//   lit: where the floodlights aim (left / center / right), when the base has them.
//
// Taking up the plan (applyPlan): everyone in it who is in the fight goes to their cell; whoever the default posts
// had put there swaps to the planned one's default cell. A cell that cannot be used this time (a breach, rubble, the
// cell now has a building on it) → the nearest free one within 2 cells; else the default post. People not in the
// plan keep their default posts. Headless and auto-played battles take the plan up too, so it counts either way.
import { active, unitAt, say, createBattle } from "./combat.js";
import { sideTf, sideUntf, canPlace, postAt, setLit, LIT_ZONES, deployAct } from "./deploy.js";
import { day, atBase } from "./world.js";

export const PLAN_NEAR = 2; // how far from a planned cell that cannot be used this time someone may stand instead
export const PLAN_MAPS = { fort: "the walls and the yard", wall: "the wall", interior: "the yard and the buildings" };

// Which plan a battle's deploy step uses ("" = none: an assault on someone else's walls, the redeploy after falling
// back to the yard, a battle without a deploy step).
export function planKey(b) {
  if (!b || !b.deploy || b.deploy.attackers || !b.tier) return "";
  if (b.tier.map === "interior" && b.tier.fellBackTurn != null) return "";
  return PLAN_MAPS[b.tier.map] ? b.tier.map : "";
}
const baseOfBattle = (state, b) => (b && b.setup && b.setup.baseId != null ? state.bases.find((x) => x.id === b.setup.baseId) || null : null);
const frameOf = (b) => {
  const fr = b.deploy.frame || {};
  return { w0: fr.w0 || b.w, h0: fr.h0 || b.h, fort: !!fr.fort };
};
// Cell of the plan → cell of this battle's map, and back.
function toMap(b) {
  const fr = frameOf(b);
  return fr.fort ? (x, y) => [x, y] : sideTf(b.deploy.side || "east", fr.w0, fr.h0);
}
function fromMap(b) {
  const fr = frameOf(b);
  return fr.fort ? (x, y) => [x, y] : sideUntf(b.deploy.side || "east", fr.w0, fr.h0);
}

// The base's plan for this battle's map, if it fits it.
export function planFor(state, b) {
  const key = planKey(b), base = baseOfBattle(state, b);
  const plan = key && base && base.defencePlan ? base.defencePlan[key] : null;
  if (!plan) return null;
  const fr = frameOf(b);
  return plan.w0 === fr.w0 && plan.h0 === fr.h0 ? plan : null;
}
// Why the base's plan is not used here ("" = it is, or there is none).
export function planStale(state, b) {
  const key = planKey(b), base = baseOfBattle(state, b);
  const plan = key && base && base.defencePlan ? base.defencePlan[key] : null;
  return plan && !planFor(state, b) ? `${base.name} has changed since its defence plan was made (a new map): default posts until it is planned again.` : "";
}

// Puts the planned defenders on their cells. Returns { placed, near, missing } (missing: in the plan, not here or
// not standing). quiet: no line in the battle's log.
export function applyPlan(state, b, { quiet = false } = {}) {
  const plan = planFor(state, b);
  const out = { placed: 0, near: 0, missing: 0, off: 0 };
  if (!plan) return out;
  const tf = toMap(b);
  const players = b.units.filter((u) => u.side === "player" && active(u));
  const list = [];
  for (const [sid, x, y] of plan.posts) {
    const u = players.find((p) => p.sid === sid);
    if (!u) { out.missing++; continue; }
    list.push([u, ...tf(x, y)]);
  }
  if (!list.length) return out;
  // Off the map first, so their default cells are free for whoever has to swap.
  const home = new Map(list.map(([u]) => [u, [u.x, u.y]]));
  for (const [u] of list) u.x = -100;
  const free = (x, y) => canPlace(b, x, y) && !unitAt(b, x, y);
  const placeOn = (u, x, y) => { u.x = x; u.y = y; u.post = postAt(b, x, y); };
  for (const [u, x, y] of list) {
    let spot = null;
    if (canPlace(b, x, y)) {
      const other = unitAt(b, x, y);
      if (!other) spot = [x, y];
      else if (other.side === "player" && active(other) && !home.has(other)) {
        // Someone on their default post stands there: they take the planned one's default cell (or the nearest free).
        const [hx, hy] = home.get(u);
        other.x = -100;
        const to = free(hx, hy) ? [hx, hy] : nearest(b, hx, hy, 6, free);
        if (to) { placeOn(other, to[0], to[1]); spot = [x, y]; }
        else { other.x = x; other.y = y; }
      }
    }
    if (!spot) { spot = nearest(b, x, y, PLAN_NEAR, free); if (spot) out.near++; }
    if (spot) { placeOn(u, spot[0], spot[1]); out.placed++; continue; }
    // Nowhere near it: their default post (or the nearest free cell to it).
    const [hx, hy] = home.get(u);
    const back = free(hx, hy) ? [hx, hy] : nearest(b, hx, hy, 6, free) || [hx, hy];
    placeOn(u, back[0], back[1]);
    out.off++;
  }
  if (plan.lit && b.deploy.floodlit && LIT_ZONES[plan.lit]) setLit(b, plan.lit);
  b.deploy.planned = true;
  if (!quiet) {
    const base = baseOfBattle(state, b);
    const rest = players.length - list.length;
    say(b, `${base ? base.name : "The base"}'s defence plan: ${out.placed} at their planned posts${out.near ? ` (${out.near} beside theirs: the cell is taken or broken this time)` : ""}${out.off ? `, ${out.off} at the default post (no room by theirs)` : ""}${rest ? `, ${rest} not in the plan at the default posts` : ""}${out.missing ? `; ${out.missing} in the plan ${out.missing === 1 ? "is" : "are"} not here` : ""}.`, "info");
  }
  b.rev = (b.rev || 0) + 1;
  return out;
}

// Keeps where everyone stands now as the base's plan for this map (people in the plan who are not in this fight
// keep their posts, unless someone here now stands on theirs).
export function savePlan(state, b) {
  const key = planKey(b), base = baseOfBattle(state, b);
  if (!key || !base) return "There is no base plan for this fight.";
  const fr = frameOf(b), back = fromMap(b);
  const players = b.units.filter((u) => u.side === "player" && active(u) && u.x >= 0 && u.sid != null);
  const posts = players.map((u) => [u.sid, ...back(u.x, u.y)]);
  const old = base.defencePlan && base.defencePlan[key];
  if (old && old.w0 === fr.w0 && old.h0 === fr.h0) {
    const here = new Set(players.map((u) => u.sid));
    const used = new Set(posts.map(([, x, y]) => `${x},${y}`));
    for (const p of old.posts) {
      const s = state.survivors.find((x) => x.id === p[0]);
      if (!here.has(p[0]) && s && s.alive && !used.has(`${p[1]},${p[2]}`)) { posts.push(p.slice()); used.add(`${p[1]},${p[2]}`); }
    }
  }
  base.defencePlan = base.defencePlan || {};
  base.defencePlan[key] = { w0: fr.w0, h0: fr.h0, posts, lit: b.deploy.floodlit ? b.deploy.lit : (old && old.lit) || "center", day: day(state) };
  b.deploy.planned = true;
  return `${base.name}'s defence plan saved: ${posts.length} post${posts.length === 1 ? "" : "s"} on ${PLAN_MAPS[key]}.`;
}
export function clearPlan(state, base, key = null) {
  if (!base || !base.defencePlan) return "";
  if (key) delete base.defencePlan[key]; else delete base.defencePlan;
  if (base.defencePlan && !Object.keys(base.defencePlan).length) delete base.defencePlan;
  return `${base.name}'s defence plan cleared: the default posts from now on.`;
}
// A survivor who left or died: off every plan (the Defence tab shows who is in it).
export function planPeople(state, base) {
  const out = new Map();
  for (const [key, plan] of Object.entries((base && base.defencePlan) || {})) for (const [sid] of plan.posts) {
    const s = state.survivors.find((x) => x.id === sid);
    if (s && s.alive) { if (!out.has(s)) out.set(s, []); out.get(s).push(key); }
  }
  return out;
}

// ---------- the drill: planning on the base's battle map ----------
// The base's own battle map (as an attack on it would lay it out, from the east, by day or night as it is now) with
// everyone at the base on it and nobody to fight: place them, Save as plan, Close. The clock stands still (it is a
// battle screen); nothing is fought, worn or saved as a battle start (ui/settings.js skips a drill).
export function startDrill(state, baseId) {
  if (state.combat) return "Finish the battle first.";
  const base = state.bases.find((x) => x.id === baseId);
  if (!base) return "";
  if (!atBase(state, base.id).length) return `Nobody is at ${base.name} to drill.`;
  const setup = {
    mode: "battle", layout: "baseDefence", deploy: true, drill: true, baseId: base.id, canRetreat: false, handler: null,
    enemy: { kind: "zombies", count: 1, power: 1, name: "nobody (a drill)" }, context: { baseId: base.id, drill: true },
  };
  const b = createBattle(state, setup);
  b.units = b.units.filter((u) => u.side === "player"); // the stand-in attacker the battle is made with
  b.log = [];
  b.drill = true;
  b.phase = "deploy";
  b.acted = true;
  const key = planKey(b);
  const stale = planStale(state, b);
  say(b, `Defence drill at ${base.name}: place everyone where they should stand when the base is attacked, then Save as plan. ${key === "fort" ? "The plan holds whichever side the attack comes from" : "The map is shown facing an attack from the east; in a real attack it turns to face the side the attack comes from, and the plan turns with it"}. In the deploy step of every attack here the plan is taken up by itself, and you can still change it for that fight.`, "info");
  if (stale) say(b, stale, "warn");
  state.combat = b;
  return "";
}
export function endDrill(state) {
  const b = state.combat;
  if (!b || !b.setup.drill) return "";
  state.combat = null;
  return "";
}
// A drill's commands: the deploy step's (place, gate, defaults, flood, plan, savePlan), and close.
export function drillAct(state, b, act) {
  if (act.type === "endDrill") return endDrill(state);
  if (!["place", "gate", "defaults", "flood", "plan", "savePlan"].includes(act.type)) return "This is a drill: place your people, save the plan, or close it.";
  return deployAct(state, b, act);
}
// The nearest cell to (x, y) within r that passes ok (rings outward).
function nearest(b, x, y, r, ok) {
  for (let d = 1; d <= r; d++) {
    let best = null;
    for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h || !ok(nx, ny)) continue;
      const k = Math.hypot(dx, dy);
      if (!best || k < best.k) best = { x: nx, y: ny, k };
    }
    if (best) return [best.x, best.y];
  }
  return null;
}
