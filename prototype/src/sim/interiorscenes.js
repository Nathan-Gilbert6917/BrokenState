// Signs of survival inside a raid's building (the user's request 2026-10-25, issue #11: "The interior of buildings can
// have chairs, shelves and other movable furniture that can block door ways, hallways etc to show people were here
// surviving trying to barricade or slow down something. Add blood splatters, dead zombie bodies survivor bodies."):
// scenes rolled from the building's own dice once its rooms, doors and furniture are laid out (buildingmaps.js
// buildingMap → rollScenes), and put on the battle when the raid starts (combat.js createRaid → sceneBattle).
//
//   How many (SCENES.ODDS, SCENES.COUNT): a building of a kind has scenes at ODDS[kind] (a house 60%, a hospital 90%,
//   a church 40%; DEFAULT otherwise), then 1, 2 or 3 of them (COUNT: the chance of a second, of a third). Which ones:
//   by weight (SCENE_KINDS[k].w, × BY_KIND[kind][k] for the building's kind), each tried in a room that fits it; one
//   that fits nowhere gives way to the next by weight, so a building that rolls scenes nearly always gets one.
//   The scenes (SCENE_KINDS; registerScene adds one: the hospital, police and school layouts call it):
//     barricade  a dead-end room (one door, not an exit, no stairs) shut from inside: its door boarded up (barricade.js
//                boardCell, BOARD.HP a layer) or a piece shoved into its open frame (setPiece: c.frame, hp), a piece
//                dragged against the inside (c.moved, hp); inside 1–2 survivor bodies with their kit, a pile of empty
//                tins and a water jug (a ground pile: a little water), blood. Upstairs, ALIVE of the time nobody died
//                there: the room is marked (area.scene.alive) and floorfolk.js barricadeSurvivors holds it first.
//     overrun    a room whose door was broken in (doorway), a blood trail from it to a survivor body who took 3–6 of
//                the dead with them (b.corpses, sleeper: by sleepers.js's own share, SLEEPER.ODDS + ODDS_INF × the
//                tile's Infection: a Sleeper among them sometimes).
//     choke      a hallway or corridor (a hub room one to three cells across) with furniture shoved across it, a
//                one-cell gap left or none, now and then one smashed to rubble. Only half cover (the living vault or
//                shove, the dead crawl over: barricade.js crawlable), so nothing is ever walled in.
//     stand      the top of a stairwell upstairs (a building of storeys): half cover round the landing, spent brass
//                behind it (c.brass, seeded for ui/battlemarks.js), the dead on the stairs and at their foot on the
//                floor below, a survivor body behind the pieces, blood.
//     quiet      a body by a bed (or anywhere in a quiet room), a pill bottle (a ground pile: meds), no blood.
//   Blood (c.blood = { kind: "human" | "zombie", amount: 1–3 }): on floor cells of the building only (never a wall, a
//   piece, "void", outdoors), in splatters round a body and trails (a short random walk toward the door). ui/
//   battlemarks.js draws it with the marks of the fight, by floor.
//   Bodies: the dead (zombies) are b.corpses with f; the survivors are dead people on the battle (side "neutral",
//   kit survivors; restored: never counted as killed), so a Carrier raises them (carriers.js wormable) and their body
//   container (kind "body", c.full: their kit always) is searched as any body.
// Determinism: rollScenes draws from dice of its own (sceneRng: the world seed, the tile, the building's option id),
// never the map's or the world's, so the floor plan, its containers and every other roll are as they were. The same
// building rolls the same scenes every visit; the city crawl's snapshot keeps the cells (blood, pieces, boards), the
// bodies and the scene log (citycrawl.js snapshotBuilding); a point of interest's ledger keeps the scene's pieces as
// they were left (sceneLedger / applySceneLedger: poicont.js poi.cont.scenes), so a smashed piece stays smashed. A
// save from before has none and loads as it was.
// The intro line (sceneSeen): the first time one of your people sees a scene's room, its sentence in the log.
// AI parity: nobody places these in play; the AI's own barricading is barricade.js aiBarricade as before.
// API: SCENES, SCENE_KINDS, registerScene(name, def), sceneRng(state, tileId, option), scenePieces(room, rng, n, opts),
//      rollScenes(map, rng, key), sceneBattle(b, map), sceneSeen(b, u), sceneLedger(b), applySceneLedger(b, list),
//      bloodAt(c).
import { CELL, KITS, enemyUnit, say, los } from "./combat.js"; // call-time only (combat.js and buildingmaps.js import this)
import { FURNITURE, setPiece, boardCell } from "./barricade.js";
import { SLEEPER } from "./hiveconst.js";
import { hash01 } from "./skills.js";
import { Rng } from "./rng.js";

