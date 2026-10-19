// Siege equipment on the battle map, raiders' siege kit by their preparedness, and siege kit by the numbers.
//
// The kit (data.js GEAR: frag grenade, siege ladder, battering ram; the pipe bomb too):
//   Grenades: thrown over walls (throwables.js throwBlind, throwLanding): no line of sight needed to a cell anyone on
//     the thrower's side sees; a tile off now and then by aim; area damage; light cover blown apart.
//   Ladder (bulky, a team's cargo or a raider's kit): its carrier walks a tile slower an action (LADDER.SLOW). From
//     the foot of a wall section (the cell next to it, on the ground) one action sets it up: the wall cell becomes a
//     "siegeladder" (combat.js CELL: walkable, height 1, a climb), so anyone can climb onto the walkway behind it (a
//     climb of 1 for people, 2 for the dead) and stands exposed while on it (no cover, +CLIMB_AIM to be hit). A
//     defender next to it, up on the walkway or a tower or right behind the wall, pushes it off with one action:
//     35% + a fifth of their melee aim + Tough / Brave (Coward −), −15 with someone on it, 15–80%. Pushed off, it
//     lies at its foot (one action raises it again) and whoever was on it falls: 10–18 damage, the rest of the turn lost.
//   Ram (bulky, needs RAM.MIN–RAM.CREW carriers): its lead walks at RAM.MOB tiles an action and the crew keeps up
//     (they follow the lead and spend their turn carrying); from right in front of a barred gate or door the lead
//     swings it: 16–24 damage a carrier next to it (2–3), the gate's hit points 100–180 (deploy.js), a door's 45–60.
//     The crew cannot shoot and has no cover (+CREW_AIM to be hit). With fewer than RAM.MIN left standing it is dropped;
//     anyone on that side next to it can take it up again with whoever stands next to them.
//   Rocks from the walls: a defender up on the walkway or a tower drops what is to hand on someone at the foot of
//     the wall (within DROP.RANGE tiles and lower): DROP.CHANCE% for 12–18, and a ram's crew is bunched: one more of
//     them takes 6–10.
// Who brings it: raiders and outsider bands coming for a walled base of yours, by how prepared they are (raidSiegeKit:
//   eras.js raid preparedness, rising with the years; the State Map's raid warning card says what they carry), and
//   your teams on an Assault (kit.js packSiegeKit: ladders, the ram, grenades from the hub's armory into the cargo,
//   weighed by load.js). A group's raid brings only what its stores hold (arsenal.js packRaidKit: its own ladders and
//   ram, made by your recipe when it has none; grenades as throwables on the raiders), a band only what its people
//   carry (visitors.js bandKit). The battle hands out the ram to the three strongest and the ladders to the next
//   (siegeSetup); the grenades are already on whoever carries them (fighters.js fitThrowables).
// By the numbers: the walls count less against a raid with kit (siegeWallCut: −6% a ladder, −10% a ram, −2% a
//   grenade off the wall tier's bonus, at most −25%: defences.js raidTier, interior.js baseTiers) and an assault
//   with kit faces less of its walls (assaultCut: −15% a ladder, −20% the ram, −4% a grenade of the walls' share of
//   their defence, at most −60%: conquest.js assaultForce).
// Everything that is on the map is data any renderer can draw: battleOverlays.
import { atVehicle } from "./raidloot.js"; // the team's vehicle on the map (loadRam / unloadRam)
import { CELL, active, unitAt, unitById, say, fx, reachable, pathTo, distField, moveAlong, damage, heightAt, barredCell, breakCell, structureName, alertNear } from "./combat.js";
import { throwAt, THROWABLES, throwablesOf, botAttackThrow } from "./stealth.js";
import { blastSpot, flashSpot, throwBlind as throwBlindOf, FRAG, BLAST, FIRE } from "./throwables.js";
import { shepherdsOf } from "./decoys.js";
import { ACID } from "./acid.js";
import { count, hasWall } from "./buildings.js";
import { ZTYPES, SHEPHERD } from "./hiveconst.js";
import { raidPrep, outsiderPrep } from "./eras.js";
import { aiLaunch } from "./launchers.js"; // a grenade launcher or a rocket (section 13): rockets at your gate, your ram, your vehicle first

export const LADDER = { SLOW: 1, PUSH: 35, PUSH_AIM: 0.2, CLIMBER: -15, MIN: 15, MAX: 80, FALL: [10, 18] };
export const RAM = { DMG: [16, 24], CREW: 3, MIN: 2, MOB: 3, NOISE: 3, WAKE: 12, DETOUR: 8 }; // DETOUR: a gate is worth the ram when the way round (a breach) is this much longer
export const DROP = { RANGE: 2, CHANCE: 70, DMG: [12, 18], SPLASH: [6, 10] };
export const CLIMB_AIM = 10, CREW_AIM = 10;
// Raiders' kit by preparedness (raidSiegeKit): level 0–1 from the year's raid preparedness (eras.js PREP 0.8 → 1.25;
// an outsider band's OUT_PREP 0.6 → 1.05), + PREPARED for a raid that comes back stronger (escalated) or a military
// / expansionist group. Ladders at chance LADDERS × level (2 with 8+ fighters), a ram at (level − RAM_FROM) × RAM_PER
// (+ RAM_GATE against a reinforced gate; 4+ fighters), grenades at (level − GREN_FROM) × GREN_PER (1 + 1 per 5
// fighters, at most 3). Outsiders: × OUTSIDER (they bring it sometimes).
export const RAID_KIT = { LADDERS: 0.9, RAM_FROM: 0.25, RAM_PER: 1.0, RAM_GATE: 0.2, GREN_FROM: 0.15, GREN_PER: 0.85, PREPARED: 0.15, OUTSIDER: 0.6, MIN_FIGHTERS: 3 };
export const CUT = { ladder: 0.06, ram: 0.1, grenade: 0.02, max: 0.25 };
export const ASSAULT_CUT = { ladder: 0.15, ram: 0.2, grenade: 0.04, max: 0.6 };
export const GRENADES = ["frag", "pipebomb"];
const AI_THROWS = [...GRENADES, "molotov"]; // what anyone carrying them throws on a bunch of their foes (docs/adr/0001-ai-parity.md: a Molotov too)

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const inside = (b, x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h;
const cellOf = (b, x, y) => b.cells[y * b.w + x];
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hash = (n) => { let x = (n >>> 0) ^ 0x9e3779b9; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); return (x ^ (x >>> 16)) >>> 0; };
const roll = (...keys) => keys.reduce((h, k) => hash(h ^ Math.imul((k | 0) + 0x632be5ab, 0x27d4eb2d)), 0x1234567) / 4294967296;

