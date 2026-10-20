// Throwables that do more than make a noise (stealth.js THROWABLES lists them all; its throw action calls landEffect
// for the ones with fx). What is on the map lives on the battle as data any renderer can draw (siege.js
// battleOverlays): b.fires = [{ x, y, r: 0.5, turns }] one burning cell each, b.smoke and b.flares = [{ x, y, r,
// turns }] (smoke from a fire: thick, one cell), counted down at the start of each player turn (a full round, burnRound).
//   Thrown over walls: a grenade, a pipe bomb, a Molotov, smoke or a flare needs no line of sight to where it lands,
//     only someone on its side who sees the cell (or, for your people, an enemy last seen within a tile of it):
//     throwBlind. It lands off by a tile now and then (throwLanding): 45% less 0.8 a point of aim over 40 (8–45%),
//     +15% thrown blind (then 2 tiles off past 5 tiles), + the throwable's own scatter (a pipe bomb +10%).
//   frag (frag grenade): 20–30 damage to everyone within a tile of where it lands, either side; blows apart light
//     cover there (crates, fences, hay, sandbags, barricades, shelves: rubble) and hits a door or the gate for 30–45
//     (a wall section half). Wakes everything within 12 tiles; gunfire noise.
//   blast (pipe bomb): the same with 22–34 damage, 40–60 to structures and a 14-tile wake.
//   fire (Molotov): a 3 × 3 patch burns (the cells that can: open ground of any kind, wood and hay; not walls, rock,
//     water or wrecks), the middle 3 rounds and the rest 2–3; 12–18 to everyone in it when it lands. Whoever walks
//     into the flames or stands in them when a round ends burns: people 8–14, the dead 16–24 (most die in one or two
//     turns; a brute takes 60%). Each round a burning cell sets each flammable neighbour alight by its fuel (hay 45%,
//     crates, fences, barricades 25%, shelves and counters 20%, a wooden door 15%, a field 20%, grass 12%, a wooden
//     floor 8%; never stone, asphalt, dirt, gravel, the walls), at most 40 cells burning; wood and hay that burn out
//     are rubble. Every burning cell gives off thick smoke for the round: a sight line through it is blocked
//     (smokeBlocks). The dead that follow light or heat walk into it (decoys.js); people's AI walks around it
//     (combat.js reachable).
//   smoke (smoke grenade): a cloud 2 tiles around for 3 rounds; a shot into or out of it is −30 to hit, and sounding
//     the retreat is +20 for anyone in it or within 2 tiles of it (combat.js escapeOdds). Someone running from the
//     fight whom it screens from a pursuer is gone at SMOKE.gone tiles from them (battlesize.js fledFarEnough).
//   flare (road flare): burns 4 rounds; your people see anything within 5 tiles of it whatever the dark, and aim
//     +10 at it in a night battle. Its glare and heat are a lure too (stealth.js, decoys.js).
//   flash (flashbang): a bang and a blinding flash where it lands (FLASH). Living people of either side within 2 tiles
//     who see the burst cell (line of sight from it; 1 tile when the sight line crosses a doorway, a broken door or a
//     window) are stunned (u.stun): their next turn they lose an action (2 within a tile), aim -30 until that turn
//     ends, and they cannot overwatch (it drops theirs now). Facing away from it (stealth.js facing, u.face), or the
//     one who threw it: only dazed, aim -15 and no action lost. Ear protection (u.earCut, a share 0-1, when a unit has
//     it) and a riot helmet's visor (GEAR visor: FLASH.visor) take off part of it: aim x (1 - the cut), an action
//     less at a cut of 0.25, two at 0.5. The dead are not blinded: the bang is a noise lure (stealth.js THROWABLES
//     flashbang: radius 12, a decoy for one enemy turn, so even the aware dead turn to it). 0-3 damage within a tile;
//     no cover broken. Wakes the people within 12 tiles (gunfire noise, Heat +8 in a raid). stunTurnStart takes the
//     actions off at the start of the unit's next turn, stunTurnEnd lifts it when that turn ends (combat.js).
// The AI (combat.js autoPlayerTurn): a frag grenade, a pipe bomb or a Molotov on three or more enemies bunched up
// (two at a breach, the gate or a doorway for a Molotov) and none of yours near, a smoke grenade when the retreat is
// about to be sounded (the enemy's and the third side's the turn they start to fall back: siege.js coverSmoke), a flashbang on two or more people bunched within its reach (flashSpot; the enemy's soldiers and
// guards carry them: kitFlashbangs, siege.js enemyThrow).
import { nearCell, say, fx, damage, active, alertNear, alertPod, CELL, canSeeAt, breakCell, structureName, vehicleBlast, los, coverAgainst, bossOnLand } from "./combat.js";
import { ZTYPES } from "./hiveconst.js";
import { armorVs } from "./deadsoldiers.js";
import { GEAR } from "./data.js";
import { deafen, HEAR } from "./hearing.js"; // the bang: deafened near a blast
import { noteBlast } from "./crossfire.js"; // their blast heard by your people, not seen: a marker in the fog with a guess
import { blastHit, cookOffs, groundBlast } from "./launchers.js"; // section 24: what a blast does to the gear of those it hits (and to what lies there); carried bombs set off
export { registerHearing } from "./launchers.js"; // hearing.js (w2-helmets) hands its deafen here: launcher blasts and rocket launches call it
import { breakRam } from "./siege.js"; // a rocket breaks a battering ram