export const SCENES = {
  DEFAULT: 0.5,
  ODDS: {
    house: 0.6, farmhouse: 0.6, cabin: 0.5, lodge: 0.55, apartments: 0.7, motel: 0.65, neighbourhood: 0.6,
    hospital: 0.9, clinic: 0.75, infirmary: 0.7, vet: 0.5, pharmacy: 0.55,
    police: 0.8, firestation: 0.6, school: 0.7, church: 0.4, barracks: 0.75, cellblock: 0.6, messhall: 0.5,
    grocery: 0.55, supermarket: 0.6, deptstore: 0.55, offices: 0.6, library: 0.45, bank: 0.5,
    warehouse: 0.35, factory: 0.35, barn: 0.25, garage: 0.35, gasstation: 0.45, diner: 0.45,
  },
  COUNT: [0.35, 0.12],   // a second scene, a third (of a building with scenes)
  ALIVE: 0.3,            // an upper floor's barricaded room: nobody died there (floorfolk.js's survivors may hold it)
  DEAD: [3, 6],          // the dead an overrun survivor took with them
  STAND_DEAD: [2, 4],    // the dead on the stairs of a last stand (part of them on the floor below)
  BRASS: [3, 8],         // spent cases behind a last stand's furniture, a cell
  TRAIL: [4, 8],         // the cells of a blood trail
};
// The scenes and their weights; by: the building kinds that weigh one more (× the factor).
export const SCENE_KINDS = {
  barricade: { w: 3, place: barricade },
  overrun: { w: 3, place: overrun },
  choke: { w: 2, place: choke },
  stand: { w: 2, place: stand },
  quiet: { w: 2, place: quiet },
};
export const BY_KIND = {
  hospital: { quiet: 2.5, barricade: 1.5 }, clinic: { quiet: 2 }, infirmary: { quiet: 2 },
  police: { stand: 2, overrun: 1.5 }, barracks: { stand: 2, overrun: 1.5 }, cellblock: { overrun: 2 },
  church: { barricade: 2, quiet: 1.5 }, school: { barricade: 2, choke: 1.5 },
  house: { barricade: 1.5, quiet: 1.5 }, apartments: { barricade: 2, stand: 1.5 }, motel: { barricade: 2 },
  supermarket: { choke: 1.5, overrun: 1.5 }, offices: { stand: 1.5, choke: 1.5 },
};
// A scene of another module's (the special buildings' layouts): def { w, place(ctx, room?) → scene | null, kinds? }.
export function registerScene(name, def) { SCENE_KINDS[name] = def; }

// The building's own dice for its scenes: the world seed, the tile and the building's option id.
export const sceneRng = (state, tileId, option) => new Rng(Math.floor(hash01(state.seed, "scenes", tileId, option && option.id != null ? option.id : option && option.key) * 4294967296) || 1);

// The furniture a scene's people shove into place, picked in one place (the room's kind first): the catalogue of #8
// (data-furniture.js: chairs, sofas, wardrobes) slots in here. opts.half: half cover only (the living vault it, the
// dead crawl over it).
const HOME = ["table", "cabinet", "shelf", "bed", "crate"], SHOP = ["shelf", "counter", "crate", "rack", "barrel"], WORK = ["table", "cabinet", "locker", "crate", "shelf"];
const ROOM_PIECES = { house: HOME, kitchen: HOME, cabin: HOME, clinic: ["bed", "cabinet", "table", "locker"], pharmacy: SHOP, store: SHOP, warehouse: SHOP, office: WORK, lockers: WORK, chapel: ["table", "cabinet", "crate"], barracks: ["bed", "locker", "table"] };
export function scenePieces(room, rng, n, opts = {}) {
  let list = (room && (ROOM_PIECES[room.type] || (room.hub ? ["table", "cabinet", "crate", "shelf"] : null))) || HOME;
  list = list.filter((k) => FURNITURE[k] && (!opts.half || CELL[k].cover === 1));
  if (!list.length) list = ["table", "crate"];
  return Array.from({ length: n }, () => rng.pick(list));
}

