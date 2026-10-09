// A base's defence plans: where each defender stands when the base is attacked, laid out ahead of time (a drill on the
// base's own battle map, from the Defence tab) and taken up by itself at the deploy step of every attack on that
// base (a horde breaking in, raiders at the gates, outsiders, a rescue: defences.js "baseDefence"). In the deploy
// step it can still be changed for that fight, another plan picked, and saved back.
//
// base.defencePlans = [{ id, name, who, when, maps: { [map]: { w0, h0, posts: [[survivor id, x, y, role?]…], lit, day } } }]
//   A handful of named plans (PLAN.MAX: "Default", "Horde", "Night"...), each tagged for who attacks (who: "any",
//   "dead" for a horde, "people" for raiders, outsiders, a rescue) and when (when: "any", "day", "night"). At an attack
//   the plan that fits best is taken up by itself (pickPlan): one tagged for this attacker beats one for any attacker,
//   one tagged for this time of day beats one for any time, a plan tagged for another attacker or time is never
//   picked; a tie goes to the plan higher in the list. Only plans with posts on this battle's map count.
//   Old saves (base.defencePlan = { [map]: {…} }: one plan per map) become one plan, "Default" (plansOf).
//   map: the base battle's first map (b.tier.map): "fort" (a walled base on land, fort.js: the whole fight on one
//   map that does not turn, so the cells are the map's own), "wall" (a bridge barricade's wall map, deploy.js) or
//   "interior" (no walls: the yard and buildings map, interior.js). Those two are turned to face the attack, so their
//   cells are kept as on the east-facing layout (deploy.js sideUntf) and turned with the map each time.
//   w0 × h0: the map's size when the plan was made. A base that has grown (a longer wall, a bigger yard) has a new
//   map: the old posts no longer fit and the defaults are used until it is planned again.
//   posts: by name ([id, x, y]: that person stands there) or by role ([id, x, y, role]: the best available person
//   for that kind of post: "shooter" the best shot, "close" the toughest close fighter, "any" anyone; id is who stood
//   there when it was saved, and they keep it when they are here and fit it).
//   lit: where the floodlights aim (left / center / right), when the base has them.
//
// Taking up the plan (applyPlan): posts by name first (everyone in the plan who is in the fight to their cell), then
// the posts by role, the most important first (towers, then the walkway and the gate, the perches, the buildings, the
// yard), each to the best fit left; whoever the default posts had put on a planned cell swaps to the planned one's
// default cell. A cell that cannot be used this time (a breach, rubble, the cell now has a building on it) → the
// nearest free one within PLAN.NEAR cells; else the default post. Everyone else keeps their default post. Headless and
// auto-played battles take the plan up too, so it counts either way.
//
// Who is at a post when the attack hits (the start: openStart, the first time the plan is taken up in a battle):
// a warned attack ("Prepare defenses", a horde warning: watch.js readiness manned) finds everyone at their posts. An
// attack on a base whose defences are not manned finds only the people on guard right now (the watch roster, guards,
// watch.js readiness watchers) at their posts (planned, else default: a watcher on a post in the yard steps up to a
// tower, the walkway or a perch its default holder left empty); everyone else starts in the buildings (the main house
// and the bunkhouses first, by the door; on a bridge's wall map, with no buildings, at the back by the ladders) and
// cannot act until the attackers have moved once (u.late: no actions in the first turn; with nobody on watch at all
// the attackers move first). They cannot be placed in the deploy step either. Nobody on watch: nobody at a post.
import { active, unitAt, say, createBattle, WEAPONS, isRanged } from "./combat.js";
import { sideTf, sideUntf, canPlace, postAt, setLit, LIT_ZONES, deployAct } from "./deploy.js";
import { day, atBase, localId } from "./world.js";
import { readiness } from "./watch.js";
import { Rng } from "./rng.js";

export const PLAN = {
  NEAR: 2,           // how far from a planned cell that cannot be used this time someone may stand instead
  MAX: 5,            // plans a base keeps
  NAME: 20,          // letters in a plan's name
  HOME: ["hall", "bunkhouse", "shack"], // where the people not on watch start: these buildings first (interior.js STRUCTURES)
  BACK: [2, 5],      // the wall map (no buildings): the columns at the back they start in (east-facing; 0–1 is the way out)
};
export const PLAN_NEAR = PLAN.NEAR;
export const PLAN_MAPS = { fort: "the walls and the yard", wall: "the wall", interior: "the yard and the buildings" };
export const PLAN_WHO = { any: "Any attack", dead: "The dead", people: "People" };
export const PLAN_WHEN = { any: "Day or night", day: "By day", night: "At night" };
export const PLAN_ROLES = { shooter: "Best shot", close: "Close fighter", any: "Anyone" };
// Post kinds, the most important first: role posts are filled in this order (postAt: the cell's post).
const POST_RANK = { tower: 0, wall: 1, gate: 1, perch: 2, inside: 3, door: 3 };
const rankOf = (post) => POST_RANK[post] ?? 4;