// ---------- the kit a raid brings (State Map) ----------
// { ladders, ram, grenades, kind } or null. Deterministic: its own dice from the seed and the raid (no world dice).
// opts: { count: fighters, key: the raid's id, outsider, prepared: escalated / a well-armed group, kind: "frag" | "pipebomb" }.
export function raidSiegeKit(state, base, opts = {}) {
  if (!base || !hasWall(base)) return null;
  const n = opts.count || 0;
  if (n < RAID_KIT.MIN_FIGHTERS) return null;
  let level = opts.outsider ? (outsiderPrep(state) - 0.6) / 0.45 : (raidPrep(state) - 0.8) / 0.45;
  level = clamp(level + (opts.prepared ? RAID_KIT.PREPARED : 0), 0, 1);
  if (level <= 0) return null;
  const mult = opts.outsider ? RAID_KIT.OUTSIDER : 1;
  const key = (opts.key | 0) + 7;
  const r = (k) => roll(state.seed || 1, key, k, Math.floor(state.hour / 24));
  const ladders = r(1) < level * RAID_KIT.LADDERS * mult ? (n >= 8 ? 2 : 1) : 0;
  const ram = n >= 4 && r(2) < ((level - RAID_KIT.RAM_FROM) * RAID_KIT.RAM_PER + (count(base, "gate") ? RAID_KIT.RAM_GATE : 0)) * mult ? 1 : 0;
  const grenades = r(3) < (level - RAID_KIT.GREN_FROM) * RAID_KIT.GREN_PER * mult ? Math.min(3, 1 + Math.floor(n / 5)) : 0;
  if (!ladders && !ram && !grenades) return null;
  return { ladders, ram, grenades, kind: opts.kind || "pipebomb" };
}
// The ladders and the ram a band of raiders sets out with from beyond the border (visitors.js makeVisitor): the dice
// raidSiegeKit throws for an outsider band against a walled base with a gate (the year's preparedness × OUTSIDER;
// ladders 2 with 8+ of them, a ram with 4+), thrown once when it crosses the border, with no base in view yet. From
// then on they are real items in the band's gear, carried by its people (nomads.js bandRoom), brought to a raid and
// home from it (visitors.js bandKit, siegeGearBack): no ladder or ram is handed to it again. key: the band's serial.
// { ladders, ram } or null.
export function bandSetOutKit(state, n, key) {
  if ((n || 0) < RAID_KIT.MIN_FIGHTERS) return null;
  const level = clamp((outsiderPrep(state) - 0.6) / 0.45, 0, 1);
  if (level <= 0) return null;
  const r = (k) => roll(state.seed || 1, (key | 0) + 13, k, 0);
  const ladders = r(1) < level * RAID_KIT.LADDERS * RAID_KIT.OUTSIDER ? (n >= 8 ? 2 : 1) : 0;
  const ram = n >= 4 && r(2) < ((level - RAID_KIT.RAM_FROM) * RAID_KIT.RAM_PER + RAID_KIT.RAM_GATE) * RAID_KIT.OUTSIDER ? 1 : 0;
  return ladders || ram ? { ladders, ram } : null;
}
// "they carry two ladders and a ram, and grenades" ("" without kit).
export function kitText(kit) {
  if (!kit) return "";
  const parts = [];
  if (kit.ladders) parts.push(kit.ladders > 1 ? `${kit.ladders} ladders` : "a ladder");
  if (kit.ram) parts.push("a battering ram");
  const things = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "";
  const gren = kit.grenades ? `${kit.grenades > 1 ? `${kit.grenades} ${kit.kind === "frag" ? "grenades" : "pipe bombs"}` : kit.kind === "frag" ? "a grenade" : "a pipe bomb"} to throw over the walls` : "";
  return `They carry ${[things, gren].filter(Boolean).join(", and ")}.`;
}
// How much less the walls count against a raid with siege kit (the wall tier's multiplier less this, at least 1).
export function siegeWallCut(kit) {
  if (!kit) return 0;
  return Math.min(CUT.max, (kit.ladders || 0) * CUT.ladder + (kit.ram ? CUT.ram : 0) + (kit.grenades || 0) * CUT.grenade);
}
// The siege kit a team carries (in its cargo, on its people): { ladders, ram, grenades }.
export function teamKit(state, people, cargo) {
  const all = [...(cargo || [])];
  for (const s of people || []) {
    for (const it of Object.values(s.gear || {})) if (it) { all.push(it); if (it.contents) all.push(...it.contents); }
    for (const it of s.pockets || []) if (it) all.push(it);
  }
  const n = (k) => all.filter((it) => it && it.key === k).length;
  return { ladders: n("ladder"), ram: n("ram") ? 1 : 0, grenades: n("frag") + n("pipebomb") };
}
// A fight by the numbers used the team's grenades up (conquest.js: an assault resolved without the map).
export function spendGrenades(state, people, cargo) {
  if (cargo && cargo.gear) cargo.gear = cargo.gear.filter((it) => !(it && GRENADES.includes(it.key)));
  for (const s of people || []) {
    for (let i = 0; i < (s.pockets || []).length; i++) if (s.pockets[i] && GRENADES.includes(s.pockets[i].key)) s.pockets[i] = null;
    const pk = s.gear && s.gear.backpack && s.gear.backpack.contents;
    if (pk) for (let i = 0; i < pk.length; i++) if (pk[i] && GRENADES.includes(pk[i].key)) pk[i] = null;
  }
}
// The share of their walls an assault with kit takes away (conquest.js assaultForce).
export function assaultCut(kit) {
  if (!kit) return 0;
  return Math.min(ASSAULT_CUT.max, Math.min(2, kit.ladders || 0) * ASSAULT_CUT.ladder + (kit.ram ? ASSAULT_CUT.ram : 0) + Math.min(4, kit.grenades || 0) * ASSAULT_CUT.grenade);
}