// ---------- the context of one map ----------
const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const AROUND = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function context(map, rng, key) {
  const W = map.w, H = map.h;
  const floors = map.floors && map.floors.length ? map.floors.map((F) => F.cells) : [map.cells];
  const stairs = new Set((map.stairs || []).map(([x, y]) => `${x},${y}`));
  const boxAt = new Set();
  for (const c of map.containers || []) for (let dy = 0; dy < (c.h || 1); dy++) for (let dx = 0; dx < (c.w || 1); dx++) boxAt.add(`${c.f || 0}:${c.x + dx},${c.y + dy}`);
  const used = new Set(); // cells a scene took (a piece, a body)
  const ctx = {
    map, rng, key, W, H, floors, out: { list: [], bodies: [], piles: [], pieces: [] },
    at: (f, x, y) => (x < 0 || y < 0 || x >= W || y >= H || !floors[f] ? null : floors[f][y * W + x]),
    rooms: (map.rooms || []).filter((a) => !a.outdoor),
    inner: (r) => { const out = []; for (let y = r.y0 + 1; y <= r.y0 + r.h - 2; y++) for (let x = r.x0 + 1; x <= r.x0 + r.w - 2; x++) out.push([x, y]); return out; },
    // A way out: a door with the outside (or open air) next to it.
    exit: (x, y, f = 0) => NEXT4.some(([dx, dy]) => { const c = x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H && floors[f] ? floors[f][(y + dy) * W + x + dx] : null; return !c || c.f !== "floor"; }),
    stair: (x, y) => stairs.has(`${x},${y}`),
    nearBox: (f, x, y) => NEXT4.some(([dx, dy]) => boxAt.has(`${f}:${x + dx},${y + dy}`)) || boxAt.has(`${f}:${x},${y}`),
    used: (f, x, y) => used.has(`${f}:${x},${y}`),
    take: (f, x, y) => used.add(`${f}:${x},${y}`),
  };
  // A free floor cell: open, not the stairs, a door's side, a container's side or one a scene took.
  ctx.free = (f, x, y) => { const c = ctx.at(f, x, y); return !!c && c.k === "open" && !ctx.stair(x, y) && !ctx.used(f, x, y) && !ctx.nearBox(f, x, y) && !NEXT4.some(([dx, dy]) => DOORS.has((ctx.at(f, x + dx, y + dy) || {}).k)); };
  ctx.freeIn = (r) => ctx.inner(r).filter(([x, y]) => ctx.free(r.f || 0, x, y));
  ctx.floorCell = (f, x, y) => { const c = ctx.at(f, x, y); return !!c && c.f === "floor" && !!CELL[c.k] && CELL[c.k].walk && c.k !== "void"; };
  ctx.piece = (f, x, y, k) => { const c = ctx.at(f, x, y); setPiece(c, k); delete c.blood; delete c.brass; /* blood lies on the floor, not on a piece */ ctx.take(f, x, y); ctx.out.pieces.push({ f, x, y, k }); };
  ctx.body = (f, x, y, o = {}) => { ctx.take(f, x, y); ctx.out.bodies.push({ f, x, y, human: !!o.human, quiet: !!o.quiet, r: rng.next(), weapon: o.human ? rng.pick(KITS.survivors.weapons) : null }); };
  ctx.pile = (f, x, y, label, sup, area) => { ctx.take(f, x, y); ctx.out.piles.push({ f, x, y, label, sup, area }); };
  ctx.blood = (f, x, y, kind, amount) => {
    if (!ctx.floorCell(f, x, y)) return false;
    const c = ctx.at(f, x, y);
    if (!c.blood || c.blood.amount < amount) c.blood = { kind: c.blood && c.blood.kind === "human" ? "human" : kind, amount: Math.max(1, Math.min(3, amount)) };
    return true;
  };
  ctx.splatter = (f, x, y, kind, amount) => { ctx.blood(f, x, y, kind, amount); for (const [dx, dy] of AROUND) if (rng.chance(0.35)) ctx.blood(f, x + dx, y + dy, kind, Math.max(1, amount - 1)); };
  // A trail of blood from (x, y) toward (tx, ty): a short random walk over floor cells, mostly the right way.
  ctx.trail = (f, x, y, tx, ty, kind) => {
    let cx = x, cy = y;
    const n = rng.int(SCENES.TRAIL[0], SCENES.TRAIL[1]);
    for (let i = 0; i < n && (cx !== tx || cy !== ty); i++) {
      ctx.blood(f, cx, cy, kind, rng.chance(0.3) ? 2 : 1);
      const steps = NEXT4.map(([dx, dy]) => [cx + dx, cy + dy]).filter(([nx, ny]) => ctx.floorCell(f, nx, ny));
      if (!steps.length) break;
      steps.sort((p, q) => Math.abs(p[0] - tx) + Math.abs(p[1] - ty) - (Math.abs(q[0] - tx) + Math.abs(q[1] - ty)));
      [cx, cy] = rng.chance(0.75) ? steps[0] : rng.pick(steps);
    }
  };
  ctx.done = (kind, r, x, y, text, extra = {}) => { const s = { kind, f: r ? r.f || 0 : 0, room: r ? r.id : null, x, y, text, seen: false, ...extra }; ctx.out.list.push(s); if (r) r.scene = { kind, ...(extra.alive ? { alive: true } : {}) }; return s; };
  return ctx;
}
const DOORS = new Set(["idoor", "odoor", "door", "doorway", "bdoor", "boarded"]);
const lower = (r) => String(r.name || "room").replace(/ \(upstairs\)$/, "").toLowerCase();
const area = (r) => Math.max(0, r.w - 2) * Math.max(0, r.h - 2);
// The cell next to a door inside the room, and the one outside it.
function sides(ctx, r, [dx, dy]) {
  const inR = (x, y) => x > r.x0 && x < r.x0 + r.w - 1 && y > r.y0 && y < r.y0 + r.h - 1;
  let inn = null, out = null;
  for (const [ox, oy] of NEXT4) { const x = dx + ox, y = dy + oy; if (inR(x, y)) { inn = [x, y]; out = [dx - ox, dy - oy]; } }
  return inn ? { inn, out } : null;
}
// The rooms a scene fits, shuffled: a dead end with one inner door (closed or open), none of the stairs.
function deadEnds(ctx) {
  return ctx.rng.shuffle(ctx.rooms.filter((r) => !r.hub && !r.entry && !r.locked && !r.scene && r.doors && r.doors.length === 1 && area(r) >= 4 && !ctx.exit(r.doors[0][0], r.doors[0][1], r.f || 0)
    && ["idoor", "odoor"].includes((ctx.at(r.f || 0, r.doors[0][0], r.doors[0][1]) || {}).k) && !ctx.inner(r).some(([x, y]) => ctx.stair(x, y)) && sides(ctx, r, r.doors[0])));
}
const far = (cells, x, y) => cells.slice().sort((p, q) => Math.abs(q[0] - x) + Math.abs(q[1] - y) - (Math.abs(p[0] - x) + Math.abs(p[1] - y)));