export const BLAST = { r: 1.5, dmg: [22, 34], wake: 14, noise: 4, struct: [40, 60] };
export const FRAG = { r: 1.5, dmg: [20, 30], wake: 12, noise: 4, struct: [30, 45] };
export const FIRE = {
  r: 1.5, turns: 3, edge: [2, 3], hit: [12, 18], burn: [8, 14], zburn: [16, 24], bossBurn: 0.5, lure: 7, max: 40, spreadTurns: 2,
  fuel: { hay: 0.45, crate: 0.25, fence: 0.25, barricade: 0.25, shelf: 0.2, cabinet: 0.2, counter: 0.2, bdoor: 0.15, doorway: 0.1, tent: 0.6, torn: 0.4 }, // tent, torn: a camp's canvas goes up fast and burns to rubble (softcover.js: the tent's wear afterwards)
  ground: { field: 0.2, grass: 0.12, floor: 0.08 },
};
// gone: someone running from the fight (combat.js flee, battlesize.js fledFarEnough) whom a cloud screens from a
// pursuer (smokeScreens: the cloud on the line between them, or either of them in it) is gone at this many tiles from
// that pursuer instead of 9 out of sight: chasing into the cloud keeps them, at −30 to shots into or out of it.
export const SMOKE = { r: 2, turns: 3, aim: 30, retreat: 20, near: 2, gone: 5 };
export const FLARE = { r: 5, turns: 4, aim: 10 };
// r / near: tiles (the larger of the two offsets: within 2 is the 5 x 5 square); ap / apNear: actions lost next turn;
// aim / daze: the aim penalty stunned / dazed; dmg within near; wake: people woken (tiles); noise: gunfire's; visor:
// a riot helmet's visor's cut (cutMax: the most any protection takes off).
export const FLASH = { r: 2, near: 1, ap: 1, apNear: 2, aim: 30, daze: 15, dmg: [0, 3], wake: 12, noise: 4, visor: 0.3, cutMax: 0.75 };
// The soldiers and guards who carry a flashbang, and who carries a smoke grenade, into a fight (combat.js enemyUnit):
// { key: [chance, how many] }. Their own dice (a hash of the battle's dice position and the unit), so nothing else in
// the battle changes. What they never threw is on their body (inventory.js carriedThrowables). Smoke covers a retreat
// (siege.js coverSmoke): a squad of soldiers or contractors usually has one, militia sometimes, raiders rarely. A group
// with an arsenal hands out only what it holds (arsenal.js ARSENAL.NONLETHAL stocks the same shares).
export const FLASH_KIT = {
  guards: { flashbang: [0.2, 1], smokegren: [0.1, 1] }, soldiers: { flashbang: [0.3, 1], smokegren: [0.35, 1] },
  contractors: { smokegren: [0.3, 1] }, militia: { smokegren: [0.12, 1] }, fighters: { smokegren: [0.08, 1] }, raiders: { smokegren: [0.04, 1] },
};
// Where the flash is cut to FLASH.near: a sight line through a doorway, a broken or open door, a gate, a window.
const DOORISH = new Set(["doorway", "odoor", "smashed", "breach", "gate", "window"]);
export const SCATTER = { base: 0.45, perAim: 0.008, min: 0.08, max: 0.45, blind: 0.15, far: 5 };
// Light cover a blast tears apart (what is left: rubble).
const LIGHT = new Set(["crate", "fence", "hay", "sandbag", "barricade", "shelf", "cabinet", "counter", "barrel"]);
// What can burn where a Molotov lands even without fuel of its own: any open ground.
const BURN_GROUND = new Set(["open", "rubble", "doorway", "smashed", "spikes", "trench", "wire", "beartrap", "breach", "stairs", "loft", "roof"]);

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const inAny = (list, x, y, extra = 0) => !!list && list.some((c) => dist(c.x, c.y, x, y) <= c.r + extra + 1e-6);
const inside = (b, x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h;
const cellOf = (b, x, y) => b.cells[y * b.w + x];

// Smoke grenades' clouds (not a fire's thick smoke, which blocks sight instead: smokeBlocks).
export const smokeAt = (b, x, y, extra = 0) => !!b.smoke && b.smoke.some((c) => !c.thick && dist(c.x, c.y, x, y) <= c.r + extra + 1e-6);
// A smoke grenade's cloud between two cells (or over either of them).
export function smokeScreens(b, x0, y0, x1, y1) {
  if (!b.smoke || !b.smoke.some((c) => !c.thick)) return false;
  if (smokeAt(b, x0, y0) || smokeAt(b, x1, y1)) return true;
  return lineCells(x0, y0, x1, y1).some(([x, y]) => smokeAt(b, x, y));
}
export const flareLit = (b, x, y) => inAny(b.flares, x, y);
export const fireAt = (b, x, y) => !!b.fires && b.fires.some((c) => c.x === x && c.y === y);
// A sight line through a fire's thick smoke (a cell between the two ends) is blocked (combat.js canSeeAt).
export function smokeBlocks(b, x0, y0, x1, y1) {
  if (!b.smoke || !b.smoke.some((c) => c.thick)) return false;
  const thick = new Set(b.smoke.filter((c) => c.thick).map((c) => c.y * b.w + c.x));
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 3);
  for (let i = 1; i < n; i++) {
    const cx = Math.floor(x0 + 0.5 + ((x1 - x0) * i) / n), cy = Math.floor(y0 + 0.5 + ((y1 - y0) * i) / n);
    if ((cx === x0 && cy === y0) || (cx === x1 && cy === y1)) continue;
    if (thick.has(cy * b.w + cx)) return true;
  }
  return false;
}

