// @ts-check
// Bunkers (the user's request 2026-10-25, issue #26 of the interiors epic #7: "Add bunker buildings"): the military
// command bunker (Crashlanding's mountain bunker, bunker_mil, and a rare military site in any run), the government
// continuity bunker, the public fallout shelter and the prepper's bunker. Their plans (BUNKER_PLANS: buildingmaps.js
// BUILDINGS milbunker, govbunker, shelter, prepper call them), their rooms furnished for their kind on roomlayout.js's
// placement helpers (BUNKER_STYLES, by the plan leaf's bunker mark: lanes kept clear, backs to the walls, a door's
// front never taken, the lootable pieces the containers), and their signs of survival (registered with interiorscenes.js).
//
// Underground (the choice, recorded in docs/features/combat.md "Bunkers"): the engine's storeys, named down. A bunker's
// ground floor (f 0) is the Entrance level at the surface; its other floors are "Level −1", "Level −2" (spec.below:
// assemble's floor names), each the footprint's full size, reached by stair runs that join every level. The view still
// draws the active level raised as it draws any storey (ui/isoview.js liftOf is never negative: sinking it would need the
// outside ground and the building's wall mass drawn above the floor, left for later); the names, the rock and the dark
// say underground.
//   - Built into the ground: on the Entrance level most of the footprint is solid rock (a { role: "rock" } leaf: assemble
//     fills it with crag cells, "Mountainside", not a building's floor, so the view draws the hillside over it), and only
//     the portal shows: the blast door's hall, the airlock, the checkpoint, the guard post and the vehicle garage (the
//     military's), the shelter's stair kiosk, the prepper's shed. A vent stack stands on the rock (spec.vent). Round a
//     military or a government bunker (spec.rockFill) the outside is mountainside too, the approach to the portal left
//     open with a wire fence across it (spec.fence) and its gap at the road.
//   - No windows (spec.windows false); concrete and steel floors; the bunker wall colour (decor.js WALLC).
//   - Dark: every room of a bunker is a dark room (indoorlight.js: a.dark by the area's bunker mark) and its lights
//     work only once the generator runs (b.raid.genOn); starting the genset (the generator room's Military generator, a
//     real data-power.js genset_military when lifted; a prepper's battery rack) is an action (combat.js "genset"), loud
//     (Heat and noise) for a genset, quiet for the batteries, and it lights every room of the bunker.
//
// The plans (sizes at real-world scale, a cell a metre: BUNKER.SIZE; #24's size table was not on dev when this was built,
// so each size is one const here):
//   milbunker  Entrance level: rock either side; the garage on the vehicle ramp (a Humvee, fuel tank, a roller door: the
//              ramp's exit), the guard post, the portal column (the blast door's hall behind the blast door, the
//              decontamination airlock between two steel doors, the security checkpoint with the stairs down) and at the
//              back of that column the escape hatch (the stairs up from the levels below, the back exit). Below: the main
//              tunnel down the middle under the portal (both stair runs land in it) with side galleries: the command
//              centre, communications, the barracks gallery, the generator and plant room, the water store, the med bay,
//              a latrine; and (Level −2, or squeezed in on −1 in a two-level bunker) the armory behind its vault door, the
//              magazine, the mess, its kitchen, the ration store, quarters and the stores.
//   govbunker  the same portal (no garage: a security office), below a main corridor: the situation room, communications,
//              offices, a dormitory, the records vault (vault door), the generator room, the kitchen and the big pantry, a
//              small armory, a first-aid room.
//   shelter    a stair kiosk and an emergency hatch on the surface; below the entry hall, the bunk hall (rows of bunks
//              or cots), the ration store, the plant room (a generator, the hand-cranked filter), toilets, first aid.
//   prepper    a shed over the hatch; below the airlock (the ladder lands in it), the bunk room, the pantry (the richest
//              food per area in the game), the gun room (a gun safe, a radio console, the battery rack).
// Determinism and older saves: the plans are new kinds; nothing an older save holds changes (a saved bunker_mil site
// had no buildings, so its raid was the street map: a save from before this change opens the bunker's own map the next
// time, which is the fix the ticket asks for; its POI ledger had no containers).
import { hash01 } from "./skills.js";
import { registerScene, SCENES } from "./interiorscenes.js";
import { vehicleIn, CIVIC_STYLES } from "./civiclayout.js";

