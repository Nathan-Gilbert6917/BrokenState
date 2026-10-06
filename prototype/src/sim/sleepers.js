// Bodies on the ground, and the Sleepers among them (every number in hiveconst.js SLEEPER; the Sleeper's stats in
// ZTYPES sleeper). A fight in the open (no layout: not a base, a hive or a growth) and every raid map (a street, a
// building) has bodies lying about: placeBodies, SLEEPER.COUNT for a Medium map's area (more on a bigger map and
// PER_INF more on infected ground, at most MAX), none within AWAY tiles of where your people start, none in a raid's
// extraction zones or on the evac strip. They are plain data on the battle (b.corpses: { id, x, y, seed, sleeper,
// spotted, burst, burnt, unit }), drawn as bodies, never units: nothing in the battle counts or walks round them.
//   A Sleeper (each body at ODDS + ODDS_INF × the tile's Infection, at most ODDS_MAX; the placing has dice of its
//   own, so the battle's own dice do not change): a body so full of the worm that it splits open when anyone living
//   (your people, raiders, the third side; never one of the dead) steps next to it (wakeNear, combat.js moveAlong).
//   SWARMS worm swarms pour out (carriers.js releaseSwarm: the Carrier's swarm, sinking after CARRIER.SWARM_TURNS),
//   and the first bites whoever woke it at once unless the Sleeper had been spotted.
//   Spotting (spotCheck: each of your people as they move and at the start of your turn): a Sleeper within SPOT_RANGE
//   tiles in sight, at SPOT + SPOT_PER × Scouting (at most SPOT_MAX), one try a turn for each of them. Spotted, it
//   becomes a unit lying where it is (ztype "sleeper", dormant: it never acts; combat.js checkEnd and clearEnough do
//   not wait for it), drawn with its ring and letter, that can be shot from afar: it splits where it lies (sleeperDies).
//   Fire cooks the worms in it (any body on a burning tile: burnBodies; a Sleeper killed by fire): no swarm.
// Battles with no Sleeper among the bodies draw no dice of the battle's here.
import { SLEEPER } from "./hiveconst.js";
import { CELL, say, fx, active, los, enemyUnit, unitAt, zoneAt, inEvac, damage, meleeOdds } from "./combat.js";
import { applyZType } from "./zombietypes.js";
import { releaseSwarm } from "./carriers.js";
import { fireAt } from "./throwables.js";
import { Rng } from "./rng.js";

const cheb = (a, c) => Math.max(Math.abs(a.x - c.x), Math.abs(a.y - c.y));
const power = (b) => (b.setup && b.setup.enemy && b.setup.enemy.kind === "zombies" && b.setup.enemy.power) || 2 + (b.infection || 0) * 3;
const first = (name) => String(name || "").split(" ")[0];
const live = (c) => c.sleeper && !c.burst && !c.burnt;
const hash = (n) => { let x = (n >>> 0) ^ 0x9e3779b9; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); return (x ^ (x >>> 16)) >>> 0; };

// Bodies on a new battle map (combat.js createBattle for a fight in the open, createRaid). seed: the world's seed.
export function placeBodies(b, seed = 1) {
  const rng = new Rng(hash((seed | 0) ^ Math.imul((b.tileId ?? 0) + 1, 0x27d4eb2d) ^ Math.imul(b.w * 131 + b.h, 0x165667b1)));
  const inf = b.infection || 0;
  const n = Math.min(SLEEPER.MAX, Math.round(((SLEEPER.COUNT + SLEEPER.PER_INF * inf) * b.w * b.h) / SLEEPER.AREA));
  const odds = Math.min(SLEEPER.ODDS_MAX, SLEEPER.ODDS + SLEEPER.ODDS_INF * inf);
  const mine = b.units.filter((u) => u.side === "player" && !u.dead);
  const cells = [];
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const i = y * b.w + x;
    if (!CELL[b.cells[i].k].walk || !b.reach[i] || unitAt(b, x, y)) continue;
    if (b.raid ? zoneAt(b, x, y) >= 0 : inEvac(b, x, y)) continue;
    if (mine.some((u) => cheb(u, { x, y }) < SLEEPER.AWAY)) continue;
    cells.push([x, y]);
  }
  rng.shuffle(cells);
  b.corpses = [];
  for (let i = 0; i < Math.min(n, cells.length); i++) b.corpses.push({ id: i + 1, x: cells[i][0], y: cells[i][1], seed: rng.int(0, 99999), sleeper: rng.chance(odds) });
  return b.corpses;
}
export const sleepersLeft = (b) => (b.corpses || []).filter(live).length;