// ---------- the scenes ----------
function barricade(ctx) {
  const { rng } = ctx;
  for (const r of deadEnds(ctx)) {
    const f = r.f || 0, [dx, dy] = r.doors[0], s = sides(ctx, r, r.doors[0]);
    const free = ctx.freeIn(r).filter(([x, y]) => x !== s.inn[0] || y !== s.inn[1]);
    if (free.length < 2) continue;
    const door = ctx.at(f, dx, dy);
    const boarded = rng.chance(0.5);
    const [k0, k1] = scenePieces(r, rng, 2);
    delete door.blood;
    if (boarded) { door.k = "idoor"; boardCell({ units: [], losCache: { fill() {} } }, door, dx, dy); ctx.take(f, dx, dy); ctx.out.pieces.push({ f, x: dx, y: dy, k: "boarded" }); }
    else { door.k = "odoor"; ctx.piece(f, dx, dy, k0); }
    // Dragged against the inside: the cell inside the door, if it is bare floor.
    const ic = ctx.at(f, s.inn[0], s.inn[1]);
    if (ic && ic.k === "open" && !ctx.stair(s.inn[0], s.inn[1])) ctx.piece(f, s.inn[0], s.inn[1], k1);
    const alive = f > 0 && rng.chance(SCENES.ALIVE);
    if (alive) return ctx.done("barricade", r, dx, dy, `Someone barricaded the ${lower(r)} from inside${boarded ? ": the door is boarded up" : ""}.`, { alive: true });
    const spots = far(free, dx, dy);
    const n = Math.min(spots.length - 1, rng.chance(0.4) ? 2 : 1);
    for (let i = 0; i < n; i++) { const [x, y] = spots[i]; ctx.body(f, x, y, { human: true }); ctx.splatter(f, x, y, "human", rng.int(2, 3)); }
    const [px, py] = spots[n];
    ctx.pile(f, px, py, "Empty tins and a water jug", rng.chance(0.5) ? { water: 1 } : {}, r.id);
    return ctx.done("barricade", r, dx, dy, boarded ? `Someone boarded themselves into the ${lower(r)}. They never came out.` : `Someone barricaded the ${lower(r)}. It did not hold.`);
  }
  return null;
}
function overrun(ctx) {
  const { rng } = ctx;
  const cands = rng.shuffle(ctx.rooms.filter((r) => !r.hub && !r.locked && !r.scene && area(r) >= 4 && (r.doors || []).some((d) => !ctx.exit(d[0], d[1], r.f || 0) && ["idoor", "odoor"].includes((ctx.at(r.f || 0, d[0], d[1]) || {}).k) && sides(ctx, r, d))));
  for (const r of cands) {
    const f = r.f || 0;
    const d = r.doors.find((q) => !ctx.exit(q[0], q[1], f) && ["idoor", "odoor"].includes((ctx.at(f, q[0], q[1]) || {}).k) && sides(ctx, r, q));
    const free = ctx.freeIn(r);
    if (free.length < 3) continue;
    const s = sides(ctx, r, d);
    const door = ctx.at(f, d[0], d[1]);
    door.k = "doorway"; delete door.held; delete door.t; delete door.tOpen; door.hp = 0; // broken in (buildingmaps.js doorBroken)
    ctx.take(f, d[0], d[1]);
    const spots = far(free, d[0], d[1]);
    const [bx, by] = spots[0];
    ctx.body(f, bx, by, { human: true });
    ctx.splatter(f, bx, by, "human", 3);
    ctx.trail(f, s.out[0], s.out[1], bx, by, "human");
    const n = rng.int(SCENES.DEAD[0], SCENES.DEAD[1]);
    // The dead round the survivor and in the doorway, a few outside it.
    const near = spots.slice(1).sort((p, q) => Math.hypot(p[0] - bx, p[1] - by) - Math.hypot(q[0] - bx, q[1] - by));
    const outside = [];
    for (const [ox, oy] of AROUND) { const x = s.out[0] + ox, y = s.out[1] + oy; if (ctx.free(f, x, y)) outside.push([x, y]); }
    if (ctx.free(f, s.out[0], s.out[1])) outside.unshift(s.out.slice());
    let placed = 0;
    for (let i = 0; i < n; i++) {
      const c = (i % 3 === 2 && outside.length ? outside : near.length ? near : outside).shift();
      if (!c) break;
      ctx.body(f, c[0], c[1], {});
      ctx.splatter(f, c[0], c[1], "zombie", rng.int(1, 2));
      placed++;
    }
    return ctx.done("overrun", r, d[0], d[1], `The door of the ${lower(r)} was broken in: someone made a stand in there and took ${placed} of the dead with them.`);
  }
  return null;
}
function choke(ctx) {
  const { rng } = ctx;
  const halls = rng.shuffle(ctx.rooms.filter((r) => r.hub && !r.scene && Math.min(r.w - 2, r.h - 2) >= 1 && Math.min(r.w - 2, r.h - 2) <= 3 && Math.max(r.w - 2, r.h - 2) >= 5));
  for (const r of halls) {
    const f = r.f || 0, iw = r.w - 2, ih = r.h - 2, alongX = iw >= ih;
    // A line across the hall, away from its ends.
    const lines = [];
    const len = alongX ? iw : ih;
    for (let i = 2; i < len - 2; i++) {
      const cells = [];
      for (let j = 0; j < (alongX ? ih : iw); j++) cells.push(alongX ? [r.x0 + 1 + i, r.y0 + 1 + j] : [r.x0 + 1 + j, r.y0 + 1 + i]);
      if (cells.every(([x, y]) => ctx.free(f, x, y))) lines.push(cells);
    }
    if (!lines.length) continue;
    const line = rng.pick(lines);
    const gap = line.length > 1 && rng.chance(0.6) ? rng.int(0, line.length - 1) : -1;
    const smashed = line.length > 1 && rng.chance(0.4) ? rng.int(0, line.length - 1) : -1;
    const ks = scenePieces(r, rng, line.length, { half: true });
    line.forEach(([x, y], i) => {
      if (i === gap) return;
      if (i === smashed) { ctx.at(f, x, y).k = "rubble"; ctx.take(f, x, y); ctx.out.pieces.push({ f, x, y, k: "rubble" }); return; }
      ctx.piece(f, x, y, ks[i]);
    });
    // A little blood on one side of it now and then.
    if (rng.chance(0.5)) { const [x, y] = line[0], o = alongX ? [x + (rng.chance(0.5) ? 1 : -1), y] : [x, y + (rng.chance(0.5) ? 1 : -1)]; ctx.splatter(f, o[0], o[1], rng.chance(0.5) ? "zombie" : "human", 1); }
    const [ax, ay] = line[0];
    return ctx.done("choke", r, ax, ay, `Furniture is piled across the ${lower(r)}${gap >= 0 ? ", a gap left to squeeze through" : ""}: someone tried to hold it here.`, { cells: line.filter((_, i) => i !== gap) });
  }
  return null;
}
function stand(ctx) {
  const { rng } = ctx;
  const stairs = ctx.map.stairs || [];
  if (ctx.floors.length < 2 || !stairs.length) return null;
  const opts = [];
  for (let f = 1; f < ctx.floors.length; f++) for (const [sx, sy] of stairs) if ((ctx.at(f, sx, sy) || {}).k === "stairs" && !ctx.used(f, sx, sy)) opts.push([f, sx, sy]);
  for (const [f, sx, sy] of rng.shuffle(opts)) {
    // The landing's cells round the stairwell: pieces on some, one side always left open.
    const ring = AROUND.map(([dx, dy]) => [sx + dx, sy + dy]).filter(([x, y]) => ctx.free(f, x, y));
    const open4 = NEXT4.map(([dx, dy]) => [sx + dx, sy + dy]).filter(([x, y]) => ring.some((q) => q[0] === x && q[1] === y));
    if (open4.length < 2 || ring.length < 3) continue;
    const keep = rng.pick(open4);
    const set = rng.shuffle(ring.filter(([x, y]) => x !== keep[0] || y !== keep[1])).slice(0, rng.int(2, 3));
    const r = ctx.rooms.find((q) => (q.f || 0) === f && sx > q.x0 && sx < q.x0 + q.w - 1 && sy > q.y0 && sy < q.y0 + q.h - 1) || null;
    const ks = scenePieces(r, rng, set.length, { half: true });
    set.forEach(([x, y], i) => ctx.piece(f, x, y, ks[i]));
    // Behind the pieces: the defenders' brass and one of them; the dead at the top of the stairs and at their foot.
    const behind = [];
    for (const [px, py] of set) for (const [dx, dy] of NEXT4) { const x = px + dx, y = py + dy; if (Math.max(Math.abs(x - sx), Math.abs(y - sy)) === 2 && ctx.free(f, x, y) && !behind.some((q) => q[0] === x && q[1] === y)) behind.push([x, y]); }
    for (const [x, y] of behind.slice(0, 3)) { const c = ctx.at(f, x, y); c.brass = rng.int(SCENES.BRASS[0], SCENES.BRASS[1]); }
    if (behind.length) { const [x, y] = rng.pick(behind); ctx.body(f, x, y, { human: true }); ctx.splatter(f, x, y, "human", 2); }
    // The dead: one at the top of the stairs (the side left open), the rest at their foot on the floor below.
    let n = rng.int(SCENES.STAND_DEAD[0], SCENES.STAND_DEAD[1]);
    if (ctx.free(f, keep[0], keep[1])) { ctx.body(f, keep[0], keep[1], {}); ctx.splatter(f, keep[0], keep[1], "zombie", 2); n--; }
    const below = rng.shuffle(AROUND.map(([dx, dy]) => [sx + dx, sy + dy]).filter(([x, y]) => ctx.free(f - 1, x, y)));
    for (const [x, y] of below.slice(0, n)) { ctx.body(f - 1, x, y, {}); ctx.splatter(f - 1, x, y, "zombie", 1); }
    return ctx.done("stand", r, sx, sy, `Furniture is stacked round the top of the stairs, spent brass behind it: a last stand. The dead lie on the steps.`, { stairs: [sx, sy], cells: set });
  }
  return null;
}
function quiet(ctx) {
  const { rng } = ctx;
  const rooms = rng.shuffle(ctx.rooms.filter((r) => !r.locked && !r.scene && area(r) >= 4)).sort((p, q) => (p.hub ? 1 : 0) - (q.hub ? 1 : 0));
  for (const r of rooms) {
    const f = r.f || 0;
    const free = ctx.freeIn(r);
    if (free.length < 2) continue;
    // By a bed when there is one.
    const byBed = free.filter(([x, y]) => NEXT4.some(([dx, dy]) => (ctx.at(f, x + dx, y + dy) || {}).k === "bed"));
    const [x, y] = byBed.length ? rng.pick(byBed) : rng.pick(free);
    ctx.body(f, x, y, { human: true, quiet: true });
    const rest = free.filter(([px, py]) => (px !== x || py !== y) && Math.abs(px - x) + Math.abs(py - y) <= 2);
    if (rest.length) { const [px, py] = rng.pick(rest); ctx.pile(f, px, py, "A pill bottle", { meds: 1 }, r.id); }
    return ctx.done("quiet", r, x, y, `Someone lay down in the ${lower(r)} and never got up. A pill bottle lies beside them.`);
  }
  return null;
}

