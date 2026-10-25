// Item icons: every item that is not a gun has its own pixel drawing (user 2026-10-16: "All items should have their
// own unique sprites shown in the inventory"). Guns keep theirs from ui/gunart.js (gunThumb: as fitted, in its finish).
// The drawings live in the family files (ui/itemart/*.js; the kit and the rules for a drawing: ui/itemart/kit.js):
//   food.js       foods and the base supplies (water, fuel, wood, scrap, parts...)
//   ammo.js       boxes of rounds (GEAR) and loose rounds (SUPPLIES), by calibre and type, hand-loads marked
//   parts.js      gun attachments and magazines
//   wear.js       melee weapons, bows, armour, helmets, plates, bags, rigs, cases, the bicycle, the carts
//   tools.js      books, manuals, tools, lights, optics, radios, medical kits, throwables, camp gear, defences
//   valuables.js  trade goods and comforts: jewellery, smokes, liquor, treats, toiletries, gadgets, collectibles
//   tents.js      the tent bags (sim/tents.js), a torn tent's canvas, the beds as furniture (sim/beds.js)
//   power.js      the found generators, the mounted spotlight, the fridge (sim/data-power.js)
//   furniture.js  the found storage, comfort and work pieces set at a base (sim/furniture.js, #20)
// Each drawing is a 16 × 16 grid, outlined by toCanvas into an 18 × 18 picture, 3 canvas pixels a grid pixel; cached by
// key. GEAR and SUPPLIES share some keys (a box of .223 and loose .223), so the two are asked for apart.
// tools/itemarttest.js: every item has its drawing and no two look the same; tools/itemartpreview.html shows them all.
import { painter, toCanvas } from "./sprites.js";
import { GEAR } from "../sim/data.js"; // the supply items (supKey) borrow their supply's drawing
import * as food from "./itemart/food.js";
import * as ammo from "./itemart/ammo.js";
import * as parts from "./itemart/parts.js";
import * as wear from "./itemart/wear.js";
import * as tools from "./itemart/tools.js";
import * as valuables from "./itemart/valuables.js";
import * as tents from "./itemart/tents.js";
import * as power from "./itemart/power.js";
import * as furniture from "./itemart/furniture.js";

export const ART_SIZE = 16, ICON_SIZE = ART_SIZE + 2, ICON_UP = 3;
export const FAMILIES = { food, ammo, parts, wear, tools, valuables, tents, power, furniture };
export const GEAR_ART = {}, SUPPLY_ART = {};
for (const f of Object.values(FAMILIES)) { Object.assign(GEAR_ART, f.GEAR_ART || {}); Object.assign(SUPPLY_ART, f.SUPPLY_ART || {}); }
// A supply held as an item (sim/supitems.js: s_<key>, a can of beans or a bottle of water out of the stores) looks
// like its supply.
for (const [k, d] of Object.entries(GEAR)) if (d.supKey && !GEAR_ART[k] && SUPPLY_ART[d.supKey]) { const sk = d.supKey; GEAR_ART[k] = (p) => SUPPLY_ART[sk](p, sk); }

const table = (kind) => (kind === "supply" ? SUPPLY_ART : GEAR_ART);
export const hasItemArt = (key, kind = "gear") => typeof table(kind)[key] === "function";

// The drawing as pixels: an 18 × 18 painter (the 16 × 16 drawing a pixel in, room for the outline); null when the key
// has none or its drawing throws (the caller shows the emoji).
const pix = new Map();
export function itemPixels(key, kind = "gear") {
  const id = `${kind}:${key}`;
  if (pix.has(id)) return pix.get(id);
  let q = null;
  const draw = table(kind)[key];
  if (typeof draw === "function") {
    try {
      const p = painter(ART_SIZE, ART_SIZE);
      draw(p, key);
      q = painter(ICON_SIZE, ICON_SIZE);
      for (let y = 0; y < ART_SIZE; y++) for (let x = 0; x < ART_SIZE; x++) { const c = p.get(x, y); if (c) q.set(x + 1, y + 1, c); }
      if (!q.px.some(Boolean)) q = null;
    } catch { q = null; }
  }
  pix.set(id, q);
  return q;
}

// The picture's data URL ("" without a browser canvas or a drawing).
const urls = new Map();
export function itemArtURL(key, kind = "gear") {
  const id = `${kind}:${key}`;
  if (urls.has(id)) return urls.get(id);
  const q = itemPixels(key, kind);
  const cv = q ? toCanvas(q, ICON_UP) : null;
  const u = cv && typeof cv.toDataURL === "function" ? cv.toDataURL("image/png") : "";
  urls.set(id, u);
  return u;
}

// The icon as an <img> for HTML (h: its size in rem, so it scales with the UI scale); "" when there is none.
export function itemArtHtml(key, h = 1.3, cls = "iart", kind = "gear") {
  const u = itemArtURL(key, kind);
  return u ? `<img class="${cls}" src="${u}" alt="" style="width:${h}rem;height:${h}rem">` : "";
}
export const supplyArtHtml = (key, h = 1.3, cls = "iart") => itemArtHtml(key, h, cls, "supply");
// The icon sized by the text around it (1.25em: chips, stock tiles, the stack mover's head); "" when there is none.
export function itemArtIcon(key, kind = "gear") {
  const u = itemArtURL(key, kind);
  return u ? `<img class="iart ico" src="${u}" alt="">` : "";
}
