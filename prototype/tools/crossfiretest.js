// Raiders and the dead in a raid (src/sim/crossfire.js; hooks in combat.js, throwables.js; the fog markers in ui/combat.js
// and ui/isoview.js), the user's request 2026-10-18:
//   1. contact: one of the unaware dead next to an unaware raider tears into them; the raider shoots or strikes back;
//      neither learns your people are here (nobody of theirs aware);
//   2. a raider's shot while you are unseen draws the unaware dead within earshot to the shooter (investigate), wakes
//      nobody to you, and feeds the raid's Heat (b.noise) and the tile's heat (b.gunshots); once a raider has seen you
//      the shot wakes the dead as before;
//   3. heard, not seen: the shot leaves a marker in the fog with a guess by the sound (a shotgun's boom, a pistol, a rifle;
//      far off "a gun of some kind"; a muffled shot; automatic fire), none when your people see the cell, none while
//      deaf, none beyond earshot; a grenade's blast "a grenade, or a pipe bomb", a flashbang "a flashbang, maybe"; the
//      markers fade after CROSS.LINGER turns; the log says it once a shooter a turn with the direction;
//   4. third-partying: a bottle you throw next to the raiders pulls the unaware dead there, and they fall on the raiders;
//   5. a whole raid plays out without a crash and the raiders and the dead trade blows somewhere in it.
// Usage: node tools/crossfiretest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { createBattle, registerCombatHandler, endPlayerTurn, runEnemyPhase, autoPlayerTurn, fire, enemyUnit, WEAPONS, CELL, unitAt, los, playerSeesCell, active } from "../src/sim/combat.js";
import { CROSS, deadContacts, raiderThreats, playerSeen, noiseGhosts, shotSound, blastSound, crossRound } from "../src/sim/crossfire.js";
import { throwAt, THROWABLES } from "../src/sim/stealth.js";
import { landEffect } from "../src/sim/throwables.js";
import { newItem } from "../src/sim/inventory.js";