// ---------- the plans ----------
// The base's plans (an old save's one plan per map becomes "Default").
export function plansOf(base) {
  if (!base) return [];
  if (base.defencePlan) {
    if (!base.defencePlans && Object.keys(base.defencePlan).length) base.defencePlans = [{ id: 1, name: "Default", who: "any", when: "any", maps: base.defencePlan }];
    delete base.defencePlan;
  }
  return base.defencePlans || [];
}
export const planById = (base, id) => plansOf(base).find((p) => p.id === id) || null;
export const planTags = (p) => `${p.who === "dead" ? "the dead" : p.who === "people" ? "people" : "any attack"}, ${p.when === "night" ? "at night" : p.when === "day" ? "by day" : "day or night"}`;
const cleanName = (s) => String(s || "").trim().replace(/\s+/g, " ").slice(0, PLAN.NAME);
export function newPlan(state, base, name = "", who = "any", when = "any") {
  const list = plansOf(base);
  if (list.length >= PLAN.MAX) return null;
  const id = list.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  const p = { id, name: cleanName(name) || (list.length ? `Plan ${id}` : "Default"), who: PLAN_WHO[who] ? who : "any", when: PLAN_WHEN[when] ? when : "any", maps: {} };
  base.defencePlans = [...list, p];
  return p;
}
export function renamePlan(base, id, name) {
  const p = planById(base, id), n = cleanName(name);
  if (p && n) p.name = n;
  return p;
}
export function tagPlan(base, id, who, when) {
  const p = planById(base, id);
  if (!p) return null;
  if (who && PLAN_WHO[who]) p.who = who;
  if (when && PLAN_WHEN[when]) p.when = when;
  return p;
}
export function deletePlan(state, base, id) {
  const p = planById(base, id);
  if (!p) return "";
  base.defencePlans = plansOf(base).filter((x) => x !== p);
  if (!base.defencePlans.length) delete base.defencePlans;
  return `${base.name}: the "${p.name}" plan is gone.`;
}
// Forget plans: every plan (no key), or one map's posts in every plan.
export function clearPlan(state, base, key = null) {
  if (!base) return "";
  const list = plansOf(base);
  if (!key) delete base.defencePlans;
  else for (const p of list) delete p.maps[key];
  return `${base.name}'s defence plan${key ? ` for ${PLAN_MAPS[key] || key}` : "s"} cleared: the default posts from now on.`;
}