export const BUNKER = {
  // Footprints in cells (a cell is about a metre: data-furniture.js sizes), [min, max], outer walls included; levels.
  SIZE: {
    milbunker: { w: [60, 72], h: [30, 34], levels: [2, 3] },   // the issue's 60–120 × 30–60 m, 1–3 levels (2 at least: the galleries need them)
    govbunker: { w: [50, 60], h: [28, 32], levels: [2, 2] },
    shelter:   { w: [18, 26], h: [12, 16], levels: [2, 2] },   // 15–30 × 10–20 m
    prepper:   { w: [11, 14], h: [8, 9],   levels: [2, 2] },   // 6–15 × 4–8 m
  },
  CRASH_LEVELS: 3,      // Crashlanding's mountain bunker is always three levels deep
  BUNKS: 0.5,           // a shelter's bunk hall: cots rather than bunks this often
  SEALED: 0.3,          // a prepper's bunker sealed from inside (its shed door locked: interiorscenes "sealedhatch")
  TRAPPED: 0.3,         // a prepper's bunker booby-trapped (a bear trap in the airlock: "booby")
};
const ROCK = { role: "rock" };
const X = (...parts) => ({ split: "x", parts });
const Y = (...parts) => ({ split: "y", parts });
// A room: its role (buildingmaps.js ROLES), its style's mark, concrete underfoot (steel in the portal, the airlock and
// the plant room) and the bunker's own wall colour, a cold concrete grey (decor.js wallColour: room.wallc wins).
export const BUNKER_WALL = "#9c9e98";
const STEEL_FL = new Set(["portal", "airlock", "genroom", "prepairlock"]);
const R = (role, bunker, o = {}) => ({ role, bunker, fl: STEEL_FL.has(bunker) ? "steel" : "conc", wallc: BUNKER_WALL, ...o });
/** @param {any} rng @param {number[]} r */
const roll = (rng, r) => rng.int(r[0], r[1]);

// The portal column (military and government): the blast door's hall at the front (the entry: the blast door is the
// front door), the airlock, the checkpoint (its stairs down), rock, the escape hatch at the back.
const portalCol = () => Y([3, R("portal", "portal", { entry: true, name: "Blast door hall", dk: "steel" })], [2, R("airlock", "airlock", { name: "Decontamination airlock", dk: "steel" })],
  [2, R("checkpoint", "checkpoint", { hub: true, name: "Security checkpoint" })], ["*", ROCK], [3, R("hatch", "hatch", { name: "Escape hatch" })]);

