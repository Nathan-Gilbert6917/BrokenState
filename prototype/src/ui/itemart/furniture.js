// Furniture at the base (#20; sim/furniture.js, sim/data-basefurniture.js): the found pieces' item forms (#8's
// data-furniture.js FURNITURE_GEAR f_<kind>), each seen from the front: a wood or steel body, its doors, drawers,
// shelves or cushions.
import { R, H, V, line, oval, box, disc, ring } from "./kit.js";

const WOOD = "#8a5a30", WOODL = "#a06a3a", WOODD = "#5f3c20", STEEL = "#8a949c", STEELD = "#5e666d", GREY = "#6a7178";
const legs = (p, x0, x1, y0, y1, c) => { V(p, x0, y0, y1, c); V(p, x1, y0, y1, c); };

// ---------- storage ----------
function f_shelf(p) { // a steel shelving unit: four shelves, tins and boxes on them
  legs(p, 2, 13, 0, 15, STEELD);
  for (const y of [2, 6, 10, 14]) H(p, 2, 13, y, STEEL);
  R(p, 4, 0, 6, 1, "#c8402f"); R(p, 8, 4, 11, 5, "#b8a27a"); R(p, 4, 8, 5, 9, "#3a6fb0"); R(p, 9, 12, 12, 13, "#4f8a3a");
}
function f_locker(p) { // a bank of grey lockers: three tall doors, vents at the top, handles
  box(p, 1, 0, 14, 15, "#5f7a8a");
  for (const x of [5, 10]) V(p, x, 0, 15, "#3f5662");
  for (const x of [2, 6, 11]) { H(p, x, x + 2, 2, "#3f5662"); H(p, x, x + 2, 4, "#3f5662"); p.set(x + 2, 8, "#c9ced3"); }
}
function f_cabinet(p) { // a wooden cupboard: two doors, two knobs, a plinth
  box(p, 2, 1, 13, 13, WOOD); V(p, 7, 2, 12, WOODD); R(p, 3, 3, 6, 11, WOODL); R(p, 8, 3, 12, 11, WOODL);
  p.set(6, 7, "#d9b13b"); p.set(8, 7, "#d9b13b"); H(p, 2, 13, 14, WOODD);
}
function f_counter(p) { // a kitchen counter: a pale worktop over drawers and a cupboard
  R(p, 0, 3, 15, 4, "#d8d4c8"); H(p, 0, 15, 3, "#efece2"); box(p, 1, 5, 14, 14, "#c9b48a");
  H(p, 2, 6, 7, "#957f58"); H(p, 2, 6, 10, "#957f58"); V(p, 8, 5, 14, "#957f58"); p.set(11, 9, GREY);
}
function f_crate(p) { // a slatted wooden crate, nailed corners
  box(p, 1, 3, 14, 14, "#b07a48"); for (const y of [6, 9, 12]) H(p, 2, 13, y, "#7a5230");
  line(p, 2, 4, 13, 13, "#8a5a30"); for (const [x, y] of [[2, 4], [13, 4], [2, 13], [13, 13]]) p.set(x, y, "#3a3a3a");
}
function f_rack(p) { // warehouse shelving: orange uprights, blue beams, pallets of boxes
  legs(p, 1, 14, 0, 15, "#d9772a"); for (const y of [5, 11]) H(p, 1, 14, y, "#3a6fb0");
  R(p, 3, 1, 12, 4, "#b8a27a"); R(p, 3, 7, 7, 10, "#b8a27a"); R(p, 9, 8, 12, 10, "#c9bf9f"); H(p, 2, 13, 15, "#7a5230");
}
function f_filing(p) { // a four-drawer filing cabinet, a label and a pull on each drawer
  box(p, 3, 0, 12, 15, "#9aa1a8");
  for (const y of [3, 7, 11]) H(p, 4, 11, y, "#6f777e");
  for (const y of [1, 5, 9, 13]) { R(p, 6, y, 9, y, "#e8e0c8"); H(p, 7, 8, y + 1, "#4a5056"); }
}
function f_bookshelf(p) { // a wooden bookshelf, rows of coloured spines
  box(p, 1, 0, 14, 15, WOODD); const cols = ["#c8402f", "#3a6fb0", "#4f8a3a", "#e6c23a", "#7a4f9a", "#e8e0c8"];
  for (const [y, k] of [[1, 0], [6, 2], [11, 4]]) { for (let x = 2; x <= 13; x++) V(p, x, y, y + 3, cols[(x + k) % cols.length]); H(p, 2, 13, y + 4, WOODL); }
}
function f_wardrobe(p) { // a tall wardrobe: two doors, a carved top, two handles
  R(p, 1, 0, 14, 1, WOODD); box(p, 2, 2, 13, 15, "#7a4a28"); V(p, 7, 2, 15, WOODD);
  R(p, 3, 4, 6, 13, "#8a5a30"); R(p, 8, 4, 12, 13, "#8a5a30"); V(p, 6, 8, 9, "#d9b13b"); V(p, 8, 8, 9, "#d9b13b");
}
function f_dresser(p) { // a chest of drawers: three wide drawers, two knobs each, short legs
  box(p, 1, 2, 14, 13, "#a06a3a");
  for (const y of [5, 9]) H(p, 2, 13, y, WOODD);
  for (const y of [3, 7, 11]) { p.set(4, y, "#d9b13b"); p.set(11, y, "#d9b13b"); }
  legs(p, 2, 13, 14, 15, WOODD);
}
function f_nightstand(p) { // a bedside table: one drawer, a lamp on top
  box(p, 4, 7, 11, 15, "#a06a3a"); H(p, 5, 10, 10, WOODD); p.set(8, 9, "#d9b13b");
  R(p, 6, 2, 9, 4, "#e6c23a"); V(p, 7, 5, 6, GREY); H(p, 6, 9, 6, GREY);
}
function f_tvstand(p) { // a low TV stand with a dead set on it
  box(p, 0, 10, 15, 14, WOODD); V(p, 7, 11, 13, "#3a2414"); legs(p, 1, 14, 15, 15, "#3a2414");
  box(p, 3, 1, 12, 8, "#202226"); R(p, 4, 2, 11, 7, "#383b41"); H(p, 6, 9, 9, "#202226");
}
function f_medcab(p) { // a white medicine cabinet: a mirror door, a red cross
  box(p, 2, 1, 13, 14, "#eef0f2"); R(p, 4, 3, 11, 12, "#b8d6e4"); line(p, 5, 11, 8, 4, "#e2f0f6");
  R(p, 7, 5, 8, 10, "#c8402f"); R(p, 5, 7, 10, 8, "#c8402f");
}
function f_vending(p) { // a vending machine: red cabinet, a glass front of rows of cans, the coin slot
  box(p, 1, 0, 14, 15, "#c8402f"); R(p, 2, 2, 9, 12, "#202226");
  for (const y of [3, 6, 9]) for (let x = 3; x <= 8; x += 2) R(p, x, y, x, y + 1, ["#e6c23a", "#4fb3c2", "#4f8a3a"][(x + y) % 3]);
  R(p, 11, 3, 12, 6, "#c9ced3"); R(p, 2, 13, 9, 14, "#8e2a20");
}
function f_checkout(p) { // a shop checkout: a counter, a till with its screen, a belt
  box(p, 0, 8, 15, 15, "#5a6470"); R(p, 0, 7, 15, 7, "#1f1f22");
  box(p, 9, 2, 14, 6, "#383b41"); R(p, 10, 3, 13, 4, "#6fe08a"); R(p, 2, 5, 6, 6, "#c9ced3");
}
function f_displaycase(p) { // a glass display case: a wooden base, glass top, rings and watches inside
  box(p, 0, 10, 15, 15, WOOD); R(p, 1, 3, 14, 9, "#9ed0e0"); H(p, 1, 14, 3, "#d4ecf4"); V(p, 1, 3, 9, "#d4ecf4");
  for (const x of [3, 7, 11]) { p.set(x, 7, "#d9b13b"); p.set(x + 1, 7, "#f2d36a"); p.set(x, 8, "#c9ced3"); }
}
function f_toolchest(p) { // a red rolling tool chest: five drawers, chrome pulls, casters
  box(p, 2, 0, 13, 13, "#c8402f");
  for (const y of [2, 5, 8, 11]) { H(p, 3, 12, y, "#8e2a20"); H(p, 6, 9, y - 1, "#c9ced3"); }
  for (const x of [3, 12]) R(p, x, 14, x, 15, "#1f1f22");
}
function f_gunrack(p) { // a wall rack: three long guns standing in it, the lock bar across
  box(p, 0, 12, 15, 15, WOOD); R(p, 0, 0, 15, 1, WOODD);
  for (const x of [3, 7, 11]) { V(p, x, 2, 11, "#2a2d33"); R(p, x - 1, 9, x, 13, "#6a4224"); }
  H(p, 0, 15, 6, "#9aa1a8");
}
function f_schooldesk(p) { // a school desk: a slanted lid on steel legs, a chair joined on
  line(p, 1, 6, 9, 4, "#c9a46a"); H(p, 1, 9, 7, "#a07a48"); legs(p, 2, 8, 8, 15, STEEL);
  R(p, 11, 9, 14, 10, "#3a6fb0"); V(p, 14, 3, 9, "#3a6fb0"); legs(p, 11, 14, 11, 15, STEEL);
}
// ---------- comfort ----------
function f_sofa(p) { // a three-seat sofa: a high back, three cushions, rolled arms
  box(p, 1, 3, 14, 8, "#5f7a4a"); R(p, 0, 6, 1, 13, "#4f6a3a"); R(p, 14, 6, 15, 13, "#4f6a3a");
  for (const x of [2, 6, 10]) box(p, x, 9, x + 3, 12, "#6f8a5a"); legs(p, 1, 14, 14, 15, WOODD);
}
function f_armchair(p) { // a deep armchair: a wing back, a fat seat cushion, round arms
  box(p, 3, 1, 12, 9, "#8a3a4a"); R(p, 1, 6, 3, 13, "#6e2a3a"); R(p, 12, 6, 14, 13, "#6e2a3a");
  box(p, 4, 9, 11, 12, "#a04a5a"); legs(p, 2, 13, 14, 15, WOODD);
}
function f_chair(p) { // a plain wooden chair, side on: a slatted back, the seat, four legs
  V(p, 4, 0, 15, WOOD); for (const y of [2, 5]) H(p, 4, 7, y, WOODL);
  R(p, 4, 8, 12, 9, WOODL); V(p, 12, 10, 15, WOOD); V(p, 6, 10, 15, WOODD);
}
function f_barstool(p) { // a tall bar stool: a round red seat on a chrome post, a foot ring
  oval(p, 3, 2, 12, 4, "#c8402f"); H(p, 4, 12, 2, "#e2654f"); V(p, 7, 5, 15, "#c9ced3"); V(p, 8, 5, 15, "#9aa1a8");
  H(p, 4, 11, 10, "#9aa1a8"); H(p, 4, 11, 15, "#7d858c");
}
function f_piano(p) { // an upright piano: a dark case, the keyboard, the music stand
  box(p, 1, 0, 14, 15, "#2a1a10"); R(p, 2, 7, 13, 9, "#eef0f2");
  for (let x = 3; x <= 12; x += 2) V(p, x, 7, 8, "#202226");
  R(p, 4, 2, 11, 4, "#4a3020"); legs(p, 2, 13, 12, 15, "#1a0f08");
}
function f_pew(p) { // a church pew, side on: a long bench and its tall back, carved ends
  R(p, 0, 9, 15, 10, WOOD); R(p, 0, 2, 15, 3, WOODL); V(p, 0, 2, 15, WOODD); V(p, 15, 2, 15, WOODD);
  for (const x of [4, 8, 11]) V(p, x, 4, 8, WOOD); H(p, 1, 14, 13, WOODD);
}
// ---------- decor (#13's kinds) ----------
function f_plant(p) { // a potted plant: a terracotta pot, a spray of leaves
  box(p, 5, 10, 10, 15, "#b06a46"); H(p, 4, 11, 10, "#c98a64");
  for (const [x0, y0, x1, y1] of [[7, 9, 3, 2], [8, 9, 12, 1], [7, 9, 7, 0], [8, 9, 14, 6], [7, 9, 1, 6]]) line(p, x0, y0, x1, y1, "#5f9a3c");
  R(p, 5, 4, 10, 7, "#4f8a3a");
}
function f_floorlamp(p) { // a standing lamp: a cream shade, a thin brass pole, a round foot
  R(p, 4, 0, 11, 4, "#efe6d2"); H(p, 3, 12, 5, "#d8cdb2"); V(p, 7, 6, 14, "#b8952a"); V(p, 8, 6, 14, "#d9b13b"); H(p, 4, 11, 15, "#8a7244");
}
function f_painting(p) { // a framed landscape: a gilt frame, sky, hills, a sun
  box(p, 0, 1, 15, 14, "#a8842a"); R(p, 2, 3, 13, 8, "#5f93cf"); R(p, 2, 9, 13, 12, "#4f8a3a");
  line(p, 2, 9, 7, 6, "#356127"); line(p, 7, 6, 13, 9, "#356127"); R(p, 10, 4, 11, 5, "#f2d36a");
}
function f_wallclock(p) { // a round wall clock: a white face, the hours, two hands
  oval(p, 1, 1, 14, 14, "#563820"); oval(p, 3, 3, 12, 12, "#eef0f2");
  for (const [x, y] of [[7, 3], [12, 7], [7, 12], [3, 7]]) p.set(x, y, "#202226");
  V(p, 7, 4, 7, "#202226"); H(p, 7, 10, 7, "#c8402f");
}
// ---------- work ----------
function f_table(p) { // a kitchen table: a plank top, four legs, a cloth runner
  R(p, 0, 5, 15, 7, WOODL); H(p, 0, 15, 5, "#b98a58"); legs(p, 1, 14, 8, 15, WOOD); legs(p, 4, 11, 8, 13, WOODD);
  R(p, 5, 4, 10, 5, "#e8e0c8");
}
function f_desk(p) { // an office desk: a top, a drawer pedestal at the right, a lamp
  R(p, 0, 6, 15, 7, "#7a5230"); box(p, 10, 8, 15, 15, "#7a5230"); H(p, 10, 15, 11, WOODD); V(p, 1, 8, 15, WOODD);
  V(p, 3, 1, 5, GREY); R(p, 2, 0, 5, 1, "#3a6fb0");
}
function f_teacherdesk(p) { // a teacher's desk: a wide grey steel desk, a modesty panel, books and an apple on it
  box(p, 0, 6, 15, 15, "#7d858c"); R(p, 2, 8, 13, 13, "#6a7178");
  R(p, 2, 3, 6, 5, "#c8402f"); R(p, 3, 2, 7, 2, "#3a6fb0"); oval(p, 11, 3, 13, 5, "#c8402f");
}
function f_workbench(p) { // a heavy workbench: a thick top, a vice at the left, a shelf below, tools hung
  R(p, 0, 5, 15, 7, "#a06a3a"); box(p, 1, 2, 4, 4, "#5e666d"); legs(p, 1, 14, 8, 15, WOODD); H(p, 1, 14, 12, WOOD);
  V(p, 9, 0, 3, "#9aa1a8"); V(p, 12, 0, 3, "#c8402f");
}
function f_optable(p) { // an operating table: a padded green top on a steel column, the big lamp overhead
  R(p, 0, 7, 15, 8, "#4f8a7a"); H(p, 0, 15, 7, "#6faa9a"); V(p, 7, 9, 13, STEEL); V(p, 8, 9, 13, STEELD); R(p, 4, 14, 11, 15, STEELD);
  oval(p, 4, 1, 12, 3, "#c9ced3"); V(p, 8, 0, 1, GREY);
}

