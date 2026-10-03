// Seeded random number generator (mulberry32) so a seed always rebuilds the same state.
export class Rng {
  constructor(seed) {
    this.state = seed >>> 0;
  }
  next() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min, max) {
    return min + this.next() * (max - min);
  }
  int(min, max) {
    // inclusive
    return Math.floor(this.range(min, max + 1));
  }
  chance(p) {
    return this.next() < p;
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  weighted(items, weightFn) {
    const total = items.reduce((s, it) => s + weightFn(it), 0);
    let roll = this.next() * total;
    for (const it of items) {
      roll -= weightFn(it);
      if (roll <= 0) return it;
    }
    return items[items.length - 1];
  }
}
