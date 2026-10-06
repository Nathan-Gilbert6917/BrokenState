// The Carrier and its worm swarm on the battle map (every number in hiveconst.js CARRIER; their stats as special dead
// in ZTYPES carrier / swarm). Any battle: a field fight, a raid or a building's interior, a base battle.
//   The worm: the dead carry it, and a Carrier is one of them so full of it that it is swollen. A human body (anyone
//     killed: your people, raiders, soldiers, the third side; never one of the dead, never someone only down or
//     knocked out) within CARRIER.RANGE tiles of a Carrier stirs (stir): checked as each Carrier ends its move and at
//     the start of every player turn. A stirring body gets up as one of the dead at the start of the next enemy turn
//     after a player turn (riseBodies), so you always get one turn to answer: burn it (a fire on its tile, as it
//     would rise or when it stirs) or crush the skull from next to it (combatAct "crush", 1 action, silent; the
//     battle AI does it too: botCrush). Where it lay something else now stands, it gets up on a free tile next to it.
//   The risen (turn): an ordinary zombie (enemyUnit at the battle's power), named after the person ("Dana (turned)"
//     for one of yours or the third side, "Raider 3 (turned)" for the others), up with CARRIER.RISE_AP actions. It
//     keeps what the person wore: armour still takes its share of every hit (your people: inventory.js armorMult of
//     what they wear; others: their armour piece), no guns. It goes for every living thing (wild), and does not
//     count among the enemy the battle began with (reinforcement). The body it rose from is gone from the map (off).
//   Their things, never duplicated or lost (combat.js endBattle and damage; inventory.js bodies):
//     - One of yours: what they wore stays theirs (s.gear) as for anyone who dies (world.js killSurvivor: their death
//       site, or the armory at one of your bases). Put down and the battle won, their body is there to loot as usual
//       (allyBody, "Dana (turned)"); still walking when the battle ends, there is no body: the things stay at the death
//       site (or in the armory).
//     - Anyone else: the body it rose from leaves no body of its own; the risen, killed, is a body with the person's
//       kit (turnedBody: their weapon, their armour, what was in their pockets).
//     - In a raid a body is a container (combat.js damage, raidloot.js dropHaul): it goes with the risen (bodyBox) and
//       lies where they are put down; still walking when the raid ends, it is put back where they stand.
//   The swarm (burst): a Carrier that dies bursts: a worm swarm (ZTYPES.swarm, the Carrier's power) comes out on its
//     tile. Quick and weak; bullets and bolts do CARRIER.SHOT of their damage (swarmArmor), blows more, fire and
//     blasts the most. Anyone it brings to 0 is full of the worm (wormed): a body that stirs at the next player turn
//     wherever it is; one of yours it brings down rises only if they bleed out (or are torn into lying down). With no
//     one to kill it sinks into the ground after CARRIER.SWARM_TURNS enemy turns (sinkSwarms). It leaves no body.
//   The AI: an aware Carrier with none of the living next to it walks to the nearest body within CARRIER.SEEK
//     (carrierTurn); the rest of the time it claws like the others. Your people shoot it first (ZTYPES priority).
// Battles without Carriers play exactly as before (no dice are drawn here unless a Carrier or a swarm is on the map).
import { CARRIER } from "./hiveconst.js";
import { CELL, KITS, say, fx, active, adjacent, enemyUnit, reachable, pathTo, moveAlong, unitAt } from "./combat.js";
import { applyZType } from "./zombietypes.js";
import { fireAt } from "./throwables.js";
import { survivorById } from "./world.js";
import { armorMult, enemyBody } from "./inventory.js";

const cheb = (a, x, y) => Math.max(Math.abs(a.x - x), Math.abs(a.y - y));
const first = (name) => String(name || "").split(" ")[0];
export const isCarrier = (u) => u.ztype === "carrier";
const carriers = (b) => b.units.filter((u) => isCarrier(u) && active(u));
// A body that can still get up: one of the living killed, lying on the map, not risen, burned or crushed.
export const wormable = (c) => c.dead && c.kind === "human" && !c.off && !c.left && !c.fled && c.roseAs == null && !c.burnt && !c.crushed;
export const stirring = (c) => wormable(c) && c.stir != null;
// Is the worm about on this map (a Carrier or a swarm alive, or a body already stirring)? The crush button shows then.
export const wormsAbout = (b) => b.units.some((u) => (u.ztype === "carrier" || u.ztype === "swarm") && !u.dead) || b.units.some(stirring);

