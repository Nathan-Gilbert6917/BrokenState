// The game's gun painter under Node (design preview only): stubs the canvas the way tools/gunarttest.js does, then
// re-exports ui/gunart.js so the sheets can show the current 64 × 24 drawing (blown up 2×) next to the HD one.
//   fromGame(p): a game painter (ui/sprites.js painter) as an hdcore painter of the same size.
//   currentGun(key, looks, finish): the game's drawing of a gun, scaled 2× onto the HD 128 × 48 grid.
import { painter, scaled } from "./hdcore.js";

if (typeof document === "undefined") {
  const ctx = () => new Proxy({ fillStyle: "", imageSmoothingEnabled: true }, { get: (o, k) => (k in o ? o[k] : k === "measureText" ? (t) => ({ width: String(t).length * 6 }) : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: ctx, toDataURL: () => "data:image/png;base64,AAAA" }), getElementById: () => null, head: null };
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
}
const GA = await import("../../src/ui/gunart.js");
export const { paintGun, anchorOf, ART_W, ART_H, PART_ART, artOf, platformOf } = GA;
export { GA };

export function fromGame(p) {
  const q = painter(p.w, p.h);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) { const c = p.get(x, y); if (c) q.set(x, y, c); }
  return q;
}
export const currentGun = (key, looks = {}, finish = null) => scaled(fromGame(paintGun(key, looks, null, finish)), 2);
