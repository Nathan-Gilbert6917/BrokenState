// @ts-check
// Hex grid helpers. Pointy-top hexes in "odd-r" offset layout; tile id = y * width + x.
const EVEN_DIRS = [
  [1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1],
];
const ODD_DIRS = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1],
];

export class HexGrid {
  /** @param {number} width @param {number} height */
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.size = width * height;
  }
  /** @param {number} x @param {number} y @returns {number} */
  id(x, y) {
    return y * this.width + x;
  }
  /** @param {number} id @returns {[number, number]} */
  xy(id) {
    return [id % this.width, Math.floor(id / this.width)];
  }
  /** @param {number} x @param {number} y @returns {boolean} */
  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }
  // A new array every call (callers sort and splice what they get). The arithmetic is xy's, without its pair.
  /** @param {number} id @returns {number[]} */
  neighbors(id) {
    const w = this.width, x = id % w, y = Math.floor(id / w);
    const dirs = y & 1 ? ODD_DIRS : EVEN_DIRS;
    const out = [];
    for (let k = 0; k < 6; k++) {
      const nx = x + dirs[k][0], ny = y + dirs[k][1];
      if (nx >= 0 && ny >= 0 && nx < w && ny < this.height) out.push(ny * w + nx);
    }
    return out;
  }
  /** @param {number} id @returns {[number, number, number]} */
  cube(id) {
    const [x, y] = this.xy(id);
    const q = x - (y - (y & 1)) / 2;
    return [q, y, -q - y];
  }
  // cube() for both tiles, written out: no arrays (it is called hundreds of thousands of times an hour). s = -q - r, so
  // the third axis' difference is -(dq + dr).
  /** @param {number} a @param {number} b @returns {number} */
  distance(a, b) {
    const w = this.width, ay = Math.floor(a / w), by = Math.floor(b / w);
    const dq = a - ay * w - (ay - (ay & 1)) / 2 - (b - by * w - (by - (by & 1)) / 2), dr = ay - by;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
  }
  // All tile ids within radius of center (inclusive), row by row, each row's ids ascending. On a row dr away the tiles
  // in reach are one run of cube q (from max(-r, -dr - r) to min(r, -dr + r) about the centre's), so each row is a
  // range rather than a bounding box tested tile by tile. A radius that is not a whole number takes the old way.
  /** @param {number} center @param {number} radius @returns {number[]} */
  within(center, radius) {
    if (!Number.isInteger(radius)) return this.withinTested(center, radius);
    const w = this.width, cy = Math.floor(center / w), cq = center - cy * w - (cy - (cy & 1)) / 2;
    const out = [];
    for (let y = Math.max(0, cy - radius); y <= Math.min(this.height - 1, cy + radius); y++) {
      const dr = y - cy, off = (y - (y & 1)) / 2;
      const x0 = Math.max(0, cq + Math.max(-radius, -dr - radius) + off), x1 = Math.min(w - 1, cq + Math.min(radius, -dr + radius) + off);
      for (let x = x0; x <= x1; x++) out.push(y * w + x);
    }
    return out;
  }
  /** @param {number} center @param {number} radius @returns {number[]} */
  withinTested(center, radius) {
    const [cx, cy] = this.xy(center);
    const out = [];
    for (let y = Math.max(0, cy - radius); y <= Math.min(this.height - 1, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius - 1); x <= Math.min(this.width - 1, cx + radius + 1); x++) {
        const id = this.id(x, y);
        if (this.distance(center, id) <= radius) out.push(id);
      }
    }
    return out;
  }
  // Tile id from cube coordinates (-1 if off the map).
  /** @param {number} q @param {number} r @returns {number} */
  fromCube(q, r) {
    const x = q + (r - (r & 1)) / 2;
    return this.inBounds(x, r) ? this.id(x, r) : -1;
  }
  // The tile one step past b, coming from its neighbor a (same direction): a boat crossing a over b.
  /** @param {number} a @param {number} b @returns {number} */
  beyond(a, b) {
    const [aq, ar] = this.cube(a);
    const [bq, br] = this.cube(b);
    return this.fromCube(2 * bq - aq, 2 * br - ar);
  }
  // Pixel center of a tile for hex size s.
  /** @param {number} id @param {number} s @returns {[number, number]} */
  toPixel(id, s) {
    const [x, y] = this.xy(id);
    return [s * Math.sqrt(3) * (x + 0.5 * (y & 1)), s * 1.5 * y];
  }
  /** @param {number} px @param {number} py @param {number} s @returns {number} */
  fromPixel(px, py, s) {
    // to fractional axial, round in cube space, then back to offset
    const q = ((Math.sqrt(3) / 3) * px - (1 / 3) * py) / s;
    const r = ((2 / 3) * py) / s;
    let rx = Math.round(q), ry = Math.round(r), rz = Math.round(-q - r);
    const dx = Math.abs(rx - q), dy = Math.abs(ry - r), dz = Math.abs(rz - (-q - r));
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    const x = rx + (ry - (ry & 1)) / 2;
    const y = ry;
    return this.inBounds(x, y) ? this.id(x, y) : -1;
  }
}