// × the damage a hit does to a worm swarm (deadsoldiers.js armorVs asks): most bullets pass through it.
export function swarmArmor(hit) {
  if (!hit) return CARRIER.BASH; // a trap, a spike pit
  if (hit.how === "shot") return CARRIER.SHOT;
  if (hit.how === "melee") return CARRIER.MELEE;
  if (hit.how === "bash") return CARRIER.BASH;
  if (hit.how === "blast") return CARRIER.BLAST;
  return 1; // fire (ZTYPES.swarm.burn makes it hotter), acid
}

// ---------- the bodies stir ----------
// The worms get into a body: it gets up at the start of the next enemy turn after a player turn.
function stir(b, c, why) {
  if (!wormable(c) || c.stir != null) return false;
  if (fireAt(b, c.x, c.y)) return burnBody(b, c);
  c.stir = b.phase === "enemy" ? b.turn + 1 : b.turn;
  const yours = c.side === "player";
  say(b, `${yours ? c.name : `${c.name}'s body`} ${why}. ${yours ? "They get" : "It gets"} up at the end of this turn unless the body burns or someone crushes the skull (U, from next to it).`, yours ? "death" : "danger");
  fx(b, { type: "loot", to: [c.x, c.y], text: "STIRS" });
  return true;
}
function burnBody(b, c) {
  c.burnt = true;
  c.stir = null;
  say(b, `The fire cooks the worms in ${c.name}'s body. It will not get up.`, "good");
  return false;
}
// The bodies within reach of one Carrier.
function stirNear(b, u) {
  for (const c of b.units) if (wormable(c) && c.stir == null && cheb(u, c.x, c.y) <= CARRIER.RANGE) stir(b, c, `twitches as ${u.name} shambles over it`);
}
// The start of each player turn (combat.js startPlayerTurn): bodies near a Carrier, and the swarm's dead, stir.
export function stirBodies(b) {
  for (const c of b.units) if (stirring(c) && fireAt(b, c.x, c.y)) burnBody(b, c);
  for (const c of b.units) if (wormable(c) && c.wormed && c.stir == null) stir(b, c, "twitches: the swarm's worms are in it");
  for (const u of carriers(b)) stirNear(b, u);
}

// ---------- the dead get up ----------
// A free tile to stand on: the body's own, else one next to it (null: nowhere).
function standAt(b, x, y) {
  const ok = (cx, cy) => cx >= 0 && cy >= 0 && cx < b.w && cy < b.h && CELL[b.cells[cy * b.w + cx].k].walk && !unitAt(b, cx, cy);
  if (ok(x, y)) return [x, y];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && ok(x + dx, y + dy)) return [x + dx, y + dy];
  return null;
}
// The battle's own dead are this strong (the risen and the swarm of a Carrier with no power on record).
const battlePower = (b) => (b.setup && b.setup.enemy && b.setup.enemy.kind === "zombies" && b.setup.enemy.power) || 2 + (b.infection || 0) * 3;
const zombieCount = (b) => b.units.filter((o) => o.kind === "zombie").length + 1;

