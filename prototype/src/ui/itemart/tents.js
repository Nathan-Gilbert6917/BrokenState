// Item icons, the tents family (ui/itemart.js; the kit and the rules: ui/itemart/kit.js): the tent bags (sim/tents.js,
// sim/data-tents.js), a slashed tent's torn canvas (tentfight.js) and the beds as furniture (sim/beds.js). Each bag is
// its stuff sack lying on its side, the light from the top left, with the poles' ends out of its mouth and the tent it
// holds printed on it: a small green one-person sack, a fatter orange two-person sack with blue compression straps, a
// long khaki four-person duffle with carry handles.
import { R, H, V, line, oval, box, shade } from "./kit.js";

// A lit sack: an ellipse in c, its top-left rim lighter and bottom-right rim darker.
function sack(p, x0, y0, x1, y1, c) {
  oval(p, x0, y0, x1, y1, c);
  const hi = shade(c, 0.3), lo = shade(c, -0.3);
  const s = p.px.slice(), on = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && s[y * 16 + x] === c;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!on(x, y)) continue;
    if (!on(x - 1, y) || !on(x, y - 1)) p.set(x, y, hi);
    else if (!on(x + 1, y) || !on(x, y + 1)) p.set(x, y, lo);
  }
}
// A small A-frame tent printed on a bag: apex at (cx, y0), h rows tall, a dark door in the middle.
function print(p, cx, y0, h, c, door) {
  for (let i = 0; i < h; i++) H(p, cx - i, cx + i, y0 + i, c);
  V(p, cx, y0 + Math.max(1, h - 2), y0 + h - 1, door);
}

function tent1(p) { // a small green stuff sack, a drawstring and its toggle at the right, two pole ends at the left
  line(p, 0, 6, 3, 7, "#9aa1a8"); line(p, 0, 9, 3, 9, "#7d858c");
  sack(p, 2, 5, 12, 11, "#4f8a3a");
  print(p, 7, 6, 4, "#d8e6c8", "#2a3a22");
  H(p, 13, 14, 8, "#b89a62"); R(p, 14, 7, 15, 9, "#202226");
}
function tent2(p) { // a fat orange sack, two blue compression straps round it, three pole ends at the left
  line(p, 0, 5, 2, 6, "#9aa1a8"); H(p, 0, 2, 8, "#c9ced3"); line(p, 0, 11, 2, 10, "#7d858c");
  sack(p, 1, 3, 14, 13, "#d9772a");
  for (const x of [4, 11]) V(p, x, 4, 12, "#3a6fb0");
  print(p, 8, 5, 5, "#f6e2c4", "#5a3010");
  R(p, 14, 7, 15, 9, "#2a2d33");
}
function tent4(p) { // a long khaki duffle, end to end, two carry handles over the top, a big tent printed on its side
  R(p, 4, 1, 5, 3, "#3a3d42"); R(p, 10, 1, 11, 3, "#3a3d42"); H(p, 4, 11, 1, "#3a3d42");
  R(p, 0, 4, 15, 13, "#8f8a5a");
  H(p, 0, 15, 4, shade("#8f8a5a", 0.3)); V(p, 0, 4, 13, shade("#8f8a5a", 0.3));
  H(p, 0, 15, 13, shade("#8f8a5a", -0.35)); V(p, 15, 4, 13, shade("#8f8a5a", -0.35));
  for (const x of [2, 13]) V(p, x, 5, 12, "#6b6640");
  print(p, 8, 6, 6, "#e8e0c8", "#3a3420");
  H(p, 4, 11, 12, "#b8952a");
}

function canvas(p) { // a crumpled khaki sheet, its edges ragged, a fold across it and a dark slash through it
  oval(p, 1, 4, 14, 13, "#a39a6a");
  for (const [x, y] of [[1, 8], [2, 5], [5, 4], [9, 4], [14, 7], [14, 11], [11, 13], [6, 13], [3, 12]]) p.clear(x, y);
  line(p, 3, 6, 9, 9, shade("#a39a6a", 0.25)); line(p, 9, 9, 13, 8, shade("#a39a6a", 0.25));
  line(p, 5, 11, 11, 6, "#4a4530"); line(p, 6, 11, 11, 7, "#6b6640");
}
// The beds as furniture (sim/beds.js, data-beds.js), side on (a large bed from its foot): a wood frame, a mattress, a blanket.
function cot(p) { // a folding camp cot: an olive sling between two poles, a sag in the middle, crossed legs at each end
  H(p, 0, 15, 6, "#9aa1a8"); R(p, 1, 7, 14, 8, "#6f7a45"); H(p, 1, 14, 7, shade("#6f7a45", 0.25)); H(p, 4, 11, 9, "#56603a");
  for (const x of [2, 10]) { line(p, x, 9, x + 4, 14, "#7d858c"); line(p, x + 4, 9, x, 14, "#7d858c"); }
}
function bed(p) { // a single bed: a tall headboard at the left, a low footboard, a white mattress, a pillow and a blue blanket
  R(p, 1, 2, 2, 14, "#8a5a30"); V(p, 1, 2, 14, shade("#8a5a30", 0.25)); R(p, 13, 6, 14, 14, "#8a5a30");
  R(p, 3, 10, 12, 11, "#a06a3a"); V(p, 4, 12, 14, "#7a5230"); V(p, 11, 12, 14, "#7a5230");
  R(p, 3, 7, 12, 9, "#e8e0c8"); R(p, 3, 6, 5, 7, "#f6f1e2"); box(p, 6, 7, 12, 9, "#3a6fb0");
}
function bunkbed(p) { // two bunks stacked on four posts, a green blanket up top and a red one below, a ladder between
  V(p, 1, 0, 15, "#8a5a30"); V(p, 14, 0, 15, "#8a5a30");
  for (const [y, c] of [[3, "#4f8a3a"], [10, "#c8402f"]]) { R(p, 2, y, 13, y + 1, "#e8e0c8"); box(p, 6, y, 13, y + 1, c, shade(c, 0.25), null); H(p, 1, 14, y + 2, "#a06a3a"); }
  V(p, 10, 6, 9, "#b07a48"); V(p, 12, 6, 9, "#b07a48"); H(p, 10, 12, 7, "#b07a48"); H(p, 10, 12, 9, "#b07a48");
}
function bigbed(p) { // a large double bed from its foot: a wide headboard, two pillows, a wine-red blanket down to the foot
  box(p, 0, 0, 15, 2, "#6a4224"); R(p, 1, 3, 14, 13, "#e8e0c8");
  R(p, 2, 4, 6, 5, "#f6f1e2"); R(p, 9, 4, 13, 5, "#f6f1e2"); box(p, 1, 7, 14, 13, "#8a3a4a");
  H(p, 0, 15, 14, "#7a5230"); R(p, 0, 15, 1, 15, "#563820"); R(p, 14, 15, 15, 15, "#563820");
}

export const GEAR_ART = { tent1, tent2, tent4, canvas, cot, bed, bunkbed, bigbed };