// ---------- rolling a building's scenes ----------
/**
 * The scenes of a building's map (buildingmaps.js buildingMap, after assemble): the cells changed in place (pieces,
 * boards, broken doors, blood, brass), the rooms marked (area.scene), and map.scenes = { list, bodies, piles, pieces }
 * for the battle (sceneBattle). key: the building's kind (BUILDINGS key). Returns map.scenes, or null with none.
 */
export function rollScenes(map, rng, key) {
  if (!map || !map.rooms) return null;
  const odds = SCENES.ODDS[key] ?? SCENES.DEFAULT;
  if (!rng.chance(odds)) return null;
  const want = 1 + (rng.chance(SCENES.COUNT[0]) ? 1 + (rng.chance(SCENES.COUNT[1]) ? 1 : 0) : 0);
  const ctx = context(map, rng, key);
  const by = BY_KIND[key] || {};
  for (let i = 0; i < want; i++) {
    const kinds = Object.keys(SCENE_KINDS).filter((k) => !SCENE_KINDS[k].kinds || SCENE_KINDS[k].kinds.includes(key));
    // By weight, the ones that fit nowhere giving way to the next.
    let placed = null;
    while (kinds.length && !placed) {
      const k = rng.weighted(kinds, (q) => SCENE_KINDS[q].w * (by[q] ?? 1));
      kinds.splice(kinds.indexOf(k), 1);
      placed = SCENE_KINDS[k].place(ctx);
    }
    if (!placed) break;
  }
  if (!ctx.out.list.length) return null;
  ctx.out.list.forEach((s, i) => { s.id = i + 1; });
  ctx.out.seed = rng.int(1, 2147483646); // the battle's own dice for the bodies (sceneBattle)
  map.scenes = ctx.out;
  return map.scenes;
}