// One body gets up as one of the dead.
export function turn(state, b, c) {
  const at = standAt(b, c.x, c.y);
  if (!at) return null; // hemmed in: it gets up when there is room
  const z = enemyUnit(b, b.rng, "zombies", battlePower(b), zombieCount(b));
  const named = c.side === "player" || c.side === "third" ? first(c.name) : c.name;
  z.name = `${named} (turned)`;
  z.x = at[0]; z.y = at[1];
  z.face = c.face;
  // What they wore: armour still takes its share; one of yours by what they have on (not the Tough trait).
  const s = c.sid != null && state ? survivorById(state, c.sid) : null;
  z.armor = s ? armorMult(s) : c.armor ?? 1;
  z.turned = { from: c.id, sid: c.sid ?? null, side: c.side, name: c.name, kit: c.kit || null, weapon: c.weapon || null, armorKey: c.armorKey || null, app: c.app || null };
  z.aware = true;
  z.wild = true; // the dead go for every living thing
  z.reinforcement = true; // not one of the enemy the battle began with
  z.ap = CARRIER.RISE_AP;
  c.roseAs = z.id;
  c.stir = null;
  c.off = true; // the body is gone from where it lay
  // A raid: the body's container (what it carries) goes with it.
  if (b.raid) {
    const box = b.raid.containers.find((k) => k.kind === "body" && k.uid === c.id);
    if (box) { b.raid.containers.splice(b.raid.containers.indexOf(box), 1); z.bodyBox = box; }
  }
  b.units.push(z);
  const yours = c.side === "player";
  say(b, yours ? `${c.name} gets up again, the worm in their eyes. ${z.name} is one of the dead now${s && armorMult(s) < 1 ? ", still in their armour" : ""}.` : `${c.name}'s body gets up: ${z.name} is one of the dead now.`, yours ? "death" : "danger");
  fx(b, { type: "loot", to: [z.x, z.y], text: "RISES" });
  return z;
}

// The start of each enemy turn (combat.js endPlayerTurn, before the enemy's queue is made: the risen act at once):
// the stirring bodies whose time has come get up (or burn), and the swarms sink a turn closer to the ground.
export function carrierRound(state, b) {
  for (const c of [...b.units]) {
    if (!stirring(c) || c.stir > b.turn) continue;
    if (fireAt(b, c.x, c.y)) { burnBody(b, c); continue; }
    turn(state, b, c);
  }
  sinkSwarms(b);
}
function sinkSwarms(b) {
  for (const u of b.units) {
    if (u.ztype !== "swarm" || !active(u)) continue;
    u.life = (u.life ?? CARRIER.SWARM_TURNS) - 1;
    if (u.life > 0) continue;
    u.dead = true; u.off = true; u.sank = true;
    say(b, `${u.name} sinks into the ground: with no one to go to, the worms are gone.`, "good");
  }
}

// ---------- a Carrier bursts ----------
// combat.js damage, as a Carrier dies: the worm swarm comes out where it fell.
export function burst(b, t) {
  const w = releaseSwarm(b, t.x, t.y, t.power || battlePower(b));
  if (w) say(b, `${t.name} bursts open: a swarm of worms pours out of it. Whoever it kills gets up as one of the dead. Fire and blows hurt it; most bullets go straight through.`, "danger");
  return w;
}
// A worm swarm comes out at (x, y), or on a free tile next to it (null: nowhere): a Carrier bursting, a Sleeper
// splitting open, a Flinger's throw (sleepers.js, middead.js). It acts from the next enemy turn.
export function releaseSwarm(b, x, y, power = battlePower(b)) {
  const at = standAt(b, x, y);
  if (!at) return null;
  const w = applyZType(enemyUnit(b, b.rng, "zombies", power, zombieCount(b)), "swarm", false, power);
  w.name = "Worm swarm";
  w.x = at[0]; w.y = at[1];
  w.aware = true;
  w.wild = true;
  w.reinforcement = true;
  w.life = CARRIER.SWARM_TURNS;
  w.ap = 0;
  b.units.push(w);
  fx(b, { type: "loot", to: [w.x, w.y], text: "WORMS" });
  return w;
}
// combat.js damage: a hit from the swarm that brings someone living to 0 leaves the worm in them.
export function swarmHit(t, by) {
  if (by && by.ztype === "swarm" && t.kind === "human") t.wormed = true;
}