// Everyone standing (or down) within r of (x, y) who can still be hurt.
const caught = (b, x, y, r) => b.units.filter((t) => active(t) && dist(...nearCell(t, x, y), x, y) <= r + 1e-6); // a 2 × 2 boss: its nearest cell

function hurtAll(b, by, list, [lo, hi], what) {
  const parts = [];
  const how = what === "FIRE" ? "fire" : "blast"; // the armoured dead (deadsoldiers.js): fire ignores their armour
  for (const t of list) {
    const eff = Math.round(damage(b, t, b.rng.int(lo, hi), by, false, { how }));
    if (how === "blast") blastHit(b, t, eff); // launchers.js (section 24): their gear's wear, a carried bomb going off
    if (by && by.xpT && t.side === "enemy") { by.xpT.hits++; if (t.dead) by.xpT.kills++; }
    parts.push(`${t.name} ${eff}${t.dead ? " (dead)" : t.down ? " (down)" : ""}`);
    fx(b, { type: "melee", from: [t.x, t.y], to: [t.x, t.y], hit: true, crit: false, dmg: eff, side: by ? by.side : "enemy", text: what });
    if (t.side === "enemy" && !t.dead && !t.aware) alertPod(b, t.pod, `${t.name} cries out!`);
  }
  return parts;
}

// ---------- throwing over walls ----------
// Is the throw blind (no sight of the cell from where the thrower stands)? false: they see it; true: a teammate
// sees it (or an enemy was last seen within a tile of it: your people only); null: nobody on their side knows it.
export function throwBlind(b, u, x, y) {
  if (canSeeAt(b, u, x, y)) return false;
  for (const o of b.units) if (o !== u && o.side === u.side && active(o) && canSeeAt(b, o, x, y)) return true;
  if (u.side === "player" && b.ghosts) for (const g of Object.values(b.ghosts)) if (dist(g[0], g[1], x, y) <= 1.5) return true;
  return null;
}
// The chance a throw lands off target (SCATTER), by the thrower's aim.
export function scatterChance(u, T, blind) {
  const aim = u.aim ?? 40;
  return Math.max(SCATTER.min, Math.min(SCATTER.max, SCATTER.base - (aim - 40) * SCATTER.perAim)) + (blind ? SCATTER.blind : 0) + ((T && T.scatter) || 0) / 100;
}
// Where a throw comes down: on target, or a tile off (two when thrown blind past SCATTER.far tiles). [x, y, off].
export function throwLanding(b, u, T, x, y, blind) {
  if (!b.rng.chance(scatterChance(u, T, blind))) return [x, y, false];
  const k = blind && dist(u.x, u.y, x, y) > SCATTER.far ? 2 : 1;
  const opts = [];
  for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === k && inside(b, x + dx, y + dy)) opts.push([x + dx, y + dy]);
  if (!opts.length) return [x, y, false];
  const [lx, ly] = b.rng.pick(opts);
  return [lx, ly, true];
}

