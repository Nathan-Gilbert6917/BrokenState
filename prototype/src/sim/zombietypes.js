// The special dead a hive breeds once it has grown the structure for them (hivetech.js, numbers in hiveconst.js
// ZTYPES): runners, brutes, spitters, screamers and crawlers. Each one asks for a different answer:
// - Runner: very fast (6 tiles an action). Walls and overwatch stop them; in the open they are on you in a turn.
// - Brute: 2.4× the hit points, takes ¾ of every hit, hits half again as hard, slow; smashes the barricade, wall
//   section, fence or crates in its way when it cannot reach anyone this turn. Armor and heavy guns.
// - Spitter: spits acid (combat.js WEAPONS.acid) every other turn, with cover counting one step less. Smoke, or
//   shoot it first.
// - Screamer: hangs back about 5 tiles from your people and shrieks every other turn, calling 1–2 more of the dead
//   in from the enemy's edge (6 a battle at most). Kill it first.
// - Crawler: low in the grass: your people cannot see (or shoot) it until it is within 2.5 tiles, stands in
//   floodlight or a flare's light, or has struck; its first bite from hiding hits 1.4× as hard. Light and keeping
//   together.
// On the State Map a horde carries its special dead as a mix: the share of each kind (h.mix, hordes.js), turned
// into unit counts for a battle (battleTypes) and weighed in fights by the numbers (mixWeight, typeStrength).
// Everything here is deterministic: the battle's rng only.
import { ZTYPES, TECH } from "./hiveconst.js";
import { CELL, say, fx, reachable, pathTo, moveAlong, active, adjacent, enemyUnit, ZOMBIE_MOVE } from "./combat.js";
import { flareLit } from "./throwables.js";

export const ZKINDS = Object.keys(ZTYPES);
const round = (v, n = 1000) => Math.round(v * n) / n;

// ---------- the mix of a horde (State Map) ----------
// × a horde's size or strength from its special dead: field "weight" (a fight by the numbers, a group's walls),
// "wall" (against your hold limit). Elite special dead weigh ELITE_WEIGHT more.
export function mixWeight(mix, field = "weight", elite = false) {
  if (!mix) return 1;
  let m = 1;
  for (const k in mix) if (ZTYPES[k]) m += (mix[k] || 0) * (ZTYPES[k][field] * (elite && field === "weight" ? TECH.ELITE_WEIGHT : 1) - 1);
  return Math.max(0.2, m);
}
// Two hordes merging: the shares weighted by how many each brings.
export function mergeMix(a, na, b, nb) {
  if (!a && !b) return null;
  const out = {};
  const tot = Math.max(1, na + nb);
  for (const k of ZKINDS) {
    const v = ((a && a[k]) || 0) * na + ((b && b[k]) || 0) * nb;
    if (v > 0) out[k] = round(v / tot);
  }
  return Object.keys(out).length ? out : null;
}
// "12 runners, 4 brutes" for a horde of `size` (or shares as words when no size).
export function mixText(mix, size = 0) {
  if (!mix) return "";
  const parts = ZKINDS.filter((k) => mix[k] > 0).map((k) => {
    const n = Math.round((size || 0) * mix[k]);
    const name = ZTYPES[k].name.toLowerCase();
    return size ? `${n} ${name}${n === 1 ? "" : "s"}` : `${name}s`;
  }).filter((s) => !/^0 /.test(s));
  return parts.join(", ");
}
// The special dead among `count` battle units (largest remainder, never more than count): { runner: 3, ... }.
export function battleTypes(mix, count) {
  if (!mix || !count) return null;
  const want = ZKINDS.filter((k) => mix[k] > 0).map((k) => ({ k, v: mix[k] * count }));
  const out = {};
  let used = 0;
  for (const w of want) { const n = Math.floor(w.v); if (n) { out[w.k] = n; used += n; } }
  want.sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)) || ZKINDS.indexOf(a.k) - ZKINDS.indexOf(b.k));
  for (const w of want) {
    if (used >= count) break;
    if (w.v - Math.floor(w.v) >= 0.35) { out[w.k] = (out[w.k] || 0) + 1; used++; }
  }
  return Object.keys(out).length ? out : null;
}
// The kind of each of `count` dead in a battle (null: ordinary), spread through the line rather than bunched.
export function typeList(types, count) {
  const out = new Array(count).fill(null);
  if (!types) return out;
  const kinds = [];
  for (const k of ZKINDS) for (let i = 0; i < (types[k] || 0); i++) kinds.push(k);
  const n = Math.min(count, kinds.length);
  for (let i = 0; i < n; i++) out[Math.floor((i * count) / n)] = kinds[i];
  return out;
}
// The dead that come in during a battle (reinforcements drawn by noise) in the battle's mix (b.zmix, set where the
// battle is made: the armoured dead of a military site, deadsoldiers.js): the nth one is of a kind when that kind's
// share × n crosses a whole number. No dice, so nothing else in the battle changes. Returns the kind or null.
export function nextOfMix(b, mix = b && b.zmix) {
  if (!mix) return null;
  const n = (b.zspawn = (b.zspawn || 0) + 1);
  for (const k of ZKINDS) if (mix[k] > 0 && Math.floor(n * mix[k] + 1e-9) > Math.floor((n - 1) * mix[k] + 1e-9)) return k;
  return null;
}
// The kinds of n of the dead made at once, in a mix by shares (battleTypes then typeList, spread through them).
export const mixList = (mix, n) => typeList(battleTypes(mix, n), n);

