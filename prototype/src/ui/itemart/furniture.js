// Furniture at the base (#20; sim/furniture.js, sim/data-basefurniture.js): the found pieces' item forms (#8's
// data-furniture.js FURNITURE_GEAR f_<kind>), each seen from the front: a wood or steel body, its doors, drawers,
// shelves or cushions.
import { R, H, V, line, oval, box } from "./kit.js";

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

export const GEAR_ART = {
  f_shelf, f_locker, f_cabinet, f_counter, f_crate, f_rack, f_filing, f_bookshelf, f_wardrobe, f_dresser, f_nightstand, f_tvstand, f_medcab,
  f_vending, f_checkout, f_displaycase, f_toolchest, f_gunrack, f_schooldesk, f_sofa, f_armchair, f_chair, f_barstool, f_piano, f_pew,
  f_table, f_desk, f_teacherdesk, f_workbench, f_optable, f_plant, f_floorlamp, f_painting, f_wallclock,
};