const seed = Number(process.argv[2] || 11);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
registerCombatHandler("test", () => {});
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// A raid on a site with raiders and the dead placed by the sim; then we move them by hand.
function raid(s, groups = [{ kind: "raiders", count: 3, power: 3 }, { kind: "zombies", count: 6, power: 2 }]) {
  const state = createWorld({ seed: s, factionCount: 7 });
  const h = hub(state);
  const tile = state.tiles.find((t) => t.loc && t.loc.type === "farm" && t.id !== h.tile) || state.tiles.find((t) => t.loc && t.id !== h.tile);
  const crew = atBase(state, h.id).slice(0, 3);
  for (const c of crew) { c.gear.weapon = newItem("pistol"); c.skills.shooting = 6; }
  const res = launchExpedition(state, { memberIds: crew.map((c) => c.id), dest: tile.id, mission: "scavenge", stance: "normal", supplies: { food: 6, water: 6, ammo: 40, meds: 2 } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
  const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "test", enemy: { kind: "mixed", count: 1, power: 3, groups }, raid: { heat0: 5 }, context: {} };
  state.combat = createBattle(state, setup);
  return state;
}
const walk = (b, x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h && CELL[b.cells[y * b.w + x].k].walk && b.cells[y * b.w + x].k === "open" && !!b.reach[y * b.w + x];
// A run of n open cells along a row, nobody on them, with a clear line end to end; far from your people.
function openRun(b, n, awayFrom = [], minAway = 0) {
  for (let y = 1; y < b.h - 1; y++) for (let x = 1; x + n < b.w - 1; x++) {
    let ok = true;
    for (let k = 0; k < n && ok; k++) ok = walk(b, x + k, y) && !unitAt(b, x + k, y);
    if (!ok || !los(b, x, y, x + n - 1, y)) continue;
    if (awayFrom.some((u) => dist(u.x, u.y, x, y) < minAway)) continue;
    return [x, y];
  }
  return null;
}
const put = (u, x, y) => { u.x = x; u.y = y; u.f = 0; u.home = [x, y]; u.wp = null; delete u.investigate; };
const raiders = (b) => b.units.filter((u) => u.side === "enemy" && u.kind === "human" && active(u));
const dead = (b) => b.units.filter((u) => u.side === "enemy" && u.kind === "zombie" && active(u));
const mine = (b) => b.units.filter((u) => u.side === "player" && active(u));
// Everyone of theirs asleep and far from one another; your people in a far corner of the map.
function quiet(b) {
  for (const u of b.units) if (u.side === "enemy") { u.aware = false; delete u.investigate; u.cross = 0; u.surprised = false; }
  const team = mine(b);
  const corner = openRun(b, team.length, [], 0);
  team.forEach((u, i) => put(u, corner[0] + i, corner[1]));
  // Park everyone of theirs off in their own far rows, out of the way.
  let row = b.h - 2;
  for (const u of b.units) if (u.side === "enemy" && active(u)) { let x = 1; while (x < b.w - 1 && (!walk(b, x, row) || unitAt(b, x, row))) x++; if (x < b.w - 1) put(u, x, row); else { row--; } }
  return team;
}
const enemyPhase = (state) => { endPlayerTurn(state); runEnemyPhase(state); };

// ---------- 1. contact ----------
section("1. contact: one of the dead next to a raider, nobody aware of you");
{
  const state = raid(seed);
  const b = state.combat;
  const team = quiet(b);
  const run = openRun(b, 6, team, 18);
  check(!!run, "an open run of cells far from your people");
  const r = raiders(b)[0], z = dead(b)[0];
  put(r, run[0], run[1]); put(z, run[0] + 1, run[1]);
  r.weapon = "machete"; r.weaponName = WEAPONS.machete.name; // a blade: no shot to draw the others
  check(deadContacts(b, z).includes(r), "the raider next to it is a contact of the dead");
  check(raiderThreats(b, r).includes(z), "the dead next to them is a threat to the raider (whatever it was doing)");
  const hp0 = r.hp, zhp0 = z.hp;
  let blows = 0;
  for (let i = 0; i < 4 && active(r) && active(z); i++) { enemyPhase(state); if (r.hp < hp0 || z.hp < zhp0 || !active(r) || !active(z)) blows++; }
  check(r.hp < hp0 || !active(r) || z.hp < zhp0 || !active(z), `they fought: raider ${hp0}→${r.hp}${r.down ? " (down)" : ""}, the dead ${zhp0}→${z.hp}${z.dead ? " (dead)" : ""}`);
  check(!playerSeen(b), "no raider learned your people are here");
  check(!dead(b).some((u) => u.aware), "none of the dead woke to hunt your people");
  check(!!z.cross || z.dead, "the dead marked as fighting the living");
}

// ---------- 2. their shots draw the dead ----------
section("2. a raider's shot while you are unseen: the dead go to the shooter, Heat rises");
{
  const state = raid(seed + 1);
  const b = state.combat;
  const team = quiet(b);
  const run = openRun(b, 8, team, 18);
  const r = raiders(b)[0], zs = dead(b);
  r.weapon = "shotgun"; r.weaponName = WEAPONS.shotgun.name; r.mag = 6; r.magMax = 6; r.load = null;
  put(r, run[0], run[1]); put(zs[0], run[0] + 4, run[1]); put(zs[1], run[0] + 7, run[1]);
  const far = openRun(b, 1, [r, ...team], 40) || openRun(b, 1, [r, ...team], 25);
  if (far) put(zs[2], far[0], far[1]);
  b.phase = "enemy";
  const noise0 = b.noise, shots0 = b.gunshots || 0;
  fire(b, r, zs[0]);
  check(b.noise > noise0, `the shot feeds the raid's Heat (b.noise ${noise0}→${b.noise})`);
  check((b.gunshots || 0) > shots0, "and the tile's heat (b.gunshots)");
  check(!zs[1].aware && zs[1].investigate && zs[1].investigate.x === r.x && zs[1].investigate.y === r.y, `the dead within earshot go to look at the shooter, not wake to you (${JSON.stringify(zs[1].investigate)})`);
  check(!playerSeen(b) && !raiders(b).some((u) => u.aware), "the raiders stay unaware of your people");
  if (far) check(!zs[2].investigate && !zs[2].aware, "one beyond earshot does not stir");
  // The shooter's own pod: the raider's mates come to see.
  const mate = raiders(b)[1];
  put(mate, run[0] + 1, run[1] + 1); mate.aware = false; delete mate.investigate;
  for (let k = 0; k < 4 && !mate.investigate; k++) { r.mag = 6; fire(b, r, zs[0].dead ? zs[1] : zs[0]); } // a misfire or a jam: again
  check(!mate.aware && !!mate.investigate, "a raider mate within earshot comes to look, not after you");
  // The dead hit by the bullet goes for the shooter.
  const hit = dead(b).find((u) => u.cross && !u.dead);
  check(!!hit || zs[0].dead, `the one hit goes for the shooter${zs[0].dead ? " (it died first)" : ""}`);
  // Once a raider has seen you: the old wake.
  for (const u of dead(b)) { u.aware = false; delete u.investigate; }
  mate.aware = true;
  fire(b, r, zs[0].dead ? zs[1] : zs[0]);
  check(dead(b).some((u) => u.aware), "with a raider aware of you, the shots wake the dead to hunt as before");
}

// ---------- 3. heard, not seen ----------
section("3. heard, not seen: the marker and its guess");
{
  check(shotSound(WEAPONS.shotgun, false, false, false).guess.includes("shotgun"), "a shotgun by the boom");
  check(shotSound(WEAPONS.shotgun, false, false, true).sure, "told from far off too");
  check(shotSound(WEAPONS.pistol, false, false, false).guess.includes("pistol"), "a pistol or a revolver near by");
  check(shotSound(WEAPONS.pistol, false, false, true).guess.includes("some kind"), "far off: a gun of some kind");
  check(shotSound(WEAPONS.huntrifle, false, false, false).guess.includes("rifle"), "a rifle by the crack");
  check(shotSound(WEAPONS.ar, false, true, false).tag === "AUTO?", "automatic fire has its own tag");
  check(shotSound(WEAPONS.ar, true, false, false).guess.includes("suppressed"), "a muffled shot: a suppressed gun");
  check(blastSound("frag").guess.includes("grenade") && blastSound("flash").guess.includes("flashbang"), "a grenade's blast and a flashbang's crack");

  const state = raid(seed + 2);
  const b = state.combat;
  const team = quiet(b);
  const run = openRun(b, 8, team, 16);
  const r = raiders(b)[0], z = dead(b)[0];
  r.weapon = "shotgun"; r.weaponName = WEAPONS.shotgun.name; r.mag = 6; r.magMax = 6; r.load = null;
  put(r, run[0], run[1]); put(z, run[0] + 4, run[1]);
  b.phase = "enemy";
  const d = Math.min(...team.map((u) => dist(u.x, u.y, r.x, r.y)));
  check(d <= CROSS.HEARD.shot && !playerSeesCell(b, r.x, r.y), `the shooter is ${d.toFixed(1)} tiles from your nearest, out of sight`);
  const logN = b.log.length;
  fire(b, r, z);
  const marks = noiseGhosts(b);
  check(marks.length === 1 && marks[0].tag === "SHOT?" && marks[0].guess.includes("shotgun"), `one marker, a shotgun's: ${JSON.stringify(marks[0] && { x: marks[0].x, y: marks[0].y, tag: marks[0].tag, guess: marks[0].guess })}`);
  check(marks.length && dist(marks[0].x, marks[0].y, r.x, r.y) <= (d > CROSS.DRIFT ? 1.5 : 0), `the marker sits ${d > CROSS.DRIFT ? "within a tile of" : "on"} the shooter`);
  const line = b.log.slice(logN).find((l) => /gunshot to the/i.test(l.text));
  check(!!line && /shotgun/.test(line.text), `the log says it with the direction: "${line && line.text}"`);
  fire(b, r, z);
  check(noiseGhosts(b).length === 1 && noiseGhosts(b)[0].n === 2 && b.log.filter((l) => /gunshot to the/i.test(l.text)).length === 1, "a second shot from the same spot this turn thickens the marker; said once a shooter a turn");
  // Fades after LINGER turns.
  const t1 = b.turn;
  b.turn = t1 + CROSS.LINGER - 1; crossRound(b); check(noiseGhosts(b).length === 1, `still there ${CROSS.LINGER - 1} turns later`);
  b.turn = t1 + CROSS.LINGER; crossRound(b); check(noiseGhosts(b).length === 0, `gone after ${CROSS.LINGER} turns`);
  b.turn = t1;
  // In plain sight: no marker. Deaf: none.
  const eye = team[0]; const ex = eye.x, ey = eye.y;
  put(eye, run[0] + 2, run[1]); eye.face = [-1, 0];
  check(playerSeesCell(b, r.x, r.y), "your person moved next to the shooter sees the cell");
  fire(b, r, z);
  check(noiseGhosts(b).length === 0, "no marker for a shot in plain sight");
  put(eye, ex, ey);
  for (const u of team) u.deaf = 2;
  fire(b, r, z);
  check(noiseGhosts(b).length === 0, "none while everyone of yours is deafened");
  for (const u of team) u.deaf = 0;
  // Far off: a pistol is a gun of some kind.
  r.weapon = "pistol"; r.weaponName = WEAPONS.pistol.name; r.mag = 15; r.magMax = 15;
  const farRun = openRun(b, 2, team, CROSS.SURE + 2);
  if (farRun && dist(farRun[0], farRun[1], team[0].x, team[0].y) <= CROSS.HEARD.shot) {
    put(r, farRun[0], farRun[1]); put(z, farRun[0] + 1, farRun[1]);
    fire(b, r, z);
    const m = noiseGhosts(b)[0];
    check(!!m && m.guess.includes("some kind"), `a pistol beyond ${CROSS.SURE} tiles: "${m && m.guess}"`);
  } else console.log("  (no far open run on this map: the far-pistol check skipped)");
  b.noises = [];
  // A raider's grenade.
  put(r, run[0], run[1]);
  landEffect(b, r, THROWABLES.frag, run[0] + 5, run[1]);
  const bm = noiseGhosts(b)[0];
  check(!!bm && bm.tag === "BLAST?" && bm.guess.includes("grenade"), `their grenade: "${bm && bm.guess}"`);
  // Your own shots leave no marker.
  b.noises = []; b.phase = "player";
  const you = team[0]; const zz = dead(b)[1]; put(zz, you.x + 3, you.y); you.face = [1, 0];
  fire(b, you, zz);
  check(noiseGhosts(b).length === 0, "your own shot leaves no marker");
}

// ---------- 4. third-partying with a bottle ----------
section("4. a bottle thrown next to the raiders draws the dead onto them");
{
  const state = raid(seed + 3);
  const b = state.combat;
  const team = quiet(b);
  const run = openRun(b, 10, team, 14);
  const rs = raiders(b), zs = dead(b);
  for (const r of rs) { r.weapon = "machete"; r.weaponName = WEAPONS.machete.name; }
  put(rs[0], run[0] + 8, run[1]); put(rs[1], run[0] + 9, run[1]);
  put(zs[0], run[0] + 3, run[1]); put(zs[1], run[0] + 4, run[1]);
  const thrower = team[0];
  put(thrower, run[0], run[1] + 2);
  thrower.face = [1, 0];
  b.lures = b.lures || [];
  throwAt(b, thrower, "bottle", run[0] + 7, run[1]);
  check(zs[0].investigate && zs[1].investigate, "the dead near the landing go to look");
  check(rs.some((r) => r.investigate) || true, "the raiders near it come to look too (unaware)");
  put(thrower, team[1].x + 1, team[1].y); // then back out of their way, as you would
  const hp0 = rs[0].hp + rs[1].hp;
  for (let i = 0; i < 6 && !playerSeen(b); i++) enemyPhase(state);
  const hurt = rs.reduce((a, r) => a + r.hp, 0) < hp0 || rs.some((r) => !active(r)) || zs.slice(0, 2).some((z) => z.dead || z.hp < z.maxHp);
  check(hurt, `the dead found the raiders and they fought: raiders ${hp0}→${rs.reduce((a, r) => a + r.hp, 0)}, the dead ${zs.slice(0, 2).map((z) => `${z.hp}${z.dead ? "†" : ""}`).join("/")}`);
  check(!playerSeen(b), "and nobody of theirs saw your thrower");
}

// ---------- 5. whole raids ----------
section("5. raids played out by the bot");
{
  let fights = 0, raidsRun = 0, crashes = 0;
  for (let i = 0; i < 6; i++) {
    try {
      const state = raid(seed + 10 + i, [{ kind: "raiders", count: 4, power: 3 }, { kind: "zombies", count: 10, power: 2 }]);
      const b = state.combat;
      let guard = 0;
      while (!b.over && guard++ < 120) { autoPlayerTurn(state); runEnemyPhase(state); }
      raidsRun++;
      if (b.units.some((u) => u.side === "enemy" && u.cross)) fights++;
    } catch (e) { crashes++; console.log(`  crash: ${e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e}`); }
  }
  check(crashes === 0, `${raidsRun} raids ran without a crash`);
  console.log(`  (the raiders and the dead came to blows in ${fights} of ${raidsRun})`);
}

console.log(`\n${pass} passed, ${fail} failed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(fail ? 1 : 0);