// ---------- the battle ----------
/**
 * The scenes' bodies and piles on the raid's battle (combat.js createRaid, after sleepers.js placeBodies): the dead as
 * b.corpses (with f; Sleepers at the battle's own share), the survivors as dead people with their body containers,
 * the piles as ground piles; b.raid.scenes keeps the list (the intro lines) and the pieces (the POI ledger).
 */
export function sceneBattle(b, map) {
  const S = map && map.scenes;
  if (!b || !b.raid || !S) return;
  const rng = new Rng(S.seed || 1);
  const inf = b.infection || 0, odds = Math.min(SLEEPER.ODDS_MAX, SLEEPER.ODDS + SLEEPER.ODDS_INF * inf);
  b.corpses = b.corpses || [];
  let cid = b.corpses.reduce((a, c) => Math.max(a, c.id || 0), 0) + 1, n = 0;
  for (const o of S.bodies) {
    if (!o.human) { b.corpses.push({ id: cid++, x: o.x, y: o.y, f: o.f, seed: Math.floor(o.r * 99999), sleeper: o.r < odds, scene: true }); continue; }
    const u = enemyUnit(b, rng, "survivors", 2, ++n);
    Object.assign(u, { side: "neutral", name: "A survivor", short: "S", x: o.x, y: o.y, f: o.f, away: o.f !== (b.floor || 0), dead: true, hp: 0, aware: false, reinforcement: true, restored: true, scene: true, face: [0, 1] });
    if (o.weapon) u.weapon = o.weapon;
    if (o.quiet) u.noPool = true; // ui/battlemarks.js: no pool of blood under a quiet death
    b.units.push(u);
    b.raid.containers.push({ id: b.nextId++, x: o.x, y: o.y, f: o.f, kind: "body", area: null, searched: false, kit: "survivors", weapon: u.weapon, label: "A survivor's body", uid: u.id, full: true });
  }
  for (const p of S.piles) b.raid.containers.push({ id: b.nextId++, x: p.x, y: p.y, f: p.f, kind: "ground", drop: false, area: p.area ?? null, searched: true, partial: false, label: p.label, scene: true, contents: { sup: { ...p.sup }, gear: [] } });
  b.raid.scenes = { list: S.list.map((s) => ({ ...s })), pieces: S.pieces.map((p) => ({ ...p })) };
}