// ---------- the battle: handing out the kit ----------
const wallCells = (b) => b.cells.some((c) => c.k === "palisade");
const strength = (u) => u.hp / Math.max(0.05, u.armor) + (u.meleeAim || 0) * 0.3;
// After both sides are placed (combat.js createBattle): the enemy's kit (setup.enemy.siege) and a team's (its cargo).
export function siegeSetup(state, b) {
  b.ladders = b.ladders || [];
  b.rams = b.rams || [];
  const walls = wallCells(b);
  const e = b.setup.enemy || {};
  const kit = e.siege;
  if (kit) hand(b, b.units.filter((u) => u.side === "enemy" && u.kind === "human"), kit, walls, true);
  const p = b.setup.partyId != null ? state.parties.find((x) => x.id === b.setup.partyId) : null;
  if (p && p.cargo && walls) {
    const cargo = p.cargo.gear || [];
    const mine = { ladders: cargo.filter((it) => it && it.key === "ladder").length, ram: cargo.some((it) => it && it.key === "ram") ? 1 : 0, grenades: 0 };
    if (mine.ladders || mine.ram) hand(b, b.units.filter((u) => u.side === "player"), mine, walls, false);
  }
}
function hand(b, people, kit, walls, enemy) {
  // The team's ram rides in its vehicle when it brought one (combat.js b.vehicle): nobody is slowed by it until it is
  // unloaded next to the wall (unloadRam); the crew takes it up from there.
  if (kit.ram && !enemy && b.vehicle) {
    b.rams.push({ id: b.nextId++, side: "player", lead: null, crew: [], x: b.vehicle.x, y: b.vehicle.y, dropped: false, inVehicle: true, hits: 0 });
    kit = { ...kit, ram: 0 };
  }
  const left = people.slice().sort((a, c) => strength(c) - strength(a) || a.id - c.id);
  if (kit.ram && left.length >= RAM.MIN && (walls || b.cells.some((c) => barredCell(c)))) {
    const crew = left.splice(0, Math.min(RAM.CREW, left.length >= 4 || !enemy ? RAM.CREW : RAM.MIN));
    const r = { id: b.nextId++, side: crew[0].side, lead: crew[0].id, crew: crew.map((u) => u.id), x: crew[0].x, y: crew[0].y, dropped: false, hits: 0 };
    b.rams.push(r);
    for (const u of crew) { u.ram = r.id; u.mob0 = u.mob0 ?? u.mob; }
    crew[0].mob = Math.min(crew[0].mob0, RAM.MOB);
    // The ram starts where its side stands nearest a gate (the lead swaps places with whoever stood there).
    const goals = enemy ? ramGoals(b, crew[0]) : [];
    if (goals.length) {
      const field = distField(b, goals.map(([x, y]) => [x, y]));
      const spot = people.filter((o) => active(o)).sort((a, c) => field[a.y * b.w + a.x] - field[c.y * b.w + c.x] || a.id - c.id)[0];
      if (spot && spot !== crew[0]) { const [x, y] = [spot.x, spot.y]; spot.x = crew[0].x; spot.y = crew[0].y; crew[0].x = x; crew[0].y = y; }
      r.x = crew[0].x; r.y = crew[0].y;
    }
    // The crew starts gathered round the lead.
    for (const u of crew.slice(1)) followLead(b, u, crew[0], true);
  }
  if (kit.ladders && walls) {
    for (let i = 0; i < kit.ladders && left.length; i++) {
      const u = left.splice(left.findIndex((x) => !x.ladder), 1)[0];
      u.ladder = (u.ladder || 0) + 1;
      u.mob0 = u.mob0 ?? u.mob;
      u.mob = Math.max(2, u.mob0 - LADDER.SLOW);
    }
  }
  // The grenades are not handed out here: they are real throwables the raiders carry (arsenal.js packRaidKit; a band's
  // own, visitors.js bandKit), counted on each from the items (fighters.js fitThrowables) and spent from them.
}

// ---------- ladders ----------
// A wall section (palisade) a ladder can go up from (fx, fy): the foot on the ground next to it, something to climb
// onto on the far side.
export function ladderSpot(b, wx, wy, fx, fy) {
  if (!inside(b, wx, wy) || !inside(b, fx, fy)) return false;
  const c = cellOf(b, wx, wy);
  if (c.k !== "palisade" || Math.abs(wx - fx) + Math.abs(wy - fy) !== 1) return false;
  const foot = cellOf(b, fx, fy);
  if (!CELL[foot.k].walk || heightAt(b, fx, fy) !== 0 || barredCell(foot)) return false;
  const tx = wx + (wx - fx), ty = wy + (wy - fy);
  return inside(b, tx, ty) && CELL[cellOf(b, tx, ty).k].walk;
}
export const ladderAt = (b, x, y) => (b.ladders || []).find((l) => l.up && l.x === x && l.y === y) || null;
const lyingNear = (b, u) => (b.ladders || []).find((l) => !l.up && l.side === u.side && cheb(l.fx, l.fy, u.x, u.y) <= 1) || null;
// Where this unit could set a ladder up now: wall sections orthogonally next to it.
export function ladderTargets(b, u) {
  if (!(u.ladder > 0) && !lyingNear(b, u)) return [];
  return DIRS4.map(([dx, dy]) => [u.x + dx, u.y + dy]).filter(([x, y]) => ladderSpot(b, x, y, u.x, u.y) && !ladderAt(b, x, y));
}
function placeLadder(b, u, wx, wy) {
  if (!ladderSpot(b, wx, wy, u.x, u.y)) return "Stand at the foot of a wall section, right next to it, to set a ladder up.";
  if (ladderAt(b, wx, wy)) return "There is a ladder there already.";
  const lying = !(u.ladder > 0) ? lyingNear(b, u) : null;
  if (!(u.ladder > 0) && !lying) return "Nobody here carries a ladder.";
  const c = cellOf(b, wx, wy);
  c.was = c.k;
  c.k = "siegeladder";
  b.losCache.fill(0);
  let lad;
  if (lying) { lad = lying; Object.assign(lad, { up: true, x: wx, y: wy, fx: u.x, fy: u.y }); }
  else {
    u.ladder -= 1;
    if (!u.ladder) u.mob = u.mob0 ?? u.mob;
    lad = { id: b.nextId++, side: u.side, x: wx, y: wy, fx: u.x, fy: u.y, up: true, by: u.id };
    b.ladders.push(lad);
  }
  u.ap -= 1;
  fx(b, { type: "melee", from: [u.x, u.y], to: [wx, wy], hit: true, crit: false, dmg: 0, side: u.side, text: "LADDER" });
  say(b, `${u.name} ${lying ? "raises the ladder again" : "sets a ladder against the wall"}. ${u.side === "enemy" ? "They will come over the top!" : "Climb!"}`, u.side === "enemy" ? "danger" : "good");
  return "";
}
// Can this unit push that ladder off: next to it, up on the walkway or a tower or right behind the wall (not at its foot).
export function canPush(b, u, lad) {
  if (!lad || !lad.up || u.side === lad.side || !active(u) || cheb(u.x, u.y, lad.x, lad.y) !== 1) return false;
  const tx = lad.x + (lad.x - lad.fx), ty = lad.y + (lad.y - lad.fy);
  return heightAt(b, u.x, u.y) >= 1 || (u.x === tx && u.y === ty) || ((u.x - lad.x) * (lad.x - lad.fx) + (u.y - lad.y) * (lad.y - lad.fy) > 0);
}
export function pushChance(b, u, lad) {
  const on = unitAt(b, lad.x, lad.y);
  return Math.round(clamp(LADDER.PUSH + (u.meleeAim || 65) * LADDER.PUSH_AIM + (u.str || 0) + (on && active(on) ? LADDER.CLIMBER : 0), LADDER.MIN, LADDER.MAX));
}
export const pushable = (b, u) => (b.ladders || []).filter((l) => canPush(b, u, l));
function pushLadder(b, u, lad) {
  if (!canPush(b, u, lad)) return "Stand next to the ladder, up on the walkway or behind the wall, to push it off.";
  const ch = pushChance(b, u, lad);
  u.ap -= 1;
  u.hunker = false;
  if (!b.rng.chance(ch / 100)) {
    say(b, `${u.name} heaves at the ladder, but it holds (${ch}%).`, "info");
    return "";
  }
  const on = unitAt(b, lad.x, lad.y);
  const c = cellOf(b, lad.x, lad.y);
  c.k = c.was || "palisade";
  delete c.was;
  b.losCache.fill(0);
  lad.up = false;
  fx(b, { type: "melee", from: [u.x, u.y], to: [lad.x, lad.y], hit: true, crit: false, dmg: 0, side: u.side, text: "PUSHED" });
  say(b, `${u.name} pushes the ladder off the wall (${ch}%)!`, u.side === "player" ? "good" : "danger");
  if (on) {
    const spot = freeNear(b, lad.fx, lad.fy, (x, y) => heightAt(b, x, y) === 0);
    if (spot) { on.x = spot[0]; on.y = spot[1]; }
    on.ap = 0;
    const eff = Math.round(damage(b, on, b.rng.int(LADDER.FALL[0], LADDER.FALL[1]), u));
    say(b, `${on.name} falls off the ladder (${eff}).`, on.side === "player" ? "danger" : "good");
  }
  return "";
}
function freeNear(b, x, y, ok = () => true) {
  for (let r = 0; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (cheb(0, 0, dx, dy) !== r) continue;
    const nx = x + dx, ny = y + dy;
    if (!inside(b, nx, ny) || !CELL[cellOf(b, nx, ny).k].walk || cellOf(b, nx, ny).k === "siegeladder" || unitAt(b, nx, ny) || !ok(nx, ny)) continue;
    return [nx, ny];
  }
  return null;
}

