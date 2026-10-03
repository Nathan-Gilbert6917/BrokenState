// Hex grid helpers. Pointy-top hexes in "odd-r" offset layout; tile id = y * width + x.
const EVEN_DIRS = [
  [1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1],
];
const ODD_DIRS = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1],
];

export class HexGrid {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.size = width * height;
  }
  id(x, y) {
    return y * this.width + x;
  }
  xy(id) {
    return [id % this.width, Math.floor(id / this.width)];
  }
  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }
  neighbors(id) {
    const [x, y] = this.xy(id);
    const dirs = y & 1 ? ODD_DIRS : EVEN_DIRS;
    const out = [];
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (this.inBounds(nx, ny)) out.push(this.id(nx, ny));
    }
    return out;
  }
  cube(id) {
    const [x, y] = this.xy(id);
    const q = x - (y - (y & 1)) / 2;
    return [q, y, -q - y];
  }
  distance(a, b) {
    const [aq, ar, as] = this.cube(a);
    const [bq, br, bs] = this.cube(b);
    return Math.max(Math.abs(aq - bq), Math.abs(ar - br), Math.abs(as - bs));
  }
  // All tile ids within radius of center (inclusive).
  within(center, radius) {
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
  fromCube(q, r) {
    const x = q + (r - (r & 1)) / 2;
    return this.inBounds(x, r) ? this.id(x, r) : -1;
  }
  // The tile one step past b, coming from its neighbor a (same direction): a boat crossing a over b.
  beyond(a, b) {
    const [aq, ar] = this.cube(a);
    const [bq, br] = this.cube(b);
    return this.fromCube(2 * bq - aq, 2 * br - ar);
  }
  // Pixel center of a tile for hex size s.
  toPixel(id, s) {
    const [x, y] = this.xy(id);
    return [s * Math.sqrt(3) * (x + 0.5 * (y & 1)), s * 1.5 * y];
  }
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

// A* over the grid. costFn(fromId, toId) returns step cost or Infinity if blocked.
export function findPath(grid, start, goal, costFn, maxCost = Infinity) {
  if (start === goal) return { path: [start], cost: 0 };
  const open = new MinHeap();
  const g = new Map([[start, 0]]);
  const came = new Map();
  open.push(start, grid.distance(start, goal));
  while (open.size) {
    const cur = open.pop();
    if (cur === goal) {
      const path = [cur];
      let c = cur;
      while (came.has(c)) {
        c = came.get(c);
        path.push(c);
      }
      path.reverse();
      return { path, cost: g.get(goal) };
    }
    const gc = g.get(cur);
    for (const n of grid.neighbors(cur)) {
      const step = costFn(cur, n);
      if (!isFinite(step)) continue;
      const ng = gc + step;
      if (ng > maxCost) continue;
      if (ng < (g.get(n) ?? Infinity)) {
        g.set(n, ng);
        came.set(n, cur);
        open.push(n, ng + grid.distance(n, goal) * 0.5);
      }
    }
  }
  return null;
}

class MinHeap {
  constructor() {
    this.items = [];
    this.prio = [];
  }
  get size() {
    return this.items.length;
  }
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
  swap(a, b) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
  }
}
