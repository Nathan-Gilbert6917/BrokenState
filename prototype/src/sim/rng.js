// @ts-check
// Seeded random number generator (mulberry32) so a seed always rebuilds the same state.
export class Rng {
  /** @param {number} seed */
  constructor(seed) {
    /** The position in the sequence (saved: save.js). It grows past 32 bits. @type {number} */
    this.state = seed >>> 0;
  }
  /** @returns {number} 0 ≤ x < 1 */
  next() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** @param {number} min @param {number} max @returns {number} min ≤ x < max */
  range(min, max) {
    return min + this.next() * (max - min);
  }
  /** @param {number} min @param {number} max @returns {number} */
  int(min, max) {
    // inclusive
    return Math.floor(this.range(min, max + 1));
  }
  /** @param {number} p @returns {boolean} */
  chance(p) {
    return this.next() < p;
  }
  /** @template T @param {readonly T[]} arr @returns {T} */
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** In place. @template T @param {T[]} arr @returns {T[]} */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  /** @template T @param {readonly T[]} items @param {(it: T) => number} weightFn @returns {T} */
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