function milbunker(rng, o = {}) {
  const S = BUNKER.SIZE.milbunker, bw = roll(rng, S.w), bh = roll(rng, S.h), iw = bw - 2;
  const n = o.levels || roll(rng, S.levels);
  const lr = Math.floor((iw - 23 - 4) / 2); // rock left of the portal block (garage 13, guard post 4, portal 6, the walls)
  const entrance = X([lr, ROCK], [13, Y([9, R("bays", "garage", { name: "Vehicle garage", type: "motorpool", maxBoxes: 3 })], ["*", ROCK])],
    [4, Y([4, R("office", "guardpost", { name: "Guard post", type: "barracks", maxBoxes: 1 })], ["*", ROCK])], [6, portalCol()], ["*", ROCK]);
  const tunnel = [6, R("tunnel", "tunnel", { hub: true, name: "Main tunnel" })];
  const cmd = [9, X(["*", R("control", "command", { name: "Command centre", type: "control" })], [11, R("control", "comms", { name: "Communications", type: "control" })])];
  const armory = (d) => [d, X(["*", R("armory", "armory", { lock: ["vault", 0.9], boxLock: ["cage", 0.5], gunSafe: ["gunsafe3", 0.4] })], [10, R("armory", "magazine", { name: "Magazine", lock: ["door", 0.5], boxLock: ["crate", 0.4] })])];
  const barracks = ["*", R("dorm", "barracks", { name: "Barracks gallery", type: "barracks", maxBoxes: 6 })];
  const plant = [8, R("genroom", "genroom", { name: "Generator and plant room", type: "motorpool" })];
  const water = [5, R("waterstore", "waterstore", { name: "Water store", type: "kitchen" })];
  const med = (d) => [d, R("medbay", "medbay", { name: "Med bay", type: "clinic" })];
  const mess = [9, R("mess", "mess", { name: "Mess" })], kitchen = [5, R("kitchen", "kitchen", { name: "Kitchen" })];
  const rations = [4, R("pantry", "rations", { name: "Ration store", type: "barracks", maxBoxes: 3 })];
  const stores = ["*", R("storage", "stores", { name: "Stores", type: "warehouse", maxBoxes: 5 })];
  const left = lr + 19; // the galleries left of the tunnel: the tunnel lies under the portal column
  const latrine = ["*", R("restroom", "latrine", { name: "Latrine" })];
  const quarters = ["*", X(["*", R("dorm", "quarters", { name: "Quarters", type: "barracks", maxBoxes: 3 })], [12, stores[1]])];
  const supply = ["*", R("storage", "stores", { name: "Supply room", type: "warehouse", maxBoxes: 3 })];
  const lower = n === 2
    ? [X([left, Y(cmd, armory(7), barracks)], tunnel, ["*", X(["*", Y(plant, water, med("*"))], ["*", Y(mess, kitchen, rations, stores)])])]
    : [X([left, Y(cmd, barracks)], tunnel, ["*", Y(plant, water, med(6), latrine)]),
      X([left, Y(armory(9), quarters)], tunnel, ["*", Y(mess, kitchen, rations, supply)])];
  return {
    bw, bh, front: { width: 2 }, ground: "rock", storeys: n, foot: "huge", below: true, windows: false, extraDoors: 0.05, rockFill: true, fence: true, vent: true,
    stairs: { roles: ["checkpoint", "hatch"], n: 2, len: 3 }, margins: { front: 8 },
    program: entrance, upper: (f) => lower[f - 1] || lower[lower.length - 1],
    exits: [{ side: "front", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.2, name: "Vehicle ramp" }, { side: "back", roles: ["hatch"], chance: 1, lock: 0, name: "Escape hatch" }],
  };
}
function govbunker(rng) {
  const S = BUNKER.SIZE.govbunker, bw = roll(rng, S.w), bh = roll(rng, S.h), iw = bw - 2;
  const lr = Math.floor((iw - 16 - 3) / 2);
  const entrance = X([lr, ROCK], [10, Y([6, R("office", "guardpost", { name: "Security office", type: "office", maxBoxes: 1 })], ["*", ROCK])], [6, portalCol()], ["*", ROCK]);
  const left = lr + 11;
  const sit = [9, X(["*", R("control", "situation", { name: "Situation room", type: "control" })], [10, R("control", "comms", { name: "Communications", type: "control" })])];
  const offices = [7, X(["*", R("office", "govoffice", { name: "Offices" })], ["*", R("office", "govoffice", { name: "Offices" })])];
  const dorm = ["*", R("dorm", "barracks", { name: "Dormitory", type: "house", maxBoxes: 4 })];
  const colA = ["*", Y([8, R("office", "vault", { name: "Records vault", lock: ["vault", 0.8], boxLock: ["safe", 0.4] })], [6, R("genroom", "genroom", { name: "Generator room", type: "motorpool" })],
    ["*", R("armory", "armory", { name: "Security armory", lock: ["vault", 0.7], boxLock: ["cage", 0.4], maxBoxes: 2 })])];
  const colB = ["*", Y([6, R("kitchen", "kitchen", { name: "Kitchen" })], [8, R("pantry", "rations", { name: "Pantry", type: "kitchen", maxBoxes: 4 })], ["*", R("medbay", "medbay", { name: "First aid", type: "nurse" })])];
  const level = X([left, Y(sit, offices, dorm)], [6, R("tunnel", "tunnel", { hub: true, name: "Main corridor" })], ["*", X(colA, colB)]);
  return {
    bw, bh, front: { width: 2 }, ground: "rock", storeys: 2, foot: "huge", below: true, windows: false, extraDoors: 0.05, rockFill: true, fence: true, vent: true,
    stairs: { roles: ["checkpoint", "hatch"], n: 2, len: 3 }, margins: { front: 8 },
    program: entrance, upper: () => level,
    exits: [{ side: "back", roles: ["hatch"], chance: 1, lock: 0, name: "Escape hatch" }],
  };
}
function shelter(rng) {
  const S = BUNKER.SIZE.shelter, bw = roll(rng, S.w), bh = roll(rng, S.h), iw = bw - 2;
  const lr = Math.floor((iw - 6 - 2) / 2);
  const entrance = X([lr, ROCK], [6, Y([4, R("portal", "stairhead", { entry: true, name: "Shelter entrance", hub: true })], ["*", ROCK], [3, R("hatch", "hatch", { name: "Emergency hatch" })])], ["*", ROCK]);
  const cots = hash01(rng.state, "cots") < BUNKER.BUNKS;
  const level = X([lr, Y([4, R("restroom", "latrine", { name: "Toilets" })], ["*", R("dorm", "bunkhall", { name: "Bunk hall", type: "house", cots, maxBoxes: 3 })])],
    [6, R("tunnel", "tunnel", { hub: true, name: "Entry hall" })],
    ["*", Y([4, R("medbay", "firstaid", { name: "First aid", type: "nurse", maxBoxes: 1 })], [4, R("genroom", "genroom", { name: "Plant room", type: "motorpool", maxBoxes: 1 })], ["*", R("pantry", "rations", { name: "Ration store", type: "kitchen", maxBoxes: 4 })])]);
  return {
    bw, bh, front: { width: 1 }, ground: "town", storeys: 2, foot: "medium", below: true, windows: false, extraDoors: 0, vent: true,
    stairs: { roles: ["stairhead", "hatch"], n: 2, len: 3 },
    program: entrance, upper: () => level,
    exits: [{ side: "back", roles: ["hatch"], chance: 1, lock: 0.3, name: "Emergency hatch" }],
  };
}
function prepper(rng) {
  const S = BUNKER.SIZE.prepper, bw = roll(rng, S.w), bh = roll(rng, S.h);
  const entrance = X(["*", ROCK], [5, Y([3, R("hatch", "shed", { entry: true, name: "Shed", hub: true, type: "garage", maxBoxes: 1 })], ["*", ROCK])], [1, ROCK]);
  const level = X(["*", Y(["*", R("bunk", "prepbunks", { name: "Bunk room", type: "cabin", maxBoxes: 2 })], [3, R("pantry", "preppantry", { name: "Pantry", type: "cabin", maxBoxes: 4 })])],
    [5, Y([3, R("airlock", "prepairlock", { name: "Airlock", hub: true, dk: "steel" })], ["*", R("gunroom", "prepguns", { name: "Gun room", gunSafe: ["gunsafe2", 0.8], maxBoxes: 2 })])], [1, ROCK]);
  return {
    bw, bh, front: { width: 1 }, ground: "farm", storeys: 2, foot: "small", below: true, windows: false, extraDoors: 0,
    stairs: { roles: ["hatch"], n: 1, len: 2 },
    program: entrance, upper: () => level, exits: [],
  };
}
/** The archetype makers (buildingmaps.js BUILDINGS). opts.levels: a fixed count (Crashlanding's bunker). */
export const BUNKER_PLANS = { milbunker, govbunker, shelter, prepper };
export const BUNKER_KEYS = Object.keys(BUNKER_PLANS);
export const isBunker = (key) => BUNKER_KEYS.includes(key);
// A level's name: the Entrance level at the surface, then Level −1, −2 ... going down (assemble's floorName).
export const levelName = (f) => (f === 0 ? "Entrance level" : `Level −${f}`);