// A fight by the numbers (combat.js autoResolveCombat): × the enemy's strength for the special dead among them.
export function typeStrength(enemy) {
  if (enemy && !enemy.types && enemy.mix) return mixWeight(enemy.mix, "weight", enemy.elite); // shares only (deadsoldiers.js)
  if (!enemy || !enemy.types) return 1;
  const count = Math.max(1, enemy.count || 1);
  let extra = 0;
  for (const k in enemy.types) if (ZTYPES[k]) extra += (enemy.types[k] || 0) * (ZTYPES[k].weight * (enemy.elite ? TECH.ELITE_WEIGHT : 1) - 1);
  return 1 + extra / count;
}

// ---------- on the battle map ----------
// Turns one of the dead (combat.js enemyUnit, power p) into a special one.
export function applyZType(u, kind, elite = false, power = 2) {
  const z = ZTYPES[kind];
  if (!z) return u;
  const hpM = z.hp * (elite ? TECH.ELITE_HP : 1);
  u.ztype = kind;
  u.elite = !!elite;
  u.name = `${elite ? "Elite " : ""}${z.name}${u.name.replace(/^Zombie/, "")}`;
  u.short = z.short;
  u.maxHp = u.hp = Math.max(8, Math.round(u.maxHp * hpM));
  u.dmgMult = Math.round(u.dmgMult * z.dmg * (elite ? TECH.ELITE_DMG : 1) * 100) / 100;
  u.meleeAim += z.aim;
  if (z.mob) u.mob = z.mob;
  else u.mob = Math.min(u.mob, ZOMBIE_MOVE); // the armoured dead (deadsoldiers.js): never faster than a walker
  u.armor = z.armor; // the armoured dead: an average; combat.js damage asks deadsoldiers.js armorVs per hit
  u.power = power;
  if (kind === "spitter") { u.weapon = "acid"; u.weaponName = "Acid spit"; u.aim = z.spitAim + power * 3; u.cd = 0; }
  if (kind === "crawler") u.low = true;
  if (kind === "screamer") u.screamCd = 0;
  if (kind === "shepherd") u.sight = Math.max(u.sight || 0, 11); // it watches
  return u;
}

// Can your people see this crawler yet? Within its reveal range of one of them, in floodlight or a flare's light,
// or once it has struck (low cleared).
export function zRevealed(b, t) {
  if (!t.low) return true;
  const r = ZTYPES.crawler.reveal;
  for (const o of b.units) if (o.side === "player" && active(o) && Math.hypot(o.x - t.x, o.y - t.y) <= r) return true;
  if (b.lit && b.lit[t.y * b.w + t.x]) return true;
  if (b.flares && b.flares.length && flareLit(b, t.x, t.y)) return true;
  return false;
}
// A crawler striking from hiding: × its damage, and it is seen from then on.
export function strikeBonus(b, a) {
  if (!a.low) return 1;
  a.low = false;
  say(b, `${a.name} lunges out of the grass!`, "danger");
  return ZTYPES.crawler.ambush;
}

// At the start of the enemy's turn: the spitters' and screamers' cooldowns tick down.
export function zTick(b) {
  for (const u of b.units) {
    if (!u.ztype) continue;
    if (u.cd > 0) u.cd--;
    if (u.screamCd > 0) u.screamCd--;
  }
}

const playerFoes = (b) => b.units.filter((o) => o.side === "player" && active(o));
// A special unit's own turn (combat.js aiUnit). true: it has acted; false: the usual AI plays it.
export function zombieTurn(b, u) {
  if (!u.aware) return false;
  if (u.ztype === "screamer") return screamerTurn(b, u);
  if (u.ztype === "brute") return bruteTurn(b, u);
  if (u.ztype === "spitter") return spitterTurn(b, u);
  if (u.ztype === "shepherd") return shepherdTurn(b, u);
  return false;
}

// A Shepherd keeps behind its pack: about `keep` tiles from your people, never in the flames (combat.js reachable
// keeps it out of them); cornered, it claws like the rest. Its aura is decoys.js herded.
function shepherdTurn(b, u) {
  const foes = playerFoes(b);
  if (!foes.length || foes.some((f) => adjacent(u, f))) return false;
  return hangBack(b, u, foes, ZTYPES.shepherd.keep);
}

// The edge the dead come in from: the enemy's side of the map (east, or the side a base was attacked from).
function edgeCells(b) {
  const W = b.w, H = b.h, out = [];
  const side = b.side || "east";
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const on = side === "west" ? x === 0 : side === "north" ? y === 0 : side === "south" ? y === H - 1 : x === W - 1;
    if (!on) continue;
    const c = CELL[b.cells[y * W + x].k];
    if (c && c.walk && !b.units.some((o) => !o.dead && !o.left && !o.fled && o.x === x && o.y === y)) out.push([x, y]);
  }
  return out;
}