// ---------- the rest of the liftable catalogue (#12 made every liftable kind an item; #14-#16's kinds; the epic's
// integration pass, #7): the appliances, the beds and bales lifted off a raid's floor, the special buildings' fittings ----------
function f_bed(p) { // a single bed lifted whole, side on: a wooden headboard, the mattress, a blue blanket
  R(p, 0, 3, 2, 14, WOODD); R(p, 3, 8, 15, 10, "#eef0f2"); R(p, 6, 8, 15, 11, "#3a6fb0"); R(p, 3, 7, 5, 8, "#e8e0c8");
  R(p, 13, 11, 14, 14, WOODD); R(p, 3, 11, 4, 14, WOODD);
}
function f_bunk(p) { // a steel bunk, side on: two thin mattresses, a ladder at the end
  legs(p, 0, 15, 0, 15, STEELD); R(p, 1, 4, 14, 5, "#c9b48a"); R(p, 1, 11, 14, 12, "#c9b48a");
  H(p, 1, 14, 6, STEEL); H(p, 1, 14, 13, STEEL); for (const y of [7, 9]) H(p, 12, 14, y, GREY);
}
function f_hospbed(p) { // a hospital bed: a raised white back, rails, the mattress, wheels
  line(p, 1, 9, 4, 3, "#eef0f2"); R(p, 4, 7, 14, 9, "#eef0f2"); H(p, 1, 14, 10, STEEL); H(p, 5, 13, 5, STEEL);
  V(p, 5, 5, 9, STEEL); V(p, 13, 5, 9, STEEL); legs(p, 2, 13, 11, 13, STEELD); for (const x of [2, 13]) R(p, x - 1, 14, x, 15, "#1f1f22");
}
function f_gurney(p) { // a gurney: a thin green-sheeted mattress on a steel frame, a pillow, wheels
  R(p, 0, 6, 15, 7, "#8fc2b0"); R(p, 1, 5, 3, 6, "#eef0f2"); H(p, 0, 15, 8, STEEL);
  line(p, 2, 9, 12, 13, STEELD); line(p, 12, 9, 2, 13, STEELD); for (const x of [2, 12]) R(p, x, 14, x + 1, 15, "#1f1f22");
}
function f_ivstand(p) { // an IV stand: a clear bag on the hook, the tube, a tall pole on a star foot
  H(p, 4, 11, 1, STEEL); R(p, 9, 2, 12, 6, "#cfe6ee"); H(p, 9, 12, 6, "#9ed0e0"); line(p, 11, 7, 9, 12, "#9ed0e0");
  V(p, 7, 1, 13, STEEL); line(p, 7, 13, 3, 15, STEELD); line(p, 7, 13, 12, 15, STEELD);
}
function f_hay(p) { // two stacked hay bales, their twine bands
  box(p, 0, 8, 15, 15, "#d9b45a"); box(p, 2, 1, 13, 7, "#e6c36a");
  for (const x of [4, 11]) { V(p, x, 9, 14, "#8a6a2a"); V(p, x, 2, 6, "#8a6a2a"); } for (const [x, y] of [[6, 11], [9, 4], [13, 12]]) p.set(x, y, "#b8923a");
}
function f_barrel(p) { // a blue plastic rain barrel: ribs, a lid, the tap near the foot
  R(p, 3, 1, 12, 15, "#3a6fb0"); H(p, 3, 12, 1, "#5a8fd0"); for (const y of [5, 10]) H(p, 3, 12, y, "#2a5590");
  V(p, 4, 2, 14, "#5a8fd0"); R(p, 13, 12, 14, 13, "#c9ced3");
}
function f_range(p) { // a kitchen range: four burners on the top, the oven door with its window, knobs
  box(p, 1, 3, 14, 15, "#e4e6e8"); R(p, 1, 1, 14, 2, "#202226"); for (const x of [3, 10]) R(p, x, 1, x + 2, 2, "#5e666d");
  for (const x of [3, 6, 9, 12]) p.set(x, 4, "#202226"); R(p, 3, 7, 12, 13, "#383b41"); R(p, 5, 9, 10, 11, "#6a5a3a");
}
function f_dishwasher(p) { // a dishwasher: a steel door, the control strip, the handle
  box(p, 1, 1, 14, 15, "#c9ced3"); R(p, 2, 2, 13, 3, "#383b41"); for (const x of [9, 11]) p.set(x, 2, "#6fe08a");
  H(p, 4, 11, 5, "#7d858c"); H(p, 2, 13, 14, "#7d858c");
}
function f_washer(p) { // a front-loading washing machine: a round glass door, the drum, the dial
  box(p, 1, 0, 14, 15, "#eef0f2"); H(p, 2, 13, 3, "#c9ced3"); disc(p, 4, 1, 1, "#7d858c"); R(p, 9, 1, 12, 2, "#9aa1a8");
  ring(p, 7, 9, 4, "#9aa1a8"); disc(p, 7, 9, 3, "#6f9ab8"); line(p, 6, 8, 8, 10, "#a8c8dc");
}
function f_dryer(p) { // a tumble dryer: a big round door, its lint filter, a row of buttons
  box(p, 1, 0, 14, 15, "#e4e6e8"); for (const x of [3, 5, 7]) p.set(x, 2, "#3a6fb0"); disc(p, 11, 2, 1, "#7d858c");
  ring(p, 7, 9, 4, "#7d858c"); disc(p, 7, 9, 3, "#4a5056"); H(p, 5, 9, 14, "#9aa1a8");
}
function f_fryer(p) { // a deep fryer: a steel box, two baskets standing in the oil, their long handles
  box(p, 1, 6, 14, 15, "#9aa1a8"); R(p, 2, 6, 13, 7, "#c9902a"); for (const x of [3, 9]) { R(p, x, 4, x + 3, 7, "#5e666d"); line(p, x + 1, 4, x - 1, 0, "#1f1f22"); }
  R(p, 3, 10, 12, 11, "#7d858c");
}
function f_coldshelf(p) { // cold-room shelving: wire shelves of milk crates and frosted tins
  legs(p, 1, 14, 0, 15, "#b8c4cc"); for (const y of [4, 9, 14]) H(p, 1, 14, y, "#d4dde2");
  R(p, 3, 1, 6, 3, "#4fb3c2"); R(p, 8, 1, 12, 3, "#eef0f2"); R(p, 3, 6, 7, 8, "#e8e0c8"); R(p, 9, 6, 12, 8, "#4fb3c2"); R(p, 4, 11, 11, 13, "#c9ced3");
}
function f_icemachine(p) { // an ice machine: a steel cabinet, a sloped bin door, ice inside
  box(p, 1, 2, 14, 15, "#b8c0c6"); R(p, 2, 3, 13, 5, "#383b41"); p.set(11, 4, "#6fe08a");
  line(p, 2, 8, 13, 7, "#7d858c"); R(p, 3, 9, 12, 13, "#dff2f8"); for (const [x, y] of [[5, 11], [8, 10], [10, 12]]) p.set(x, y, "#9ed0e0");
}
function f_watercooler(p) { // a water cooler: a blue jug upside down on a white stand, two taps
  R(p, 5, 0, 10, 5, "#6fb0e0"); H(p, 5, 10, 0, "#9ed0f0"); V(p, 7, 6, 7, "#6fb0e0");
  box(p, 4, 7, 11, 15, "#eef0f2"); p.set(6, 9, "#3a6fb0"); p.set(9, 9, "#c8402f");
}
function f_compressor(p) { // an air compressor: a red tank on wheels, the motor on top, a gauge and the hose
  oval(p, 1, 7, 14, 13, "#c8402f"); H(p, 3, 12, 8, "#e2654f"); box(p, 4, 2, 10, 6, "#383b41"); disc(p, 12, 4, 1, "#eef0f2");
  for (const x of [3, 12]) disc(p, x, 14, 1, "#1f1f22"); line(p, 14, 10, 15, 15, "#1f1f22");
}
function f_tank(p) { // a fish tank on its stand: green water, a fish, bubbles, gravel
  box(p, 0, 11, 15, 15, WOODD); R(p, 1, 2, 14, 10, "#3f8a8a"); H(p, 1, 14, 2, "#9ed0e0"); H(p, 1, 14, 10, "#b8a27a");
  R(p, 5, 5, 8, 6, "#e6923a"); p.set(9, 5, "#e6923a"); for (const [x, y] of [[11, 4], [12, 6], [11, 8]]) p.set(x, y, "#cfeef4");
}
function f_jukebox(p) { // a jukebox: a rounded top, a glowing arch, the record window, the speaker grille
  oval(p, 1, 0, 14, 8, "#8e2a20"); R(p, 1, 4, 14, 15, "#8e2a20"); oval(p, 3, 1, 12, 7, "#f2d36a");
  R(p, 4, 4, 11, 7, "#383b41"); disc(p, 7, 5, 1, "#202226"); for (const y of [10, 12, 14]) H(p, 3, 12, y, "#c9902a");
}
function f_pooltable(p) { // a pool table: green baize in a wood frame, the pockets, balls and a cue
  box(p, 0, 4, 15, 11, WOODD); R(p, 1, 5, 14, 10, "#2f7a3a"); for (const [x, y] of [[1, 5], [14, 5], [1, 10], [14, 10], [7, 5], [7, 10]]) p.set(x, y, "#1f1f22");
  for (const [x, y, c] of [[4, 7, "#eef0f2"], [10, 7, "#c8402f"], [11, 8, "#e6c23a"], [10, 9, "#3a6fb0"]]) p.set(x, y, c);
  line(p, 1, 2, 9, 3, "#c9a46a"); legs(p, 2, 13, 12, 15, WOODD);
}
function f_clothesrack(p) { // a shop clothes rack: a chrome rail, shirts on hangers, a wheeled foot
  H(p, 1, 14, 2, "#c9ced3"); V(p, 1, 2, 14, "#9aa1a8"); V(p, 14, 2, 14, "#9aa1a8"); H(p, 0, 15, 15, "#7d858c");
  for (const [x, c] of [[3, "#c8402f"], [6, "#3a6fb0"], [9, "#e6c23a"], [12, "#4f8a3a"]]) R(p, x - 1, 3, x + 1, 10, c);
}
function f_pottingbench(p) { // a potting bench: a slatted top, pots and a trowel on it, a shelf of bags under it
  R(p, 0, 7, 15, 8, "#a07a48"); legs(p, 1, 14, 9, 15, WOODD); H(p, 1, 14, 12, WOOD);
  for (const x of [2, 7]) box(p, x, 3, x + 3, 6, "#b06a46"); R(p, 3, 1, 4, 2, "#4f8a3a"); line(p, 11, 6, 14, 3, GREY); R(p, 4, 10, 11, 11, "#8a7a5a");
}
function f_palletrack(p) { // a pallet rack: tall orange frames, a wrapped pallet on each beam
  legs(p, 0, 15, 0, 15, "#d9772a"); for (const y of [6, 14]) H(p, 0, 15, y, "#3a6fb0");
  R(p, 2, 1, 13, 5, "#c9d6dc"); H(p, 2, 13, 3, "#e2ecf0"); R(p, 2, 8, 13, 13, "#b8a27a"); H(p, 2, 13, 10, "#957f58");
}
function f_tirerack(p) { // a tyre rack: a steel frame of black tyres standing in rows
  legs(p, 0, 15, 0, 15, STEELD); H(p, 0, 15, 7, STEEL); H(p, 0, 15, 15, STEEL);
  for (const x of [3, 8, 13]) { ring(p, x, 4, 2, "#1f1f22"); ring(p, x, 12, 2, "#1f1f22"); p.set(x, 4, GREY); p.set(x, 12, GREY); }
}
function f_saddlerack(p) { // a saddle rack: a brown leather saddle over a wooden rail, the stirrup hanging
  legs(p, 2, 13, 8, 15, WOODD); H(p, 1, 14, 8, WOOD); oval(p, 2, 3, 13, 9, "#7a4a28"); H(p, 4, 11, 4, "#a06a3a");
  V(p, 8, 9, 12, "#3a2414"); R(p, 7, 12, 9, 13, "#9aa1a8");
}
function f_secdesk(p) { // a security desk: a tall reception counter, two CCTV monitors on it
  box(p, 0, 7, 15, 15, "#4a5056"); H(p, 0, 15, 7, "#6f777e");
  for (const x of [2, 9]) { box(p, x, 1, x + 4, 5, "#202226"); R(p, x + 1, 2, x + 3, 4, "#3f8a5a"); } H(p, 2, 13, 11, "#383b41");
}
function f_deposit(p) { // a wall of safe-deposit boxes: small numbered steel doors with keyholes
  box(p, 0, 0, 15, 15, "#b8a27a");
  for (const y of [1, 5, 9, 13]) for (const x of [1, 5, 9, 13]) { R(p, x, y, x + 1, y + 1, "#d9c49a"); p.set(x + 1, y + 1, "#5f4a2a"); }
}
function f_ammocab(p) { // an olive steel ammo cabinet: two doors, a padlocked hasp, stencilled bands
  box(p, 1, 0, 14, 15, "#5a6a3a"); V(p, 7, 1, 14, "#3f4a28"); for (const y of [3, 12]) H(p, 2, 13, y, "#e6c23a");
  R(p, 6, 7, 9, 9, "#9aa1a8"); p.set(7, 6, "#9aa1a8"); p.set(8, 6, "#9aa1a8");
}
function f_evlocker(p) { // an evidence locker: steel doors in two rows, each with a tag and a seal
  box(p, 1, 0, 14, 15, "#6a7178"); H(p, 2, 13, 7, "#4a5056"); V(p, 7, 1, 14, "#4a5056");
  for (const [x, y] of [[3, 2], [9, 2], [3, 9], [9, 9]]) { R(p, x, y, x + 2, y + 1, "#e8e0c8"); p.set(x + 3, y + 3, "#c8402f"); }
}
function f_turnout(p) { // a turnout locker: an open bay with a firefighter's tan coat, helmet above, boots below
  box(p, 1, 0, 14, 15, "#c8402f"); R(p, 3, 1, 12, 14, "#3a2a24"); oval(p, 5, 1, 10, 3, "#e6c23a");
  R(p, 4, 4, 11, 10, "#c9a46a"); for (const y of [6, 9]) H(p, 4, 11, y, "#e6e04a"); R(p, 4, 12, 6, 14, "#1f1f22"); R(p, 9, 12, 11, 14, "#1f1f22");
}
function f_schoollocker(p) { // a row of narrow school lockers: blue doors, vent slots, a padlock
  box(p, 0, 0, 15, 15, "#3a6fb0"); for (const x of [4, 8, 12]) V(p, x, 0, 15, "#2a5590");
  for (const x of [1, 5, 9, 13]) { H(p, x, x + 1, 2, "#2a5590"); H(p, x, x + 1, 3, "#2a5590"); } R(p, 6, 8, 7, 9, "#c9ced3");
}
function f_sportcage(p) { // a sports storage cage: a wire mesh front, balls and bats inside
  box(p, 0, 1, 15, 15, "#7d858c"); for (let x = 1; x <= 14; x += 3) V(p, x, 2, 14, "#9aa1a8"); for (let y = 3; y <= 14; y += 3) H(p, 1, 14, y, "#9aa1a8");
  disc(p, 4, 11, 2, "#e6923a"); disc(p, 9, 12, 1, "#eef0f2"); line(p, 11, 4, 13, 13, "#c9a46a");
}
function f_labbench(p) { // a lab bench: a black resin top, a gooseneck tap and a sink, flasks, cupboards below
  R(p, 0, 7, 15, 8, "#202226"); box(p, 0, 9, 15, 15, "#c9b48a"); V(p, 7, 9, 15, "#957f58");
  V(p, 3, 3, 6, STEEL); H(p, 3, 5, 3, STEEL); R(p, 10, 4, 12, 6, "#6fe08a"); p.set(11, 3, "#cfeef4"); R(p, 13, 5, 14, 6, "#4fb3c2");
}
function f_weightbench(p) { // a weight bench: a padded bench, the uprights, a loaded barbell across them
  R(p, 1, 9, 13, 10, "#c8402f"); legs(p, 2, 12, 11, 15, STEELD); V(p, 11, 3, 10, STEEL); V(p, 13, 3, 10, STEEL);
  H(p, 0, 15, 3, STEEL); for (const x of [1, 14]) R(p, x - 1, 1, x, 5, "#1f1f22");
}
function f_candles(p) { // a pair of brass candlesticks, their candles lit
  for (const x of [4, 11]) { V(p, x, 4, 13, "#d9b13b"); H(p, x - 2, x + 2, 14, "#b8952a"); H(p, x - 1, x + 1, 8, "#b8952a"); R(p, x, 1, x, 3, "#eef0f2"); p.set(x, 0, "#f2a43a"); }
}
function f_pulpit(p) { // a pulpit: a tall carved wooden lectern, a slanted top, an open book on it
  line(p, 2, 4, 13, 2, "#a06a3a"); box(p, 3, 5, 12, 15, "#7a4a28"); R(p, 5, 7, 10, 13, "#8a5a30"); V(p, 7, 8, 12, "#d9b13b");
  R(p, 4, 1, 7, 2, "#eef0f2"); R(p, 8, 0, 11, 2, "#e8e0c8");
}
function f_cubicle(p) { // an office cubicle partition: a grey fabric panel, a pinned memo, a steel trim
  box(p, 0, 0, 15, 13, "#8a949c"); H(p, 0, 15, 0, STEELD); R(p, 3, 3, 6, 6, "#e6e04a"); R(p, 9, 4, 12, 8, "#eef0f2");
  for (const x of [2, 13]) R(p, x, 14, x + 1, 15, STEELD);
}
function f_whiteboard(p) { // a whiteboard on a stand: a white face, a marker scrawl, the tray
  box(p, 0, 1, 15, 10, "#eef0f2"); line(p, 2, 4, 7, 3, "#3a6fb0"); line(p, 2, 6, 11, 6, "#c8402f"); line(p, 3, 8, 8, 8, "#202226");
  H(p, 1, 14, 11, GREY); V(p, 3, 12, 15, STEELD); V(p, 12, 12, 15, STEELD);
}
function f_keyrack(p) { // a key rack: a wooden board, hooks, keys on numbered tags
  box(p, 0, 2, 15, 13, WOOD); for (const x of [2, 6, 10, 14]) p.set(x, 4, GREY);
  for (const [x, c] of [[2, "#d9b13b"], [6, "#c9ced3"], [10, "#d9b13b"]]) { V(p, x, 5, 8, c); R(p, x - 1, 9, x + 1, 10, "#c8402f"); }
}
function f_stanchion(p) { // a queue post: a chrome post on a heavy foot, the red rope swinging off it
  V(p, 7, 1, 13, "#c9ced3"); V(p, 8, 1, 13, "#9aa1a8"); disc(p, 7, 1, 1, "#e4e6e8"); oval(p, 3, 13, 12, 15, "#7d858c");
  line(p, 8, 3, 15, 6, "#c8402f"); line(p, 8, 4, 15, 7, "#8e2a20");
}
function f_serverrack(p) { // a server rack: a black cabinet of servers, blinking lights, a vented door edge
  box(p, 1, 0, 14, 15, "#202226"); for (let y = 2; y <= 13; y += 3) { H(p, 2, 13, y, "#383b41"); p.set(11, y, "#6fe08a"); p.set(12, y, "#e6c23a"); }
  V(p, 2, 1, 14, "#4a5056");
}
function f_copier(p) { // a photocopier: a big beige body, the lid, the control panel, paper trays
  box(p, 1, 4, 14, 15, "#d8d4c8"); R(p, 1, 2, 11, 3, "#9aa1a8"); R(p, 12, 2, 14, 4, "#383b41"); p.set(13, 3, "#6fe08a");
  for (const y of [8, 11, 14]) H(p, 2, 13, y, "#a89f8a"); R(p, 3, 5, 10, 6, "#eef0f2");
}