// ---------- the ram ----------
export const ramOf = (b, u) => (u && u.ram != null ? (b.rams || []).find((r) => r.id === u.ram && !r.dropped) || null : null);
export const isCrew = (b, u) => !!ramOf(b, u);
// Barred gates and doors right in front of the lead (orthogonally): what it can swing at.
export function ramTargets(b, u) {
  const r = ramOf(b, u);
  if (!r || r.lead !== u.id) return [];
  return DIRS4.map(([dx, dy]) => [u.x + dx, u.y + dy]).filter(([x, y]) => inside(b, x, y) && ramable(cellOf(b, x, y)));
}
const ramable = (c) => c.hp > 0 && barredCell(c) && (c.k === "gate" || c.k === "bdoor");
const carriers = (b, r, lead) => r.crew.map((id) => unitById(b, id)).filter((o) => o && active(o) && (o === lead || cheb(o.x, o.y, lead.x, lead.y) <= 1));
function swing(b, u, x, y) {
  const r = ramOf(b, u);
  if (!r || r.lead !== u.id) return "Only the one leading the ram swings it.";
  if (!ramTargets(b, u).some(([tx, ty]) => tx === x && ty === y)) return "Bring the ram right up to a barred gate or door first.";
  const hands = carriers(b, r, u).slice(0, RAM.CREW);
  if (hands.length < RAM.MIN) return `The ram needs ${RAM.MIN} to swing it: wait for the crew.`;
  const c = cellOf(b, x, y);
  let dmg = 0;
  for (let i = 0; i < hands.length; i++) dmg += b.rng.int(RAM.DMG[0], RAM.DMG[1]);
  const name = structureName(c).toLowerCase();
  c.hp = Math.max(0, c.hp - dmg);
  r.hits++;
  r.target = [x, y];
  for (const o of hands) { o.ap = 0; o.face = [Math.sign(x - o.x), Math.sign(y - o.y)]; }
  u.ap = 0;
  b.noise = (b.noise || 0) + RAM.NOISE;
  alertNear(b, x, y, RAM.WAKE, "The ram's booming carries.");
  fx(b, { type: "melee", from: [u.x, u.y], to: [x, y], hit: true, crit: false, dmg, side: u.side, text: c.hp > 0 ? `RAM −${dmg}` : "SMASHED" });
  if (c.hp <= 0) { breakCell(b, x, y, u); r.target = null; }
  else say(b, `${u.name}'s crew swings the ram into the ${name}: −${dmg} (${c.hp}/${c.mhp} left).`, u.side === "enemy" ? "danger" : "good");
  b.rev++;
  return "";
}
// The crew keeps up with its lead: each one not next to it walks to a free cell next to it (start: placed there).
function followLead(b, o, lead, start = false) {
  if (!active(o) || cheb(o.x, o.y, lead.x, lead.y) <= 1) return true;
  if (start) { const s = freeNear(b, lead.x, lead.y, (x, y) => cheb(x, y, lead.x, lead.y) === 1); if (s) { o.x = s[0]; o.y = s[1]; return true; } return false; }
  const rr = reachable(b, o, (o.mob0 || o.mob) * 2);
  let best = -1;
  for (let i = 0; i < b.w * b.h; i++) {
    const x = i % b.w, y = (i / b.w) | 0;
    if (!isFinite(rr.dist[i]) || cheb(x, y, lead.x, lead.y) !== 1) continue;
    if (best < 0 || rr.dist[i] < rr.dist[best]) best = i;
  }
  if (best < 0) return false;
  if (rr.dist[best] > 0) moveAlong(b, o, pathTo(rr, best % b.w, (best / b.w) | 0));
  return active(o) && cheb(o.x, o.y, lead.x, lead.y) <= 1;
}
// After any unit moves (combat.js moveAlong): a ram's lead brings its crew along (their turn is spent carrying).
export function afterMove(b, u) {
  const r = ramOf(b, u);
  if (!r) return;
  if (r.lead !== u.id) return;
  r.x = u.x; r.y = u.y;
  if (b.following) return;
  b.following = true;
  try {
    for (const id of r.crew) {
      const o = unitById(b, id);
      if (!o || o === u || !active(o)) continue;
      const ok = followLead(b, o, u);
      o.ap = 0;
      if (!ok) leaveCrew(b, r, o, `${o.name} cannot keep up with the ram.`);
    }
  } finally { b.following = false; }
  checkRam(b, r);
}
function leaveCrew(b, r, o, why) {
  r.crew = r.crew.filter((id) => id !== o.id);
  o.ram = null;
  if (o.mob0 != null && !o.ladder) o.mob = o.mob0;
  if (why) say(b, why, "info");
}
// A ram with too few left to carry it is dropped where it is; a dead lead hands it on.
export function checkRam(b, r) {
  if (!r || r.dropped || r.inVehicle) return; // in the team's vehicle: nobody carries it
  const alive = r.crew.map((id) => unitById(b, id)).filter((o) => o && active(o));
  for (const id of r.crew.slice()) { const o = unitById(b, id); if (!o || !active(o)) leaveCrew(b, r, o || { id }, ""); }
  if (alive.length < RAM.MIN) {
    const lead = unitById(b, r.lead);
    if (lead) { r.x = lead.x; r.y = lead.y; }
    r.dropped = true;
    r.lead = null;
    for (const o of alive) leaveCrew(b, r, o, "");
    r.crew = [];
    say(b, `The battering ram is dropped${alive.length ? ": too few left to carry it" : ""}.`, r.side === "enemy" ? "good" : "danger");
    return;
  }
  if (!alive.some((o) => o.id === r.lead)) {
    const lead = alive[0];
    r.lead = lead.id;
    lead.mob = Math.min(lead.mob0 ?? lead.mob, RAM.MOB);
    r.x = lead.x; r.y = lead.y;
  }
}
export function checkRams(b) { for (const r of b.rams || []) checkRam(b, r); }
// A rocket's blast breaks the ram (launchers.js ROCKET, throwables.js landEffect): its crew lets go, it is gone.
export function breakRam(b, r) {
  if (!r || !b.rams) return;
  for (const id of r.crew.slice()) { const o = unitById(b, id); if (o) leaveCrew(b, r, o, ""); }
  r.crew = []; r.lead = null; r.dropped = true; r.broken = true;
  b.rams = b.rams.filter((x) => x !== r);
}
// Let go of the ram (the crew is free again), or take a dropped one up with whoever of your side stands next to you.
function dropRam(b, u) {
  const r = ramOf(b, u);
  if (!r) return "Not carrying the ram.";
  const lead = unitById(b, r.lead) || u;
  r.x = lead.x; r.y = lead.y; r.dropped = true; r.lead = null;
  for (const id of r.crew.slice()) { const o = unitById(b, id); if (o) leaveCrew(b, r, o, ""); }
  r.crew = [];
  say(b, `${u.name}'s crew sets the ram down.`, "info");
  return "";
}
function takeRam(b, u) {
  const r = (b.rams || []).find((x) => x.dropped && x.side === u.side && cheb(x.x, x.y, u.x, u.y) <= 1);
  if (!r) return "No ram on the ground next to you.";
  const helpers = b.units.filter((o) => o !== u && o.side === u.side && o.kind === "human" && active(o) && o.ram == null && cheb(o.x, o.y, u.x, u.y) <= 1).slice(0, RAM.CREW - 1);
  if (helpers.length + 1 < RAM.MIN) return `It takes ${RAM.MIN} to carry the ram: someone has to stand next to you.`;
  r.dropped = false; r.lead = u.id; r.crew = [u.id, ...helpers.map((o) => o.id)];
  for (const o of [u, ...helpers]) { o.ram = r.id; o.mob0 = o.mob0 ?? o.mob; o.ap = 0; }
  u.mob = Math.min(u.mob0, RAM.MOB);
  if (u.x !== r.x || u.y !== r.y) { r.x = u.x; r.y = u.y; }
  say(b, `${[u, ...helpers].map((o) => o.name).join(", ").replace(/, ([^,]*)$/, " and $1")} take up the ram.`, u.side === "enemy" ? "danger" : "good");
  return "";
}