// One of your people moved or starts their turn (combat.js, beside sleepers.js spotCheck): a scene's room in sight for
// the first time puts its sentence in the log.
const SEE = 8;
export function sceneSeen(b, u) {
  const L = b && b.raid && b.raid.scenes && b.raid.scenes.list;
  if (!L || !u || u.side !== "player") return;
  for (const s of L) {
    if (s.seen || s.f !== (u.f || 0) || (b.floor || 0) !== s.f || Math.max(Math.abs(u.x - s.x), Math.abs(u.y - s.y)) > SEE) continue;
    if (!los(b, u.x, u.y, s.x, s.y)) continue;
    s.seen = true;
    say(b, s.text, "info");
  }
}

// ---------- the point of interest's ledger (poicont.js) ----------
// The scene's pieces as they are now, where they changed (smashed to rubble or splinters, shoved away, boards torn
// down): [{ f, x, y, cell }] (the cell's own fields), for poi.cont.scenes[mapId].
const KEEP = ["k", "hp", "mhp", "moved", "frame", "under", "boards", "dk", "roll", "t", "tOpen", "held"];
export function sceneLedger(b) {
  const P = b && b.raid && b.raid.scenes && b.raid.scenes.pieces;
  if (!P) return null;
  const out = [];
  for (const p of P) {
    const cells = b.floors ? b.floors[p.f] && b.floors[p.f].cells : p.f === 0 ? b.cells : null;
    const c = cells && cells[p.y * b.w + p.x];
    if (!c) continue;
    const changed = c.k !== p.k || (p.k !== "rubble" && c.hp != null && c.mhp != null && c.hp < c.mhp);
    if (!changed) continue;
    const cell = {};
    for (const k of KEEP) if (c[k] !== undefined) cell[k] = JSON.parse(JSON.stringify(c[k]));
    out.push({ f: p.f, x: p.x, y: p.y, cell });
  }
  return out;
}
// A revisit: the pieces put back as the ledger kept them (combat.js createRaid → poicont.js poiRaidStart).
export function applySceneLedger(b, list) {
  if (!b || !Array.isArray(list) || !list.length) return 0;
  let n = 0;
  for (const o of list) {
    const cells = b.floors ? b.floors[o.f] && b.floors[o.f].cells : o.f === 0 ? b.cells : null;
    const c = cells && cells[o.y * b.w + o.x];
    if (!c || !o.cell) continue;
    for (const k of KEEP) delete c[k];
    Object.assign(c, JSON.parse(JSON.stringify(o.cell)));
    n++;
  }
  if (n) { if (b.losCache) b.losCache.fill(0); if (b.floors) for (const F of b.floors) if (F.losCache) F.losCache.fill(0); }
  return n;
}
// The hover words for blood on a cell (ui/combat.js).
export const bloodAt = (c) => (c && c.blood ? `<b>${c.blood.kind === "zombie" ? "Dark, old blood" : "Blood"}</b><span class="muted">: ${c.blood.amount >= 3 ? "a lot of it" : c.blood.amount === 2 ? "smeared" : "a few drops"}.</span>` : "");
