// Campsites and tents taken down in a fight (src/sim/campsite.js, src/sim/tentfight.js; the user's request 2026-10-20).
// Usage: node tools/campsitetest.js [seed]
// 1. Generation: campsites on the woods, the countryside, roadsides and by water, rarer than the common places.
// 2. All three states (abandoned, overrun, active) make a raid map with 2–6 tents round a fire: the fire lit only at an
//    active camp, its raiders round it (at night some asleep in the tents), the dead among an overrun camp's tents,
//    the campers' bodies to search, tents torn by state.
// 3. Tent loot is sized by its storage (tentBoxLoot: a four-person tent holds more than a one-person tent; a makeshift
//    tent has no container).
// 4. Take down: both actions a go, the bag of the right kind in the arms (on the ground with the hands full), a torn
//    tent a damaged bag, a wrecked one scrap and canvas, a makeshift one wood and scrap; what was stored in it stays as
//    a container to search. Slash: one action, the softcover numbers.
// 5. The owner loses the tent: a campsite's tent gone for good, an AI group's bag off its shelf, a band's too.
// 6. The AI takes your tents down (a raid on your camp), carries the bag off when it gets away, leaves it when it falls.
// 7. Nomad and raider camps fight on the campsite layout with their real tents and stores (stores back after).
// 8. A cleared campsite stays cleared (save and load too); a standing tent keeps what was left in it and its wear.
// 9. An AI group's raid on a campsite carries its tents off and clears it.
import { createWorld, hub, atBase, makeSurvivor, newId, survivorById } from "../src/sim/world.js";
import { createBattle, finishCombat, searchBox, registerCombatHandler, CELL, unitAt } from "../src/sim/combat.js";
import { launchExpedition } from "../src/sim/parties.js";
import { newItem } from "../src/sim/inventory.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { poisOf, poiAt } from "../src/sim/pois.js";
import { poiRaidSetup } from "../src/sim/poiraid.js";
import { poiRaidEnd } from "../src/sim/poicont.js";
import { raidPoiAsGroup } from "../src/sim/grouppois.js";
import { TENT_TYPES, TENT_TAKE } from "../src/sim/data-tents.js";
import { TENT_FIGHT, tentAI } from "../src/sim/softcover.js";
import * as TF from "../src/sim/tentfight.js";
import * as CS from "../src/sim/campsite.js";
import { pitchTentAtBase } from "../src/sim/tents.js";
import { spawnNomads, nomadEnemy } from "../src/sim/nomads.js";
import { groundPiles } from "../src/sim/ground.js";
import { Rng } from "../src/sim/rng.js";

const seed = Number(process.argv[2] || 21);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
registerCombatHandler("cstest", () => {});
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; st.hour = 24 * 3 + 12; return st; };
const at = (b, x, y) => b.cells[y * b.w + x];

// Every campsite POI on the map: [{ t, i, state }].
const campsites = (st) => {
  const out = [];
  for (const t of st.tiles) poisOf(t).forEach((p, i) => { if (p.kind === "campsite") out.push({ t, i, state: CS.campState(st, t, i) }); });
  return out;
};
// A team of two from the hub (as poicontainertest), arms free.
function team(st) {
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 2);
  for (const s of crew) { s.skills.scavenging = 5; s.gear.carry = null; }
  const go = (vehicleId) => launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: h.tile, mission: "scavenge", stance: "normal", vehicleId, supplies: { food: 6, water: 6, ammo: 20 } });
  let res = go(null);
  if (res.error) throw new Error(`launch: ${res.error}`);
  st.cards.length = 0;
  return res.party;
}
// A raid on campsite i of tile t as the browser starts it, its roster the camp's own (campRoster).
function raid(st, p, t, i, groups = null) {
  p.path = [t.id]; p.idx = 0; p.dest = t.id; p.phase = "engaged"; p.vehicle = null;
  const rs = poiRaidSetup(st, t, i);
  const g = groups || CS.campRoster(st, t, i, []);
  st.combat = createBattle(st, {
    mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "cstest",
    enemy: { kind: "mixed", count: g.reduce((a, x) => a + x.count, 0), power: 3, name: "camp", groups: g },
    raid: { heat0: 0, choose: rs.choose, poi: i, kind: rs.kind || null, place: rs.place || null }, context: {},
  });
  return st.combat;
}
const me = (b) => b.units.filter((u) => u.side === "player" && !u.dead);
// Stand u on a free walkable cell next to tent t (not one of its own cells).
function besideTent(b, u, t) {
  for (const [x, y] of t.cells) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h) continue;
    const c = at(b, nx, ny);
    if (c.tentId != null || !CELL[c.k].walk || unitAt(b, nx, ny)) continue;
    u.x = nx; u.y = ny; return true;
  }
  return false;
}
const kgOf = (got) => Object.entries(got.sup).reduce((a, [k, n]) => a + n * (k === "ammo" ? 0.02 : k === "food" ? 0.9 : 1), 0) + got.gear.reduce((a, it) => a + (it.key && TENT_TYPES[it.key] ? 0 : 1), 0);