// ---------- the hospitals', clinics' and vets' pieces (#14, sim/roomlayout.js MEDICAL_STYLES) ----------
function f_medcart(p) { // a medication cart: blue drawers on a steel frame, a pull on each, castors
  box(p, 2, 2, 13, 13, "#3a6fb0"); for (const y of [5, 8, 11]) H(p, 3, 12, y, "#284f80");
  for (const y of [3, 6, 9, 12]) H(p, 7, 8, y, "#c9ced3"); H(p, 1, 14, 1, STEEL); for (const x of [3, 12]) R(p, x - 1, 14, x, 15, "#1f1f22");
}
function f_drugsafe(p) { // a drug safe: a squat steel box, the dial and the handle, a red cross
  box(p, 1, 2, 14, 15, STEEL); R(p, 3, 4, 12, 13, STEELD); disc(p, 9, 8, 2, "#c9ced3"); p.set(9, 8, "#383b41");
  H(p, 5, 7, 11, "#c9ced3"); V(p, 4, 5, 7, "#c8402f"); H(p, 3, 5, 6, "#c8402f");
}
function f_instcab(p) { // an instrument cabinet: a tall white case, glass doors, steel trays and tools behind them
  box(p, 2, 0, 13, 15, "#e4e6e2"); R(p, 3, 1, 12, 12, "#bcd8e2"); V(p, 7, 1, 12, "#9aa1a8");
  for (const y of [4, 8]) H(p, 3, 12, y, STEEL); for (const [x, y] of [[4, 2], [9, 6], [5, 10], [11, 2]]) H(p, x, x + 1, y, STEELD); R(p, 3, 13, 12, 14, "#c9c7bd");
}
function f_morguelocker(p) { // morgue drawers: a steel wall of square doors, a latch on each
  box(p, 0, 0, 15, 15, "#a8b0b6"); for (const x of [5, 10]) V(p, x, 0, 15, "#6f777e"); H(p, 0, 15, 7, "#6f777e");
  for (const x of [2, 7, 12]) for (const y of [3, 11]) H(p, x, x + 1, y, "#e8eaec");
}
function f_autopsy(p) { // an autopsy table: a steel slab with a raised lip, a drain, on a single column
  R(p, 0, 5, 15, 7, "#c9ced3"); H(p, 0, 15, 4, "#e8eaec"); p.set(13, 6, "#383b41"); R(p, 6, 8, 9, 13, STEEL); R(p, 3, 14, 12, 15, STEELD);
}
function f_wheelchair(p) { // a wheelchair, side on: the big wheel, the black seat and back, the push handle, a footrest
  ring(p, 6, 10, 4, STEELD); p.set(6, 10, STEEL); R(p, 4, 7, 11, 8, "#26272a"); R(p, 10, 1, 11, 8, "#26272a"); H(p, 10, 13, 1, STEEL);
  line(p, 4, 8, 2, 13, STEEL); H(p, 1, 3, 13, STEEL); disc(p, 12, 14, 1, "#1f1f22");
}
function f_vettable(p) { // a vet's steel exam table: a bright top on a pedestal
  R(p, 0, 5, 15, 6, "#e8eaec"); H(p, 0, 15, 7, STEEL); R(p, 6, 8, 9, 13, STEEL); R(p, 3, 14, 12, 15, STEELD);
}
function f_curtain(p) { // a privacy curtain: a rail, rings, folds of pale green cloth
  H(p, 0, 15, 0, STEEL); for (let x = 1; x < 15; x += 2) p.set(x, 1, "#c9ced3");
  for (let x = 0; x < 16; x++) V(p, x, 2, 14, x % 3 === 0 ? "#6f9a8c" : "#8fc2b0");
}
function f_linencart(p) { // a linen cart: a blue canvas bag full of folded sheets on a steel frame
  R(p, 1, 3, 14, 4, "#eef0f2"); R(p, 2, 2, 7, 3, "#e8e0c8"); box(p, 1, 5, 14, 12, "#4f7b88"); H(p, 0, 15, 13, STEEL);
  for (const x of [2, 13]) R(p, x - 1, 14, x, 15, "#1f1f22");
}
function f_monitor(p) { // a patient monitor on its stand: a dark screen with a green trace, a pole, a star foot
  box(p, 2, 0, 13, 7, "#26272a"); R(p, 3, 1, 12, 6, "#1c2a30"); line(p, 3, 4, 6, 4, "#5ad06a"); line(p, 6, 4, 7, 2, "#5ad06a"); line(p, 7, 2, 8, 6, "#5ad06a"); line(p, 8, 6, 12, 4, "#5ad06a");
  V(p, 7, 8, 13, STEEL); line(p, 7, 13, 3, 15, STEELD); line(p, 7, 13, 12, 15, STEELD);
}
function f_crib(p) { // an infant cot: wooden bars round a little mattress, a folded blanket
  H(p, 1, 14, 3, WOODL); H(p, 1, 14, 12, WOOD); for (let x = 1; x <= 14; x += 2) V(p, x, 3, 12, WOOD);
  R(p, 2, 9, 13, 11, "#eef0f2"); R(p, 8, 9, 12, 10, "#e8a0b0"); legs(p, 1, 14, 13, 15, WOODD);
}
function f_exambed(p) { // an exam bed: a padded teal top with a raised end, the paper roll, a cabinet base
  line(p, 1, 3, 4, 6, "#4f7b88"); R(p, 4, 6, 15, 7, "#4f7b88"); H(p, 4, 15, 5, "#eef0f2"); box(p, 3, 8, 14, 15, "#c9b48a"); H(p, 4, 13, 11, "#957f58");
}