// ======================================================================================
// The rooms (BUNKER_STYLES, by the plan leaf's bunker mark)
// ======================================================================================
/** @typedef {any} Lay */
const OPP = { n: "s", s: "n", w: "e", e: "w" };
// A row of bunks along the walls, a footlocker beside each (a container up to the room's share, plain after).
function bunkRows(L, k = "bunk", most = 12) {
  let n = 0;
  for (let i = 0; i < most; i++) {
    const b = L.wall(k, { prefer: "corner" });
    if (!b) break;
    n++;
    L.beside(b, "footlocker", { plain: L.boxes() >= L.target() });
  }
  for (let i = 0; i < most - n; i++) if (!L.centre(k)) break; // a second row down the middle where the walls are full
  return n;
}
function tableSet(L, chairs = 4) {
  const t = L.centre("table");
  if (t) L.around(t, "chair", chairs);
  return t;
}
function kitchenRun(L) {
  const ws = L.walls();
  if (!ws.length) return;
  L.run(["range", "counter", "sink", "counter", "freezer"], ws.slice(0, 2).map((w) => w.side));
  for (const k of ["range", "sink"]) if (!L.has(k)) L.need(k);
}
// The blast door's frame: steel either side of the front door, inside.
function blastFrame(L) {
  const c = L.c;
  const doors = (L.room.doors || []).filter(([, y]) => y === c.y1 + 1);
  if (!doors.length) return;
  const xs = doors.map(([x]) => x);
  for (const x of [Math.min(...xs) - 1, Math.max(...xs) + 1]) L.place("blastframe", [[x, c.y1]], { face: "n", force: true });
}
export const BUNKER_STYLES = {
  // ---------- the portal ----------
  portal(L) { blastFrame(L); L.wall("locker", { prefer: "corner" }); },
  airlock(L) {
    L.wall("deconshower", { sides: ["w"] }) || L.need("deconshower");
    L.wall("deconshower", { sides: ["e"] });
    L.wall("hazmatrack", { prefer: "corner" }) || L.need("hazmatrack");
  },
  checkpoint(L) {
    const desk = L.wall("counter", { prefer: "middle" });
    if (desk) L.around(desk, "chair", 1);
    L.wall("locker", { prefer: "corner" });
  },
  guardpost(L) {
    const d = L.wall("desk", { prefer: "corner" });
    if (d) L.around(d, "chair", 1);
    L.wall("radioconsole", { prefer: "corner" });
    L.fill(["footlocker"]);
  },
  garage(L) {
    vehicleIn(L, { kind: "truck", len: 4, body: "humvee", box: "humvee" });
    L.wall("fueltank", { prefer: "corner" });
    L.wall("toolchest", { prefer: "corner" });
    L.fill(["crate"]);
  },
  hatch(L) { L.wall("escapeladder", { prefer: "corner" }) || L.need("escapeladder"); },
  tunnel(L) { L.wall("crate", { prefer: "corner", plain: true }); },
  // ---------- the galleries ----------
  command(L) {
    L.centre("maptable") || L.need("maptable");
    for (let i = 0; i < 3; i++) if (!L.wall("screens", { prefer: "middle" })) break;
    L.wall("radioconsole", { prefer: "corner" }) || L.need("radioconsole");
    L.wall("radioconsole", { prefer: "corner" });
    const d = L.wall("desk", { prefer: "corner" });
    if (d) L.around(d, "chair", 1);
    L.fill(["filing"]);
  },
  situation(L) { BUNKER_STYLES.command(L); },
  comms(L) {
    for (let i = 0; i < 3; i++) if (!L.wall("radioconsole", { prefer: "corner" })) break;
    if (!L.has("radioconsole")) L.need("radioconsole");
    L.wall("serverrack", { prefer: "corner" });
    L.wall("screens", { prefer: "middle" });
    L.fill(["serverrack"]);
  },
  barracks(L) { bunkRows(L, "bunk", 14); },
  quarters(L) {
    const b = L.wall("bed", { prefer: "corner" });
    if (b) L.beside(b, "footlocker");
    const d = L.wall("desk", { prefer: "corner" });
    if (d) L.around(d, "chair", 1);
    bunkRows(L, "bunk", 4);
  },
  armory(L) {
    for (let i = 0; i < 6; i++) if (L.boxes() >= L.target() || !L.wall("gunrack", { prefer: "corner" })) break;
    if (!L.has("gunrack")) L.need("gunrack");
    L.wall("ammocab", { prefer: "corner" });
    L.wall("locker", { prefer: "corner" }); // the gun safe may take it (locks.js placeGunSafes)
  },
  magazine(L) {
    L.wall("ammocab", { prefer: "corner" }) || L.need("ammocab");
    L.fill(["ammocab", "crate"]);
  },
  mess(L) {
    L.wall("counter", { prefer: "middle" });
    for (let i = 0; i < 3; i++) if (!tableSet(L, 4)) break;
  },
  kitchen(L) { kitchenRun(L); L.fill(["cabinet"]); },
  rations(L) {
    L.wall("rationshelf", { prefer: "corner" }) || L.need("rationshelf");
    L.fill(["rationshelf", "crate"]);
  },
  stores(L) { L.fill(["rationshelf", "crate", "rack"]); },
  medbay(L) {
    for (let i = 0; i < 3; i++) { const b = L.wall("hospbed", { prefer: "corner" }); if (!b) break; L.beside(b, "ivstand"); }
    L.wall("medcab", { prefer: "corner" }) || L.need("medcab");
    L.fill(["medcab"]);
  },
  firstaid(L) { L.wall("cot", { prefer: "corner" }); L.wall("medcab", { prefer: "corner" }) || L.need("medcab"); },
  genroom(L) {
    L.need("genset", { prefer: "corner" });
    L.wall("fueltank", { prefer: "corner" });
    L.wall("airfilter", { prefer: "middle" });
    L.wall("handfilter", { prefer: "corner" });
    L.fill(["toolchest"]);
  },
  waterstore(L) {
    for (let i = 0; i < 4; i++) if (!L.wall("watertank", { prefer: "corner" })) break;
    if (!L.has("watertank")) L.need("watertank");
    L.fill(["crate"]);
  },
  latrine(L) { CIVIC_STYLES.washroom(L); L.wall("toilet", { prefer: "corner" }); },
  vault(L) {
    L.wall("deposit", { prefer: "corner" });
    L.fill(["filing", "deposit"]);
  },
  govoffice(L) {
    for (let i = 0; i < 2; i++) { const d = L.centre("desk"); if (!d) break; L.around(d, "chair", 1); }
    L.wall("copier", { prefer: "corner" });
    L.fill(["filing", "bookshelf"]);
  },
  // ---------- the fallout shelter ----------
  stairhead() {},
  bunkhall(L) { bunkRows(L, L.room.cots ? "cot" : "bunk", 16); L.wall("handfilter", { prefer: "corner" }); },
  // ---------- the prepper's bunker ----------
  shed(L) { L.fill(["toolchest"]); },
  prepairlock(L) { L.wall("hazmatrack", { prefer: "corner" }); },
  prepbunks(L) { bunkRows(L, "bunk", 2); L.wall("handfilter", { prefer: "corner" }); },
  preppantry(L) { L.fill(["rationshelf"]); L.wall("watertank", { prefer: "corner" }); },
  prepguns(L) {
    L.wall("gunrack", { prefer: "corner" }) || L.need("gunrack");
    L.wall("radioconsole", { prefer: "corner" }) || L.need("radioconsole");
    L.wall("batteries", { prefer: "corner" }) || L.need("batteries");
    L.wall("locker", { prefer: "corner" }); // the gun safe's place
  },
};
// The bunker style for a room (buildingmaps.js assemble): its plan leaf's bunker mark. null: none.
/** @param {any} room */
export function bunkerStyle(room) {
  return room && room.bunker && BUNKER_STYLES[room.bunker] ? BUNKER_STYLES[room.bunker] : null;
}
// The power piece that lights a bunker (combat.js "genset"): a genset (loud) or a prepper's battery rack (quiet).
export const POWER_PIECES = { genset: { loud: true, name: "generator" }, batteries: { loud: false, name: "battery rack" } };