// Which plan map a battle's deploy step uses ("" = none: an assault on someone else's walls, the redeploy after
// falling back to the yard, a battle without a deploy step).
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
const fits = (entry, b) => { const fr = frameOf(b); return !!entry && entry.w0 === fr.w0 && entry.h0 === fr.h0; };
// Cell of the plan → cell of this battle's map, and back.
function toMap(b) {
  const fr = frameOf(b);
  return fr.fort ? (x, y) => [x, y] : sideTf(b.deploy.side || "east", fr.w0, fr.h0);
}
function fromMap(b) {
  const fr = frameOf(b);
  return fr.fort ? (x, y) => [x, y] : sideUntf(b.deploy.side || "east", fr.w0, fr.h0);
}
// Who attacks ("dead" / "people") and whether it is night, as the plan's tags read them.
export const attackWho = (b) => (b.setup && b.setup.enemy && b.setup.enemy.kind === "zombies" ? "dead" : "people");
const attackNight = (b) => !!(b.deploy && b.deploy.night);
// How well a plan's tags fit an attack: -1 never, else higher is better.
export function planScore(p, who, night) {
  if (p.who !== "any" && p.who !== who) return -1;
  if ((p.when === "night" && !night) || (p.when === "day" && night)) return -1;
  return (p.who === who ? 2 : 0) + (p.when !== "any" ? 1 : 0);
}
// The plan an attack takes up by itself: the best-fitting tags among the plans with posts on this map.
export function pickPlan(state, b) {
  const key = planKey(b), base = baseOfBattle(state, b);
  if (!key || !base) return null;
  const who = attackWho(b), night = attackNight(b);
  let best = null, bestSc = -1;
  for (const p of plansOf(base)) {
    if (!fits(p.maps[key], b)) continue;
    const sc = planScore(p, who, night);
    if (sc > bestSc) { best = p; bestSc = sc; }
  }
  return best;
}
// The plan this battle uses: picked by hand (the deploy step's picker, the drill: b.deploy.planId; 0 = the default
// posts), else the one pickPlan finds (a drill opens on the plan it was asked for: context.planId).
export function currentPlan(state, b) {
  if (!b || !b.deploy || !planKey(b)) return null;
  const base = baseOfBattle(state, b);
  if (b.deploy.planId === undefined) {
    const c = (b.setup && b.setup.context) || {}, want = c.planId;
    if (c.noPlan) { b.deploy.planId = 0; return null; }
    const p = want != null ? planById(base, want) : b.setup.drill ? plansOf(base)[0] || null : pickPlan(state, b);
    b.deploy.planId = p ? p.id : 0;
  }
  return b.deploy.planId ? planById(base, b.deploy.planId) : null;
}
// The posts of this battle's plan for its map, if they fit it.
export function planFor(state, b) {
  const p = currentPlan(state, b), key = planKey(b);
  return p && fits(p.maps[key], b) ? p.maps[key] : null;
}
// Why the plan is not used here ("" = it is, or there is none).
export function planStale(state, b) {
  const key = planKey(b), base = baseOfBattle(state, b);
  if (!key || !base || planFor(state, b)) return "";
  const p = currentPlan(state, b);
  if (p && p.maps[key]) return `${base.name} has changed since the "${p.name}" plan was made (a new map): default posts until it is planned again.`;
  if (!p && plansOf(base).some((q) => q.maps[key] && !fits(q.maps[key], b))) return `${base.name} has changed since its defence plan was made (a new map): default posts until it is planned again.`;
  return "";
}

// ---------- roles ----------
const isClose = (u) => !!WEAPONS[u.weapon].melee || u.weapon === "shotgun" || u.weapon === "pipegun";
const tough = (u) => (isClose(u) ? 40 : 0) + u.hp / u.armor;
// The kind of post a person fits: a gun that reaches (shooter), a melee weapon or a shotgun (close), else anyone.
export const roleOf = (u) => (isRanged(u) && !isClose(u) ? "shooter" : isClose(u) && u.weapon !== "fists" ? "close" : "any");
const fitsRole = (u, role) => role === "any" || roleOf(u) === role;
// The best of pool for a post of this role (hint: the survivor id who stood there when it was saved keeps it).
function bestFor(role, pool, hint) {
  const h = hint != null ? pool.find((u) => u.sid === hint) : null;
  if (h && fitsRole(h, role)) return h;
  if (role === "shooter") {
    const guns = pool.filter((u) => roleOf(u) === "shooter").sort((a, c) => c.aim - a.aim);
    return guns[0] || pool.filter((u) => isRanged(u)).sort((a, c) => c.aim - a.aim)[0] || null;
  }
  if (role === "close") return pool.filter((u) => roleOf(u) === "close").sort((a, c) => tough(c) - tough(a))[0] || pool.slice().sort((a, c) => tough(c) - tough(a))[0] || null;
  return pool.slice().sort((a, c) => tough(c) + c.aim * 0.5 - tough(a) - a.aim * 0.5)[0] || null;
}