// ---------- grocery stores by size (issue #22) ----------
function f_freezercase(p) { // an upright freezer case: a white frame, a frosted glass door, white boxes of frozen food, the compressor on top
  R(p, 1, 0, 14, 2, "#7d858c"); box(p, 1, 3, 14, 15, "#e4e6e8"); R(p, 3, 4, 12, 14, "#bcdbe6");
  for (const y of [7, 11]) H(p, 3, 12, y, "#eef0f2"); R(p, 4, 5, 6, 6, "#3a6fb0"); R(p, 8, 5, 11, 6, "#eef0f2"); R(p, 4, 8, 7, 10, "#c8402f"); R(p, 9, 8, 11, 10, "#eef0f2"); R(p, 4, 12, 11, 13, "#e6c23a");
  V(p, 12, 6, 11, "#c9ced3");
}
function f_islandfreezer(p) { // an island freezer: a long low white tub under sliding glass lids, frost and boxes inside
  box(p, 0, 8, 15, 15, "#e4e6e8"); R(p, 1, 5, 14, 7, "#bcdbe6"); H(p, 0, 15, 4, "#c9ced3"); V(p, 7, 5, 7, "#c9ced3");
  R(p, 2, 6, 4, 7, "#3a6fb0"); R(p, 9, 6, 12, 7, "#c8402f"); H(p, 1, 14, 11, "#9aa1a8");
}
function f_meatcase(p) { // a butcher's case: a curved glass front over trays of red cuts, a white steel base
  box(p, 0, 9, 15, 15, "#dcdcd6"); line(p, 1, 8, 4, 3, "#bcdbe6"); R(p, 4, 3, 15, 8, "#bcdbe6"); H(p, 4, 15, 3, "#e4f2f6");
  R(p, 3, 6, 6, 8, "#b03a30"); R(p, 7, 6, 10, 8, "#c85a48"); R(p, 11, 6, 14, 8, "#9e2a22"); H(p, 1, 14, 12, "#9aa1a8");
}
function f_freezershelf(p) { // a walk-in freezer's wire shelving: frost on the wire, white boxes and frozen sacks
  legs(p, 1, 14, 0, 15, "#d4e6ee"); for (const y of [4, 9, 14]) H(p, 1, 14, y, "#eef6fa");
  R(p, 3, 1, 7, 3, "#eef0f2"); R(p, 9, 1, 12, 3, "#9ec8d8"); R(p, 2, 6, 6, 8, "#9ec8d8"); R(p, 8, 6, 13, 8, "#eef0f2"); R(p, 4, 11, 10, 13, "#d4dde2"); p.set(5, 2, "#c8402f");
}
function f_producebin(p) { // produce bins: a slanted wooden stand, apples, oranges and greens heaped in it
  line(p, 0, 9, 15, 5, WOODD); box(p, 1, 10, 14, 15, WOOD); legs(p, 1, 14, 13, 15, WOODD);
  for (const [x, y, c] of [[2, 8, "#c8402f"], [4, 8, "#c8402f"], [3, 7, "#d84a3a"], [6, 7, "#e8a020"], [8, 6, "#e8a020"], [7, 6, "#f0b030"], [10, 6, "#4f8a3a"], [12, 5, "#5fa04a"], [11, 5, "#4f8a3a"], [13, 5, "#6ab050"]]) disc(p, x, y, 1, c);
}
function f_breadrack(p) { // a bread rack: a chrome frame on castors, loaves on three shelves
  V(p, 2, 0, 14, "#c9ced3"); V(p, 13, 0, 14, "#9aa1a8"); for (const y of [4, 9, 14]) H(p, 2, 13, y, "#c9ced3");
  for (const [x0, y0] of [[3, 2], [8, 2], [4, 7], [9, 7], [3, 12], [8, 12]]) { R(p, x0, y0, x0 + 3, y0 + 1, "#b8783a"); H(p, x0, x0 + 3, y0, "#d49a5a"); }
  p.set(2, 15, "#383b41"); p.set(13, 15, "#383b41");
}
function f_selfcheckout(p) { // a self-checkout kiosk: a grey stand, a lit screen on top, the scanner glass and the bagging shelf
  box(p, 4, 7, 11, 15, "#6a7480"); box(p, 5, 1, 11, 5, "#26272a"); R(p, 6, 2, 10, 4, "#6fe08a");
  R(p, 4, 6, 11, 6, "#9ed0e0"); R(p, 11, 8, 15, 8, "#c9ced3"); V(p, 15, 8, 15, "#9aa1a8"); p.set(9, 10, "#e6c23a");
}
function f_aislesign(p) { // an aisle marker: a blue sign with a white number on a chrome post
  box(p, 2, 0, 13, 6, "#2f5d8a"); R(p, 6, 1, 8, 1, "#eef0f2"); V(p, 8, 1, 5, "#eef0f2"); R(p, 6, 5, 10, 5, "#eef0f2"); R(p, 7, 2, 7, 2, "#eef0f2");
  V(p, 7, 7, 14, "#c9ced3"); V(p, 8, 7, 14, "#9aa1a8"); oval(p, 4, 14, 11, 15, "#7d858c");
}