// ---------- rocks from the walls ----------
export function canDrop(b, u, t) {
  return !!t && active(u) && active(t) && t.side !== u.side && !t.off && heightAt(b, u.x, u.y) >= 1 && heightAt(b, t.x, t.y) < heightAt(b, u.x, u.y) && cheb(u.x, u.y, t.x, t.y) <= DROP.RANGE;
}
export const dropTargets = (b, u) => b.units.filter((t) => canDrop(b, u, t));
function dropRocks(b, u, t) {
  if (!canDrop(b, u, t)) return `Drop things only from up on the walkway or a tower, on someone below within ${DROP.RANGE} tiles.`;
  u.ap = 0; u.hunker = false;
  u.face = [Math.sign(t.x - u.x), Math.sign(t.y - u.y)];
  if (!b.rng.chance(DROP.CHANCE / 100)) {
    say(b, `${u.name} heaves a rock over the wall at ${t.name} and misses (${DROP.CHANCE}%).`, "info");
    fx(b, { type: "melee", from: [u.x, u.y], to: [t.x, t.y], hit: false, side: u.side });
    return "";
  }
  const eff = Math.round(damage(b, t, b.rng.int(DROP.DMG[0], DROP.DMG[1]), u));
  let text = `${u.name} drops a rock on ${t.name}: ${eff}.`;
  fx(b, { type: "melee", from: [u.x, u.y], to: [t.x, t.y], hit: true, crit: false, dmg: eff, side: u.side, text: "ROCK" });
  const r = ramOf(b, t) || (b.rams || []).find((x) => !x.dropped && x.crew.includes(t.id));
  if (r) {
    const other = r.crew.map((id) => unitById(b, id)).find((o) => o && o !== t && active(o));
    if (other) { const e2 = Math.round(damage(b, other, b.rng.int(DROP.SPLASH[0], DROP.SPLASH[1]), u)); text += ` It glances off the ram onto ${other.name} (${e2}).`; }
    checkRam(b, r);
  }
  say(b, text, u.side === "player" ? "good" : "danger");
  return "";
}

// ---------- actions (combat.js combatAct, and the AI) ----------
// ladder (x, y: the wall section), push (ladder: id), ram (x, y: the gate or door), dropRam, takeRam, drop (target).
export function siegeAct(state, b, u, t, act) {
  switch (act.type) {
    case "loadRam": { // the ram into the team's vehicle (combat.js b.vehicle): the one this crew carries, or one lying next to you
      if (!b.vehicle) return "There is no vehicle here.";
      if (!atVehicle(b, u)) return "Stand next to the vehicle.";
      const r = ramOf(b, u) || (b.rams || []).find((x) => x.dropped && x.side === u.side && cheb(x.x, x.y, u.x, u.y) <= 1);
      if (!r) return "No ram carried or lying next to you.";
      for (const id of r.crew.slice()) { const o = unitById(b, id); if (o) leaveCrew(b, r, o, ""); }
      r.crew = []; r.lead = null; r.dropped = false; r.inVehicle = true; r.x = b.vehicle.x; r.y = b.vehicle.y;
      u.ap = Math.max(0, u.ap - 1);
      say(b, `${u.name} heaves the ram into the ${b.vehicle.kind === "truck" ? "truck" : "car"}.`, "info");
      return "";
    }
    case "unloadRam": { // the ram out of the vehicle onto the ground next to you (then Take up ram)
      if (!b.vehicle) return "There is no vehicle here.";
      if (!atVehicle(b, u)) return "Stand next to the vehicle.";
      const r = (b.rams || []).find((x) => x.inVehicle && x.side === u.side);
      if (!r) return "No ram in the vehicle.";
      r.inVehicle = false; r.dropped = true; r.x = u.x; r.y = u.y;
      u.ap = Math.max(0, u.ap - 1);
      say(b, `${u.name} drags the ram out of the ${b.vehicle.kind === "truck" ? "truck" : "car"}: it lies here for a crew to take up.`, "info");
      return "";
    }
    case "ladder": {
      const tg = act.x != null ? [Number(act.x), Number(act.y)] : ladderTargets(b, u)[0];
      if (!tg) return u.ladder > 0 || lyingNear(b, u) ? "Stand at the foot of a wall section, right next to it." : "Nobody here carries a ladder.";
      return placeLadder(b, u, tg[0], tg[1]);
    }
    case "push": {
      const lad = act.ladder != null ? (b.ladders || []).find((l) => l.id === act.ladder) : pushable(b, u)[0];
      return pushLadder(b, u, lad);
    }
    case "ram": {
      const tg = act.x != null ? [Number(act.x), Number(act.y)] : ramTargets(b, u)[0];
      if (!tg) return isCrew(b, u) ? "Bring the ram right up to a barred gate or door first." : "Not carrying the ram.";
      return swing(b, u, tg[0], tg[1]);
    }
    case "dropRam": return dropRam(b, u);
    case "takeRam": return takeRam(b, u);
    case "drop": return dropRocks(b, u, t);
    default: return "Unknown action.";
  }
}