function scream(b, u) {
  const z = ZTYPES.screamer;
  const room = z.callMax - (b.screamed || 0);
  const cells = edgeCells(b);
  b.rng.shuffle(cells);
  const n = Math.min(room, b.rng.int(z.calls[0], z.calls[1]), cells.length);
  fx(b, { type: "scream", from: [u.x, u.y], to: [u.x, u.y], hit: true, text: "SHRIEK", side: "enemy" });
  if (n <= 0) { say(b, `${u.name} shrieks, but nothing more comes.`, "info"); return; }
  const power = u.power || (b.setup && b.setup.enemy && b.setup.enemy.power) || 2;
  for (let i = 0; i < n; i++) {
    const z2 = enemyUnit(b, b.rng, "zombies", power, b.units.filter((o) => o.kind === "zombie").length + 1);
    z2.x = cells[i][0]; z2.y = cells[i][1];
    z2.called = true;
    z2.ap = 0;
    b.units.push(z2);
  }
  b.screamed = (b.screamed || 0) + n;
  say(b, `${u.name} lets out a shriek: ${n} more of the dead come running from the ${b.side || "east"} edge. Kill it to stop the calling.`, "danger");
}

function screamerTurn(b, u) {
  const z = ZTYPES.screamer;
  const foes = playerFoes(b);
  if (!foes.length || foes.some((f) => adjacent(u, f))) return false; // cornered: it claws like the rest
  if (!(u.screamCd > 0) && (b.screamed || 0) < z.callMax) {
    scream(b, u);
    u.screamCd = z.every;
    u.ap = 0;
    return true;
  }
  return hangBack(b, u, foes, z.keep);
}

// Keeps about `keep` tiles from the nearest of your people (one move), where it can shriek or spit again.
function hangBack(b, u, foes, keep) {
  const near = (x, y) => foes.reduce((m, f) => Math.min(m, Math.hypot(f.x - x, f.y - y)), 99);
  const r = reachable(b, u, u.mob);
  let best = null;
  for (let i = 0; i < b.w * b.h; i++) {
    if (!isFinite(r.dist[i])) continue;
    const x = i % b.w, y = (i / b.w) | 0;
    const sc = Math.abs(near(x, y) - keep) + r.dist[i] * 0.05;
    if (!best || sc < best.sc) best = { x, y, sc, cost: r.dist[i] };
  }
  if (best && best.cost > 0) moveAlong(b, u, pathTo(r, best.x, best.y));
  u.ap = 0;
  return true;
}

// A spitter between spits keeps its distance (next to someone it claws like the rest).
function spitterTurn(b, u) {
  if (!(u.cd > 0)) return false; // ready: it spits (combat.js aiUnit, the ranged AI)
  const foes = playerFoes(b);
  if (!foes.length || foes.some((f) => adjacent(u, f))) return false;
  return hangBack(b, u, foes, ZTYPES.spitter.keep);
}

// What a brute can smash (and what is left there): barricades, the base's wall line (a breach), fences, crates,
// sandbags, hay. Only cells that never block sight, so the battle's line-of-sight cache stays right.
const SMASH = { barricade: "open", palisade: "breach", fence: "open", crate: "open", sandbag: "open", hay: "open" };
function bruteTurn(b, u) {
  const z = ZTYPES.brute;
  const foes = playerFoes(b);
  if (!foes.length || foes.some((f) => adjacent(u, f))) return false;
  // Someone it can get next to this turn: it walks (the usual AI).
  const r = reachable(b, u, u.mob * Math.max(1, u.ap));
  for (const f of foes) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = f.x + dx, y = f.y + dy;
    if ((dx || dy) && x >= 0 && y >= 0 && x < b.w && y < b.h && isFinite(r.dist[y * b.w + x])) return false;
  }
  if (!b.rng.chance(z.smash)) return false;
  const f = foes.reduce((a, c) => (Math.hypot(c.x - u.x, c.y - u.y) < Math.hypot(a.x - u.x, a.y - u.y) ? c : a));
  const d0 = Math.hypot(f.x - u.x, f.y - u.y);
  let best = null;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = u.x + dx, y = u.y + dy;
    if ((!dx && !dy) || x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
    const k = b.cells[y * b.w + x].k;
    if (!SMASH[k]) continue;
    const d = Math.hypot(f.x - x, f.y - y);
    if (d < d0 && (!best || d < best.d)) best = { x, y, k, d };
  }
  if (!best) return false;
  const name = CELL[best.k].name.toLowerCase();
  b.cells[best.y * b.w + best.x].k = SMASH[best.k];
  u.face = [Math.sign(best.x - u.x), Math.sign(best.y - u.y)];
  fx(b, { type: "melee", from: [u.x, u.y], to: [best.x, best.y], hit: true, crit: false, dmg: 0, side: "enemy", text: "SMASH" });
  say(b, `${u.name} smashes through the ${name}.`, "danger");
  u.ap = 0;
  return true;
}