// A blast tears apart light cover and hits doors, the gate and wall sections (half) within its radius. heavy (a
// rocket, launchers.js ROCKET): a building's doors and a bridge's tank traps too.
const HEAVY = new Set(["idoor", "door", "tanktrap"]);
function wreck(b, x, y, r, [lo, hi], by, heavy = false) {
  let torn = 0;
  const hit = [];
  for (let cy = Math.floor(y - r); cy <= Math.ceil(y + r); cy++) for (let cx = Math.floor(x - r); cx <= Math.ceil(x + r); cx++) {
    if (!inside(b, cx, cy) || dist(cx, cy, x, y) > r + 1e-6) continue;
    const c = cellOf(b, cx, cy);
    if (LIGHT.has(c.k)) { c.k = "rubble"; delete c.t; torn++; continue; }
    if (c.hp > 0 && (c.k === "palisade" || c.k === "gate" || c.k === "bdoor" || c.k === "window" || c.k === "siegeladder" || (heavy && HEAVY.has(c.k)))) {
      const dmg = Math.round(b.rng.int(lo, hi) * (c.k === "palisade" || c.k === "siegeladder" ? 0.5 : 1));
      const name = structureName(c).toLowerCase();
      c.hp = Math.max(0, c.hp - dmg);
      if (c.hp <= 0 && c.k !== "siegeladder") breakCell(b, cx, cy, by);
      else hit.push(`the ${name} −${dmg}`);
    }
  }
  if (torn) b.losCache.fill(0);
  return (torn ? ` ${torn} cell${torn > 1 ? "s" : ""} of cover blown apart.` : "") + (hit.length ? ` It hits ${hit.join(", ")}.` : "");
}

// A throwable with fx lands at (x, y). Returns extra text for the log line. T.blast: the blast's own table (a launcher's
// round, launchers.js GL_HE / ROCKET: impact on the cell it lands on, dmg the splash around it; struct; kind: the
// vehicle's wear, combat.js BLAST_WEAR; heavy: doors and tank traps too; rams: a battering ram is broken).
export function landEffect(b, u, T, x, y) {
  if (T.fx) { const L = b.landed || (b.landed = []); const e = { fx: T.fx, x, y, side: u ? u.side : null }; L.push(e); if (L.length > 20) L.shift(); bossOnLand(b, e); } // what landed where (the Hivemind's weak spots, the Broodmother dazed: hivecrawl.js)
  if (T.fx === "blast" || T.fx === "frag") {
    const B = T.blast || (T.fx === "frag" ? FRAG : BLAST);
    const list = caught(b, x, y, B.r);
    const parts = B.impact ? [...hurtAll(b, u, list.filter((t) => t.x === x && t.y === y), B.impact, "BOOM"), ...hurtAll(b, u, list.filter((t) => t.x !== x || t.y !== y), B.dmg, "BOOM")] : hurtAll(b, u, list, B.dmg, "BOOM");
    b.noise = (b.noise || 0) + B.noise;
    if (!T.blast) deafen(b, x, y, HEAR.BLAST[T.fx] || HEAR.BLAST.frag); // hearing.js: the bang deafens those near it (a launcher's round: launchers.js deafenAt, its own bang, once)
    alertNear(b, x, y, B.wake, "The blast wakes everything nearby.", u); // crossfire.js: theirs, while you are unseen, draws the dead to the spot
    noteBlast(b, u, x, y, T.fx === "frag" ? "frag" : (T.blast && T.blast.kind) || "blast");
    const torn = wreck(b, x, y, B.r, B.struct, u, !!B.heavy);
    const rams = B.rams ? ramsHit(b, x, y, B.r) : "";
    groundBlast(b, x, y, B.r, !!B.heavy); // launchers.js: what lies within it (containers, the dead, spears, dropped guns, the vehicle's cargo) is worn by how close
    const veh = vehicleBlast(b, x, y, B.r, B.dmg, B.kind || T.fx); // combat.js: the team's vehicle and its riders (plating, glass)
    const cooked = b.cookQueue && b.cookQueue.length ? ` ${cookOffs(b)}` : ""; // launchers.js: bombs the blast set off on someone
    return (parts.length ? `The blast catches ${parts.join(", ")}.` : "The blast hits nobody.") + torn + rams + veh + cooked;
  }
  if (T.fx === "fire") {
    const parts = hurtAll(b, u, caught(b, x, y, FIRE.r), FIRE.hit, "FIRE");
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = x + dx, cy = y + dy;
      if (!inside(b, cx, cy) || !canBurn(b, cx, cy)) continue;
      ignite(b, cx, cy, dx || dy ? b.rng.int(FIRE.edge[0], FIRE.edge[1]) : FIRE.turns);
      n++;
    }
    return `${n} tiles burn for ${FIRE.edge[0]}–${FIRE.turns} turns${parts.length ? `; caught in it: ${parts.join(", ")}` : ""}.`;
  }
  if (T.fx === "smoke") {
    (b.smoke || (b.smoke = [])).push({ x, y, r: SMOKE.r, turns: SMOKE.turns });
    return `Thick smoke for ${SMOKE.turns} turns: shots through it are −${SMOKE.aim}.`;
  }
  if (T.fx === "flare") {
    (b.flares || (b.flares = [])).push({ x, y, r: FLARE.r, turns: FLARE.turns });
    return "It lights up everything around it.";
  }
  if (T.fx === "flash") return flashBurst(b, u, x, y);
  return "";
}