// ---------- spotting ----------
// One of your people moved or starts their turn: the Sleepers in sight within SPOT_RANGE, one try each a turn.
export function spotCheck(b, u) {
  if (!b.corpses || !b.corpses.length || u.side !== "player" || !active(u)) return;
  for (const c of b.corpses) {
    if (!live(c) || c.spotted || cheb(u, c) > SLEEPER.SPOT_RANGE) continue;
    const tried = c.tried || (c.tried = {});
    if (tried[u.id] === b.turn || !los(b, u.x, u.y, c.x, c.y)) continue;
    tried[u.id] = b.turn;
    if (b.rng.chance(Math.min(SLEEPER.SPOT_MAX, SLEEPER.SPOT + SLEEPER.SPOT_PER * (u.scouting || 0)))) spot(b, c, u);
  }
}
function spot(b, c, by) {
  if (unitAt(b, c.x, c.y)) return; // something stands on it: no clear look
  c.spotted = true;
  const p = power(b);
  const z = applyZType(enemyUnit(b, b.rng, "zombies", p, b.units.filter((o) => o.kind === "zombie").length + 1), "sleeper", false, p);
  z.name = "Sleeper";
  z.x = c.x; z.y = c.y;
  z.aware = true;
  z.reinforcement = true; // not one of the enemy the battle began with
  z.corpse = c.id;
  z.ap = 0;
  z.face = [0, 0];
  c.unit = z.id;
  b.units.push(z);
  say(b, `${first(by.name)} sees one of the bodies twitch: a Sleeper, full of the worm. Shoot it from here or burn it; nobody goes next to it.`, "good");
  fx(b, { type: "loot", to: [c.x, c.y], text: "SLEEPER" });
}

// ---------- splitting open ----------
// Someone living just stepped (combat.js moveAlong): a Sleeper next to them splits open.
export function wakeNear(b, u) {
  if (!b.corpses || !b.corpses.length || u.kind === "zombie" || !active(u)) return;
  for (const c of b.corpses) if (live(c) && cheb(u, c) <= 1) split(b, c, u);
}
function split(b, c, by) {
  c.burst = true;
  const z = c.unit != null ? b.units.find((o) => o.id === c.unit) : null;
  if (z && !z.dead) { z.dead = true; z.hp = 0; z.dormant = false; }
  const swarms = [];
  for (let i = 0; i < SLEEPER.SWARMS; i++) { const w = releaseSwarm(b, c.x, c.y, power(b)); if (w) swarms.push(w); }
  const who = by ? first(by.name) : "someone";
  say(b, `The body by ${who} splits open: a Sleeper. ${swarms.length ? "A swarm of worms pours out of it." : "The worms spill out and sink into the ground."}`, "danger");
  if (swarms.length && by && by.side === "player" && !c.spotted && active(by)) bite(b, swarms[0], by);
}
// The swarm's first bite, before anyone can react.
function bite(b, w, t) {
  const o = meleeOdds(b, w, t);
  w.face = [Math.sign(t.x - w.x), Math.sign(t.y - w.y)];
  if (b.rng.chance(o.chance / 100)) {
    const eff = Math.round(damage(b, t, b.rng.int(o.dmg[0], o.dmg[1]), w, false, { how: "melee", crit: false }));
    say(b, `The worms are on ${first(t.name)} before they can step back (${eff}).`, "danger");
    fx(b, { type: "melee", from: [w.x, w.y], to: [t.x, t.y], hit: true, crit: false, dmg: eff, side: "enemy" });
  } else {
    say(b, `${first(t.name)} jerks back from the worms in time.`, "info");
    fx(b, { type: "melee", from: [w.x, w.y], to: [t.x, t.y], hit: false, side: "enemy" });
  }
}
// A spotted Sleeper killed (combat.js damage): it splits where it lies, or the fire cooks the worms in it.
export function sleeperDies(b, t, hit) {
  const c = (b.corpses || []).find((x) => x.id === t.corpse);
  t.dormant = false;
  if (hit && hit.how === "fire") {
    if (c) c.burnt = true;
    say(b, "The fire cooks the worms in the Sleeper. Nothing comes out of it.", "good");
    return;
  }
  if (c) c.burst = true;
  const w = releaseSwarm(b, t.x, t.y, power(b));
  say(b, w ? "The Sleeper splits open where it lies: a swarm of worms pours out, well clear of your people." : "The Sleeper splits open; the worms spill out and sink into the ground.", "good");
}

// ---------- fire ----------
// At each turn's change (combat.js): a body on a burning tile burns, and a Sleeper's worms cook with it.
export function burnBodies(b) {
  if (!b.corpses || !b.corpses.length || !b.fires || !b.fires.length) return;
  for (const c of b.corpses) {
    if (c.burst || c.burnt || !fireAt(b, c.x, c.y)) continue;
    c.burnt = true;
    if (!c.sleeper) continue;
    const z = c.unit != null ? b.units.find((o) => o.id === c.unit) : null;
    if (z && !z.dead) { z.dead = true; z.hp = 0; z.dormant = false; }
    say(b, "One of the bodies in the flames writhes as it burns: a Sleeper, its worms cooked.", "good");
  }
}