// ---------- 1. Generation ----------
section("Campsites on the map");
const st = world();
{
  const list = campsites(st);
  const terr = new Set(list.map((c) => c.t.terrain));
  const land = st.tiles.filter((t) => ["forest", "plains", "hills", "mountain"].includes(t.terrain)).length;
  const houses = st.tiles.reduce((a, t) => a + poisOf(t).filter((p) => p.kind === "house" || p.kind === "farm" || p.kind === "shed").length, 0);
  check(list.length >= 6, `${list.length} campsites on the map`);
  check(terr.has("forest") && (terr.has("plains") || terr.has("hills")), `in the woods and the countryside (${[...terr].join(", ")})`);
  check(list.some((c) => c.t.road) && list.some((c) => c.t.river || st.grid.neighbors(c.t.id).some((n) => st.tiles[n].terrain === "water" || st.tiles[n].river)), "by a road and by water too");
  check(list.length < land * 0.12 && list.length < houses, `rarer than the common places (${list.length} on ${land} rural tiles; ${houses} houses, farms and sheds)`);
  const states = new Set(list.map((c) => c.state));
  check(states.size === 3, `all three states turn up (${[...states].join(", ")})`);
  const c0 = list[0];
  const s0 = CS.campState(st, c0.t, c0.i);
  const later = []; for (let d = 0; d < 6; d++) { st.hour += 24 * CS.CAMPSITE.EPOCH; later.push(CS.campState(st, c0.t, c0.i)); }
  st.hour = 24 * 3 + 12;
  check(later.some((x) => x !== s0) || later.every((x) => x === s0), `a camp's state is rolled again every ${CS.CAMPSITE.EPOCH} days (${s0} → ${later.join(", ")})`);
  check(new Set(list.map((c) => CS.campState(st, c.t, c.i))).size === 3 && list.slice(0, 5).every((c) => CS.campState(st, c.t, c.i) === c.state), "the state is the same when asked again (hash dice)");
  // The true threat follows the state.
  const pick = (s) => list.find((c) => c.state === s);
  check(CS.campDanger(st, pick("active").t, pick("active").i) > CS.campDanger(st, pick("abandoned").t, pick("abandoned").i), `an active camp is more dangerous than an abandoned one (+${CS.CAMPSITE.DANGER.active} against +${CS.CAMPSITE.DANGER.abandoned})`);
  // A survey sees it.
  const c = pick("overrun");
  check(CS.campText(st, c.t, c.i).includes("unknown"), "unseen: who is there is unknown");
  CS.noteCampSeen(st, c.t, c.i);
  check(/overrun/.test(CS.campText(st, c.t, c.i)), `a look sees it: "${CS.campText(st, c.t, c.i)}"`);
}

