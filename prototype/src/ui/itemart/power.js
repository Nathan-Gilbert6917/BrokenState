// Item icons, the power family (ui/itemart.js; the kit and the rules: ui/itemart/kit.js): the found generators, the
// mounted spotlight and the fridge (sim/data-power.js, sim/electric.js). The generators run small to big: a red
// suitcase inverter with a carry handle, a yellow wheeled house set in its tube frame, an orange contractor's set in a
// roll cage, a grey standby cabinet with louvres, and the Army's olive skid-mounted set with its stencil. The
// spotlight is a big round lamp head on a yoke and stand; the fridge a tall white two-door box.
import { C, R, H, V, line, disc, ring, box, shade, text } from "./kit.js";

function genset_inverter(p) { // a red suitcase inverter: a rounded case, a carry handle across the top, a vent and a panel
  R(p, 5, 2, 10, 3, C.black); R(p, 5, 3, 5, 5, C.black); R(p, 10, 3, 10, 5, C.black);
  box(p, 2, 5, 13, 13, C.red);
  for (let y = 7; y <= 11; y += 2) H(p, 3, 7, y, C.redD);
  box(p, 9, 7, 12, 11, C.black, C.blackL, null);
  p.set(10, 8, C.yellow); p.set(11, 10, C.green);
  H(p, 3, 12, 14, C.rubber);
}
function genset_house(p) { // a yellow petrol set in a black tube frame, a fuel tank on top, a wheel at the bottom left
  R(p, 1, 3, 14, 3, C.black); V(p, 1, 3, 12, C.black); V(p, 14, 3, 12, C.black); H(p, 1, 14, 12, C.black);
  box(p, 3, 1, 10, 4, C.yellow);
  R(p, 7, 0, 8, 0, C.blackL);
  box(p, 3, 5, 9, 11, C.silverD, C.silver);
  for (let y = 6; y <= 10; y += 2) H(p, 4, 8, y, shade(C.silverD, -0.3));
  box(p, 10, 5, 13, 11, C.yellow);
  p.set(11, 7, C.red); p.set(12, 9, C.black);
  disc(p, 3, 13, 2, C.rubber); p.set(3, 13, C.silver);
}
function genset_contractor(p) { // an orange contractor's set in a heavy roll cage, the engine and the alternator inside
  R(p, 0, 2, 15, 2, C.blackL); R(p, 0, 13, 15, 13, C.blackL); V(p, 0, 2, 13, C.blackL); V(p, 15, 2, 13, C.blackL); V(p, 8, 2, 13, C.blackL);
  box(p, 1, 3, 7, 12, C.orange);
  box(p, 9, 5, 14, 12, C.silverD, C.silver);
  ring(p, 11, 8, 2, shade(C.silverD, -0.35));
  for (let y = 5; y <= 11; y += 2) H(p, 2, 6, y, C.orangeD);
  R(p, 9, 3, 14, 4, C.black); p.set(10, 3, C.red); p.set(12, 3, C.yellow); p.set(13, 4, C.green);
  H(p, 1, 14, 14, C.rubber); H(p, 1, 14, 15, C.rubber);
}
function genset_standby(p) { // a grey standby cabinet on a concrete pad: a sloped lid, louvres, a status light
  box(p, 0, 13, 15, 15, "#9a9890", "#b8b6ae");
  box(p, 1, 2, 14, 12, "#7d858c", "#9aa1a8");
  H(p, 2, 13, 1, "#9aa1a8");
  for (let y = 4; y <= 10; y += 2) H(p, 3, 9, y, "#545a60");
  box(p, 11, 4, 13, 8, C.black, C.blackL, null);
  p.set(12, 5, C.green);
  V(p, 11, 10, 11, C.silver);
}
function genset_military(p) { // the Army's olive diesel set on a steel skid, lift eyes, a stencil and a control box
  const od = "#5a6b3a";
  H(p, 0, 15, 14, C.blackL); H(p, 0, 15, 15, C.black);
  box(p, 1, 3, 14, 13, od);
  p.set(2, 2, C.blackL); p.set(13, 2, C.blackL); H(p, 2, 13, 2, shade(od, 0.25));
  text(p, 3, 5, "US", "#e8e0c8");
  for (let y = 11; y <= 12; y++) H(p, 3, 9, y, shade(od, -0.35));
  box(p, 10, 5, 13, 9, C.black, C.blackL, null);
  p.set(11, 6, C.yellow); p.set(12, 8, C.red);
}
function spotlamp(p) { // a big round lamp head on a yoke, its glass lit, on a short stand with three feet
  disc(p, 8, 6, 5, C.blackL);
  disc(p, 8, 6, 4, "#e8e0a0");
  disc(p, 7, 5, 2, C.white);
  ring(p, 8, 6, 5, C.black);
  V(p, 2, 3, 9, C.silverD); V(p, 14, 3, 9, C.silverD); H(p, 2, 14, 11, C.silverD);
  V(p, 8, 11, 14, C.silverD);
  line(p, 8, 14, 4, 15, C.blackL); line(p, 8, 14, 12, 15, C.blackL); H(p, 7, 9, 15, C.blackL);
}
function fridge(p) { // a tall white fridge-freezer: two doors, the handles, a little shade down its right side
  box(p, 3, 0, 12, 15, C.white, C.white, C.whiteD);
  H(p, 3, 12, 5, C.whiteD);
  V(p, 11, 1, 4, C.silverD); V(p, 11, 7, 11, C.silverD);
  V(p, 12, 0, 15, "#a8acb2");
  p.set(5, 2, C.blue); p.set(6, 2, C.blueL);
  H(p, 4, 6, 14, C.whiteD);
}

export const GEAR_ART = { genset_inverter, genset_house, genset_contractor, genset_standby, genset_military, spotlamp, fridge };