// ---------- the AI (both sides): rams, ladders, storming, grenades, pushing ladders, rocks ----------
// The barred gates and doors a ram could go for, each with the cells in front of it on the ram's side.
// Only a gate or door that is really in the way: the cell behind it cannot be walked to without it, or only the long
// way round (RAM.DETOUR tiles more: a breach far off, or held); one gate cell already broken opens the other's way too.
function ramGoals(b, u) {
  const out = [];
  const walk = reachable(b, u, 400).dist; // barred cells closed to the attackers (combat.js)
  const near = distField(b, [[u.x, u.y]]); // the front: reachable at all (other units do not count)
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const c = cellOf(b, x, y);
    if (!ramable(c)) continue;
    for (const [dx, dy] of DIRS4) {
      const fx0 = x + dx, fy0 = y + dy, bx = x - dx, by = y - dy;
      if (!inside(b, fx0, fy0) || !inside(b, bx, by) || !CELL[cellOf(b, fx0, fy0).k].walk || barredCell(cellOf(b, fx0, fy0))) continue;
      const front = near[fy0 * b.w + fx0], behind = walk[by * b.w + bx];
      if (!isFinite(front) || behind <= front + RAM.DETOUR || !CELL[cellOf(b, bx, by).k].walk) continue;
      out.push([fx0, fy0, x, y]);
    }
  }
  return out;
}
function ramLeadTurn(b, u) {
  const r = ramOf(b, u);
  const goals = ramGoals(b, u);
  if (!goals.length) { dropRam(b, u); return false; } // nothing left to batter: fight as usual
  const here = goals.find(([x, y]) => x === u.x && y === u.y);
  if (here) {
    if (carriers(b, r, u).length >= RAM.MIN) { swing(b, u, here[2], here[3]); return true; }
    for (const id of r.crew) { const o = unitById(b, id); if (o && o !== u) followLead(b, o, u); }
    if (carriers(b, r, u).length >= RAM.MIN) swing(b, u, here[2], here[3]);
    u.ap = 0;
    return true;
  }
  // Walking (RAM.MOB tiles an action, both actions if the gate is not within one), then a swing if there is an action left.
  const field = distField(b, goals.map(([x, y]) => [x, y]));
  const one = reachable(b, u, u.mob);
  const reachOne = goals.some(([x, y]) => isFinite(one.dist[y * b.w + x]));
  const rr = reachOne || u.ap < 2 ? one : reachable(b, u, u.mob * u.ap);
  let best = -1;
  for (let i = 0; i < b.w * b.h; i++) if (isFinite(rr.dist[i]) && (best < 0 || field[i] < field[best] || (field[i] === field[best] && rr.dist[i] < rr.dist[best]))) best = i;
  if (best < 0 || rr.dist[best] === 0) { u.ap = 0; return true; }
  u.ap -= rr.dist[best] <= u.mob ? 1 : 2;
  moveAlong(b, u, pathTo(rr, best % b.w, (best / b.w) | 0));
  if (!active(u) || !ramOf(b, u)) return true;
  const now = goals.find(([x, y]) => x === u.x && y === u.y);
  if (now && u.ap >= 1 && carriers(b, r, u).length >= RAM.MIN) swing(b, u, now[2], now[3]);
  u.ap = 0;
  return true;
}
// The wall sections a ladder could go up for this unit: [foot x, y, wall x, y], the foot on its side, a real shortcut.
function ladderGoals(b, u) {
  const field = distField(b, [[u.x, u.y]]);
  const out = [];
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    if (cellOf(b, x, y).k !== "palisade" || ladderAt(b, x, y)) continue;
    for (const [dx, dy] of DIRS4) {
      const fx0 = x - dx, fy0 = y - dy, tx = x + dx, ty = y + dy;
      if (!ladderSpot(b, x, y, fx0, fy0)) continue;
      const f = field[fy0 * b.w + fx0], t = field[ty * b.w + tx];
      if (!isFinite(f) || (isFinite(t) && t <= f + 4)) continue;
      if (unitAt(b, fx0, fy0) && unitAt(b, fx0, fy0) !== u) continue;
      // Not next to the gate (the ram's), and away from the towers.
      const nearGate = DIRS4.some(([ax, ay]) => inside(b, x + ax, y + ay) && cellOf(b, x + ax, y + ay).k === "gate");
      const nearTower = b.cells.some((c, i) => c.k === "tower" && cheb(i % b.w, (i / b.w) | 0, tx, ty) <= 1);
      out.push({ fx: fx0, fy: fy0, x, y, sc: f + (nearGate ? 4 : 0) + (nearTower ? 6 : 0) });
    }
  }
  return out.sort((a, c) => a.sc - c.sc);
}
function ladderTurn(b, u) {
  const goals = ladderGoals(b, u);
  if (!goals.length) { u.ladder = 0; u.mob = u.mob0 ?? u.mob; return false; }
  const at = goals.find((g) => g.fx === u.x && g.fy === u.y);
  if (at) { placeLadder(b, u, at.x, at.y); stormers(b, u, ladderAt(b, at.x, at.y)); u.ap = 0; return true; }
  const field = distField(b, goals.slice(0, 4).map((g) => [g.fx, g.fy]));
  const rr = reachable(b, u, u.mob);
  let best = -1;
  for (let i = 0; i < b.w * b.h; i++) if (isFinite(rr.dist[i]) && (best < 0 || field[i] < field[best] || (field[i] === field[best] && rr.dist[i] < rr.dist[best]))) best = i;
  if (best < 0 || rr.dist[best] === 0) return false;
  u.ap -= 1;
  moveAlong(b, u, pathTo(rr, best % b.w, (best / b.w) | 0));
  const at2 = active(u) && u.ap >= 1 ? ladderGoals(b, u).find((g) => g.fx === u.x && g.fy === u.y) : null;
  if (at2) { placeLadder(b, u, at2.x, at2.y); stormers(b, u, ladderAt(b, at2.x, at2.y)); }
  u.ap = 0;
  return true;
}
// Who goes up a ladder just set: the one who set it and the two nearest close fighters of its side.
function stormers(b, u, lad) {
  if (!lad) return;
  u.storm = lad.id;
  const near = b.units.filter((o) => o !== u && o.side === u.side && o.kind === "human" && active(o) && o.ram == null && !o.ladder && !o.storm && dist(o.x, o.y, lad.fx, lad.fy) <= 9)
    .sort((a, c) => dist(a.x, a.y, lad.fx, lad.fy) - dist(c.x, c.y, lad.fx, lad.fy));
  for (const o of near.slice(0, 2)) o.storm = lad.id;
}
function stormTurn(b, u) {
  const lad = (b.ladders || []).find((l) => l.id === u.storm);
  if (!lad) { u.storm = null; return false; }
  const tx = lad.x + (lad.x - lad.fx), ty = lad.y + (lad.y - lad.fy);
  if (b.tier && b.tier.interior && b.tier.interior[u.y * b.w + u.x]) { u.storm = null; return false; } // over the wall
  if (u.x === tx && u.y === ty) { u.storm = null; return false; }
  if (!lad.up) {
    if (cheb(u.x, u.y, lad.fx, lad.fy) <= 1 && (u.x === lad.fx && u.y === lad.fy)) { placeLadder(b, u, lad.x, lad.y); u.ap = 0; return true; }
    if (cheb(u.x, u.y, lad.fx, lad.fy) > 6) { u.storm = null; return false; }
    // Back to its foot to raise it again.
    const rr = reachable(b, u, u.mob * u.ap);
    const i = lad.fy * b.w + lad.fx;
    if (isFinite(rr.dist[i]) && rr.dist[i] > 0) { u.ap -= rr.dist[i] <= u.mob ? 1 : 2; moveAlong(b, u, pathTo(rr, lad.fx, lad.fy)); if (active(u) && u.ap >= 1 && u.x === lad.fx && u.y === lad.fy) placeLadder(b, u, lad.x, lad.y); u.ap = 0; return true; }
    u.storm = null;
    return false;
  }
  const rr = reachable(b, u, u.mob * u.ap);
  const field = distField(b, [[tx, ty]], u);
  let best = -1;
  for (let i = 0; i < b.w * b.h; i++) if (isFinite(rr.dist[i]) && isFinite(field[i]) && (best < 0 || field[i] < field[best] || (field[i] === field[best] && rr.dist[i] < rr.dist[best]))) best = i;
  if (best < 0 || rr.dist[best] === 0 || !(field[best] < field[u.y * b.w + u.x])) { u.storm = null; return false; }
  u.ap -= rr.dist[best] <= u.mob ? 1 : 2;
  moveAlong(b, u, pathTo(rr, best % b.w, (best / b.w) | 0));
  if (!active(u) || u.ap < 1) { u.ap = 0; return true; }
  return false; // up and with an action left: the usual AI (shoot or strike from the top)
}
// A grenade (the enemy's kit: u.throwables) on two or more of the defenders bunched up, once a turn for the side.
export function enemyThrow(b, u) {
  if (!u.throwables || b.enemyThrowTurn === b.turn || u.ap < 1) return false;
  for (const key of AI_THROWS) {
    if (!(u.throwables[key] > 0)) continue;
    const T = THROWABLES[key];
    const spot = blastSpot(b, u, T.range, key === "frag" ? FRAG.r : key === "molotov" ? FIRE.r : BLAST.r, { need: 2 });
    if (!spot) continue;
    const blind = throwBlindOf(b, u, spot.x, spot.y);
    u.throwables[key] -= 1;
    b.enemyThrowTurn = b.turn;
    u.ap = 0;
    throwAt(b, u, key, spot.x, spot.y, blind);
    return true;
  }
  // A flashbang (a soldier's or a guard's, throwables.js FLASH_KIT) at 3-7 tiles on two or more of yours bunched up,
  // at least one of them in cover, none of theirs in its reach: then the rest of the turn as usual (the rush).
  if (u.throwables.flashbang > 0) {
    const spot = flashSpot(b, u, THROWABLES.flashbang.range, { need: 2, cover: true });
    if (spot) {
      u.throwables.flashbang -= 1;
      b.enemyThrowTurn = b.turn;
      u.ap -= 1;
      throwAt(b, u, "flashbang", spot.x, spot.y, spot.blind);
      return u.ap < 1;
    }
  }
  return false;
}