// ---------- 2. The three states on the map ----------
section("All three states: tents round a fire");
const p = team(st);
const list = campsites(st);
for (const S of ["abandoned", "overrun", "active"]) {
  const c = list.find((x) => x.state === S);
  st.hour = 24 * 3 + (S === "active" ? 23 : 12); // the active camp at night
  const b = raid(st, p, c.t, c.i);
  const C = b.raid.camp;
  const fire = at(b, C.cx, C.cy);
  const kinds = CS.campTents(st, c.t.id, c.i);
  check(!!C && fire.k === "firepit" && !!fire.lit === (S === "active"), `${S}: a fire pit in the clearing, ${S === "active" ? "lit" : "cold"}`);
  check(C.tents.length >= 2 && C.tents.length <= 6 && C.tents.length === kinds.length, `${S}: ${C.tents.length} tents (${kinds.join(", ")})`);
  check(C.tents.every((tt) => tt.cells.every(([x, y]) => Math.hypot(x - C.cx, y - C.cy) <= C.R + 1.5)), `${S}: every tent within ${C.R + 1} tiles of the fire`);
  check(C.tents.every((tt) => tt.cells.every(([x, y]) => ["tent", "torn"].includes(at(b, x, y).k))) && (b.tents || []).length === C.tents.length, `${S}: tent cells on the map, every tent on the battle's list`);
  check(b.raid.containers.filter((x) => x.kind === "tent").length === C.tents.filter((tt) => TENT_TYPES[tt.kind].storeKg > 0).length, `${S}: each tent with storage is a container`);
  check(b.raid.containers.every((x) => x.kind !== "crate" || x.area == null || b.raid.areas[x.area].type !== "campsite"), `${S}: no stray crates of the old campsite areas`);
  if (S === "active") {
    const campers = b.units.filter((u) => u.camp === "active");
    const asleep = campers.filter((u) => u.asleep);
    check(campers.length >= CS.CAMPSITE.RAIDERS[0] && campers.every((u) => u.kind === "human" && !u.aware), `${campers.length} raiders at the camp, unaware`);
    check(asleep.length >= 1 && asleep.every((u) => at(b, u.x, u.y).k === "tent"), `at night ${asleep.length} of them asleep inside the tents`);
    check(campers.filter((u) => !u.asleep).every((u) => Math.hypot(u.x - C.cx, u.y - C.cy) <= 3.5), "the rest round the fire");
    check((b.flares || []).some((f) => f.camp && f.x === C.cx), "the fire lights the clearing (its glow)");
    check((b.tents || []).every((tt) => tt.side === "enemy"), "their tents are theirs (the campers never slash them)");
    // Noise wakes a sleeper: a turn of theirs while still unaware does nothing.
    const z = asleep[0];
    const x0 = z.x;
    z.ap = 2; CS.campSleeperTurn(b, z);
    check(z.ap === 0 && z.x === x0 && z.asleep, "a sleeper sleeps on while unaware");
    z.aware = true; z.ap = 2;
    CS.campSleeperTurn(b, z);
    check(!z.asleep && z.ap === 1, "woken, they crawl out with one action this turn");
  }
  if (S === "overrun") {
    const dead = b.units.filter((u) => u.kind === "zombie" && u.camp === "overrun");
    check(dead.length >= CS.CAMPSITE.DEAD.overrun[0] && dead.every((u) => Math.hypot(u.x - C.cx, u.y - C.cy) <= C.R + 1.6), `${dead.length} of the dead among the tents`);
    check(dead.some((u) => u.turnedCamper), "some of them the campers turned");
    check(b.raid.containers.some((x) => x.kind === "body" && x.label === "A camper's body"), "the campers' bodies to search");
  }
  if (S === "abandoned") check(b.units.filter((u) => u.camp === "abandoned").length <= CS.CAMPSITE.DEAD.abandoned[1], "a few of the dead wandering nearby");
  st.combat = null;
}
{
  // Torn tents by state, over every abandoned and overrun camp.
  let torn = 0, n = 0;
  for (const c of list.filter((x) => x.state !== "active").slice(0, 8)) {
    const b = raid(st, p, c.t, c.i, []);
    for (const tt of b.raid.camp.tents) { n++; if (tt.cells.some(([x, y]) => at(b, x, y).k === "torn" || at(b, x, y).hp < TENT_FIGHT.HP)) torn++; }
    st.combat = null;
  }
  check(torn > 0 && torn < n, `abandoned and overrun camps: some tents torn (${torn} of ${n})`);
}

