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

// ---------- the college campuses' pieces (#28, sim/campuslayout.js and sim/campus.js) ----------
function f_dormdesk(p) { // a dorm desk: a pale top over a drawer stack, a hutch of shelves with books and a lamp
  R(p, 0, 8, 15, 9, WOODL); box(p, 9, 10, 14, 15, WOOD); H(p, 10, 13, 12, WOODD); legs(p, 1, 8, 10, 15, WOODD);
  box(p, 1, 0, 14, 7, WOOD); H(p, 2, 13, 4, WOODD); R(p, 3, 1, 6, 3, "#3a6fb0"); R(p, 8, 2, 9, 3, "#c8402f"); R(p, 11, 5, 12, 7, "#e6e04a");
}
function f_mailboxes(p) { // a mailbox wall: rows of little brass doors in a wooden frame, a keyhole on each
  box(p, 0, 0, 15, 15, WOODD); for (let y = 1; y <= 13; y += 4) for (let x = 1; x <= 13; x += 4) { R(p, x, y, x + 2, y + 2, "#c9a446"); p.set(x + 2, y + 1, "#5a4a20"); }
}
function f_campusbench(p) { // a park bench: wooden slats on black iron ends, the back rest
  for (const y of [2, 4]) H(p, 0, 15, y, WOODL); for (const y of [8, 10]) H(p, 0, 15, y, WOOD); H(p, 0, 15, 5, WOODD);
  for (const x of [1, 14]) { V(p, x, 1, 15, "#26272a"); } line(p, 1, 11, 0, 15, "#26272a"); line(p, 14, 11, 15, 15, "#26272a");
}
// ---------- the hotels' pieces (#29, sim/hotellayout.js) ----------
function f_frontdesk(p) { // a reception desk: a panelled wood front, a pale marble top, a little brass bell on it
  R(p, 0, 5, 15, 6, "#e2dcc8"); H(p, 0, 15, 5, "#f2ede0"); box(p, 1, 7, 14, 15, WOOD);
  for (const x of [5, 10]) V(p, x, 8, 14, WOODD); disc(p, 12, 3, 1, "#d9b13b"); H(p, 11, 13, 4, "#a8862a");
}
function f_suitcase(p) { // a suitcase on its end: a navy shell with ribs, the telescopic handle up, two wheels
  box(p, 3, 4, 12, 14, "#2f4a6a"); for (const y of [7, 10]) H(p, 4, 11, y, "#22384f"); H(p, 6, 9, 3, "#9aa1a8");
  V(p, 6, 0, 3, "#9aa1a8"); V(p, 9, 0, 3, "#9aa1a8"); H(p, 6, 9, 0, "#383b41"); for (const x of [4, 11]) p.set(x, 15, "#1f1f22");
}
function f_minifridge(p) { // a minibar: a little dark cabinet, a glass door, cans and little bottles on its shelves
  box(p, 2, 3, 13, 15, "#4a3424"); R(p, 4, 5, 11, 13, "#26303a"); H(p, 4, 11, 9, "#9aa1a8");
  for (const [x, c] of [[5, "#c8402f"], [7, "#e6c23a"], [9, "#4f8a3a"]]) { V(p, x, 6, 8, c); V(p, x + 1, 10, 12, "#c9ced3"); } V(p, 12, 7, 10, "#c9ced3");
}
function f_luggagecart(p) { // a luggage cart: a brass arch over a red carpeted deck, a bag on it, castors
  V(p, 2, 1, 13, "#d9b13b"); V(p, 13, 1, 13, "#d9b13b"); H(p, 2, 13, 1, "#d9b13b"); R(p, 1, 12, 14, 13, "#8e3028");
  box(p, 4, 6, 11, 11, "#5a4a62"); H(p, 6, 9, 5, "#383b41"); for (const x of [2, 13]) R(p, x - 1, 14, x, 15, "#1f1f22");
}
function f_banquet(p) { // a round banquet table: a white cloth hanging to the floor, a centrepiece
  oval(p, 0, 3, 15, 7, "#eae6da"); R(p, 1, 6, 14, 14, "#dcd6c6"); for (const x of [4, 8, 12]) V(p, x, 8, 14, "#c4bda9");
  disc(p, 7, 3, 1, "#c8402f"); p.set(8, 2, "#4f8a3a");
}
function f_loungechair(p) { // a lounge chair: a deep plum seat, a tall back and rolled arms, short wooden feet
  box(p, 3, 1, 12, 8, "#5a4a62"); R(p, 1, 6, 14, 12, "#6a5a72"); R(p, 1, 6, 2, 12, "#463a4e"); R(p, 13, 6, 14, 12, "#463a4e");
  H(p, 3, 12, 9, "#7a6a82"); for (const x of [2, 13]) R(p, x, 13, x, 15, WOODD);
}
function f_lounger(p) { // a pool lounger, side on: white slats, the raised back, chrome legs
  for (let x = 1; x <= 10; x += 2) R(p, x, 9, x, 10, "#e8e6de"); H(p, 1, 10, 11, "#c9c7bd");
  line(p, 11, 10, 14, 3, "#e8e6de"); line(p, 12, 10, 15, 4, "#c9c7bd"); for (const x of [2, 9, 12]) V(p, x, 12, 15, "#b8bec4");
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

// ---------- restaurants by kind of food (issue #33) ----------
function f_flattop(p) { // a flat-top grill: a black steel plate with a grease trough, knobs along a steel front, short legs
  R(p, 0, 5, 15, 6, "#26272a"); H(p, 0, 15, 4, "#b8bec4"); box(p, 1, 7, 14, 13, STEEL); for (const x of [3, 6, 9, 12]) p.set(x, 9, "#26272a"); legs(p, 2, 13, 14, 15, STEELD);
}
function f_deckoven(p) { // a deck oven: two stacked steel decks with dark glass doors and chrome handles, on a stand
  box(p, 1, 0, 14, 12, STEEL); R(p, 3, 1, 12, 4, "#2a3a44"); R(p, 3, 7, 12, 10, "#2a3a44"); H(p, 3, 12, 5, "#c9ced3"); H(p, 3, 12, 11, "#c9ced3"); legs(p, 2, 13, 13, 15, STEELD);
}
function f_conveyoroven(p) { // a conveyor pizza oven: a steel tunnel, the wire belt running out of both ends, a pizza on it
  box(p, 3, 3, 12, 10, STEEL); R(p, 0, 8, 15, 8, "#c9ced3"); H(p, 0, 15, 9, "#5e666d"); disc(p, 1, 7, 1, "#d9a03a"); R(p, 4, 5, 11, 7, "#26272a"); legs(p, 4, 11, 11, 15, STEELD);
}
function f_wokrange(p) { // a wok range: a steel cabinet with two big burner rings and a black wok on one
  box(p, 1, 7, 14, 15, STEEL); R(p, 0, 5, 15, 6, "#5e666d"); ring(p, 4, 5, 2, "#26272a"); oval(p, 8, 1, 14, 5, "#26272a"); H(p, 9, 13, 2, "#4a4c50"); line(p, 14, 3, 15, 1, "#5f3c20"); H(p, 2, 13, 11, "#5e666d");
}
function f_smoker(p) { // an offset smoker: a black barrel on legs, the firebox at one end, the chimney
  oval(p, 1, 5, 11, 11, "#2a2a2e"); H(p, 2, 10, 8, "#3a3a3e"); box(p, 11, 7, 15, 11, "#26272a"); V(p, 2, 0, 5, "#26272a"); V(p, 3, 0, 5, "#3a3a3e"); legs(p, 2, 10, 12, 15, "#26272a"); p.set(6, 7, "#c9ced3");
}
function f_chargrill(p) { // a char grill: bars over glowing coals on a steel body
  R(p, 0, 4, 15, 6, "#e07a20"); for (const x of [1, 3, 5, 7, 9, 11, 13, 15]) V(p, x, 4, 6, "#26272a"); box(p, 1, 7, 14, 13, STEEL); legs(p, 2, 13, 14, 15, STEELD);
}
function f_gyrospit(p) { // a gyro spit: a cone of browned meat on a vertical skewer before a glowing element
  R(p, 11, 1, 13, 12, "#e0a030"); V(p, 7, 0, 14, "#c9ced3"); for (let y = 2; y <= 11; y++) H(p, 7 - Math.max(1, 4 - Math.floor(y / 3)), 7 + Math.max(1, 4 - Math.floor(y / 3)) - 1, y, y % 2 ? "#8a4a22" : "#a05a2a");
  box(p, 3, 13, 13, 15, STEEL);
}
function f_stockpot(p) { // a stockpot burner: a low steel stand with a ring, a tall pot on it, its lid
  box(p, 2, 3, 13, 11, "#c9ced3"); H(p, 1, 14, 2, "#9aa1a8"); V(p, 2, 4, 10, "#eef0f2"); H(p, 0, 1, 5, "#9aa1a8"); H(p, 14, 15, 5, "#9aa1a8"); box(p, 1, 12, 14, 15, STEELD);
}
function f_steamtable(p) { // a steam table: a steel counter with wells of food under a sneeze guard
  H(p, 0, 15, 2, "#9ed0e0"); V(p, 1, 2, 5, "#c9ced3"); V(p, 14, 2, 5, "#c9ced3"); R(p, 0, 6, 15, 7, "#9aa1a8");
  R(p, 1, 5, 4, 6, "#d9a03a"); R(p, 6, 5, 9, 6, "#5fa04a"); R(p, 11, 5, 14, 6, "#b8402a"); box(p, 1, 8, 14, 15, STEEL);
}
function f_espresso(p) { // an espresso machine: a chrome box, two group heads, a steam wand, cups on top
  box(p, 1, 3, 14, 13, "#c9ced3"); R(p, 2, 4, 13, 6, "#26272a"); for (const x of [4, 10]) { R(p, x, 7, x + 1, 9, "#26272a"); p.set(x, 11, "#eef0f2"); } line(p, 13, 7, 15, 11, "#9aa1a8");
  for (const x of [3, 6, 9]) R(p, x, 1, x + 1, 2, "#eef0f2"); H(p, 1, 14, 14, "#5e666d");
}
function f_softserve(p) { // a soft-serve machine: a tall steel box, two hoppers on top, the handles and the cone in the drip tray
  box(p, 2, 3, 13, 15, STEEL); R(p, 3, 0, 6, 2, "#eef0f2"); R(p, 9, 0, 12, 2, "#eef0f2"); R(p, 4, 7, 11, 8, "#5e666d"); V(p, 5, 6, 8, "#c8402f"); V(p, 10, 6, 8, "#c8402f");
  line(p, 7, 12, 8, 10, "#d49a5a"); disc(p, 8, 9, 1, "#f2ead8"); H(p, 3, 12, 13, "#5e666d");
}
function f_slicer(p) { // a meat slicer: a round steel blade over its carriage, a white base
  box(p, 1, 11, 14, 15, "#e4e6e8"); disc(p, 7, 7, 5, "#c9ced3"); ring(p, 7, 7, 5, "#8a949c"); disc(p, 7, 7, 1, "#5e666d"); R(p, 11, 8, 14, 10, "#9aa1a8");
}
function f_tortillapress(p) { // a cast-iron tortilla press: two black plates, the lever arm, a pale tortilla between
  oval(p, 2, 9, 13, 13, "#26272a"); H(p, 3, 12, 8, "#f0e0b0"); oval(p, 2, 5, 13, 8, "#3a3a3e"); line(p, 13, 6, 15, 1, "#26272a"); box(p, 3, 14, 12, 15, "#26272a");
}
function f_extinguisher(p) { // a fire extinguisher: a red cylinder, the black valve and handle, the hose round its side
  box(p, 5, 4, 10, 15, "#c0281e"); H(p, 5, 10, 4, "#d8382e"); R(p, 6, 1, 9, 3, "#26272a"); line(p, 9, 1, 12, 0, "#26272a"); line(p, 10, 3, 12, 8, "#26272a"); R(p, 6, 8, 9, 10, "#eef0f2");
}
function f_saladbar(p) { // a salad bar: a sneeze-guard roof, bowls of greens and vegetables on ice, a steel base
  H(p, 0, 15, 1, "#9ed0e0"); H(p, 0, 15, 2, "#c9ced3"); V(p, 1, 2, 6, "#c9ced3"); V(p, 14, 2, 6, "#c9ced3");
  R(p, 1, 6, 15, 7, "#eef6fa"); for (const [x, c] of [[2, "#4f8a3a"], [5, "#c8402f"], [8, "#e8a020"], [11, "#5fa04a"]]) R(p, x, 5, x + 2, 6, c); box(p, 1, 8, 14, 15, STEEL);
}
function f_menuboard(p) { // a menu board: a black panel of white lines and lit pictures on a steel post
  box(p, 0, 0, 15, 9, "#26272a"); for (const y of [2, 4, 6]) H(p, 2, 8, y, "#eef0f2"); R(p, 10, 2, 13, 4, "#e0a030"); R(p, 10, 6, 13, 7, "#c8402f"); V(p, 7, 10, 15, STEEL); V(p, 8, 10, 15, STEELD);
}
function f_patiotable(p) { // a patio table under its striped umbrella
  for (let x = 0; x <= 15; x++) for (let y = 1; y <= 4; y++) if (Math.abs(x - 7.5) <= 2 + y * 2) p.set(x, y, Math.floor(x / 3) % 2 ? "#c8402f" : "#eef0f2");
  V(p, 7, 5, 14, "#c9ced3"); H(p, 2, 13, 10, "#eef0f2"); legs(p, 3, 12, 11, 15, "#9aa1a8");
}
function f_hoststand(p) { // a host stand: a dark wooden lectern, a lamp, the reservation book open on it
  line(p, 2, 3, 13, 1, WOODL); box(p, 4, 4, 11, 15, WOODD); R(p, 4, 2, 11, 3, "#efece2"); H(p, 5, 10, 8, WOOD); p.set(13, 0, "#e0a030");
}
function f_clothtable(p) { // a white-cloth table: the cloth hanging to the floor, a candle and two glasses
  R(p, 1, 5, 14, 6, "#eeeae0"); box(p, 2, 7, 13, 15, "#e2ddcc"); H(p, 2, 13, 11, "#cfc8b4"); V(p, 7, 2, 4, "#f2ead8"); p.set(7, 1, "#e0a030"); p.set(3, 4, "#9ed0e0"); p.set(12, 4, "#9ed0e0");
}
function f_kbbqtable(p) { // a Korean barbecue table: a wooden top with a round gas grill in the middle, its extractor hose above
  R(p, 0, 7, 15, 8, WOODL); oval(p, 5, 6, 10, 8, "#26272a"); H(p, 6, 9, 7, "#e07a20"); V(p, 7, 0, 5, "#c9ced3"); V(p, 8, 0, 5, "#9aa1a8"); legs(p, 1, 14, 9, 15, WOODD);
}
function f_beertower(p) { // a beer tap tower: a chrome T on a drip tray, three coloured tap handles
  H(p, 2, 13, 5, "#c9ced3"); H(p, 2, 13, 6, "#9aa1a8"); for (const [x, c] of [[3, "#d9b13b"], [7, "#3f6b3a"], [11, "#c8402f"]]) R(p, x, 0, x + 1, 4, c);
  V(p, 7, 7, 13, "#c9ced3"); R(p, 2, 14, 13, 15, "#5e666d");
}
function f_lobstertank(p) { // a lobster tank: blue water behind glass, two red lobsters, bubbles, a wooden base
  box(p, 0, 1, 15, 10, "#4f8aa8"); H(p, 0, 15, 1, "#2a3a44"); R(p, 2, 7, 5, 8, "#b8402a"); R(p, 9, 5, 12, 6, "#c8502a"); p.set(1, 6, "#b8402a"); p.set(13, 4, "#c8502a");
  for (const [x, y] of [[7, 3], [8, 5], [6, 2]]) p.set(x, y, "#bcdbe6"); box(p, 0, 11, 15, 15, WOODD);
}
function f_pastrycase(p) { // a pastry case: curved glass over shelves of cakes and croissants, a wooden base
  line(p, 0, 7, 3, 1, "#bcdbe6"); R(p, 3, 1, 15, 8, "#bcdbe6"); H(p, 3, 15, 4, "#eef0f2");
  for (const [x, y, c] of [[4, 2, "#d49a5a"], [7, 2, "#e88aa0"], [11, 2, "#5a3424"], [5, 6, "#f0d080"], [9, 6, "#d49a5a"], [13, 6, "#c8402f"]]) R(p, x, y, x + 1, y + 1, c);
  box(p, 0, 9, 15, 15, WOODD);
}
function f_dipcabinet(p) { // a dipping cabinet: a low white freezer, tubs of ice cream under its sloped glass
  line(p, 0, 7, 3, 3, "#bcdbe6"); R(p, 3, 3, 15, 7, "#bcdbe6");
  for (const [x, c] of [[3, "#f2ead8"], [6, "#e88aa0"], [9, "#5a3424"], [12, "#9cc46e"]]) R(p, x, 5, x + 2, 7, c); box(p, 0, 8, 15, 15, "#e4e6e8"); H(p, 1, 14, 11, "#9aa1a8");
}
function f_winerack(p) { // a wine rack: a wooden lattice of bottle ends, dark red and green
  box(p, 1, 0, 14, 15, WOODD); for (let y = 2; y <= 13; y += 3) for (let x = 3; x <= 12; x += 3) disc(p, x, y, 1, (x + y) % 2 ? "#5a1418" : "#2a4a2a");
}
function f_dryshelf(p) { // dry-goods shelving: steel shelves of flour sacks, rice bags and big tins
  legs(p, 1, 14, 0, 15, STEELD); for (const y of [5, 10, 15]) H(p, 1, 14, y, STEEL);
  R(p, 2, 1, 6, 4, "#e2ddcc"); R(p, 8, 2, 12, 4, "#b8a27a"); R(p, 2, 7, 4, 9, "#9aa0a6"); R(p, 6, 7, 8, 9, "#9aa0a6"); R(p, 10, 6, 13, 9, "#e2ddcc"); R(p, 3, 12, 12, 14, "#c9b48a");
}

// ---------- bunkers (issue #26) ----------
function f_hazmatrack(p) { // a steel rail on legs with two yellow hazmat suits hanging, their dark visors
  H(p, 1, 14, 1, STEEL); legs(p, 1, 14, 1, 15, STEELD);
  for (const x of [3, 9]) { R(p, x, 2, x + 3, 12, "#d8c040"); R(p, x + 1, 3, x + 2, 4, "#2a3a44"); H(p, x, x + 3, 8, "#a89020"); }
}
function f_rationshelf(p) { // a steel shelf of olive MRE boxes and tins
  legs(p, 1, 14, 0, 15, STEELD);
  for (const y of [4, 9, 14]) H(p, 1, 14, y, STEEL);
  R(p, 2, 1, 6, 3, "#6a6a3a"); R(p, 8, 1, 12, 3, "#8a7a4a"); R(p, 2, 6, 4, 8, "#9aa0a6"); R(p, 6, 6, 8, 8, "#9aa0a6"); R(p, 10, 6, 13, 8, "#6a6a3a"); R(p, 3, 11, 12, 13, "#8a7a4a");
}
function f_handfilter(p) { // a hand-cranked air filter: an olive box, a round filter canister, the crank handle
  box(p, 2, 6, 13, 14, "#5a6a4a"); disc(p, 7, 4, 3, "#8a949c"); ring(p, 7, 4, 3, "#5e666d");
  line(p, 11, 6, 14, 2, "#26272a"); p.set(14, 1, "#c8402f"); H(p, 3, 12, 10, "#3f4a34");
}
function f_screens(p) { // a wall of dead screens: a grid of six dark monitors in a steel frame, one still glowing
  box(p, 0, 1, 15, 12, "#3a3d42");
  for (const [x, y] of [[1, 2], [6, 2], [11, 2], [1, 7], [6, 7], [11, 7]]) R(p, x, y, x + 3, y + 3, "#1c2a30");
  R(p, 7, 3, 8, 4, "#5ad06a"); legs(p, 3, 12, 13, 15, STEELD);
}
function f_maptable(p) { // a map table: a big sheet map with a red route and pins on a steel table
  R(p, 0, 4, 15, 9, "#d9cfa8"); R(p, 2, 5, 6, 7, "#8aa070"); line(p, 1, 8, 13, 5, "#c8402f"); p.set(10, 6, "#3a6fb0"); p.set(4, 8, "#3a6fb0");
  H(p, 0, 15, 10, STEELD); legs(p, 1, 14, 11, 15, STEELD);
}
function f_radioconsole(p) { // a military radio console: olive cabinet, a dial face, a handset, amber lamps
  box(p, 1, 3, 14, 15, "#4a5a3a"); R(p, 2, 4, 8, 8, "#1c2a30"); disc(p, 11, 6, 2, "#c9ced3");
  for (const x of [3, 5, 7]) p.set(x, 10, "#e0a030"); line(p, 9, 10, 13, 13, "#26272a"); R(p, 12, 0, 12, 2, "#26272a");
}
function f_footlocker(p) { // a footlocker: an olive trunk with steel corners, two latches, a stencilled band
  box(p, 1, 5, 14, 14, "#4a5a30"); H(p, 1, 14, 8, "#5a6a3a");
  for (const [x, y] of [[1, 5], [14, 5], [1, 14], [14, 14]]) p.set(x, y, "#c9ced3");
  p.set(5, 8, "#c9ced3"); p.set(10, 8, "#c9ced3"); H(p, 4, 11, 11, "#e2ddcc");
}
function f_batteries(p) { // a rack of black batteries on steel shelves, red and black terminals, a cable run
  legs(p, 1, 14, 0, 15, STEELD); for (const y of [7, 14]) H(p, 1, 14, y, STEEL);
  for (const x of [2, 6, 10]) { R(p, x, 2, x + 2, 6, "#26272a"); p.set(x, 1, "#c8402f"); p.set(x + 2, 1, "#9aa0a6"); R(p, x, 9, x + 2, 13, "#26272a"); }
  line(p, 3, 1, 11, 1, "#d9b13b");
}

// ---------- libraries (issue #34) ----------
const SPINES = ["#7a3b32", "#2d4a3c", "#3a5f8e", "#c9873c", "#5b3a7a", "#8a7a4a", "#2a2a2e"];
const spines = (p, x0, x1, y0, y1, k = 0) => { for (let x = x0; x <= x1; x++) V(p, x, y0 + ((x * 7 + k) % 3 === 0 ? 1 : 0), y1, SPINES[(x * 3 + k) % SPINES.length]); };
function f_bookstack(p) { // a tall steel library stack: four shelves of spines
  legs(p, 1, 14, 0, 15, STEELD); for (const y of [0, 4, 8, 12, 15]) H(p, 1, 14, y, STEEL);
  for (const [y0, y1, k] of [[1, 3, 0], [5, 7, 2], [9, 11, 4], [13, 14, 1]]) spines(p, 2, 13, y0, y1, k);
}
function f_lowshelf(p) { // low pale-wood shelving: two shelves of books, waist high
  box(p, 1, 6, 14, 15, "#c9b48a"); H(p, 1, 14, 10, "#957f58");
  spines(p, 2, 13, 7, 9, 3); spines(p, 2, 13, 11, 14, 5);
}
function f_mobileshelf(p) { // compact mobile shelving: a pale steel carriage on its rails, the end panel's wheel
  box(p, 1, 0, 14, 13, "#c9c7bd"); for (const x of [5, 10]) V(p, x, 1, 12, "#9aa0a6");
  ring(p, 7, 6, 2, "#5e666d"); p.set(7, 6, "#5e666d"); H(p, 0, 15, 14, STEELD); H(p, 0, 15, 15, "#3a3d42");
}
function f_cardcat(p) { // a card catalogue: a grid of small oak drawers, each with a brass pull, on short legs
  box(p, 1, 1, 14, 12, WOOD);
  for (let y = 1; y <= 10; y += 3) for (let x = 1; x <= 12; x += 3) { R(p, x + 1, y + 1, x + 2, y + 2, WOODL); p.set(x + 1, y + 2, "#d9b13b"); }
  legs(p, 2, 13, 13, 15, WOODD);
}
function f_mapcase(p) { // a map cabinet: wide shallow drawers, a map's edge curling out of one
  box(p, 0, 4, 15, 15, "#7d8a7a"); for (const y of [6, 8, 10, 12, 14]) H(p, 1, 14, y, "#5a6658");
  for (const y of [5, 7, 9, 11, 13]) H(p, 6, 9, y, "#c9ced3");
  R(p, 2, 3, 9, 4, "#d9cfa8"); line(p, 9, 3, 12, 1, "#d9cfa8"); p.set(5, 3, "#8aa070");
}
function f_booktruck(p) { // a library book cart: two sloped shelves of books on castors
  legs(p, 2, 13, 2, 13, STEELD); H(p, 2, 13, 7, STEEL); H(p, 2, 13, 12, STEEL);
  spines(p, 3, 12, 3, 6, 1); spines(p, 3, 12, 8, 11, 4);
  for (const x of [2, 13]) disc(p, x, 14, 1, "#26272a");
}
function f_bookreturn(p) { // a book return bin: a blue box with a slot and a chrome flap
  box(p, 2, 2, 13, 15, "#2d5a8a"); R(p, 4, 5, 11, 6, "#1c2026"); H(p, 4, 11, 4, "#c9ced3");
  H(p, 4, 11, 10, "#e8c04a"); H(p, 2, 13, 15, "#1f3d5e");
}
function f_computer(p) { // a computer desk: a monitor and its keyboard on a steel-legged desk
  box(p, 4, 0, 11, 6, "#26272a"); R(p, 5, 1, 10, 5, "#1c2a30"); p.set(6, 2, "#5ad06a"); V(p, 7, 7, 8, "#26272a");
  H(p, 0, 15, 9, "#c9b48a"); R(p, 4, 8, 11, 8, "#d8d4c8"); legs(p, 1, 14, 10, 15, STEELD);
}
function f_printer(p) { // an office printer: a beige box, its paper tray and the sheet coming out
  box(p, 1, 5, 14, 13, "#c9bfa8"); R(p, 3, 3, 12, 4, "#f2efe6"); H(p, 2, 13, 9, "#8a8270");
  R(p, 3, 11, 12, 12, "#26272a"); p.set(12, 7, "#5ad06a"); H(p, 1, 14, 14, "#6a6458");
}
function f_microfilm(p) { // a microfilm reader: a beige hood with its lit screen, the reels beneath
  box(p, 3, 0, 12, 9, "#c9bfa8"); R(p, 4, 1, 11, 6, "#8ab0b8"); H(p, 5, 9, 3, "#5a7880");
  disc(p, 5, 11, 1, "#26272a"); disc(p, 10, 11, 1, "#26272a"); R(p, 1, 12, 14, 13, "#94704a"); legs(p, 2, 13, 14, 15, STEELD);
}
function f_selfcheck(p) { // a self-check kiosk: a steel column, a tilted screen glowing green, a scanner pad
  R(p, 6, 6, 9, 15, "#8a949c"); box(p, 3, 0, 12, 5, "#26272a"); R(p, 4, 1, 11, 4, "#3a6a4a"); p.set(5, 2, "#c9f0c9");
  R(p, 4, 7, 11, 8, "#5e666d"); p.set(10, 7, "#c8402f"); H(p, 4, 11, 15, "#5e666d");
}
function f_readtable(p) { // a long reading table with two green banker's lamps
  R(p, 0, 9, 15, 10, WOODD); legs(p, 1, 14, 11, 15, WOODD);
  for (const x of [3, 11]) { V(p, x, 5, 8, "#d9b13b"); R(p, x - 2, 3, x + 2, 4, "#2f6a3a"); H(p, x - 2, x + 2, 5, "#d9b13b"); }
}
function f_carrel(p) { // a study carrel: a desk with a fabric screen round three sides
  box(p, 0, 1, 15, 9, "#5a4a62"); R(p, 2, 3, 13, 8, "#463a4e"); H(p, 0, 15, 10, WOODL); legs(p, 1, 14, 11, 15, WOODD);
}
function f_globe(p) { // a globe on its brass meridian and a wooden stand
  disc(p, 7, 6, 5, "#3a6f9a"); R(p, 5, 3, 8, 5, "#8aa070"); R(p, 8, 7, 10, 9, "#8aa070"); ring(p, 7, 6, 6, "#d9b13b");
  V(p, 7, 12, 14, "#d9b13b"); H(p, 4, 10, 15, WOODD);
}
function f_lectern(p) { // a lectern: a slanted top on a wooden post and its foot
  line(p, 3, 4, 12, 1, WOODL); R(p, 3, 4, 12, 5, WOOD); V(p, 7, 6, 13, WOODD); V(p, 8, 6, 13, WOOD); H(p, 3, 12, 14, WOODD); H(p, 4, 11, 15, WOODD);
}
function f_woodstove(p) { // a cast-iron wood stove: its glowing door, its legs and the pipe up
  R(p, 7, 0, 8, 4, "#3a3d42"); box(p, 2, 5, 13, 13, "#26272a"); R(p, 4, 7, 11, 11, "#3a3d42"); R(p, 5, 8, 10, 10, "#e0a030");
  p.set(7, 9, "#c8402f"); legs(p, 3, 12, 14, 15, "#26272a");
}

// ---------- labs (issue #37) ----------
function f_labfreezer(p) { // an upright lab freezer: white enamel, a full-height door with its long handle, a green display
  box(p, 3, 0, 12, 15, "#dad8d0"); H(p, 3, 12, 3, "#b4b2aa"); V(p, 11, 5, 12, "#9aa1a8");
  R(p, 5, 1, 8, 2, "#1c2a30"); p.set(6, 1, "#5ad06a"); p.set(7, 1, "#5ad06a"); legs(p, 4, 11, 15, 15, STEELD);
}

function f_drum(p) { // a red 200-litre steel drum: two rolling hoops, the bung on its lid
  box(p, 3, 1, 12, 15, "#8e3028"); H(p, 3, 12, 5, "#6a241e"); H(p, 3, 12, 10, "#6a241e"); R(p, 4, 0, 11, 1, "#a8483c"); p.set(9, 0, "#26272a");
}
// ---------- amusement parks (issue #60) ----------
function f_gokart(p) { // a red go-kart from the side: four fat tyres, the low tub, the seat back and the wheel
  R(p, 2, 8, 13, 10, "#8e3028"); H(p, 2, 13, 8, "#b04a3e"); R(p, 9, 5, 10, 8, "#26272a"); line(p, 4, 7, 6, 5, "#9aa1a8");
  for (const x of [1, 11]) { R(p, x, 10, x + 3, 13, "#26272a"); p.set(x + 1, 11, "#5a5c60"); }
}
// ---------- military bases, air bases, airports and prisons (issue #25) ----------
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

// ---------- the office buildings' pieces (#27, sim/officelayout.js) ----------
function f_dentalchair(p) { // a dental chair: a teal couch reclined on its chrome column, the lamp on its arm over it
  line(p, 1, 4, 5, 8, "#4f7b88"); R(p, 5, 8, 14, 10, "#4f7b88"); H(p, 5, 14, 8, "#6f9ba8"); R(p, 8, 11, 10, 13, "#c9ced3"); R(p, 5, 14, 13, 15, STEELD);
  V(p, 13, 1, 7, STEEL); H(p, 9, 13, 1, STEEL); oval(p, 7, 2, 11, 4, "#e8e4d8"); p.set(9, 3, "#f2e6a0");
}
function f_podium(p) { // a podium: a dark wooden lectern, its slanted top, a microphone on a gooseneck
  line(p, 3, 4, 12, 2, "#a06a3a"); box(p, 4, 5, 11, 15, "#5f3c20"); R(p, 6, 7, 9, 13, "#7a4a28"); H(p, 3, 12, 15, "#3a2414");
  line(p, 10, 2, 12, 0, "#383b41"); p.set(12, 0, "#202226");
}
function f_headsetdesk(p) { // a headset desk: a small grey desk, its monitor glowing, the headset on the keyboard
  H(p, 0, 15, 9, "#a89c84"); R(p, 0, 10, 15, 10, "#7a6f5a"); legs(p, 1, 14, 11, 15, STEELD);
  box(p, 3, 1, 10, 7, "#202226"); R(p, 4, 2, 9, 6, "#3f8a5a"); V(p, 6, 7, 8, "#383b41"); ring(p, 13, 6, 2, "#26272a"); p.set(13, 6, "#26272a");
}
function f_beanbag(p) { // a beanbag: a slumped round sack of red vinyl, its seam
  oval(p, 1, 5, 14, 15, "#a83a30"); oval(p, 3, 3, 11, 10, "#c8503f"); line(p, 4, 9, 12, 13, "#7a2a20"); p.set(6, 5, "#e07060");
}
function f_camera(p) { // a TV camera on its tripod: the black body, the lens, the red tally light, three legs
  box(p, 3, 2, 12, 7, "#202226"); R(p, 0, 3, 3, 6, "#383b41"); disc(p, 1, 4, 1, "#5f8aa0"); p.set(11, 1, "#c8402f"); R(p, 12, 3, 15, 4, "#383b41");
  V(p, 8, 8, 9, "#4a5056"); line(p, 8, 9, 3, 15, "#4a5056"); line(p, 8, 9, 13, 15, "#4a5056"); V(p, 8, 9, 15, "#4a5056");
}
function f_studiolight(p) { // a studio light: a black lamp housing with its glowing face and barn doors, on a stand
  box(p, 3, 1, 12, 6, "#202226"); R(p, 4, 2, 11, 5, "#f2e6a0"); line(p, 2, 0, 3, 1, "#383b41"); line(p, 13, 0, 12, 1, "#383b41");
  V(p, 7, 7, 13, "#383b41"); line(p, 7, 13, 3, 15, "#383b41"); line(p, 7, 13, 12, 15, "#383b41");
}
function f_newsdesk(p) { // a news desk: a glossy blue curved front, the station's band across it, a chrome top
  H(p, 0, 15, 5, "#c9ced3"); box(p, 0, 6, 15, 15, "#2f5d8a"); R(p, 1, 9, 14, 10, "#d9cfa8"); R(p, 5, 9, 9, 10, "#c8402f"); H(p, 1, 14, 14, "#1f3f60");
  R(p, 10, 2, 13, 4, "#202226");
}
function f_sorter(p) { // a mail sorter: a wooden cabinet of pigeonholes, letters in some, drawers below
  box(p, 0, 0, 15, 15, "#7a5230"); for (let y = 1; y <= 9; y += 3) for (let x = 1; x <= 13; x += 3) { R(p, x, y, x + 1, y + 1, "#3a2414"); if ((x + y) % 2) p.set(x, y + 1, "#e8e0c8"); }
  H(p, 1, 14, 12, "#5f3c20"); p.set(7, 13, "#d9b13b");
}
function f_plotter(p) { // a plotter: a long beige body on two legs, the paper roll feeding out of it
  box(p, 0, 3, 15, 8, "#d8d4c8"); H(p, 0, 15, 3, "#efece2"); R(p, 11, 4, 14, 5, "#383b41"); p.set(13, 6, "#6fe08a");
  R(p, 2, 9, 13, 10, "#eef0f2"); legs(p, 2, 13, 11, 15, "#383b41");
}
function f_liquorcab(p) { // a liquor cabinet: dark wood, glass doors with bottles behind them, a carved top
  R(p, 1, 0, 14, 1, "#5f3c20"); box(p, 2, 2, 13, 15, "#4a2a18"); R(p, 3, 3, 12, 10, "#2a3a44");
  for (const [x, c] of [[4, "#c9873c"], [6, "#4f8a3a"], [8, "#a83a30"], [10, "#e8c04a"]]) { V(p, x, 5, 9, c); p.set(x, 4, c); }
  V(p, 7, 3, 10, "#5f3c20"); H(p, 3, 12, 12, "#5f3c20");
}

// ---------- shopping malls (issue #30) ----------
function f_kiosk(p) { // a kiosk cart: a striped awning on poles over a wooden cart of trinkets, two wheels
  for (let x = 0; x <= 15; x++) H(p, x, x, 1, x % 4 < 2 ? "#c8402f" : "#f0e6c8"); H(p, 0, 15, 2, "#7a1c18");
  V(p, 1, 3, 8, STEELD); V(p, 14, 3, 8, STEELD); box(p, 0, 8, 15, 13, WOODL); H(p, 1, 14, 9, "#e6c23a");
  for (const x of [3, 6, 9, 12]) p.set(x, 7, ["#3a6fb0", "#c8402f", "#5ad06a", "#e6c23a"][x % 4]);
  disc(p, 3, 14, 1, "#26272a"); disc(p, 12, 14, 1, "#26272a");
}
function f_concession(p) { // a concession counter: a red front, the popcorn machine's glass box of popcorn, cups on top
  box(p, 0, 8, 15, 15, "#a8302a"); H(p, 0, 15, 8, "#e8e0c8"); R(p, 2, 10, 13, 11, "#e6c23a");
  box(p, 8, 1, 14, 7, "#c9ced3"); R(p, 9, 3, 13, 6, "#f0e0a0"); R(p, 9, 2, 13, 2, "#c8402f");
  R(p, 2, 5, 3, 7, "#e8e0c8"); R(p, 5, 5, 6, 7, "#c8402f");
}
function f_arcadecab(p) { // an arcade cabinet: a tall black body, the marquee lit, the screen, the joystick and buttons
  box(p, 3, 0, 12, 15, "#26272a"); R(p, 4, 1, 11, 2, "#e0a030"); R(p, 4, 4, 11, 8, "#1c3a5a"); R(p, 5, 5, 8, 6, "#5ad06a");
  R(p, 3, 9, 12, 10, "#3a3b40"); p.set(5, 9, "#c8402f"); p.set(8, 9, "#3a6fb0"); p.set(10, 9, "#e6c23a"); R(p, 6, 12, 9, 13, "#3a3b40");
}
function f_projector(p) { // a film projector: two reels on arms, the grey body, the lens
  disc(p, 4, 3, 3, "#3a3b40"); disc(p, 11, 3, 3, "#3a3b40"); p.set(4, 3, STEEL); p.set(11, 3, STEEL);
  box(p, 2, 7, 13, 12, "#6a7178"); R(p, 13, 9, 15, 10, "#26272a"); p.set(15, 9, "#bcdbe6"); legs(p, 4, 11, 13, 15, STEELD);
}
function f_mannequin(p) { // a shop mannequin: a white head and torso, arms down, on a steel stand
  disc(p, 8, 2, 2, "#ece6da"); R(p, 7, 4, 8, 4, "#ece6da"); box(p, 5, 5, 10, 10, "#ece6da"); V(p, 4, 5, 10, "#d8d0c0"); V(p, 11, 5, 10, "#d8d0c0");
  V(p, 7, 11, 13, "#9aa1a8"); H(p, 5, 10, 14, "#5e666d");
}

// ---------- museums (issue #58) ----------
function f_sculpture(p) { // a white marble figure on its grey plinth
  box(p, 4, 11, 11, 15, "#8d8a82"); R(p, 6, 4, 9, 10, "#e8e4dc"); disc(p, 7, 2, 2, "#f2efe8"); V(p, 5, 5, 8, "#d8d2c6"); V(p, 10, 5, 8, "#d8d2c6");
  V(p, 9, 4, 10, "#c9c3b6"); H(p, 4, 11, 11, "#a8a49c");
}
function f_artwork(p) { // a gilt-framed painting: a landscape in oils
  box(p, 1, 2, 14, 13, "#d9b23a"); R(p, 2, 3, 13, 7, "#6a90b8"); R(p, 2, 8, 13, 12, "#5f8a3c"); line(p, 2, 9, 7, 6, "#7a6a4a"); line(p, 7, 6, 13, 9, "#7a6a4a");
  disc(p, 11, 4, 1, "#f0d070"); H(p, 1, 14, 14, "#8a6a20");
}
function f_bust(p) { // a marble bust on a short column
  disc(p, 7, 3, 3, "#ece8e0"); R(p, 6, 6, 9, 7, "#ddd8ce"); R(p, 3, 7, 12, 9, "#e2ddd2"); p.set(6, 3, "#9a968c"); p.set(9, 3, "#9a968c");
  R(p, 6, 10, 9, 13, "#a8a49c"); H(p, 4, 11, 14, "#8d8a82"); H(p, 4, 11, 15, "#6a6760");
}
function f_vase(p) { // a blue-and-white urn
  R(p, 6, 1, 9, 2, "#2d4a8a"); R(p, 5, 3, 10, 4, "#e8e6dc"); R(p, 3, 5, 12, 11, "#e8e6dc"); H(p, 3, 12, 7, "#2d4a8a"); H(p, 4, 11, 10, "#2d4a8a");
  p.set(6, 8, "#2d4a8a"); p.set(9, 8, "#2d4a8a"); R(p, 5, 12, 10, 13, "#d8d6cc"); R(p, 5, 14, 10, 15, "#2d4a8a");
}
function f_armourstand(p) { // a suit of plate armour: the helm's visor, the breastplate, the tassets, greaves
  disc(p, 7, 2, 2, "#b8bec4"); H(p, 6, 9, 2, "#26272a"); box(p, 4, 5, 11, 9, "#a8b0b6"); V(p, 7, 5, 9, "#d8dde0");
  R(p, 2, 5, 3, 9, "#8c9298"); R(p, 12, 5, 13, 9, "#8c9298"); R(p, 5, 10, 10, 11, "#8c9298"); R(p, 5, 12, 6, 15, "#a8b0b6"); R(p, 9, 12, 10, 15, "#a8b0b6");
}
function f_shipmodel(p) { // a sailing ship model on its stand: the hull, three masts, the sails
  R(p, 2, 10, 13, 11, "#5a3424"); R(p, 3, 12, 12, 12, "#3e2418"); for (const x of [4, 7, 10]) V(p, x, 1, 9, "#5f3c20");
  R(p, 3, 2, 5, 5, "#e2ddcc"); R(p, 6, 1, 8, 6, "#e2ddcc"); R(p, 9, 3, 11, 6, "#e2ddcc"); R(p, 6, 13, 9, 14, "#8a5a30"); H(p, 4, 11, 15, "#5f3c20");
}
function f_waxfigure(p) { // a wax figure: a lifelike face, a dark suit, a red tie
  disc(p, 7, 2, 2, "#e8c8a8"); H(p, 6, 8, 0, "#4a3020"); p.set(6, 2, "#26272a"); p.set(8, 2, "#26272a");
  box(p, 4, 5, 10, 10, "#2a3a5a"); V(p, 7, 5, 8, "#a8241c"); R(p, 2, 5, 3, 10, "#2a3a5a"); R(p, 11, 5, 12, 10, "#2a3a5a"); R(p, 5, 11, 6, 15, "#26272a"); R(p, 8, 11, 9, 15, "#26272a");
}
function f_boat(p) { // a rowing boat's clinker hull, a blue band, an oar inside
  line(p, 0, 7, 3, 12, "#2d5a8a"); line(p, 15, 7, 12, 12, "#2d5a8a"); R(p, 3, 9, 12, 12, "#2d5a8a"); H(p, 0, 15, 7, "#e8e4dc"); H(p, 1, 14, 8, "#a06a3a");
  H(p, 4, 11, 13, "#1f3d5e"); line(p, 2, 4, 13, 8, "#a2713f");
}
// ---------- gyms and bowling alleys (issue #56, sim/reclayout.js) ----------
function f_treadmill(p) { // a treadmill: the black belt on its deck, the uprights, the console with its screen
  line(p, 1, 14, 13, 11, "#26272a"); H(p, 1, 14, 15, "#3a3b40"); R(p, 1, 12, 13, 13, "#1f1f22");
  V(p, 12, 3, 12, STEEL); V(p, 14, 3, 12, STEEL); R(p, 10, 1, 15, 3, "#3a3b40"); R(p, 11, 2, 14, 2, "#5ad06a");
}
function f_exbike(p) { // an exercise bike: the flywheel, the frame, the saddle and the bars
  disc(p, 5, 11, 3, "#3a3b40"); p.set(5, 11, STEEL); line(p, 5, 11, 11, 4, "#26272a"); V(p, 11, 4, 13, "#26272a"); H(p, 8, 14, 14, STEELD);
  R(p, 9, 3, 13, 3, "#5a3424"); line(p, 5, 8, 4, 2, "#26272a"); H(p, 2, 6, 2, STEEL);
}
function f_rower(p) { // a rowing machine: the long rail, the sliding seat, the fan wheel at the front, the handle
  H(p, 1, 15, 12, STEEL); H(p, 1, 15, 13, STEELD); disc(p, 3, 9, 3, "#26272a"); p.set(3, 9, STEEL);
  R(p, 8, 10, 11, 11, "#26272a"); line(p, 4, 7, 7, 6, "#9aa1a8"); H(p, 6, 9, 6, "#26272a"); for (const x of [2, 14]) V(p, x, 13, 15, STEELD);
}
function f_squatrack(p) { // a squat rack: four black uprights, a loaded bar across the hooks
  for (const x of [2, 5, 10, 13]) V(p, x, 1, 15, "#26272a"); H(p, 2, 13, 1, "#26272a");
  H(p, 0, 15, 7, "#c9ced3"); for (const x of [0, 15]) R(p, x === 0 ? 0 : 14, 4, x === 0 ? 1 : 15, 10, "#1f1f22");
}
function f_dumbbells(p) { // a dumbbell rack: two tiers of black dumbbells, chrome handles, on a steel frame
  for (const y of [5, 10]) { H(p, 1, 14, y + 2, STEEL); for (let x = 1; x <= 12; x += 4) { R(p, x, y, x, y + 1, "#1f1f22"); H(p, x + 1, x + 1, y, "#c9ced3"); R(p, x + 2, y, x + 2, y + 1, "#1f1f22"); } }
  legs(p, 2, 13, 13, 15, STEELD);
}
function f_punchbag(p) { // a heavy bag: red leather hanging from a chain on its stand
  V(p, 2, 0, 15, "#26272a"); H(p, 2, 9, 0, "#26272a"); V(p, 8, 1, 2, "#9aa1a8"); box(p, 5, 3, 11, 13, "#a8302a"); V(p, 6, 4, 12, "#c8402f"); H(p, 0, 5, 15, "#26272a");
}
function f_yogamats(p) { // a bin of rolled yoga mats in four colours
  box(p, 2, 9, 13, 15, STEEL);
  for (const [x, c] of [[3, "#7a4fa0"], [6, "#3a8a8a"], [9, "#c8602a"], [12, "#4f7a3a"]]) { R(p, x, 2, x + 1, 9, c); p.set(x, 2, "#e8e0c8"); }
}
function f_ballrack(p) { // a rack of house balls: two rows of coloured balls on a steel frame
  H(p, 0, 15, 8, STEEL); H(p, 0, 15, 14, STEEL); legs(p, 1, 14, 8, 15, STEELD);
  [["#2a4a8a", 2], ["#a8302a", 7], ["#2a6a3a", 12]].forEach(([c, x]) => disc(p, x, 5, 2, c));
  [["#e0a030", 4], ["#5a2a7a", 10]].forEach(([c, x]) => disc(p, x, 11, 2, c));
}
function f_shoecubby(p) { // shoe cubbies: a grid of wooden pigeonholes, a pair of red and blue bowling shoes in some
  box(p, 1, 0, 14, 15, WOOD);
  for (const x of [5, 10]) V(p, x, 0, 15, WOODD); for (const y of [4, 8, 12]) H(p, 1, 14, y, WOODD);
  for (const [x, y] of [[2, 2], [7, 6], [12, 10], [2, 10], [12, 2]]) { R(p, x, y, x + 1, y + 1, "#a8302a"); p.set(x + 1, y, "#2a4a8a"); }
}
function f_scorer(p) { // a scoring console: the screen on its stand, the keypad below
  box(p, 3, 1, 12, 8, "#26272a"); R(p, 4, 2, 11, 7, "#1c3a5a"); for (const y of [3, 5]) H(p, 5, 10, y, "#5ad06a");
  V(p, 7, 9, 13, STEEL); V(p, 8, 9, 13, STEELD); R(p, 5, 10, 10, 11, "#3a3b40"); H(p, 4, 11, 14, STEELD); H(p, 3, 12, 15, STEELD);
}

export const GEAR_ART = {
  f_treadmill, f_exbike, f_rower, f_squatrack, f_dumbbells, f_punchbag, f_yogamats, f_ballrack, f_shoecubby, f_scorer,
  f_kiosk, f_concession, f_arcadecab, f_projector, f_mannequin,
  f_dormdesk, f_mailboxes, f_campusbench,
  f_bookstack, f_lowshelf, f_mobileshelf, f_cardcat, f_mapcase, f_booktruck, f_bookreturn, f_computer, f_printer, f_microfilm, f_selfcheck, f_readtable, f_carrel, f_globe, f_lectern, f_woodstove,
  f_drum, f_labfreezer, f_gokart,
  f_frontdesk, f_suitcase, f_minifridge, f_luggagecart, f_banquet, f_loungechair, f_lounger,
  f_flattop, f_deckoven, f_conveyoroven, f_wokrange, f_smoker, f_chargrill, f_gyrospit, f_stockpot, f_steamtable, f_espresso, f_softserve, f_slicer, f_tortillapress,
  f_extinguisher, f_saladbar, f_menuboard, f_patiotable, f_hoststand, f_clothtable, f_kbbqtable, f_beertower, f_lobstertank, f_pastrycase, f_dipcabinet, f_winerack, f_dryshelf,
  f_freezercase, f_islandfreezer, f_meatcase, f_freezershelf, f_producebin, f_breadrack, f_selfcheckout, f_aislesign,
  f_hazmatrack, f_rationshelf, f_handfilter, f_screens, f_maptable, f_radioconsole, f_footlocker, f_batteries,
  f_freezercase, f_islandfreezer, f_meatcase, f_freezershelf, f_producebin, f_breadrack, f_selfcheckout, f_aislesign,
  f_luggage, f_ammocrate, f_fuelbladder, f_gateseat, f_intakelocker,
  f_dentalchair, f_podium, f_headsetdesk, f_beanbag, f_camera, f_studiolight, f_newsdesk, f_sorter, f_plotter, f_liquorcab,
  f_medcart, f_drugsafe, f_instcab, f_morguelocker, f_autopsy, f_wheelchair, f_vettable, f_curtain, f_linencart, f_monitor, f_crib, f_exambed,
  f_bed, f_bunk, f_hospbed, f_gurney, f_ivstand, f_hay, f_barrel, f_range, f_dishwasher, f_washer, f_dryer, f_fryer, f_coldshelf,
  f_icemachine, f_watercooler, f_compressor, f_tank, f_jukebox, f_pooltable, f_clothesrack, f_pottingbench, f_palletrack, f_tirerack,
  f_saddlerack, f_secdesk, f_deposit, f_ammocab, f_evlocker, f_turnout, f_schoollocker, f_sportcage, f_labbench, f_weightbench,
  f_candles, f_pulpit, f_cubicle, f_whiteboard, f_keyrack, f_stanchion, f_serverrack, f_copier,
  f_shelf, f_locker, f_cabinet, f_counter, f_crate, f_rack, f_filing, f_bookshelf, f_wardrobe, f_dresser, f_nightstand, f_tvstand, f_medcab,
  f_vending, f_checkout, f_displaycase, f_toolchest, f_gunrack, f_schooldesk, f_sofa, f_armchair, f_chair, f_barstool, f_piano, f_pew,
  f_table, f_desk, f_teacherdesk, f_workbench, f_optable, f_plant, f_floorlamp, f_painting, f_wallclock,
  f_sculpture, f_artwork, f_bust, f_vase, f_armourstand, f_shipmodel, f_waxfigure, f_boat, // museums (issue #58)
};