// A rocket breaks any battering ram within its blast (siege.js breakRam: its crew lets go).
function ramsHit(b, x, y, r) {
  const hit = [];
  for (const ram of [...(b.rams || [])]) {
    if (ram.inVehicle) continue;
    const lead = ram.lead != null ? b.units.find((o) => o.id === ram.lead) : null;
    const rx = lead && !ram.dropped ? lead.x : ram.x, ry = lead && !ram.dropped ? lead.y : ram.y;
    if (rx == null || dist(rx, ry, x, y) > r + 0.5 + 1e-6) continue;
    breakRam(b, ram);
    hit.push(ram);
  }
  return hit.length ? ` The battering ram${hit.length > 1 ? "s are" : " is"} blown apart.` : "";
}

// ---------- the flashbang ----------
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
// The cells a straight line between two cells crosses (not the two ends).
function lineCells(x0, y0, x1, y1) {
  const out = [];
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 4);
  for (let i = 1; i < n; i++) {
    const cx = Math.floor(x0 + 0.5 + ((x1 - x0) * i) / n), cy = Math.floor(y0 + 0.5 + ((y1 - y0) * i) / n);
    if ((cx === x0 && cy === y0) || (cx === x1 && cy === y1)) continue;
    if (!out.some(([px, py]) => px === cx && py === cy)) out.push([cx, cy]);
  }
  return out;
}
const doorOn = (b, x0, y0, x1, y1) => lineCells(x0, y0, x1, y1).some(([cx, cy]) => inside(b, cx, cy) && DOORISH.has(cellOf(b, cx, cy).k));
// How a burst at (x, y) reaches the cell (tx, ty): "sight" (in plain sight within FLASH.r), "door" (the sight line
// crosses a doorway or a window: within FLASH.near only), or null (out of reach, or a wall in the way).
export function flashReach(b, x, y, tx, ty) {
  const d = cheb(x, y, tx, ty);
  if (d > FLASH.r) return null;
  if (d === 0) return "sight";
  if (!los(b, x, y, tx, ty)) return null;
  if (doorOn(b, x, y, tx, ty)) return d <= FLASH.near ? "door" : null;
  return "sight";
}
// The cells a burst at (x, y) would reach (the throw preview, ui/combat.js): [[x, y, near]].
export function flashCells(b, x, y) {
  const out = [];
  for (let cy = y - FLASH.r; cy <= y + FLASH.r; cy++) for (let cx = x - FLASH.r; cx <= x + FLASH.r; cx++) {
    if (!inside(b, cx, cy) || !flashReach(b, x, y, cx, cy)) continue;
    out.push([cx, cy, cheb(x, y, cx, cy) <= FLASH.near]);
  }
  return out;
}
// The share of a flashbang a unit shrugs off: ear protection (u.earCut, when it has it) and a visor (GEAR visor).
export function flashCut(u) {
  const visor = !u.visorUp && (!!u.visor || (u.fielded || []).some(([, it]) => it && GEAR[it.key] && GEAR[it.key].visor)); // visorUp: raised (helmets.js)
  return Math.min(FLASH.cutMax, Math.max(0, Number(u.earCut) || 0) + (visor ? FLASH.visor : 0));
}
const facingAway = (u, x, y) => { const f = u.face || [0, 0]; return !!(f[0] || f[1]) && (x - u.x) * f[0] + (y - u.y) * f[1] < 0; };
// The turn number of a unit's next turn: your people's is the next round; the enemy's (and the third side's) is this
// round's enemy phase while you are still moving, else the next.
export const nextTurnOf = (b, u) => (u.side === "player" ? b.turn + 1 : b.phase === "enemy" ? b.turn + 1 : b.turn);
// What the flash does to one living person (the burst at x, y; by: the thrower). Returns the stun, or null when they
// shrug it off entirely.
export function stunUnit(b, t, x, y, by = null) {
  if (t.kind !== "human" || !active(t)) return null;
  const near = cheb(x, y, t.x, t.y) <= FLASH.near;
  const away = t === by || facingAway(t, x, y);
  let aim = away ? FLASH.daze : FLASH.aim, ap = away ? 0 : near ? FLASH.apNear : FLASH.ap;
  const cut = flashCut(t);
  if (cut > 0) { aim = Math.round(aim * (1 - cut)); ap = Math.max(0, ap - (cut >= 0.5 ? 2 : cut >= 0.25 ? 1 : 0)); }
  if (aim <= 0 && ap <= 0) return null;
  const next = nextTurnOf(b, t), was = t.stun;
  const pending = !!was && was.next >= next && !was.applied; // a stun not yet served: the worse of the two
  const live = !!was && was.next >= b.turn; // a stun still on: its aim penalty stays until the new one ends
  t.stun = { aim: Math.max(aim, live ? was.aim : 0), ap: Math.max(ap, pending ? was.ap : 0), next: Math.max(next, pending ? was.next : 0), dazed: false };
  t.stun.dazed = t.stun.ap <= 0;
  t.ow = false; // nobody watches a doorway through a white-out
  if (t.side === "enemy" && !t.aware) { t.aware = true; if (b.phase === "player") t.surprised = true; }
  fx(b, { type: "melee", from: [t.x, t.y], to: [t.x, t.y], hit: true, crit: false, dmg: 0, side: by ? by.side : "enemy", text: t.stun.dazed ? "DAZED" : "STUN" });
  return t.stun;
}
// A stun in words: "stunned (-2 actions, aim -30)" / "dazed (aim -15)".
export const stunLabel = (s) => (!s ? "" : s.dazed ? `dazed (aim −${s.aim})` : `stunned (−${s.ap} action${s.ap === 1 ? "" : "s"}${s.aim ? `, aim −${s.aim}` : ""})`); // no aim part: a stun baton's shock (nonlethal.js)
// The burst (landEffect): the stun on the living who see it, a scratch for anyone right next to it, the wake.
function flashBurst(b, by, x, y) {
  const hit = [], hurt = [];
  for (const t of b.units) {
    if (!active(t)) continue;
    if (!flashReach(b, x, y, t.x, t.y)) continue;
    if (cheb(x, y, t.x, t.y) <= FLASH.near) {
      const raw = b.rng.int(FLASH.dmg[0], FLASH.dmg[1]);
      if (raw > 0) {
        const eff = Math.round(damage(b, t, raw, by, false, { how: "blast" }));
        if (eff > 0) hurt.push(`${t.name} ${eff}${t.dead ? " (dead)" : t.down ? " (down)" : ""}`);
      }
    }
    const s = stunUnit(b, t, x, y, by);
    if (s) hit.push(`${t.name} ${stunLabel(s)}`);
  }
  b.noise = (b.noise || 0) + FLASH.noise;
  deafen(b, x, y, HEAR.BLAST.flash); // hearing.js: the bang rings in the ears too
  noteBlast(b, by, x, y, "flash"); // crossfire.js: theirs, heard out of sight
  // The people within earshot wake (the dead turn to the noise instead: the lure, stealth.js throwAt).
  const pods = new Set();
  for (const e of b.units) if (e.side === "enemy" && e.kind === "human" && !e.aware && active(e) && dist(e.x, e.y, x, y) <= FLASH.wake) pods.add(e.pod);
  for (const pod of pods) alertPod(b, pod, "The bang wakes everyone nearby.");
  return `BANG! ${hit.length ? `${hit.join(", ")}.` : "Nobody is caught in the flash."}${hurt.length ? ` Singed: ${hurt.join(", ")}.` : ""}`;
}
// The start of a side's turn (combat.js): the stunned of these sides whose turn it is lose their actions.
export function stunTurnStart(b, sides) {
  for (const u of b.units) {
    // A rocket fired in a room (launchers.js backblast): the shooter loses an action at the start of their next turn.
    if (u.reel && sides.includes(u.side) && u.reel.next <= b.turn) {
      const lost = active(u) ? Math.min(u.ap, 1) : 0;
      u.ap -= lost;
      if (lost) say(b, `${u.name} is still reeling from ${u.reel.why || "the blast"} (−1 action).`, u.side === "player" ? "danger" : "good");
      delete u.reel;
    }
    const s = u.stun;
    if (!s || !sides.includes(u.side) || s.applied || s.next !== b.turn) continue;
    s.applied = true;
    u.ow = false;
    if (!active(u) || s.ap <= 0) continue;
    const lost = Math.min(u.ap, s.ap);
    u.ap -= lost;
    if (lost) say(b, `${u.name} is still reeling from the flash (−${lost} action${lost === 1 ? "" : "s"}).`, u.side === "player" ? "danger" : "good");
  }
}
// The end of a side's turn: the stuns served in it wear off.
// A stun with a daze to follow (s.then: a taser's, nonlethal.js applyStun) leaves that daze for the unit's next turn.
export function stunTurnEnd(b, sides) {
  for (const u of b.units) {
    if (!u.stun || !sides.includes(u.side) || u.stun.next > b.turn) continue;
    const th = u.stun.then;
    if (th && th.aim > 0) u.stun = { aim: th.aim, ap: 0, next: u.stun.next + 1, dazed: true };
    else delete u.stun;
  }
}
// Their kit (combat.js enemyUnit): a soldier or a guard with a flashbang now and then (FLASH_KIT; seed: the battle's
// dice position, read and never moved).
export function kitFlashbangs(u, kind, seed) {
  for (const [key, [p, n]] of Object.entries(FLASH_KIT[kind] || {})) {
    if (mix01(seed, u.id, kind, key) >= p) continue;
    (u.throwables || (u.throwables = {}))[key] = (u.throwables[key] || 0) + n;
  }
}
function mix01(...parts) {
  let h = 2166136261 >>> 0;
  for (const c of parts.join("|")) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
// A flashbang tossed through a doorway into a room nobody sees into (stealth.js throw): the throw's line crosses a
// doorway the thrower sees, within 3 tiles of where it lands, with a clear line from the doorway to the spot.
export function doorToss(b, u, x, y) {
  return lineCells(u.x, u.y, x, y).some(([cx, cy]) => inside(b, cx, cy) && DOORISH.has(cellOf(b, cx, cy).k) && dist(cx, cy, x, y) <= 3 && canSeeAt(b, u, cx, cy) && los(b, cx, cy, x, y));
}

// ---------- fire ----------
// Can this cell burn: open ground where a Molotov lands, or something with fuel (FIRE.fuel)?
export function canBurn(b, x, y) {
  const c = cellOf(b, x, y);
  return BURN_GROUND.has(c.k) || FIRE.fuel[c.k] != null || CELL[c.k].walk && !CELL[c.k].bar && c.k !== "walkway" && c.k !== "tower" && c.k !== "gate" && c.k !== "siegeladder" && c.k !== "water";
}
// How readily fire spreads into this cell (0: never): its fuel, else the ground's.
export function fuelOf(b, x, y) {
  const c = cellOf(b, x, y);
  if (FIRE.fuel[c.k] != null) return FIRE.fuel[c.k];
  if (!CELL[c.k].walk || c.k === "walkway" || c.k === "tower" || c.k === "gate" || c.k === "siegeladder") return 0;
  return FIRE.ground[c.f] || 0;
}
export function ignite(b, x, y, turns) {
  const list = b.fires || (b.fires = []);
  const was = list.find((c) => c.x === x && c.y === y);
  if (was) { was.turns = Math.max(was.turns, turns); return was; }
  const f = { x, y, r: 0.5, turns };
  list.push(f);
  (b.smoke || (b.smoke = [])).push({ x, y, r: 0.5, turns: 1, thick: true });
  return f;
}

// Walking into the flames (combat.js moveAlong). Returns true when the unit was burned.
export function fireStep(b, u, x, y) {
  if (!b.fires || !b.fires.length || !active(u) || !fireAt(b, x, y)) return false;
  burn(b, u, "walks into the flames");
  return true;
}
// How hot the flames are for this unit: the dead burn fast (a brute less, a boss half), people as before.
export function burnRange(u) {
  if (u.kind !== "zombie") return FIRE.burn;
  const m = u.boss ? FIRE.bossBurn : (u.ztype && ZTYPES[u.ztype] && ZTYPES[u.ztype].burn) || 1;
  return [Math.round(FIRE.zburn[0] * m), Math.round(FIRE.zburn[1] * m)];
}
// The burn line first, then the damage (so a death reads after it).
function burn(b, u, what) {
  const [lo, hi] = burnRange(u);
  const raw = b.rng.int(lo, hi);
  const fire = { how: "fire" }; // the armoured dead (deadsoldiers.js): fire ignores their armour
  const eff = Math.round(raw * armorVs(u, null, fire));
  say(b, `${u.name} ${what} (${eff}).`, u.side === "player" ? "danger" : "good");
  fx(b, { type: "melee", from: [u.x, u.y], to: [u.x, u.y], hit: true, crit: false, dmg: eff, side: "fire", text: "BURN" });
  damage(b, u, raw, null, false, fire);
  if (u.kind === "zombie" && u.dead) b.burned = (b.burned || 0) + 1;
}

// The start of each player turn: whoever stands in the flames burns, the fire spreads, then fires, smoke and flares
// burn down (wood and hay that burned out are rubble).
export function burnRound(b) {
  if (b.fires && b.fires.length) {
    for (const t of b.units) {
      if (!active(t) || !fireAt(b, t.x, t.y)) continue;
      burn(b, t, "burns");
    }
    spread(b);
  }
  for (const k of ["fires", "smoke", "flares"]) {
    if (!b[k] || !b[k].length) continue;
    for (const c of b[k]) c.turns -= 1;
    if (k === "fires") for (const c of b[k]) if (c.turns <= 0) burnOut(b, c.x, c.y);
    b[k] = b[k].filter((c) => c.turns > 0);
  }
  // The flames still burning smoke for the coming round.
  for (const f of b.fires || []) if (!b.smoke.some((c) => c.thick && c.x === f.x && c.y === f.y)) b.smoke.push({ x: f.x, y: f.y, r: 0.5, turns: 1, thick: true });
}
function spread(b) {
  const now = b.fires.slice();
  for (const f of now) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (b.fires.length >= FIRE.max) return;
      const x = f.x + dx, y = f.y + dy;
      if (!inside(b, x, y) || fireAt(b, x, y)) continue;
      const fuel = fuelOf(b, x, y);
      if (fuel > 0 && b.rng.chance(fuel)) ignite(b, x, y, FIRE.spreadTurns);
    }
  }
}
function burnOut(b, x, y) {
  const c = cellOf(b, x, y);
  if (FIRE.fuel[c.k] == null || c.k === "doorway") return;
  const los = CELL[c.k].los;
  c.k = c.k === "bdoor" ? "doorway" : "rubble";
  c.hp = 0; delete c.t;
  if (los) b.losCache.fill(0);
}