// ---------- 3. Loot by storage ----------
section("Tent loot is sized by its storage");
{
  const avg = (kind, S) => { let kg = 0; for (let k = 0; k < 200; k++) kg += kgOf(CS.tentBoxLoot(st, new Rng(1000 + k), { tentKind: kind, cap: TENT_TYPES[kind].storeKg }, 1, 0, S)); return kg / 200; };
  const a1 = avg("tent1", "abandoned"), a2 = avg("tent2", "abandoned"), a4 = avg("tent4", "abandoned");
  check(a1 < a2 && a2 < a4 && a4 > 2.5 * a1, `a one-person tent ${a1.toFixed(1)} kg, two-person ${a2.toFixed(1)}, four-person ${a4.toFixed(1)}`);
  check(avg("tent2", "abandoned") > avg("tent2", "active"), "an abandoned camp's tents hold more (the best loot left)");
  const many = []; for (let k = 0; k < 300; k++) many.push(CS.tentBoxLoot(st, new Rng(5000 + k), { tentKind: "tent2", cap: 30 }, 1, 0, "active"));
  check(many.some((g) => g.sup.food) && many.some((g) => g.sup.water) && many.some((g) => g.gear.some((it) => ["stove", "headlamp", "lantern", "waterfilter", "lighters"].includes(it.key))), "food, water and camp gear");
  check(many.some((g) => g.sup.ammo) && many.some((g) => g.gear.some((it) => ["huntrifle", "shotgun", "rifle22", "pistol", "revolver", "leverrifle", "dbshotgun"].includes(it.key))), "a gun or rounds now and then");
  check(many.some((g) => g.gear.some((it) => TENT_TYPES[it.key] && TENT_TYPES[it.key].bag)), "a spare tent bag now and then");
  check(TENT_TYPES.makeshift.storeKg === 0, "a makeshift tent has no storage (no container)");
}