// ---------- military bases, air bases, airports and prisons (issue #25) ----------
function f_footlocker(p) { // an olive footlocker: brass corners, a hasp, a stencilled name band
  box(p, 1, 5, 14, 14, "#55623a"); H(p, 1, 14, 8, "#3f4a28"); for (const [x, y] of [[1, 5], [14, 5], [1, 14], [14, 14]]) p.set(x, y, "#d9b13b");
  R(p, 7, 7, 8, 9, "#c9ced3"); H(p, 3, 6, 11, "#e8e0c8");
}
function f_maptable(p) { // a map table: a sheet with green ground, roads and red marks on a wooden table
  R(p, 0, 4, 15, 8, "#d8cfa0"); R(p, 2, 5, 6, 7, "#6a8a4a"); line(p, 0, 8, 15, 4, "#8a7a5a"); p.set(10, 6, "#c8402f"); p.set(12, 5, "#c8402f");
  legs(p, 1, 14, 9, 15, WOODD); H(p, 0, 15, 9, WOOD);
}
function f_radioconsole(p) { // a radio console: two grey-green sets stacked, dials lit green and amber, a handset
  box(p, 1, 1, 14, 7, "#5a6450"); box(p, 1, 8, 14, 14, "#4a5244"); for (const x of [3, 6, 9]) disc(p, x, 4, 1, "#202226");
  p.set(12, 3, "#5ad06a"); p.set(12, 5, "#e0a030"); H(p, 3, 11, 11, "#202226"); R(p, 12, 10, 13, 12, "#26272a");
}
function f_ammocrate(p) { // a green ammo crate: rope handles, yellow stencil band, latches
  box(p, 1, 4, 14, 14, "#4d5a32"); H(p, 2, 13, 8, "#e6c23a"); V(p, 7, 5, 13, "#3a4426");
  H(p, 0, 1, 9, "#b8a27a"); H(p, 14, 15, 9, "#b8a27a"); p.set(4, 5, "#9aa1a8"); p.set(11, 5, "#9aa1a8");
}
function f_fuelbladder(p) { // a fuel bladder: a black rubber pillow, its valve and hose
  oval(p, 0, 7, 15, 14, "#26272a"); H(p, 2, 13, 8, "#3a3b40"); R(p, 7, 5, 8, 7, "#9aa1a8"); line(p, 8, 5, 13, 2, "#1f1f22");
}
function f_gateseat(p) { // gate seating: three linked blue seats on a chrome beam
  for (const x of [0, 5, 10]) { R(p, x, 4, x + 4, 9, "#2f5d8a"); R(p, x, 10, x + 4, 11, "#3b6fa0"); }
  H(p, 0, 15, 12, "#b8bec4"); V(p, 2, 12, 15, "#b8bec4"); V(p, 13, 12, 15, "#b8bec4");
}
function f_intakelocker(p) { // a property locker: a steel bank of small numbered doors, amber tags
  box(p, 0, 0, 15, 15, "#8a949c");
  for (const y of [5, 10]) H(p, 1, 14, y, "#5e666d"); for (const x of [5, 10]) V(p, x, 1, 14, "#5e666d");
  for (const y of [2, 7, 12]) for (const x of [2, 7, 12]) p.set(x, y, "#e0a030");
}
function f_luggage(p) { // a suitcase: a hard red shell, its handle, two wheels, a tag
  box(p, 3, 3, 12, 14, "#a8443a"); V(p, 7, 4, 13, "#7a2e28"); R(p, 6, 1, 9, 2, "#26272a"); p.set(4, 15, "#1f1f22"); p.set(11, 15, "#1f1f22"); R(p, 10, 5, 11, 7, "#e8e0c8");
}