// Smoke to cover a retreat (combat.js flee): the turn a side (the enemy, or one third-side group) starts to fall back,
// the first of its fleeing people who carries a smoke grenade (u.throwables.smokegren: throwables.js FLASH_KIT by kit,
// out of the group's arsenal when it keeps one) spends an action throwing it between the group and whoever chases
// them: AHEAD tiles from the middle of the retreating group toward the middle of the NEAREST pursuers, so the cloud
// (throwables.js SMOKE: 2 tiles, 3 rounds, shots into or out of it −30) covers the rear of the group and the ground
// the pursuers must cross. Only with a pursuer within NEAR tiles, once per group per battle, and only on the turn the
// retreat starts (a later fleer with smoke does not throw). The rest of the thrower's turn: running (one action less).
// Your side under "AI plays my side" does the same before it sounds the retreat (stealth.js botRetreatSmoke).
export const COVER_SMOKE = { AHEAD: 2, NEAREST: 3, NEAR: 12 };
const groupKey = (u) => (u.side === "third" ? `third${u.tgroup}` : u.side);
// foes: combat.js foesOf(b, u). Returns true when the unit threw.
export function coverSmoke(b, u, foes) {
  const key = groupKey(u);
  const rec = (b.coverSmoke || (b.coverSmoke = {}))[key] || (b.coverSmoke[key] = { turn: b.turn, done: false });
  if (rec.done || rec.turn !== b.turn || u.ap < 1 || !(u.throwables && u.throwables.smokegren > 0)) return false;
  const f = u.f || 0;
  const group = b.units.filter((o) => groupKey(o) === key && active(o) && (o.f || 0) === f);
  const gx = group.reduce((a, o) => a + o.x, 0) / group.length, gy = group.reduce((a, o) => a + o.y, 0) / group.length;
  const near = (foes || []).filter((o) => active(o) && (o.f || 0) === f && !o.dormant && dist(o.x, o.y, gx, gy) <= COVER_SMOKE.NEAR)
    .sort((a, c) => dist(a.x, a.y, gx, gy) - dist(c.x, c.y, gx, gy)).slice(0, COVER_SMOKE.NEAREST);
  if (!near.length) return false;
  const px = near.reduce((a, o) => a + o.x, 0) / near.length, py = near.reduce((a, o) => a + o.y, 0) / near.length;
  const d = dist(gx, gy, px, py);
  const k = d > 0 ? Math.min(COVER_SMOKE.AHEAD, d / 2) / d : 0; // never past halfway to them
  let x = clamp(Math.round(gx + (px - gx) * k), 0, b.w - 1), y = clamp(Math.round(gy + (py - gy) * k), 0, b.h - 1);
  const range = THROWABLES.smokegren.range;
  if (dist(u.x, u.y, x, y) > range) { const s = range / dist(u.x, u.y, x, y); x = Math.round(u.x + (x - u.x) * s); y = Math.round(u.y + (y - u.y) * s); }
  rec.done = true;
  u.throwables.smokegren -= 1;
  u.ap -= 1;
  say(b, `${u.name} pops smoke to cover the retreat.`, u.side === "enemy" ? "danger" : "info");
  throwAt(b, u, "smokegren", x, y, throwBlindOf(b, u, x, y) === true);
  return true;
}