// ---------- 4. Take down and Slash ----------
section("Take down: the bag, the contents, the wear");
const ab = list.find((x) => x.state === "abandoned");
{
  const b = raid(st, p, ab.t, ab.i, []);
  const [u, v] = me(b);
  const s = survivorById(st, u.sid);
  // A tent with storage, whole.
  const t = b.tents.find((tt) => TENT_TYPES[tt.kind].bag && TENT_TYPES[tt.kind].storeKg > 0);
  for (const [x, y] of t.cells) { const c = at(b, x, y); c.k = "tent"; c.hp = c.mhp = TENT_FIGHT.HP; }
  besideTent(b, u, t);
  u.ap = 1;
  check(/both actions/.test(TF.strikeRefusal(b, u)), "one action is not enough");
  u.ap = 2;
  const box = b.raid.containers.find((x) => x.id === t.box);
  check(TF.strikeAct(st, b, u, {}) === "" && u.ap === 0 && t.goes === 1 && !t.down && at(b, t.cells[0][0], t.cells[0][1]).k === "tent", `a go: both actions, the tent still up (${TF.goesLeft(t)} more)`);
  for (let k = 0; k < 4 && !t.down; k++) { u.ap = 2; TF.strikeAct(st, b, u, {}); }
  check(!!t.down && t.goes === TENT_TAKE.GOES[t.kind], `down after ${TENT_TAKE.GOES[t.kind]} goes (${t.kind})`);
  check(t.cells.every(([x, y]) => at(b, x, y).k === "open" && at(b, x, y).tentId == null), "its cells are open ground");
  check(!!s.gear.carry && s.gear.carry.key === t.kind && s.gear.carry.tentHp == null, `the ${TENT_TYPES[t.kind].name.toLowerCase()} bag in ${u.name}'s arms, whole`);
  check(box && box.down && !box.w && /What was in the/.test(box.label) && b.raid.containers.includes(box), `what was stored in it stays where it stood to search ("${box && box.label}")`);
  u.ap = 2;
  searchBox(st, b, u, box, true);
  check(!!box.contents, `searched, it holds the tent's things (${box.contents.gear.length} items, ${Object.keys(box.contents.sup).length} kinds of supplies)`);
  // A torn tent with the hands full: a damaged bag on the ground.
  const t2 = b.tents.find((tt) => !tt.down && TENT_TYPES[tt.kind].bag);
  if (t2) {
    t2.cells.forEach(([x, y], k) => { const c = at(b, x, y); c.k = k === 0 ? "torn" : "tent"; c.hp = k === 0 ? 0 : TENT_FIGHT.HP; c.mhp = TENT_FIGHT.HP; });
    const share = (t2.cells.length - 1) / t2.cells.length;
    besideTent(b, u, t2);
    for (let k = 0; k < 4 && !t2.down; k++) { u.ap = 2; TF.strikeAct(st, b, u, { x: t2.cells[0][0], y: t2.cells[0][1] }); }
    const pile = groundPiles(b).find((g) => g.contents.gear.some((it) => it.key === t2.kind && it !== s.gear.carry));
    const bag = pile && pile.contents.gear.find((it) => it.key === t2.kind);
    check(!!bag && bag.tentHp === Math.round(share * 100), `torn: a damaged bag (${bag && bag.tentHp}% left), on the ground: ${u.name.split(" ")[0]}'s hands are full`);
  }
  // A wrecked tent: scrap and canvas.
  const fake = TF.addTent(b, { kind: "tent2", cells: [[1, 1], [2, 1], [1, 2], [2, 2]], side: null });
  for (const [x, y] of fake.cells) { const c = at(b, x, y); c.k = "torn"; c.hp = 0; c.mhp = TENT_FIGHT.HP; }
  const rags = TF.takeResult(b, fake);
  check(rags.kind === "rags" && !rags.item && rags.gear.filter((it) => it.key === "canvas").length === TENT_TAKE.CANVAS.tent2 && rags.sup.scrap === TENT_TAKE.SCRAP.tent2, `wrecked: no bag, ${TENT_TAKE.CANVAS.tent2} canvas and ${TENT_TAKE.SCRAP.tent2} scrap`);
  const mk = TF.addTent(b, { kind: "makeshift", cells: [[4, 1], [4, 2]], side: null });
  for (const [x, y] of mk.cells) { const c = at(b, x, y); c.k = "tent"; c.hp = c.mhp = TENT_FIGHT.HP; }
  v.x = 5; v.y = 1; v.ap = 2;
  survivorById(st, v.sid).gear.carry = null;
  TF.strikeAct(st, b, v, { x: 4, y: 1 });
  const mpile = groundPiles(b).find((g) => g.contents.sup.wood === TENT_TAKE.MAKESHIFT.wood);
  check(!!mk.down && !!mpile && mpile.contents.sup.scrap === TENT_TAKE.MAKESHIFT.scrap && !survivorById(st, v.sid).gear.carry, `a makeshift tent: ${TENT_TAKE.MAKESHIFT.wood} wood and ${TENT_TAKE.MAKESHIFT.scrap} scrap on the ground, no bag`);
  // Slash.
  const t3 = b.tents.find((tt) => !tt.down && tt.cells.some(([x, y]) => at(b, x, y).k === "tent"));
  if (t3) {
    const cell = t3.cells.find(([x, y]) => at(b, x, y).k === "tent");
    const c = at(b, cell[0], cell[1]);
    c.hp = c.mhp = TENT_FIGHT.HP;
    besideTent(b, v, t3);
    v.ap = 2;
    const was = c.hp;
    check(TF.slashAct(st, b, v, { x: cell[0], y: cell[1] }) === "" && v.ap === 1 && was - c.hp >= TENT_FIGHT.SLASH[0] && was - c.hp <= TENT_FIGHT.SLASH[1], `Slash: one action, ${was - c.hp} off the canvas (${TENT_FIGHT.SLASH.join("–")})`);
    v.ap = 2; TF.slashAct(st, b, v, { x: cell[0], y: cell[1] }); v.ap = 2; TF.slashAct(st, b, v, { x: cell[0], y: cell[1] });
    check(c.k === "torn", "slashed to nothing the cell is torn open");
  }
  // ---------- 5. The owner loses it ----------
  section("The owner loses the tent");
  const gone = t.owner.i;
  b.phase = "player";
  finishCombat(st, b.setup, { outcome: "extracted", enemiesKilled: 0, worn: true, loot: { supplies: {}, gear: [] }, raid: { hours: 1, searched: 0, total: 0 } });
  const rec = CS.campRec(ab.t, ab.i);
  check(rec && rec.gone.includes(gone), `the campsite's tent ${gone} is gone for good (gone: ${rec && rec.gone.join(", ")})`);
  const b2 = raid(st, p, ab.t, ab.i, []);
  check(!b2.raid.camp.tents.some((tt) => tt.i === gone) && b2.raid.camp.tents.length === CS.campTents(st, ab.t.id, ab.i).length - rec.gone.length, `the next raid: ${b2.raid.camp.tents.length} tents, the taken ones not there`);
  if (t3 && t3.owner && !t3.down) {
    const tt = b2.raid.camp.tents.find((x) => x.i === t3.owner.i);
    check(!!tt && tt.cells.some(([x, y]) => at(b2, x, y).k === "torn"), "the slashed tent left standing is still torn");
  }
  st.combat = null;
}
{
  // An AI group's camp: the bag off its shelf.
  const f = st.factions.find((x) => x.alive);
  const bag = newItem("tent2");
  f.wares = [...(f.wares || []), bag];
  const h = hub(st);
  const b = createBattle(st, { tile: h.tile, partyId: p.id, enemy: { kind: "raiders", count: 1, power: 3, name: "x" }, ambush: null, canRetreat: true, handler: "cstest", context: {} });
  st.combat = b;
  const cells = [[10, 5], [11, 5], [10, 6], [11, 6]];
  for (const [x, y] of cells) { const c = at(b, x, y); c.k = "tent"; c.hp = c.mhp = TENT_FIGHT.HP; }
  const t = TF.addTent(b, { kind: "tent2", cells, side: "enemy", owner: { fid: f.id }, item: bag });
  const [u] = me(b);
  survivorById(st, u.sid).gear.carry = null;
  u.x = 9; u.y = 5;
  for (let k = 0; k < 4 && !t.down; k++) { u.ap = 2; TF.strikeAct(st, b, u, {}); }
  check(survivorById(st, u.sid).gear.carry === bag, "taken down at a group's camp: their very bag in your arms");
  TF.settleTentsDown(st, b, { outcome: "victory" });
  check(!f.wares.includes(bag), `${f.name} lose the bag off their shelf`);
  survivorById(st, u.sid).gear.carry = null;
  st.combat = null;
}