// ======================================================================================
// The bunkers' signs of survival (interiorscenes.js registerScene; their own dice there, only on a bunker's map):
//   sealed      the blast door shut with people inside: a gallery behind a locked steel door (the barracks, the
//               quarters, the dormitory), its people dead in their bunks, or alive (area.scene.alive: floorfolk.js's
//               survivors hold it first);
//   bitten      a shelter overrun from within: one of them was bitten, the bunk hall's cots kicked over, bodies by
//               them and two or three of the dead among them, one a Sleeper sometimes;
//   laststand   a prepper's last stand: brass behind the gun room's door, the prepper's body with their kit, the dead
//               at the foot of the ladder;
//   lastlog     the command centre's (or the situation room's) last log entry, open on the map table: its sentence the
//               note you read when you see the room;
//   sealedhatch a prepper's shed door locked from inside (SEALED of them);
//   booby       a prepper's airlock booby-trapped (a bear trap: combat.js's trap cell beartrap on its floor, TRAPPED of them).
// ======================================================================================
const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const bunkerRooms = (ctx, marks) => ctx.rng.shuffle(ctx.rooms.filter((r) => marks.includes(r.bunker) && !r.scene && !r.locked));
const nearest = (cells, x, y) => cells.slice().sort((p, q) => Math.hypot(p[0] - x, p[1] - y) - Math.hypot(q[0] - x, q[1] - y));
const lower = (r) => String(r.name || "room").replace(/ \d+$/, "").toLowerCase();
function sealed(ctx) {
  const { rng } = ctx;
  for (const r of bunkerRooms(ctx, ["barracks", "quarters"])) {
    const f = r.f || 0, ds = r.doors || [];
    if (ds.length !== 1 || !f) continue;
    const [dx, dy] = ds[0], door = ctx.at(f, dx, dy);
    if (!door || !["idoor", "odoor"].includes(door.k)) continue;
    const free = ctx.freeIn(r);
    if (free.length < 3) continue;
    door.k = "door"; door.dk = "steel"; door.hp = door.mhp = 160; // a locked steel door holds as any locked door (buildingmaps.js BMAP.DOOR.locked)
    ctx.take(f, dx, dy);
    if (ctx.map.lockedDoors) ctx.map.lockedDoors.push({ x: dx, y: dy, f, area: r.id, kind: "door", dk: "steel" });
    if (rng.chance(SCENES.ALIVE)) return ctx.done("sealed", r, dx, dy, `The ${lower(r)} is sealed from inside: someone is still behind the steel door.`, { alive: true });
    const spots = nearest(free, r.x0 + r.w / 2, r.y0 + r.h / 2);
    const n = Math.min(spots.length, rng.int(2, 4));
    for (const [x, y] of spots.slice(0, n)) ctx.body(f, x, y, { human: true, quiet: true, kit: "soldiers" });
    return ctx.done("sealed", r, dx, dy, `They sealed themselves into the ${lower(r)} and waited: ${n} of them are still there.`);
  }
  return null;
}
function bitten(ctx) {
  const { rng } = ctx;
  for (const r of bunkerRooms(ctx, ["bunkhall"])) {
    const f = r.f || 0, free = ctx.freeIn(r);
    if (free.length < 5) continue;
    const spots = rng.shuffle(free);
    const people = rng.int(2, 4), dead = rng.int(2, 3);
    for (let i = 0; i < people; i++) { const [x, y] = spots.shift(); ctx.body(f, x, y, { human: true }); ctx.splatter(f, x, y, "human", rng.int(2, 3)); }
    for (let i = 0; i < dead && spots.length; i++) { const [x, y] = spots.shift(); ctx.body(f, x, y, { sleeper: i === 0 && rng.chance(0.4) }); ctx.blood(f, x, y, "zombie", 1); }
    if (spots.length) { const [x, y] = spots.shift(); ctx.piece(f, x, y, "cot"); }
    const [cx, cy] = free[0];
    return ctx.done("bitten", r, cx, cy, "The shelter was overrun from within: one of them was bitten and nobody knew. Cots kicked over, and the dead lying among the people they were.");
  }
  return null;
}
function lastStand(ctx) {
  const { rng } = ctx;
  for (const r of bunkerRooms(ctx, ["prepguns"])) {
    const f = r.f || 0, free = ctx.freeIn(r);
    if (free.length < 2) continue;
    const d = (r.doors || [])[0];
    const [bx, by] = d ? nearest(free, d[0], d[1]).reverse()[0] : free[0];
    ctx.body(f, bx, by, { human: true, kit: "survivors", name: "The prepper" });
    ctx.splatter(f, bx, by, "human", 2);
    for (const [x, y] of nearest(free.filter(([x, y]) => x !== bx || y !== by), bx, by).slice(0, 2)) { const c = ctx.at(f, x, y); c.brass = rng.int(SCENES.BRASS[0], SCENES.BRASS[1]); }
    const lock = ctx.rooms.find((q) => q.bunker === "prepairlock" && (q.f || 0) === f);
    let placed = 0;
    if (lock) for (const [x, y] of ctx.freeIn(lock).slice(0, rng.int(1, 3))) { ctx.body(f, x, y, {}); ctx.blood(f, x, y, "zombie", 1); placed++; }
    return ctx.done("laststand", r, bx, by, `The prepper made a last stand in the gun room: spent brass round the body${placed ? `, ${placed} of the dead in the airlock` : ""}.`);
  }
  return null;
}
function lastLog(ctx) {
  for (const r of bunkerRooms(ctx, ["command", "situation"])) {
    const f = r.f || 0;
    const table = ctx.inner(r).find(([x, y]) => (ctx.at(f, x, y) || {}).k === "maptable") || ctx.freeIn(r)[0];
    if (!table) continue;
    const near = NEXT4.map(([dx, dy]) => [table[0] + dx, table[1] + dy]).find(([x, y]) => ctx.free(f, x, y));
    if (near) { const c = ctx.at(f, near[0], near[1]); c.deco = { k: "papers", v: 0 }; ctx.take(f, near[0], near[1]); }
    const day = 30 + Math.floor(ctx.rng.next() * 600);
    const lines = [
      `Day ${day}. Generator on reserve. Surface teams have not reported. Doors stay shut.`,
      `Day ${day}. No answer on any net. We hold here until relieved. Nobody opens the blast door.`,
      `Day ${day}. Two of the decon team turned in the airlock. Sealed it. God help us.`,
    ];
    return ctx.done("lastlog", r, table[0], table[1], `The last entry in the duty log, open on the map table: "${ctx.rng.pick(lines)}"`);
  }
  return null;
}
function sealedHatch(ctx) {
  if (!ctx.rng.chance(BUNKER.SEALED)) return null;
  for (const r of bunkerRooms(ctx, ["shed"])) {
    const d = (r.doors || []).find(([x, y]) => ctx.exit(x, y, 0));
    if (!d) continue;
    const c = ctx.at(0, d[0], d[1]);
    if (!c || !["idoor", "odoor"].includes(c.k)) continue;
    c.k = "door"; c.dk = "steel"; c.hp = c.mhp = 160;
    ctx.take(0, d[0], d[1]);
    if (ctx.map.lockedDoors) ctx.map.lockedDoors.push({ x: d[0], y: d[1], f: 0, area: null, kind: "door", dk: "steel", exit: true });
    return ctx.done("sealedhatch", r, d[0], d[1], "The shed is locked from inside: whoever went down the hatch meant to stay there.");
  }
  return null;
}
function booby(ctx) {
  if (!ctx.rng.chance(BUNKER.TRAPPED)) return null;
  for (const r of bunkerRooms(ctx, ["prepairlock"])) {
    const f = r.f || 0, free = ctx.freeIn(r);
    if (!free.length) continue;
    const [x, y] = ctx.rng.pick(free);
    ctx.at(f, x, y).k = "beartrap"; // combat.js's trap cells (CELL.beartrap: trap "beartrap"), set in the airlock's floor
    ctx.take(f, x, y);
    return ctx.done("booby", r, x, y, "A bear trap set in the airlock's floor: the prepper did not want visitors.");
  }
  return null;
}
// Only on a bunker's map (when).
const isBunkerMap = (ctx) => ctx.rooms.some((r) => !!r.bunker);
registerScene("sealed", { w: 4, place: sealed, kinds: ["milbunker", "govbunker"], when: isBunkerMap });
registerScene("lastlog", { w: 4, place: lastLog, kinds: ["milbunker", "govbunker"], when: isBunkerMap });
registerScene("bitten", { w: 6, place: bitten, kinds: ["shelter"], when: isBunkerMap });
registerScene("laststand", { w: 4, place: lastStand, kinds: ["prepper"], when: isBunkerMap });
registerScene("sealedhatch", { w: 3, place: sealedHatch, kinds: ["prepper"], when: isBunkerMap });
registerScene("booby", { w: 3, place: booby, kinds: ["prepper"], when: isBunkerMap });
