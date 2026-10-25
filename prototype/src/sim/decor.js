// Interior decor for raid buildings (the user's request of 2026-10-25: "filled with appliances, furniture and decor that
// makes it feel lived in"; issue #13 of the interiors epic #7). Cosmetic only: no cell's kind changes, so walk, cover and
// line of sight (combat.js CELL) are as they were; ui/isoview.js draws it.
//
// Three layers, all laid by buildingmaps.js assemble after a room's furniture, from hash dice of the map's seed (rng.state
// read, never consumed: every other roll of the map is as before) so the same building has the same decor every visit:
//   - c.deco = { k, v, e, lt } on a room's floor cells: k a DECO kind (a rug, papers, books, broken glass, trash and tins,
//     clothes, toys, cracked tiles, a water stain, an oil stain, straw, leaves blown in), v its variant (a rug's or a
//     piece of clothing's colour), e a rug's edges (bits 1 −y, 2 +y, 4 −x, 8 +x: its border is drawn on those sides);
//     lt a light fixture overhead (1 a ceiling lamp, 2 a strip light: where indoorlight.js's light comes from; the light
//     rules are unchanged). A light alone is { k: "light", lt }.
//       Rugs (living rooms, bedrooms, halls) are 2 × 3 to 3 × 4 patches wholly inside their room, over whatever stands
//     there (a rug under the table). Clutter lies on open floor only (an "open" or "loft" cell), by the room's role
//     (DECOR) and the building's mess (messOf: its own dice; an abandoned place is messier than a held one, and the
//     survivors holding a floor keep their room tidy: tidyDecor, floorfolk.js). Broken glass lies under every broken
//     window ("smashed", on the floor cell inside it); leaves blow in at an outer door standing open or a doorway.
//   - c.wart = { k, d } on an inner wall cell next to a room's floor: k a WALL_ART kind (pictures, a clock, a mirror,
//     a whiteboard, posters, a crucifix, a notice board, a shelf of knick-knacks: none of them lootable here, the
//     lootable pieces are the furniture catalogue's), d the side its room is on (0 +x, 1 −x, 2 +y, 3 −y). Drawn on the
//     wall's face toward that room, hidden when the wall is cut away.
//   - c.wc on a room's cells: the room's wall colour (room.wallc: WALLC by role, a franchise's front room in its look's
//     wall colour), painted on the inside faces of the walls round it; the outside keeps the building's own.
// Lootable decor pieces (a potted plant, a floor lamp, a painting, a wall clock) belong to the furniture catalogue
// (data-furniture.js, issue #8) and are placed with the furniture.
import { hash01 } from "./skills.js";