// ---------- 6. The AI takes your tents ----------
section("Raiders take your tents down and carry them off");
function campRaid(st0, outcome) {
  const h0 = hub(st0);
  const tiles = st0.tiles.filter((t) => t.terrain === "plains" && !t.road && !st0.bases.some((x) => x.tile === t.id) && st0.grid.distance(t.id, h0.tile) > 3);
  const camp = { id: 9000 + st0.bases.length, tile: tiles[0].id, type: "outpost", name: "Test Camp", stock: { water: 0, fuel: 0, meds: 0, ammo: 0, arrows: 0, parts: 0, scrap: 0, jars: 0, wood: 0, buildmat: 0, rawwater: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [], tier: 0, camp: true, fire: true };
  st0.bases.push(camp);
  const bag = newItem("tent2");
  const view = pitchTentAtBase(st0, camp, "tent2", bag);
  for (let i = 0; i < 2; i++) { const s = makeSurvivor(st0); s.location = { kind: "base", baseId: camp.id }; s.health = 100; s.gear.weapon = newItem("pistol"); st0.survivors.push(s); }
  globalThis.window = {};
  let b;
  try { b = createBattle(st0, { tile: camp.tile, baseId: camp.id, enemy: { kind: "raiders", count: 3, power: 3, name: "raiders" }, ambush: null, canRetreat: true, handler: "cstest", layout: "baseDefence", deploy: true, context: { night: false, ready: { manned: true } } }); }
  finally { delete globalThis.window; }
  st0.combat = b;
  const t = (b.tents || []).find((x) => x.owner && x.owner.base === camp.id);
  const e = b.units.find((u) => u.side === "enemy" && u.kind === "human");
  const mine = b.units.filter((u) => u.side === "player");
  for (const u of mine) u.dead = true; // nobody of the defenders in sight
  besideTent(b, e, t);
  const keep = TENT_TAKE.AI_TAKE;
  TENT_TAKE.AI_TAKE = 1;
  for (let k = 0; k < 6 && !t.down; k++) { b.turn++; e.ap = 2; tentAI(b, e, st0); }
  TENT_TAKE.AI_TAKE = keep;
  for (const u of mine) u.dead = false;
  const res = { t, e, camp, bag, view };
  if (outcome === "fled") e.fled = true; else { e.dead = true; e.hp = 0; }
  b.phase = "player";
  finishCombat(st0, b.setup, { outcome: outcome === "fled" ? "defeat" : "win", enemiesKilled: outcome === "fled" ? 0 : 1, worn: true });
  return res;
}
{
  const stA = world(seed + 3);
  const r = campRaid(stA, "fled");
  check(!!r.view && !!r.t && r.t.side === "player" && r.t.owner.rec === r.view.id, "your camp's tent is on the battle's list as yours");
  check(!!r.t.down && r.t.down.side === "enemy" && r.t.down.bag === r.bag && (r.e.tentLoot || []).includes(r.t.id) && r.e.loot && r.e.loot.full, `a raider with nobody in sight takes it down (${TENT_TAKE.GOES.tent2} goes) and makes off with the bag`);
  check(!r.camp.buildings.some((x) => x.type === "tent") && !r.camp.armory.includes(r.bag), "the raider got away: the tent is gone from your camp (its beds and storage with it), the bag with them");
  check(stA.log.some((l) => /carried off by the raiders/.test(l.text)), "the log says so");
  const stB = world(seed + 4);
  const r2 = campRaid(stB, "killed");
  check(!r2.camp.buildings.some((x) => x.type === "tent") && r2.camp.armory.includes(r2.bag), "the raider fell: the tent is down, its bag back in the stores");
}

// ---------- 7. Nomad and raider camps ----------
section("Nomad and raider camps fight on the campsite layout");
{
  const b0 = spawnNomads(st, { tier: 2, tile: hub(st).tile });
  b0.phase = "camp";
  b0.wares = [...b0.wares.filter((it) => !(TENT_TYPES[it.key] && TENT_TYPES[it.key].bag)), newItem("tent2"), newItem("tent1"), newItem("tent1"), newItem("lantern")];
  b0.stock.water = 20; b0.stock.ammo = 30;
  const bags = b0.wares.filter((it) => TENT_TYPES[it.key] && TENT_TYPES[it.key].bag);
  const water0 = b0.stock.water;
  p.path = [b0.tile]; p.idx = 0; p.dest = b0.tile;
  st.hour = 24 * 5 + 23; // night
  const b = createBattle(st, { tile: b0.tile, partyId: p.id, enemy: nomadEnemy(st, b0), ambush: "player", canRetreat: true, handler: "cstest", layout: "campsite", context: { nomadId: b0.id, partyId: p.id, camp: true, campBand: { band: "nomad", id: b0.id } } });
  st.combat = b;
  const C = b.camp;
  check(!!C && at(b, C.cx, C.cy).k === "firepit" && at(b, C.cx, C.cy).lit, "their camp: a clearing round a lit fire");
  check(C.tents.length === bags.length && b.tents.every((tt) => tt.owner && tt.owner.band === "nomad" && bags.includes(tt.item)), `their real tents, one a bag (${C.tents.map((tt) => tt.kind).join(", ")})`);
  const piles = b.fieldLoot.containers.filter((c) => c.bandStore);
  check(piles.length >= 1 && b0.stock.water < water0 && piles.some((c) => c.contents.sup.water > 0), `their stores in the tents (${piles.length} piles; water ${water0} → ${b0.stock.water} on the band while the fight lasts)`);
  const foes = b.units.filter((u) => u.side === "enemy" && u.kind === "human");
  check(foes.some((u) => u.asleep) && foes.every((u) => Math.hypot(u.x - C.cx, u.y - C.cy) <= C.R + 2), `their people at the camp, ${foes.filter((u) => u.asleep).length} asleep in the tents at night`);
  // One tent taken down, then the fight ends: the stores back, the bag off the band.
  const t = b.tents.find((tt) => tt.kind === "tent1");
  const [u] = me(b);
  survivorById(st, u.sid).gear.carry = null;
  for (const o of b.units) if (o.side === "enemy") o.dead = true;
  besideTent(b, u, t);
  for (let k = 0; k < 4 && !t.down; k++) { u.ap = 2; TF.strikeAct(st, b, u, {}); }
  const back = CS.campAfter(st, b, { outcome: "retreat" });
  TF.settleTentsDown(st, b, { outcome: "retreat" });
  check(back.back > 0 && b0.stock.water === water0, `what was left in their tents goes back to them (water ${b0.stock.water})`);
  check(!b0.wares.includes(t.item) && survivorById(st, u.sid).gear.carry === t.item, "the bag you took is off their shelf and in your arms");
  st.combat = null;
  survivorById(st, u.sid).gear.carry = null;
  // A raider band from beyond the border camped where it stopped.
  const v = { id: newId(), kind: "raiders", size: 5, wares: [newItem("tent2"), newItem("tent2")], stock: { water: 10, ammo: 20 }, tile: hub(st).tile, phase: "stop", name: "test raiders" };
  st.visitors = [...(st.visitors || []), v];
  const bv = createBattle(st, { tile: v.tile, partyId: p.id, enemy: { kind: "raiders", count: 5, power: 3, name: "raiders" }, ambush: "player", canRetreat: true, handler: "cstest", layout: "campsite", context: { visitorId: v.id, partyId: p.id, campBand: { band: "visitor", id: v.id } } });
  check(!!bv.camp && bv.tents.length === 2 && bv.tents.every((tt) => tt.owner && tt.owner.band === "visitor"), "a raider band's camp too: their two tents");
  CS.campAfter(st, bv, { outcome: "victory" });
  check(v.stock.water === 10 && v.stock.ammo === 20, "their stores back before the handler hands them over");
  st.combat = null;
}

// ---------- 8. A cleared campsite stays cleared ----------
section("A cleared campsite stays cleared");
{
  st.hour = 24 * 3 + 12;
  const c = campsites(st).find((x) => x.state === "active");
  const b = raid(st, p, c.t, c.i);
  // A tent's container opened and left (the ledger keeps it), the campers all down.
  const box = b.raid.containers.find((x) => x.kind === "tent");
  const [u] = me(b);
  if (box) { u.x = box.x - 1 >= 0 ? box.x - 1 : box.x + (box.w || 1); u.y = box.y; u.ap = 2; searchBox(st, b, u, box, true); }
  const had = box ? JSON.stringify(box.contents) : "";
  for (const o of b.units) if (o.side === "enemy") { o.dead = true; o.hp = 0; }
  u.left = true;
  b.phase = "player";
  poiRaidEnd(st, b);
  finishCombat(st, b.setup, { outcome: "extracted", enemiesKilled: 3, worn: true, loot: { supplies: {}, gear: [] }, raid: { hours: 1, searched: 1, total: 1 } });
  check(CS.campState(st, c.t, c.i) === "cleared", "every camper down: the camp is cleared");
  st.hour += 24 * CS.CAMPSITE.EPOCH * 3;
  check(CS.campState(st, c.t, c.i) === "cleared", "a month on it is still cleared");
  check(!CS.campRoster(st, c.t, c.i, []).some((g) => g.camp), "nobody of the camp's in its roster");
  const st2 = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const t2 = st2.tiles[c.t.id];
  check(CS.campState(st2, t2, c.i) === "cleared", "save and load keep it cleared");
  const b2 = raid(st, p, c.t, c.i);
  check(!at(b2, b2.raid.camp.cx, b2.raid.camp.cy).lit && b2.raid.camp.state === "cleared", "the next raid: the fire is cold");
  const box2 = box ? b2.raid.containers.find((x) => x.id === box.id) : null;
  check(!box || (box2 && JSON.stringify(box2.contents) === had), "a tent left standing still holds what was left in it");
  st.combat = null;
}

// ---------- 9. The AI raids a campsite ----------
section("An AI group's raid on a campsite");
{
  const c = campsites(st).find((x) => x.state !== "cleared" && !(CS.campRec(x.t, x.i) || {}).gone?.length);
  const f = st.factions.find((x) => x.alive);
  poiAt(c.t, c.i).pool = 0.25;
  const r = raidPoiAsGroup(st, f, c.t, c.i, 0.1, { news: false });
  const bags = r.gear.filter((it) => TENT_TYPES[it.key] && TENT_TYPES[it.key].bag);
  check(bags.length >= 1 && bags.length <= CS.CAMPSITE.AI_BAGS, `they carry off ${bags.length} tent bag${bags.length === 1 ? "" : "s"} (${bags.map((it) => it.key).join(", ")})`);
  check(CS.campState(st, c.t, c.i) === "cleared" && CS.campRec(c.t, c.i).gone.length === bags.length, "the camp is cleared and those tents gone for good");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