// ---------- a Carrier's turn (zombietypes.js zombieTurn) ----------
// None of the living next to it: it walks to the nearest body within CARRIER.SEEK and stirs what it reaches.
export function carrierTurn(b, u) {
  stirNear(b, u);
  if (b.units.some((f) => f.side !== u.side && f.kind !== "zombie" && active(f) && adjacent(u, f))) return false;
  const bodies = b.units.filter((c) => wormable(c) && c.stir == null && cheb(u, c.x, c.y) > CARRIER.RANGE && cheb(u, c.x, c.y) <= CARRIER.SEEK);
  if (!bodies.length) return false;
  const r = reachable(b, u, u.mob * Math.max(1, u.ap));
  let best = null;
  for (let i = 0; i < b.w * b.h; i++) {
    if (!isFinite(r.dist[i])) continue;
    const x = i % b.w, y = (i / b.w) | 0;
    const d = Math.min(...bodies.map((c) => Math.max(Math.abs(c.x - x), Math.abs(c.y - y))));
    const sc = Math.max(0, d - CARRIER.RANGE) * 10 + r.dist[i] * 0.05;
    if (!best || sc < best.sc) best = { x, y, sc, cost: r.dist[i] };
  }
  if (!best || best.cost === 0) return false;
  moveAlong(b, u, pathTo(r, best.x, best.y));
  if (active(u)) stirNear(b, u);
  u.ap = 0;
  return true;
}

// ---------- crushing the skull (combat.js combatAct "crush") ----------
export function crushable(b, u) {
  return b.units.filter((c) => wormable(c) && cheb(u, c.x, c.y) <= 1 && (c.stir != null || c.wormed || wormsAbout(b)));
}
export function crush(b, u, c) {
  if (!c || !wormable(c) || cheb(u, c.x, c.y) > 1) return "Stand next to a body to crush its skull.";
  c.crushed = true;
  c.stir = null;
  u.face = [Math.sign(c.x - u.x), Math.sign(c.y - u.y)];
  say(b, c.side === "player" ? `${u.name} does what has to be done: ${first(c.name)} will not get up again.` : `${u.name} crushes the skull of ${c.name}'s body. It will not get up.`, "good");
  fx(b, { type: "melee", from: [u.x, u.y], to: [c.x, c.y], hit: true, crit: false, dmg: 0, side: u.side, text: "CRUSHED" });
  return "";
}
// The battle AI (combat.js autoPlayerTurn, the raid bot): a stirring body next to one of yours with none of the
// enemy next to them is crushed (1 action). Returns the act or null.
export function botCrush(b, u) {
  if (!active(u) || u.ap < 1) return null;
  if (b.units.some((f) => f.side === "enemy" && active(f) && adjacent(u, f))) return null;
  const c = b.units.find((o) => stirring(o) && cheb(u, o.x, o.y) <= 1);
  return c ? { type: "crush", unit: u.id, target: c.id } : null;
}

// ---------- their bodies (combat.js endBattle) ----------
// The risen who was not one of yours, killed: a body with the person's kit (their weapon, armour, pockets).
export function turnedBody(rng, z) {
  const t = z.turned;
  const kit = KITS[t.kit] || KITS.raiders;
  const body = enemyBody(rng, { id: z.id, name: z.name, kind: "human", kit: t.kit, weapon: t.weapon, armorKey: t.armorKey }, kit);
  return body;
}
// Is the body of one of your fallen walking about as one of the dead (no body to loot: the things stay at the death
// site or in the armory)?
export const walksOn = (b, u) => u.roseAs != null && b.units.some((z) => z.id === u.roseAs && !z.dead);
// Put down: the name its body goes by ("Dana (turned)").
export const turnedName = (b, u) => { const z = u.roseAs != null ? b.units.find((o) => o.id === u.roseAs) : null; return z ? z.name : u.name; };
// A line for the battle's summary: one of yours got up as one of the dead.
export function turnedLine(b, u) {
  const z = b.units.find((o) => o.id === u.roseAs);
  return `${u.name} got up again as one of the dead${z && z.dead ? " and had to be put down" : " and was still walking when it ended"}.`;
}

// ---------- a raid's bodies (combat.js damage, endRaid) ----------
// The risen, put down in a raid: the body it carried along lies where it fell.
export function dropBodyBox(b, z) {
  const box = z.bodyBox;
  if (!b.raid || !box) return false;
  box.x = z.x; box.y = z.y; box.uid = z.id;
  box.label = `${z.name}'s body`;
  b.raid.containers.push(box);
  z.bodyBox = null;
  return true;
}
// The raid ends with the risen still walking: their bodies' containers go back on the map where they stand (so what
// was found on them is counted as left behind, raidloot.js raidHome).
export function raidEndBodies(b) {
  for (const z of b.units) if (z.bodyBox) dropBodyBox(b, z);
}