// Floor clutter by kind: what lies on the floor, the rooms its colour is drawn in (ui/isoview.js decoTexel).
export const DECO = {
  rug: "a rug", papers: "papers", books: "books", glass: "broken glass", trash: "trash", tins: "empty tins",
  clothes: "clothes", toys: "toys", crack: "cracked tiles", stain: "a water stain", oil: "an oil stain",
  straw: "straw", leaves: "leaves blown in", light: "a light overhead",
};
// Room roles (buildingmaps.js ROLES) → their decor: rug (the room gets one, of this chance), clutter [kind, share of
// its open floor cells at full mess], art [wall art kinds, how many at most], light (1 a ceiling lamp, 2 strip lights).
const HOME = { light: 1 };
const WORK = { light: 2 };
export const DECOR = {
  living:     { ...HOME, rug: 0.85, clutter: [["papers", 0.04], ["trash", 0.05], ["toys", 0.02]], art: [["picture", "picture", "clock", "shelf"], 3] },
  greatroom:  { ...HOME, rug: 0.7, clutter: [["trash", 0.06], ["papers", 0.03]], art: [["picture", "shelf", "clock"], 2] },
  dayroom:    { ...HOME, rug: 0.6, clutter: [["papers", 0.04], ["trash", 0.05]], art: [["picture", "notice", "clock"], 2] },
  dining:     { ...HOME, rug: 0.5, clutter: [["trash", 0.04]], art: [["picture", "clock"], 2] },
  hall:       { ...HOME, rug: 0.6, clutter: [["papers", 0.02]], art: [["picture", "mirror"], 1] },
  bedroom:    { ...HOME, rug: 0.75, clutter: [["clothes", 0.12], ["books", 0.04], ["papers", 0.03]], art: [["poster", "picture", "mirror"], 2] },
  motelroom:  { ...HOME, rug: 0.3, clutter: [["clothes", 0.08], ["trash", 0.06]], art: [["picture"], 1] },
  apt:        { ...HOME, rug: 0.6, clutter: [["clothes", 0.06], ["trash", 0.06], ["papers", 0.03], ["toys", 0.02]], art: [["picture", "poster", "clock"], 2] },
  bunk:       { ...HOME, clutter: [["clothes", 0.1], ["trash", 0.04]], art: [["poster", "picture"], 1] },
  dorm:       { ...WORK, clutter: [["clothes", 0.08], ["trash", 0.03]], art: [["notice", "poster"], 1] },
  kitchen:    { ...HOME, clutter: [["trash", 0.1], ["tins", 0.08]], art: [["clock", "shelf"], 1] },
  breakroom:  { ...WORK, clutter: [["trash", 0.08], ["tins", 0.05]], art: [["notice", "clock"], 1] },
  mess:       { ...WORK, clutter: [["trash", 0.06], ["tins", 0.05]], art: [["notice", "clock"], 2] },
  cafeteria:  { ...WORK, clutter: [["trash", 0.06], ["tins", 0.04]], art: [["notice", "clock", "poster"], 2] },
  pantry:     { ...HOME, clutter: [["tins", 0.1]] },
  bath:       { ...HOME, clutter: [["crack", 0.12], ["stain", 0.1]], art: [["mirror"], 1] },
  restroom:   { ...WORK, clutter: [["crack", 0.1], ["stain", 0.1]], art: [["mirror"], 1] },
  office:     { ...WORK, clutter: [["papers", 0.14], ["trash", 0.03]], art: [["whiteboard", "picture", "clock"], 2] },
  vestry:     { ...HOME, clutter: [["papers", 0.08], ["books", 0.04]], art: [["crucifix", "picture"], 1] },
  nave:       { ...HOME, clutter: [["papers", 0.03]], art: [["crucifix"], 2] },
  classroom:  { ...WORK, clutter: [["papers", 0.12], ["books", 0.04]], art: [["whiteboard", "notice", "poster", "clock"], 3] },
  corridor:   { ...WORK, clutter: [["papers", 0.03], ["trash", 0.02]], art: [["notice"], 2] },
  foyer:      { ...WORK, clutter: [["papers", 0.03]], art: [["notice", "picture", "clock"], 2] },
  lobby:      { ...WORK, clutter: [["papers", 0.03]], art: [["notice", "picture", "clock"], 2] },
  reception:  { ...WORK, clutter: [["papers", 0.05]], art: [["picture", "notice"], 1] },
  ward:       { ...WORK, clutter: [["papers", 0.04], ["trash", 0.04]], art: [["notice", "clock"], 1] },
  exam:       { ...WORK, clutter: [["papers", 0.04]], art: [["notice", "poster"], 1] },
  nurse:      { ...WORK, clutter: [["papers", 0.05]], art: [["poster", "notice"], 1] },
  pharmroom:  { ...WORK, clutter: [["papers", 0.04], ["trash", 0.03]] },
  dispensary: { ...WORK, clutter: [["papers", 0.04], ["trash", 0.03]] },
  sales:      { ...WORK, clutter: [["trash", 0.05], ["papers", 0.03]], art: [["poster"], 3] },
  terminal:   { ...WORK, clutter: [["trash", 0.05], ["papers", 0.03]], art: [["notice", "clock", "poster"], 2] },
  stock:      { ...WORK, clutter: [["trash", 0.04]] },
  storage:    { ...WORK, clutter: [["trash", 0.03]] },
  gym:        { ...WORK, clutter: [["trash", 0.03]], art: [["notice", "clock"], 1] },
  lockerroom: { ...WORK, clutter: [["clothes", 0.06], ["crack", 0.04]], art: [["mirror"], 1] },
  cells:      { ...WORK, clutter: [["trash", 0.05], ["papers", 0.02]] },
  evidence:   { ...WORK, clutter: [["papers", 0.06]] },
  armory:     { ...WORK },
  hgarage:    { ...WORK, clutter: [["oil", 0.1], ["trash", 0.03]], art: [["shelf"], 1] },
  bays:       { ...WORK, clutter: [["oil", 0.12], ["trash", 0.03]], art: [["notice"], 1] },
  motor:      { ...WORK, clutter: [["oil", 0.1]], art: [["notice"], 1] },
  hangarfloor: { ...WORK, clutter: [["oil", 0.06]] },
  parts:      { ...WORK, clutter: [["oil", 0.06], ["trash", 0.03]] },
  workshop:   { ...WORK, clutter: [["oil", 0.06], ["trash", 0.04]], art: [["shelf", "notice"], 1] },
  warefloor:  { ...WORK, clutter: [["trash", 0.03], ["oil", 0.02]] },
  factoryfloor: { ...WORK, clutter: [["oil", 0.05], ["trash", 0.03]], art: [["notice"], 1] },
  control:    { ...WORK, clutter: [["papers", 0.06]], art: [["notice", "clock"], 1] },
  lab:        { ...WORK, clutter: [["papers", 0.06], ["books", 0.02]], art: [["whiteboard", "notice"], 1] },
  barnfloor:  { clutter: [["straw", 0.3]] }, // no power in a barn (indoorlight.js): no light fixture
  hayloft:    { clutter: [["straw", 0.4]] },
  tack:       { clutter: [["straw", 0.15]], art: [["shelf"], 1] },
  gunroom:    { ...HOME, rug: 0.3, art: [["picture", "shelf"], 1] },
};
// Named rooms that are something else under the same role (a library's stacks are a stockroom, a child's bedroom).
const BOOKISH = /stacks|reading|library/i;
// Wall art kinds: their names (ui/isoview.js WARTC draws each).
export const WALL_ART = {
  picture: "a picture", clock: "a clock", mirror: "a mirror", whiteboard: "a whiteboard", poster: "a poster",
  crucifix: "a crucifix", notice: "a notice board", shelf: "a shelf of knick-knacks",
};
// Wall colours by role (the inside faces only): homes in a few soft paints by the room's dice, the institutions their
// pale institutional ones; the bare rooms (storerooms, bays, barns, cells) none (the building's own wall shows).
const HOMEWALL = ["#d8ccb0", "#b8c4a8", "#a8b8c8", "#d0b0a8", "#e0d8c0", "#c0a890"];
export const WALLC = {
  living: HOMEWALL, greatroom: ["#b89870", "#a88a64"], dayroom: HOMEWALL, dining: HOMEWALL, hall: HOMEWALL, bedroom: [...HOMEWALL, "#b0a8c8", "#c8b8d8"],
  motelroom: ["#c8b890", "#b0a080"], apt: HOMEWALL, bunk: ["#a89070"], dorm: ["#c8c8b8"], kitchen: ["#e0d8a8", "#d8e0d0", "#e8e0d0"],
  breakroom: ["#d0d0c0"], mess: ["#d0d0c0"], cafeteria: ["#e0d8a8", "#c8d8c0"], pantry: ["#d8d0b8"], bath: ["#d0e4e4", "#e8e8e0", "#c8d8e8"],
  restroom: ["#d8dcd8"], lockerroom: ["#c8d4d8"], office: ["#c8c4b8", "#b8bcc0"], vestry: ["#d8ccb0"], nave: ["#e0d8c4"],
  classroom: ["#e0d8a8", "#c8d8b8"], corridor: ["#d0ccb8", "#c8d4c0"], foyer: ["#d0ccb8"], lobby: ["#d0ccb8"], reception: ["#d0ccb8"],
  ward: ["#c8dcc8", "#d0e0d8"], exam: ["#c8dcc8", "#e0e4e0"], nurse: ["#d8e4d8"], pharmroom: ["#e0e4e0"], dispensary: ["#e0e4e0"],
  sales: ["#d8d8d0"], terminal: ["#d0d0c8"], gym: ["#c8c0a8"], control: ["#b8bcc0"], lab: ["#e4e8e8"], gunroom: ["#a88a64"],
};
export const DECO_CFG = {
  RUG: { w: [2, 3], h: [3, 4] },  // a rug's sides in cells (turned either way)
  MESS: [0.25, 1],                // the building's mess (messOf): from tidy to a wreck
  LEAVES: 0.6,                    // the chance of a second leafy cell further in from an open outer door
  ART_GAP: 2,                     // cells between two pieces of wall art on one room
  LIGHT_EVERY: 4,                 // strip lights: one row every so many cells in a long room
};
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const OPENISH = new Set(["open", "loft"]);
// The building's mess, 0.25 (kept) to 1 (a wreck), by its own dice.
export const messOf = (seed, key) => DECO_CFG.MESS[0] + (DECO_CFG.MESS[1] - DECO_CFG.MESS[0]) * hash01(seed, "mess", key || "");
// A room's wall colour (room.wallc): a franchise's look already set it; else WALLC by role, by the room's dice.
export function wallColour(seed, room) {
  if (room.wallc) return room.wallc;
  const list = WALLC[room.role];
  return list ? list[Math.floor(hash01(seed, "wallc", room.id, room.role) * list.length) % list.length] : null;
}