// A* over the grid. costFn(fromId, toId) returns step cost or Infinity if blocked. minStep: the cheapest step there
// is (the heuristic is the distance times it, so it never overestimates; parties.js planPath passes its mode's).
/**
 * @param {HexGrid} grid @param {number} start @param {number} goal @param {(from: number, to: number) => number} costFn
 * @returns {{ path: number[], cost: number } | null}
 */
export function findPath(grid, start, goal, costFn, maxCost = Infinity, minStep = 0.5) {
  if (start === goal) return { path: [start], cost: 0 };
  const S = scratch(grid.size), { g, came, seen, ex, exSeen } = S, mark = S.mark;
  const best = (n) => (seen[n] === mark ? g[n] : Infinity);
  try {
    const open = new MinHeap();
    seen[start] = mark; g[start] = 0; came[start] = -1;
    open.push(start, grid.distance(start, goal));
    while (open.size) {
      const cur = open.pop();
      if (cur === goal) {
        const path = [cur];
        for (let c = came[cur]; c >= 0; c = came[c]) path.push(c);
        path.reverse();
        return { path, cost: g[goal] };
      }
      const gc = g[cur];
      // A tile already expanded at its best cost so far pushes nothing when expanded again (every neighbour was
      // offered gc + step then, and a neighbour's cost only falls; a push needs strictly less), so a later copy of it
      // on the heap is skipped. The heap pops in the same order either way.
      if (exSeen[cur] === mark && ex[cur] === gc) continue;
      exSeen[cur] = mark; ex[cur] = gc;
      for (const n of grid.neighbors(cur)) {
        const step = costFn(cur, n);
        if (!isFinite(step)) continue;
        const ng = gc + step;
        if (ng > maxCost) continue;
        if (ng < best(n)) {
          seen[n] = mark; g[n] = ng; came[n] = cur;
          open.push(n, ng + grid.distance(n, goal) * minStep);
        }
      }
    }
    return null;
  } finally { release(S); }
}

// findPath's per-tile numbers (the best cost so far, where it came from, the cost it was expanded at) in typed arrays
// kept between searches: a search stamps the tiles it touches with its own mark, so nothing is cleared between them.
// A search started inside another (a cost function that plans a path) takes a second set.
const SPARE = [];
function scratch(size) {
  let S = SPARE.pop();
  if (!S || S.g.length !== size) S = { g: new Float64Array(size), came: new Int32Array(size), seen: new Uint32Array(size), ex: new Float64Array(size), exSeen: new Uint32Array(size), mark: 0 };
  if (++S.mark === 0xffffffff) { S.seen.fill(0); S.exSeen.fill(0); S.mark = 1; }
  return S;
}
const release = (S) => { if (SPARE.length < 4) SPARE.push(S); };

class MinHeap {
  constructor() {
    /** @type {number[]} */
    this.items = [];
    /** @type {number[]} */
    this.prio = [];
  }
  get size() {
    return this.items.length;
  }
  /** @param {number} item @param {number} p */
  push(item, p) {
    this.items.push(item);
    this.prio.push(p);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= this.prio[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop() {
    const top = this.items[0];
    const lastItem = this.items.pop();
    const lastPrio = this.prio.pop();
    if (this.items.length) {
      this.items[0] = lastItem;
      this.prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l] < this.prio[m]) m = l;
        if (r < this.items.length && this.prio[r] < this.prio[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  /** @param {number} a @param {number} b */
  swap(a, b) {
    const it = this.items[a], p = this.prio[a];
    this.items[a] = this.items[b]; this.prio[a] = this.prio[b];
    this.items[b] = it; this.prio[b] = p;
  }
}