// ---------- the AI's throws (combat.js autoPlayerTurn and siege.js for the enemy) ----------
const CHOKE = new Set(["gate", "breach", "doorway", "smashed", "siegeladder"]);
// The best spot for a grenade, a pipe bomb or a Molotov: at least 3 foes caught (2 at a chokepoint for a Molotov),
// none of the thrower's side within the radius + 1, a cell its side knows (throwBlind). side: whose foes.
// opts.min: the nearest it may be (2; a launcher's arming range, launchers.js); opts.direct: the thrower must see the
// cell itself (a rocket, a grenade launcher indoors); opts.clear: how far its own side must be from the spot (r + 1;
// a launcher allows for the tile or two it can land off).
export function blastSpot(b, u, range, r, opts = {}) {
  const foes = b.units.filter((t) => t.side !== u.side && active(t) && !t.off);
  const mine = b.units.filter((t) => t.side === u.side && active(t));
  const need = opts.need || 3;
  let best = null;
  for (const f of foes) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = f.x + dx, y = f.y + dy;
      if (!inside(b, x, y)) continue;
      const d = dist(u.x, u.y, x, y);
      if (d > range || d < (opts.min ?? 2)) continue;
      if (mine.some((m) => dist(m.x, m.y, x, y) <= (opts.clear ?? r + 1))) continue;
      const n = foes.filter((t) => dist(t.x, t.y, x, y) <= r + 1e-6).length;
      const choke = opts.fire && [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([ax, ay]) => inside(b, x + ax, y + ay) && CHOKE.has(cellOf(b, x + ax, y + ay).k));
      if (n < (choke ? Math.min(need, 2) : need)) continue;
      if (opts.fire && fireAt(b, x, y)) continue;
      const sc = n + (choke ? 1 : 0);
      if (best && sc <= best.sc) continue;
      if (opts.direct ? !canSeeAt(b, u, x, y) : throwBlind(b, u, x, y) === null) continue;
      best = { x, y, n, sc };
    }
  }
  return best;
}