// Lays the decor on one floor of an assemble'd building. cells, W: the floor's grid; rooms: assemble's rooms (ix0, iy0,
// iw, ih: the inside; role, name, id); rid: each cell's room id (-1 a wall, -2 outside); seed: the map's dice (rng.state
// read); f: the floor; key: the building's kind; mess: messOf's (or a held building's lower one).
export function decorate(cells, W, H, rooms, rid, o) {
  const { seed, f = 0, mess = messOf(seed, o.key) } = o;
  const h = (...p) => hash01(seed, "deco", f, ...p);
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? cells[y * W + x] : null);
  const ridAt = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? rid[y * W + x] : -2);
  for (const room of rooms) {
    const D = DECOR[room.role] || {};
    const wc = wallColour(seed, room);
    room.wallc = wc || undefined;
    const x0 = room.ix0, y0 = room.iy0, x1 = x0 + room.iw - 1, y1 = y0 + room.ih - 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (rid[y * W + x] === room.id && wc) cells[y * W + x].wc = wc;
    // The light overhead: a lamp in the middle of a home's room, strip lights down a working one.
    if (D.light) {
      const cx = x0 + (room.iw >> 1), cy = y0 + (room.ih >> 1);
      const spots = [];
      if (D.light === 1 || room.iw * room.ih < 12) spots.push([cx, cy]);
      else {
        const along = room.iw >= room.ih, n = Math.max(1, Math.floor((along ? room.iw : room.ih) / DECO_CFG.LIGHT_EVERY));
        for (let i = 0; i < n; i++) {
          const t = Math.floor(((i + 0.5) * (along ? room.iw : room.ih)) / n);
          spots.push(along ? [x0 + t, cy] : [cx, y0 + t]);
        }
      }
      for (const [x, y] of spots) if (ridAt(x, y) === room.id) { const c = at(x, y); if (c.k !== "stairs" && c.k !== "ladder") c.deco = { k: "light", lt: D.light }; }
    }
    // A rug: a patch wholly inside the room, over whatever stands there (not the stairs).
    if (D.rug && h("rug?", room.id) < D.rug && room.iw >= 2 && room.ih >= 2) {
      const turn = h("rugturn", room.id) < 0.5;
      let rw = DECO_CFG.RUG.w[0] + Math.floor(h("rugw", room.id) * (DECO_CFG.RUG.w[1] - DECO_CFG.RUG.w[0] + 1));
      let rh = DECO_CFG.RUG.h[0] + Math.floor(h("rugh", room.id) * (DECO_CFG.RUG.h[1] - DECO_CFG.RUG.h[0] + 1));
      if (turn) [rw, rh] = [rh, rw];
      if (rw > room.iw) rw = room.iw;
      if (rh > room.ih) rh = room.ih;
      if (Math.min(rw, rh) >= 2 && Math.max(rw, rh) >= 3) { // too small a room for 2 × 3: none
        const rx = x0 + Math.floor((room.iw - rw) / 2 + (h("rugx", room.id) - 0.5) * Math.max(0, room.iw - rw));
        const ry = y0 + Math.floor((room.ih - rh) / 2 + (h("rugy", room.id) - 0.5) * Math.max(0, room.ih - rh));
        const v = Math.floor(h("rugv", room.id) * 6);
        let ok = true;
        for (let y = ry; y < ry + rh && ok; y++) for (let x = rx; x < rx + rw; x++) { const c = at(x, y); if (ridAt(x, y) !== room.id || !c || c.k === "stairs" || c.k === "ladder" || D4.some(([dx, dy]) => { const n = at(x + dx, y + dy); return n && n.k === "smashed"; })) { ok = false; break; } } // not under a broken window: its glass lies there
        if (ok) for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) {
          const c = at(x, y), e = (y === ry ? 1 : 0) | (y === ry + rh - 1 ? 2 : 0) | (x === rx ? 4 : 0) | (x === rx + rw - 1 ? 8 : 0);
          c.deco = { k: "rug", v, e, ...(c.deco && c.deco.lt ? { lt: c.deco.lt } : {}) };
        }
      }
    }
    // Clutter on the open floor by the role (a library's stacks and reading rooms: books and papers; a child's room: toys).
    const clutter = (D.clutter || []).slice();
    if (BOOKISH.test(room.name || "")) clutter.push(["books", 0.1], ["papers", 0.05]);
    if (room.role === "bedroom" && h("child", room.id) < 0.3) clutter.push(["toys", 0.1]);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const c = at(x, y);
      if (rid[y * W + x] !== room.id || !OPENISH.has(c.k) || c.deco) continue;
      for (const [k, share] of clutter) if (h(k, x, y) < share * mess) { c.deco = { k, v: Math.floor(h("v", x, y) * 6) }; break; }
    }
    // Wall art on the inner wall cells beside the room's floor (not a corner: the cell along the wall both ways is wall).
    if (D.art) {
      const [kinds, most] = D.art;
      const n = Math.min(most, Math.round(most * (0.4 + 0.6 * h("artn", room.id)) + 0.2));
      const spots = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (rid[y * W + x] !== room.id) continue;
        D4.forEach(([dx, dy], d) => {
          const wx = x + dx, wy = y + dy, w = at(wx, wy);
          if (!w || w.k !== "wall" || ridAt(wx, wy) !== -1 || w.wart) return;
          const a = dx ? at(wx, wy - 1) : at(wx - 1, wy), b = dx ? at(wx, wy + 1) : at(wx + 1, wy);
          if (!a || !b || a.k !== "wall" || b.k !== "wall") return;
          spots.push([wx, wy, d ^ 1]); // d: from the wall toward the room (D4's opposite of the step out)
        });
      }
      spots.sort((p, q) => h("art", p[0], p[1]) - h("art", q[0], q[1]));
      const put = [];
      for (const [wx, wy, d] of spots) {
        if (put.length >= n) break;
        if (put.some(([px, py]) => Math.abs(px - wx) + Math.abs(py - wy) < DECO_CFG.ART_GAP)) continue;
        const k = kinds[Math.floor(h("artk", wx, wy) * kinds.length) % kinds.length];
        at(wx, wy).wart = { k, d };
        put.push([wx, wy]);
      }
    }
  }
  // Broken glass on the floor inside a broken window; leaves blown in at an outer door left open or a doorway.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = cells[y * W + x];
    if (c.k !== "smashed" && c.k !== "odoor" && c.k !== "doorway") continue;
    for (const [dx, dy] of D4) {
      const ix = x + dx, iy = y + dy, ox = x - dx, oy = y - dy;
      if (ridAt(ix, iy) < 0 || ridAt(ox, oy) !== -2) continue; // the room's side, the outside opposite
      const ic = at(ix, iy);
      if (!OPENISH.has(ic.k)) continue;
      if (c.k === "smashed") { ic.deco = { k: "glass", v: Math.floor(h("gv", ix, iy) * 6), ...(ic.deco && ic.deco.lt ? { lt: ic.deco.lt } : {}) }; continue; }
      if (ic.deco && ic.deco.k === "rug") continue;
      ic.deco = { k: "leaves", v: Math.floor(h("lv", ix, iy) * 6) };
      const fc = at(ix + dx, iy + dy);
      if (fc && ridAt(ix + dx, iy + dy) >= 0 && OPENISH.has(fc.k) && !fc.deco && h("leaves2", ix, iy) < DECO_CFG.LEAVES) fc.deco = { k: "leaves", v: Math.floor(h("lv", ix + dx, iy + dy) * 6) };
    }
  }
}

// Mess the survivors holding a room have cleared (floorfolk.js): its trash, clothes, papers and glass swept up (rugs,
// stains and lights stay). area: { x0, y0, w, h } with its walls (an area of b.raid).
const SWEPT = new Set(["trash", "tins", "clothes", "papers", "glass", "toys", "leaves", "books"]);
export function tidyDecor(cells, W, area) {
  for (let y = area.y0 + 1; y < area.y0 + area.h - 1; y++) for (let x = area.x0 + 1; x < area.x0 + area.w - 1; x++) {
    const c = cells[y * W + x];
    if (!c || !c.deco || !SWEPT.has(c.deco.k)) continue;
    if (c.deco.lt) c.deco = { k: "light", lt: c.deco.lt };
    else delete c.deco;
  }
}

// A cell copied flipped front to back (buildingmaps.js streetMap: a south-row house): its decor's sides turned with it.
export function flipDecoY(c) {
  if (c.deco && c.deco.e) { const e = c.deco.e; c.deco = { ...c.deco, e: (e & 12) | ((e & 1) << 1) | ((e & 2) >> 1) }; }
  if (c.wart && c.wart.d >= 2) c.wart = { ...c.wart, d: c.wart.d ^ 1 };
}