export const GEAR_ART = {
  f_freezercase, f_islandfreezer, f_meatcase, f_freezershelf, f_producebin, f_breadrack, f_selfcheckout, f_aislesign,
  f_luggage, f_footlocker, f_maptable, f_radioconsole, f_ammocrate, f_fuelbladder, f_gateseat, f_intakelocker,
  f_medcart, f_drugsafe, f_instcab, f_morguelocker, f_autopsy, f_wheelchair, f_vettable, f_curtain, f_linencart, f_monitor, f_crib, f_exambed,
  f_bed, f_bunk, f_hospbed, f_gurney, f_ivstand, f_hay, f_barrel, f_range, f_dishwasher, f_washer, f_dryer, f_fryer, f_coldshelf,
  f_icemachine, f_watercooler, f_compressor, f_tank, f_jukebox, f_pooltable, f_clothesrack, f_pottingbench, f_palletrack, f_tirerack,
  f_saddlerack, f_secdesk, f_deposit, f_ammocab, f_evlocker, f_turnout, f_schoollocker, f_sportcage, f_labbench, f_weightbench,
  f_candles, f_pulpit, f_cubicle, f_whiteboard, f_keyrack, f_stanchion, f_serverrack, f_copier,
  f_shelf, f_locker, f_cabinet, f_counter, f_crate, f_rack, f_filing, f_bookshelf, f_wardrobe, f_dresser, f_nightstand, f_tvstand, f_medcab,
  f_vending, f_checkout, f_displaycase, f_toolchest, f_gunrack, f_schooldesk, f_sofa, f_armchair, f_chair, f_barstool, f_piano, f_pew,
  f_table, f_desk, f_teacherdesk, f_workbench, f_optable, f_plant, f_floorlamp, f_painting, f_wallclock,
};