// The best spot for a flashbang: at least opts.need (2) of the thrower's foes, living people not already stunned, in
// its reach (flashReach); none of its own side within FLASH.r + 1 tiles of it (a throw can land a tile off), the
// thrower itself more than FLASH.r away and opts.min (3) to range tiles off; a cell its side knows (throwBlind, or a
// doorway it sees: doorToss). opts.cover: at least one of them in cover from the thrower (the enemy's rush);
// opts.aware: only foes that know of the fight count (the raid bot). Returns { x, y, n, blind } or null.
export function flashSpot(b, u, range, opts = {}) {
  const need = opts.need || 2, min = opts.min ?? 3;
  const foes = b.units.filter((t) => t.side !== u.side && t.side !== "third" && t.kind === "human" && active(t) && !t.off && !(t.stun && t.stun.next >= nextTurnOf(b, t)) && (!opts.aware || t.aware !== false));
  if (foes.length < need) return null;
  const mine = b.units.filter((t) => t !== u && t.side === u.side && t.kind === "human" && active(t));
  let best = null;
  const tried = new Set();
  for (const f of foes) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = f.x + dx, y = f.y + dy;
    if (!inside(b, x, y) || tried.has(y * b.w + x)) continue;
    tried.add(y * b.w + x);
    if (CELL[cellOf(b, x, y).k].los) continue; // not into a wall
    const d = dist(u.x, u.y, x, y);
    if (d > range + 0.01 || d < min || cheb(u.x, u.y, x, y) <= FLASH.r) continue;
    if (mine.some((m) => cheb(m.x, m.y, x, y) <= FLASH.r + 1)) continue;
    const caughtF = foes.filter((t) => flashReach(b, x, y, t.x, t.y));
    if (caughtF.length < need) continue;
    if (opts.cover && !caughtF.some((t) => coverAgainst(b, t.x, t.y, u.x, u.y).level > 0)) continue;
    const sc = caughtF.length + caughtF.filter((t) => cheb(t.x, t.y, x, y) <= FLASH.near).length * 0.3 - d * 0.01;
    if (best && sc <= best.sc) continue;
    let blind = throwBlind(b, u, x, y);
    if (blind === null) blind = doorToss(b, u, x, y) ? true : null;
    if (blind === null) continue;
    best = { x, y, n: caughtF.length, sc, blind };
  }
  return best;
}