// The enemy's people (combat.js aiUnit): the ram, a ladder, storming, a grenade. Returns true when the turn is used.
export function siegeAI(b, u) {
  if (u.kind !== "human" || !active(u)) return false;
  const r = ramOf(b, u);
  if (r) {
    if (r.lead !== u.id) { u.ap = 0; return true; } // carrying: the lead moves them
    return ramLeadTurn(b, u);
  }
  if (u.ladder > 0 && wallCells(b)) return ladderTurn(b, u);
  if (u.storm != null && stormTurn(b, u)) return true;
  if (!u.ap) return true;
  // A dropped ram of theirs with two of them close: take it up again.
  const dropped = (b.rams || []).find((x) => x.dropped && x.side === u.side && cheb(x.x, x.y, u.x, u.y) <= 1 && ramGoalsExist(b, u));
  if (dropped && !takeRam(b, u)) return true;
  if (u.gl && aiLaunch(b, u)) return true; // launchers.js: the turn's attack
  if (u.who) { botAttackThrow(null, b, u); return u.ap < 1 || !active(u); } // a person throws as yours do (stealth.js: what they carry, 1 action, once a turn for the side)
  return enemyThrow(b, u);
}
const ramGoalsExist = (b, u) => b.cells.some((c) => ramable(c));

// Your people's AI (combat.js autoPlayerTurn), before the usual: push a ladder, rocks on the ram's crew or a climber,
// lead the ram, set a ladder. Returns true when the unit acted.
export function botSiege(state, b, u) {
  if (!active(u) || u.ap < 1) return false;
  const lads = pushable(b, u).sort((a, c) => (unitAt(b, c.x, c.y) ? 1 : 0) - (unitAt(b, a.x, a.y) ? 1 : 0));
  if (lads.length && pushChance(b, u, lads[0]) >= 30) return !pushLadder(b, u, lads[0]);
  const rocks = dropTargets(b, u).sort((a, c) => (ramOf(b, c) ? 2 : 0) + (cellOf(b, c.x, c.y).k === "siegeladder" ? 1 : 0) - (ramOf(b, a) ? 2 : 0) - (cellOf(b, a.x, a.y).k === "siegeladder" ? 1 : 0) || a.hp - c.hp);
  if (rocks.length && (ramOf(b, rocks[0]) || cellOf(b, rocks[0].x, rocks[0].y).k === "siegeladder")) return !dropRocks(b, u, rocks[0]);
  const r = ramOf(b, u);
  if (r) { if (r.lead !== u.id) { u.ap = 0; return true; } return ramLeadTurn(b, u); }
  if (u.ladder > 0 && wallCells(b)) return ladderTurn(b, u);
  if (u.storm != null) return stormTurn(b, u);
  // An enemy ladder up against the wall: whoever can get next to it this action (up on the walkway, not the gate's
  // holder or a tower's shooter) goes and pushes it off.
  if (u.ap >= 2 && u.post !== "gate" && u.post !== "tower") {
    const up = (b.ladders || []).filter((l) => l.up && l.side !== u.side && dist(l.x, l.y, u.x, u.y) <= u.mob + 1.5);
    if (up.length) {
      const rr = reachable(b, u, u.mob);
      let best = null;
      for (const l of up) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = l.x + dx, y = l.y + dy;
        if ((!dx && !dy) || !inside(b, x, y) || !isFinite(rr.dist[y * b.w + x]) || !rr.dist[y * b.w + x]) continue;
        if (!canPush(b, { ...u, x, y }, l)) continue;
        if (!best || rr.dist[y * b.w + x] < best.c) best = { x, y, c: rr.dist[y * b.w + x], l };
      }
      // Only if nobody of theirs is already pushing it from where they stand.
      if (best && !b.units.some((o) => o !== u && o.side === u.side && active(o) && canPush(b, o, best.l))) {
        u.ap -= 1;
        moveAlong(b, u, pathTo(rr, best.x, best.y));
        if (active(u) && u.ap >= 1 && canPush(b, u, best.l)) pushLadder(b, u, best.l);
        return true;
      }
    }
  }
  return false;
}

// ---------- what a renderer draws (top-down ui/combat.js, isometric ui/isoview.js) ----------
// Plain data: fire cells, acid pools (acid.js: fade = turns left ÷ ACID.turns), smoke, flares, decoys, ladders (up: against the wall at x, y from its foot fx, fy; down:
// lying at its foot), rams (at the lead, with its crew and the gate it is battering), Shepherds' auras.
export function battleOverlays(b) {
  const lead = (r) => (r.lead != null ? unitById(b, r.lead) : null);
  return {
    fires: (b.fires || []).map((f) => ({ x: f.x, y: f.y, turns: f.turns })),
    acid: (b.acid || []).map((p) => ({ x: p.x, y: p.y, turns: p.turns, fade: Math.max(0.25, Math.min(1, p.turns / ACID.turns)) })),
    smoke: (b.smoke || []).map((s) => ({ x: s.x, y: s.y, r: s.r, turns: s.turns, thick: !!s.thick })),
    flares: (b.flares || []).map((f) => ({ x: f.x, y: f.y, r: f.r, turns: f.turns })),
    decoys: (b.lures || []).filter((l) => l.turns > 0).map((l) => ({ x: l.x, y: l.y, key: l.key, radius: l.radius, turns: l.turns, sense: l.sense || (THROWABLES[l.key] && THROWABLES[l.key].sense) || ["noise"], decoy: !!(THROWABLES[l.key] && THROWABLES[l.key].decoy) })),
    ladders: (b.ladders || []).map((l) => ({ id: l.id, side: l.side, up: l.up, x: l.up ? l.x : l.fx, y: l.up ? l.y : l.fy, fx: l.fx, fy: l.fy, wx: l.x, wy: l.y, dir: [l.x - l.fx, l.y - l.fy], climber: l.up && unitAt(b, l.x, l.y) ? unitAt(b, l.x, l.y).id : null })),
    rams: (b.rams || []).map((r) => { const L = lead(r); return { id: r.id, side: r.side, x: r.inVehicle ? -1 : L ? L.x : r.x, y: r.inVehicle ? -1 : L ? L.y : r.y, inVehicle: !!r.inVehicle, lead: r.lead, crew: r.crew.slice(), dropped: !!r.dropped, target: r.target || null, face: L && L.face ? L.face.slice() : [1, 0] }; }),
    carried: b.units.filter((u) => active(u) && u.ladder > 0).map((u) => ({ unit: u.id, x: u.x, y: u.y, item: "ladder" })),
    auras: shepherdsOf(b).map((s) => ({ unit: s.id, x: s.x, y: s.y, r: (ZTYPES.shepherd && ZTYPES.shepherd.aura) || SHEPHERD.AURA })),
  };
}
export { FIRE };