// ---------- taking up the plan ----------
// Puts the planned defenders on their cells. Returns { placed, near, missing, off, late } (missing: in the plan by
// name, not here or not standing; late: in the plan, still in the buildings). quiet: no line in the battle's log.
// The first time in a battle it also sets who is at a post when the attack hits (openStart).
export function applyPlan(state, b, { quiet = false } = {}) {
  const out = { placed: 0, near: 0, missing: 0, off: 0, late: 0, roles: 0 };
  if (!b || !b.deploy) return out;
  if (!b.deploy.ready && planKey(b) && !b.setup.drill) openStart(state, b, { quiet });
  const plan = planFor(state, b);
  if (!plan) return out;
  const tf = toMap(b);
  const all = b.units.filter((u) => u.side === "player" && active(u));
  const late = all.filter((u) => u.late);
  const players = all.filter((u) => !u.late);
  // Those still in the buildings are off the map meanwhile: nobody swaps onto their cells, nobody takes them out.
  const lateAt = new Map(late.map((u) => [u, [u.x, u.y]]));
  for (const u of late) u.x = -100;
  const list = [], used = new Set(), rolePosts = [];
  b.deploy.unfilled = [];
  for (const p of plan.posts) {
    const [sid, x, y, role] = p;
    if (role) { rolePosts.push(p); continue; }
    const u = players.find((q) => q.sid === sid);
    if (!u) { if (late.some((q) => q.sid === sid)) out.late++; else out.missing++; continue; }
    if (used.has(u)) continue;
    used.add(u);
    list.push([u, ...tf(x, y), null]);
  }
  // Posts by role: the most important first (towers, the walkway and the gate...), each to the best fit left.
  const ranked = rolePosts.map((p) => { const [mx, my] = tf(p[1], p[2]); const ok = mx >= 0 && my >= 0 && mx < b.w && my < b.h; return { p, mx, my, r: ok ? rankOf(postAt(b, mx, my)) : 9 }; }).sort((a, c) => a.r - c.r);
  for (const { p, mx, my } of ranked) {
    const u = bestFor(p[3], players.filter((q) => !used.has(q)), p[0]);
    if (!u) { b.deploy.unfilled.push(p.slice()); continue; }
    used.add(u);
    list.push([u, mx, my, p[3]]);
    out.roles++;
  }
  for (const u of players) delete u.planRole;
  if (list.length) {
    // Off the map first, so their default cells are free for whoever has to swap.
    const home = new Map(list.map(([u]) => [u, [u.x, u.y]]));
    for (const [u] of list) u.x = -100;
    const free = (x, y) => canPlace(b, x, y) && !unitAt(b, x, y);
    const placeOn = (u, x, y) => { u.x = x; u.y = y; u.post = postAt(b, x, y); };
    for (const [u, x, y, role] of list) {
      if (role) u.planRole = role;
      let spot = null;
      if (x >= 0 && y >= 0 && x < b.w && y < b.h && canPlace(b, x, y)) {
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
      if (!spot) { spot = nearest(b, x, y, PLAN.NEAR, free); if (spot) out.near++; }
      if (spot) { placeOn(u, spot[0], spot[1]); out.placed++; continue; }
      // Nowhere near it: their default post (or the nearest free cell to it).
      const [hx, hy] = home.get(u);
      const back = free(hx, hy) ? [hx, hy] : nearest(b, hx, hy, 6, free) || [hx, hy];
      placeOn(u, back[0], back[1]);
      out.off++;
    }
  }
  // Back into the buildings (their cell, or another indoors if a planned post took it).
  for (const u of late) {
    const [x, y] = lateAt.get(u);
    if (canPlace(b, x, y) && !unitAt(b, x, y)) { u.x = x; u.y = y; } else placeLate(b, [u], [x, y]);
  }
  if (plan.lit && b.deploy.floodlit && LIT_ZONES[plan.lit]) setLit(b, plan.lit);
  b.deploy.planned = true;
  if (!quiet) {
    const base = baseOfBattle(state, b), p = currentPlan(state, b);
    const rest = players.length - list.length;
    say(b, `${base ? base.name : "The base"}'s defence plan "${p ? p.name : "Default"}": ${out.placed} at their planned posts${out.roles ? ` (${out.roles} by role)` : ""}${out.near ? ` (${out.near} beside theirs: the cell is taken or broken this time)` : ""}${out.off ? `, ${out.off} at the default post (no room by theirs)` : ""}${rest ? `, ${rest} not in the plan at the default posts` : ""}${out.late ? `; ${out.late} in the plan ${out.late === 1 ? "is" : "are"} still in the buildings` : ""}${out.missing ? `; ${out.missing} in the plan ${out.missing === 1 ? "is" : "are"} not here` : ""}.`, "info");
  }
  b.rev = (b.rev || 0) + 1;
  return out;
}

// ---------- who is at a post when the attack hits ----------
// The start of a base battle (the first time its plan is taken up): readiness (watch.js; context.ready overrides
// it: tests, a scripted attack) decides who is at their post; everyone else goes into the buildings (placeLate) and
// sits out the first turn (u.late). Watchers on a default post in the yard step up to a tower, the walkway or a perch
// whose default holder is inside (best shots first), a close fighter to the gate. b.deploy.defaults becomes this
// start (Default positions in the deploy step comes back to it).
export function openStart(state, b, { quiet = false } = {}) {
  const base = baseOfBattle(state, b);
  if (!base) return null;
  const c = (b.setup && b.setup.context) || {};
  const r = { ...readiness(state, base), ...(c.ready || {}) };
  const players = b.units.filter((u) => u.side === "player" && active(u));
  const watch = new Set(r.watchers || []);
  const late = r.manned ? [] : players.filter((u) => u.sid != null && !watch.has(u.sid));
  b.deploy.ready = { manned: !!r.manned, night: !!r.night, late: late.map((u) => u.id), watch: players.filter((u) => !late.includes(u)).map((u) => u.id) };
  if (!late.length) return b.deploy.ready;
  const spots = late.filter((u) => u.post && POST_RANK[u.post] != null).map((u) => ({ x: u.x, y: u.y, post: u.post })).sort((a, c2) => rankOf(a.post) - rankOf(c2.post));
  const was = new Map(late.map((u) => [u, [u.x, u.y]]));
  for (const u of late) { u.late = true; u.ap = 0; u.post = null; u.x = -100; u.ow = false; u.hunker = false; }
  // Watchers off a post (in the yard) step up to the posts the others left empty.
  const idle = players.filter((u) => !u.late && (!u.post || rankOf(u.post) >= 3)).sort((a, c2) => c2.aim - a.aim);
  for (const s of spots) {
    if (!idle.length) break;
    const pick = s.post === "gate" ? idle.filter((u) => roleOf(u) === "close").sort((a, c2) => tough(c2) - tough(a))[0]
      : idle.find((u) => roleOf(u) === "shooter") || idle.find((u) => isRanged(u));
    if (!pick || unitAt(b, s.x, s.y)) continue;
    pick.x = s.x; pick.y = s.y; pick.post = postAt(b, s.x, s.y) || s.post;
    idle.splice(idle.indexOf(pick), 1);
  }
  for (const u of late) placeLate(b, [u], was.get(u));
  b.deploy.defaults = b.units.filter((u) => u.side === "player" && active(u)).map((u) => [u.id, u.x, u.y, u.post || null]);
  if (!quiet) say(b, startText(state, b), players.length > late.length ? "warn" : "danger");
  b.rev = (b.rev || 0) + 1;
  return b.deploy.ready;
}
// Where the people not on watch start: indoors in the main house and the bunkhouses first (then the other
// buildings), the cells nearest the door first; on a map without buildings (a bridge's wall map) the back columns
// (PLAN.BACK), the middle rows first. Each takes the first free one; none left → the nearest free cell to `fall`.
function lateCells(b) {
  const T = b.tier || {}, out = [];
  const walk = (x, y) => canPlace(b, x, y);
  if (T.indoor && T.buildings) {
    const homes = T.buildings.filter((s) => !s.roof && s.doors && s.doors.length)
      .map((s, i) => ({ s, i, r: PLAN.HOME.includes(s.key) ? PLAN.HOME.indexOf(s.key) : PLAN.HOME.length }))
      .sort((a, c) => a.r - c.r || a.i - c.i);
    for (const { s } of homes) {
      const [dx, dy] = s.doors[0];
      out.push(...s.cells.filter(([x, y]) => T.indoor[y * b.w + x] && walk(x, y)).sort((p, q) => Math.hypot(p[0] - dx, p[1] - dy) - Math.hypot(q[0] - dx, q[1] - dy)));
    }
    if (out.length) return out;
  }
  if (T.map === "wall") {
    const fr = frameOf(b), tf = sideTf(b.deploy.side || "east", fr.w0, fr.h0), mid = Math.floor(fr.h0 / 2);
    const back = [];
    for (let y = 0; y < fr.h0; y++) for (let x = PLAN.BACK[0]; x <= PLAN.BACK[1]; x++) back.push([x, y]);
    back.sort((p, q) => Math.abs(p[1] - mid) - Math.abs(q[1] - mid) || p[0] - q[0]);
    for (const [x, y] of back) { const [nx, ny] = tf(x, y); if (walk(nx, ny)) out.push([nx, ny]); }
  }
  return out;
}
export function placeLate(b, units, fall = null) {
  const cells = lateCells(b);
  for (const u of units) {
    const was = fall || [u.x, u.y];
    u.x = -100;
    const c = cells.find(([x, y]) => !unitAt(b, x, y)) || (was[0] >= 0 ? nearest(b, was[0], was[1], 8, (x, y) => canPlace(b, x, y) && !unitAt(b, x, y)) : null) || was;
    u.x = c[0]; u.y = c[1]; u.post = null;
  }
}
// One line on who was at a post when the attack hit (the deploy panel, the log). "" = not a base attack's start.
export function startText(state, b) {
  const R = b && b.deploy && b.deploy.ready;
  if (!R) return "";
  const wall = b.tier && b.tier.map === "wall" && !(b.tier.indoor && b.tier.buildings);
  const where = wall ? "at the back" : "in the buildings";
  if (R.manned) return "The defences were manned: everyone starts at their post.";
  if (!R.late.length) return "Everyone here was on watch: all at their posts.";
  const names = R.watch.map((id) => b.units.find((u) => u.id === id)).filter(Boolean).map((u) => u.name.split(" ")[0]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  if (!names.length) return `Nobody was on watch: everyone starts ${where} and the attackers move first.`;
  return `Only ${list} ${names.length === 1 ? "was" : "were"} on watch: the rest are coming out ${wall ? "from the back" : "of the buildings"} (they can act once the attackers have moved).`;
}
// The deploy step ends (deploy.js endDeploy): the late have no actions this turn; nobody else → the attackers first.
export function lateAtStart(b) {
  const mine = b.units.filter((u) => u.side === "player" && active(u));
  if (!mine.some((u) => u.late)) return;
  for (const u of mine) if (u.late) u.ap = 0;
  if (b.tier && !mine.some((u) => !u.late)) { b.tier.enemyNext = true; b.tier.lateNext = true; }
}
// The start of the defenders' next turn (interior.js tierPlayerTurn): the late are out.
export function lateOut(b) {
  const late = b.units.filter((u) => u.late);
  if (!late.length) return;
  for (const u of late) delete u.late;
  if (b.tier && b.tier.lateNext) { b.tier.lateNext = false; b.tier.enemyNext = false; }
  const n = late.filter((u) => active(u)).length;
  if (n) say(b, `${n === 1 ? `${late.find((u) => active(u)).name} comes` : `${n} more come`} out to fight.`, "info");
}

// ---------- saving ----------
// Keeps where everyone stands now as this battle's plan for its map (the plan picked; none yet → a new "Default").
// People in the plan who are not in this fight (or still in the buildings) keep their posts, unless someone here now
// stands on theirs; posts by role that found nobody this time stay. A defender switched to "by role" (u.planRole) is
// saved as a post by role.
export function savePlan(state, b) {
  const key = planKey(b), base = baseOfBattle(state, b);
  if (!key || !base) return "There is no base plan for this fight.";
  let p = currentPlan(state, b);
  if (!p) {
    p = newPlan(state, base) || plansOf(base)[0];
    if (!p) return "No room for another plan.";
    b.deploy.planId = p.id;
  }
  const fr = frameOf(b), back = fromMap(b);
  const players = b.units.filter((u) => u.side === "player" && active(u) && !u.late && u.x >= 0 && u.sid != null);
  const posts = players.map((u) => (u.planRole && PLAN_ROLES[u.planRole] ? [u.sid, ...back(u.x, u.y), u.planRole] : [u.sid, ...back(u.x, u.y)]));
  const old = p.maps[key];
  if (old && fits(old, b)) {
    const here = new Set(players.map((u) => u.sid));
    const used = new Set(posts.map(([, x, y]) => `${x},${y}`));
    const named = new Set(posts.filter((q) => !q[3]).map((q) => q[0]));
    for (const q of old.posts) {
      if (used.has(`${q[1]},${q[2]}`)) continue;
      if (q[3]) { if ((b.deploy.unfilled || []).some((f) => f[1] === q[1] && f[2] === q[2])) { posts.push(q.slice()); used.add(`${q[1]},${q[2]}`); } continue; }
      const s = state.survivors.find((x) => x.id === q[0]);
      if (!here.has(q[0]) && !named.has(q[0]) && s && s.alive) { posts.push(q.slice()); used.add(`${q[1]},${q[2]}`); }
    }
  }
  p.maps[key] = { w0: fr.w0, h0: fr.h0, posts, lit: b.deploy.floodlit ? b.deploy.lit : (old && old.lit) || "center", day: day(state) };
  b.deploy.planned = true;
  const roles = posts.filter((q) => q[3]).length;
  return `${base.name}'s "${p.name}" plan saved: ${posts.length} post${posts.length === 1 ? "" : "s"}${roles ? ` (${roles} by role)` : ""} on ${PLAN_MAPS[key]}.`;
}
// People in a base's plans: survivor → the names of the plans they hold a post in by name (the Defence tab).
export function planPeople(state, base) {
  const out = new Map();
  for (const p of plansOf(base)) for (const entry of Object.values(p.maps)) for (const [sid, , , role] of entry.posts) {
    if (role) continue;
    const s = state.survivors.find((x) => x.id === sid);
    if (s && s.alive) { if (!out.has(s)) out.set(s, []); if (!out.get(s).includes(p.name)) out.get(s).push(p.name); }
  }
  return out;
}

// ---------- picking, roles and plans in the deploy step and the drill ----------
// act: pickPlan { id } (0: the default posts), role { unit, role } (null: this person), roles { by: "role" / "name" },
// and in a drill newPlan { name }, renamePlan { name }, tagPlan { who, when }, deletePlan. Returns an error or "".
export function planAct(state, b, act) {
  const base = baseOfBattle(state, b);
  if (!planKey(b) || !base) return "There is no base plan for this fight.";
  switch (act.type) {
    case "pickPlan": {
      const id = Number(act.id) || 0;
      const p = id ? planById(base, id) : null;
      if (id && !p) return "No such plan.";
      b.deploy.planId = id;
      if (!p) { if (!b.setup.drill) deployAct(state, b, { type: "defaults" }); say(b, "The default posts (no plan) for this fight.", "info"); return ""; }
      if (!planFor(state, b)) { say(b, `The "${p.name}" plan has no posts on ${PLAN_MAPS[planKey(b)]} yet${b.setup.drill ? ": place everyone and Save as plan" : ""}.`, "info"); return ""; }
      applyPlan(state, b);
      return "";
    }
    case "role": {
      const u = b.units.find((x) => x.id === Number(act.unit));
      if (!u || u.side !== "player") return "Pick one of your people.";
      if (act.role && !PLAN_ROLES[act.role]) return "No such role.";
      if (act.role) u.planRole = act.role; else delete u.planRole;
      return "";
    }
    case "roles": {
      for (const u of b.units) if (u.side === "player" && active(u) && !u.late) { if (act.by === "role") u.planRole = roleOf(u); else delete u.planRole; }
      say(b, act.by === "role" ? "Every post by role (who stands there now: best shot, close fighter or anyone). Save as plan to keep it." : "Every post by name. Save as plan to keep it.", "info");
      return "";
    }
  }
  if (!b.setup.drill) return "Plans are made and renamed in a drill (the base's Defence tab).";
  switch (act.type) {
    case "newPlan": {
      const p = newPlan(state, base, act.name, act.who, act.when);
      if (!p) return `At most ${PLAN.MAX} plans.`;
      b.deploy.planId = p.id;
      say(b, savePlan(state, b).replace(/saved/, "made (from where everyone stands now)"), "good");
      return "";
    }
    case "renamePlan": {
      const p = currentPlan(state, b);
      if (!p) return "Save a plan first.";
      if (!cleanName(act.name)) return "Give it a name.";
      renamePlan(base, p.id, act.name);
      return "";
    }
    case "tagPlan": {
      const p = currentPlan(state, b);
      if (!p) return "Save a plan first.";
      tagPlan(base, p.id, act.who, act.when);
      return "";
    }
    case "deletePlan": {
      const p = currentPlan(state, b);
      if (!p) return "No plan picked.";
      say(b, deletePlan(state, base, p.id), "info");
      const next = plansOf(base)[0] || null;
      b.deploy.planId = next ? next.id : 0;
      if (next && planFor(state, b)) applyPlan(state, b, { quiet: true });
      return "";
    }
  }
  return "";
}
export const PLAN_ACTS = ["pickPlan", "role", "roles", "newPlan", "renamePlan", "tagPlan", "deletePlan"];

// ---------- the drill: planning on the base's battle map ----------
// The base's own battle map (as an attack on it would lay it out, from the east, by day or night as it is now) with
// everyone at the base on it and nobody to fight: place them, Save as plan, Close. The clock stands still (it is a
// battle screen); nothing is fought, worn or saved as a battle start (ui/settings.js skips a drill). planId: the plan
// to edit (else the base's first).
export function startDrill(state, baseId, planId = null) {
  if (state.combat) return "Finish the battle first.";
  const base = state.bases.find((x) => x.id === baseId);
  if (!base) return "";
  if (!atBase(state, base.id).length) return `Nobody is at ${base.name} to drill.`;
  const b = drillBattle(state, base, planId);
  b.log = [];
  b.drill = true;
  b.phase = "deploy";
  b.acted = true;
  const key = planKey(b);
  const stale = planStale(state, b);
  const p = currentPlan(state, b);
  say(b, `Defence drill at ${base.name}${p ? `, the "${p.name}" plan` : ""}: place everyone where they should stand when the base is attacked, then Save as plan. ${key === "fort" ? "The plan holds whichever side the attack comes from" : "The map is shown facing an attack from the east; in a real attack it turns to face the side the attack comes from, and the plan turns with it"}. In the deploy step of every attack here the plan that fits it best is taken up by itself, and you can still change it for that fight.`, "info");
  if (stale) say(b, stale, "warn");
  state.combat = b;
  return "";
}
// The drill's battle (also the governor's look at a base's map, autopilot.js): the base's layout with its people
// and nobody to fight, not opened. noPlan: the default posts only.
export function drillBattle(state, base, planId = null, { noPlan = false } = {}) {
  const setup = {
    mode: "battle", layout: "baseDefence", deploy: true, drill: true, baseId: base.id, canRetreat: false, handler: null,
    // The stand-in attacker (removed): a runner, so no walking dead of the world is drawn onto it (carriers.js placeWalking).
    enemy: { kind: "zombies", count: 1, power: 1, types: { runner: 1 }, name: "nobody (a drill)" }, context: { baseId: base.id, drill: true, planId, noPlan },
  };
  const b = createBattle(state, setup);
  b.units = b.units.filter((u) => u.side === "player"); // the stand-in attacker the battle is made with
  return b;
}
// A plan from the default posts, every post by role (the dev governor's: autopilot.js governorPlans): the base's map
// as an attack from the east would lay it out, by day, with its own dice (state.rng is not drawn from), and each
// default post kept as a post by role by what it is: the towers, the walkway, the perches and the windows for the
// best shots, the gate and the doors for close fighters, the yard for whoever stood there (their kind). Only on the
// maps that turn to face the attack (a bridge's wall, a base without walls): on the fort map a plan is fixed to its
// cells, and the default posts face whichever side the attack comes from, which no fixed plan can. The plan is the
// one marked by (made again when the map changes); a full list of plans is left alone. Returns a line, or "".
export const GOV_PLAN = { NAME: "Governor", SHOOT: ["tower", "wall", "perch", "inside"], CLOSE: ["gate", "door"] };
export function defaultRolePlan(state, base, by = "governor") {
  if (state.combat || !base || !atBase(state, base.id).length) return "";
  const saved = state.rng;
  state.rng = new Rng((Number(state.seed) || 0) * 31 + localId(state, base.id) * 7919 + 17); // localId: ids are process-wide
  let b;
  try { b = drillBattle(state, base, null, { noPlan: true }); } finally { state.rng = saved; }
  const key = planKey(b);
  if (!key || key === "fort") return "";
  let p = plansOf(base).find((x) => x.by === by);
  if (!p) { p = newPlan(state, base, GOV_PLAN.NAME); if (!p) return ""; p.by = by; }
  const fr = frameOf(b), back = fromMap(b);
  const posts = b.units.filter((u) => u.side === "player" && active(u) && u.x >= 0 && u.sid != null).map((u) => {
    const role = GOV_PLAN.SHOOT.includes(u.post) ? "shooter" : GOV_PLAN.CLOSE.includes(u.post) ? "close" : roleOf(u);
    return [u.sid, ...back(u.x, u.y), role];
  });
  p.maps = { [key]: { w0: fr.w0, h0: fr.h0, posts, lit: b.deploy.floodlit ? b.deploy.lit : "center", day: day(state) } };
  return `${base.name}: the "${p.name}" defence plan laid out on ${PLAN_MAPS[key]} (${posts.length} posts by role).`;
}
export function endDrill(state) {
  const b = state.combat;
  if (!b || !b.setup.drill) return "";
  state.combat = null;
  return "";
}
// A drill's commands: the deploy step's (place, gate, defaults, flood, plan, savePlan), the plans' (PLAN_ACTS), close.
export function drillAct(state, b, act) {
  if (act.type === "endDrill") return endDrill(state);
  if (PLAN_ACTS.includes(act.type)) return planAct(state, b, act);
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
