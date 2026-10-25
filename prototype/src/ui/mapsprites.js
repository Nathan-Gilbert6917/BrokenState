// Procedural pixel sprites for parties on the State Map (same approach as sprites.js: painted on a small
// pixel grid, outlined, upscaled once to an offscreen canvas and cached by look). A pickup truck, a sedan, an SUV,
// a work van, a Hummer or an Army truck (by the vehicle's type) for motorized teams and convoys, a small group of walkers with packs for teams on foot (armed for raids),
// and a boat (or a raft carrying the vehicle) while a team crosses water. The body or clothes are tinted
// with the owner's color. Sprites face right; drawMapSprite mirrors them for travel to the left.
// A team of one gets a figure of its own, bigger and animated: a walker (standing, or a walk cycle leaning into the
// stride) or a rider on a bicycle; the same for another group's party of one, in its group's look.
// Also the map's places and things: your bases, other groups' bases and parties (by group type), sites (one
// sprite per location type), hordes and hives, markers (vehicles, wrecks, caches, camps, graves) and status icons.
// The moving pieces (parties, solos, hordes, herds, workers) are drawn on the map as low-poly figures now
// (ui/mapfigures.js); their flat painters here stay for the sprite catalogue, the headless tools and as fallbacks.
import { zombieLook } from "./sprites.js";
import { onForgetPictures } from "./pictures.js";
import { FRANCHISES } from "../sim/data-shops.js"; // the shops' chains and their looks (pure data)

const UP = 4;             // pre-upscale factor for the cached canvas
const OUTLINE = "#0b0c0e";
const TIRE = "#1c1c1e", HUB = "#8a8a8a", GLASS = "#a9cbe0", WOOD = "#7a5230", WOOD_LIT = "#a2713f", PACK = "#6b5434", SKIN = "#d6a77a", PANTS = "#34363c";
// Places (bases, camps, map markers).
const PLASTER = "#b9a98a", BOARDS = "#8b6a48", ROOF_RUST = "#8a4b32", ROOF_GRAY = "#5d6168", LIT_WIN = "#f0c860",
  DIRT = "#6e5c40", YARD = "#584a34", SOIL = "#4a3824", CROP = "#5f9a3c", CROP_LIT = "#8cc45e", METAL = "#7d848c", STONE = "#8d8a82",
  CONCRETE = "#94948c", WHITE = "#e8e4da", RED = "#d0342c", CANVAS = "#b3a27a", SAND = "#b8a27a", OLIVE = "#5d6b3a",
  RUST = "#7b5a44", GOLD = "#e8c04a", FIRE = "#ffb43b", FIRE_HOT = "#fff0a0", FIRE_RED = "#e0542a",
  SMOKE = "#b4b4b4aa", SMOKE_FAINT = "#a0a0a066", GLOW = "#ff9a3a55", FLESH = "#5a2a2e", BONE = "#d8d0bc";

// ---------- color helpers ----------
function rgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (r, g, b) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
function shade(hex, f) { // f < 0 darker, f > 0 lighter
  const [r, g, b] = rgb(hex);
  return f < 0 ? toHex(r * (1 + f), g * (1 + f), b * (1 + f)) : toHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f);
}

// ---------- painter ----------
function painter(w, h) {
  const px = new Array(w * h).fill(null);
  const p = {
    w, h,
    set(x, y, c) { if (x >= 0 && y >= 0 && x < w && y < h && c) px[y * w + x] = c; },
    get(x, y) { return x >= 0 && y >= 0 && x < w && y < h ? px[y * w + x] : null; },
    rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) p.set(x, y, c); },
    clear(x, y) { if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = null; },
  };
  return p;
}

function toCanvas(p) {
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas");
  cv.width = p.w * UP;
  cv.height = p.h * UP;
  const c = cv.getContext("2d");
  // Outline: every empty pixel touching a solid one (see-through pixels like smoke and glow get none).
  c.fillStyle = OUTLINE;
  const solid = (x, y) => { const v = p.get(x, y); return !!v && v.length <= 7; };
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (solid(x, y)) continue;
    if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) c.fillRect(x * UP, y * UP, UP, UP);
  }
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const col = p.get(x, y);
    if (!col) continue;
    c.fillStyle = col;
    c.fillRect(x * UP, y * UP, UP, UP);
  }
  return cv;
}

// ---------- parts ----------
function wheel(p, x, y) { // 4x4 tire with a hub, top-left at (x, y)
  p.rect(x + 1, y, x + 2, y + 3, TIRE);
  p.rect(x, y + 1, x + 3, y + 2, TIRE);
  p.set(x + 1, y + 1, HUB);
  p.set(x + 2, y + 2, shade(HUB, -0.3));
}

// One walker, top-left at (x, y): 5 wide, 11 tall, pack on the back (left, since sprites face right).
function walker(p, x, y, cloth, armed) {
  p.rect(x + 2, y, x + 3, y + 1, SKIN);              // head
  p.set(x + 2, y, shade(PACK, -0.3));                 // hair
  p.rect(x + 1, y + 2, x + 3, y + 6, cloth);          // torso
  p.set(x + 1, y + 6, shade(cloth, -0.35));
  p.rect(x, y + 2, x, y + 5, PACK);                   // backpack
  p.set(x, y + 2, shade(PACK, 0.25));
  p.set(x + 4, y + 4, SKIN);                          // hand
  p.rect(x + 1, y + 7, x + 1, y + 10, PANTS);         // legs, mid-stride
  p.rect(x + 3, y + 7, x + 3, y + 9, PANTS);
  p.set(x + 4, y + 10, PANTS);
  if (armed) { p.set(x + 4, y + 3, "#555"); p.set(x + 5, y + 2, "#555"); p.set(x + 6, y + 1, "#555"); }
}

// ---------- sprites ----------
// The team's cars, 22 × 13 facing right, drawn like real cars (the user's ask 2026-10-25): a low body from the sill
// (row 9) to the belt line (row 5), the cabin's flat roof with the windscreen and the rear window sloping down to the
// belt (cab: [x0, x1] of the roof row, widening a px a row), glass between its pillars, the wheels in their arches
// under the sills, a lamp at the nose and a tail light behind. A pickup's cab has a straight back, a van's box a
// straight back and a sloped nose.
function carSide(p, color, o) {
  const dark = shade(color, -0.35), lit = shade(color, 0.25), frame = shade(color, -0.2);
  const y0 = o.belt ?? 5, y1 = 9;
  p.rect(1, y0, 20, y1, color);                                   // the body
  p.rect(1, y1, 20, y1, dark);                                    // the sill
  p.rect(1, y0, 20, y0, lit);                                     // the belt line, lit
  const [c0, c1] = o.cab, top = o.top ?? 2, rows = y0 - top;      // the cabin: a trapezoid over the belt
  for (let r = 0; r < rows; r++) {
    const y = top + r, a = o.backStraight ? c0 : c0 - r, b = o.frontStraight ? c1 : c1 + r;
    p.rect(a, y, b, y, r === 0 ? lit : frame);
    if (r > 0) for (let x = a + 1; x <= b - 1; x++) if (!(o.pillars || []).includes(x)) p.set(x, y, GLASS);
    if (r === 1) p.set(b - 1, y, "#e4f1f8");                     // the lit corner of the windscreen
  }
  if (o.rack) p.rect(c0, top - 1, c1, top - 1, METAL);           // a rack on the roof
  p.set(20, y0 + 1, "#ffe28a"); p.set(1, y0 + 1, "#d24a3a");     // the lamp, the tail light
  p.rect(19, y1 - 1, 20, y1 - 1, shade(dark, -0.2));             // the grille
  wheel(p, 3, 8); wheel(p, 15, 8);                               // the wheels in their arches
}
// Pickup truck: the cab mid-body with a straight back, the bed behind it between its rails, a load under a tarp.
function paintTruck(color) {
  const p = painter(22, 13);
  carSide(p, color, { cab: [11, 15], backStraight: true });
  p.rect(2, 4, 10, 4, shade(color, 0.25));                       // the bed's rails
  p.rect(3, 3, 9, 4, "#8c7a52"); p.rect(3, 3, 9, 3, shade("#8c7a52", 0.2)); p.set(6, 4, shade("#8c7a52", -0.3)); // the load under a tarp
  return p;
}
// Army cargo truck (sim/miltrucks.js, vehicles.js miltruck): a tall square cab, a canvas-covered bed on six wheels,
// olive drab with a white star; `color` tints the canvas a little (your team's colour on its own truck). burnt: black
// and rusted, the canvas gone to ribs; wrecked: faded, a flat.
function paintMilTruck(color = OLIVE, cond = "intact") {
  const p = painter(24, 14);
  const body = cond === "burnt" ? "#2b2723" : cond === "wrecked" ? "#55583e" : OLIVE;
  const dark = shade(body, -0.35), lit = shade(body, 0.22);
  const canvas = cond === "burnt" ? null : cond === "wrecked" ? "#7a7458" : mixHex(CANVAS, color, 0.15);
  p.rect(1, 8, 22, 10, body); p.rect(1, 10, 22, 10, dark);           // chassis
  if (canvas) { p.rect(1, 2, 14, 7, canvas); p.rect(1, 2, 14, 2, shade(canvas, 0.2)); for (const x of [4, 8, 12]) p.rect(x, 3, x, 7, shade(canvas, -0.18)); }
  else for (const x of [1, 5, 9, 13]) { p.rect(x, 2, x, 7, "#3a2e26"); p.rect(1, 2, 14, 2, "#3a2e26"); } // the burnt canvas: bare ribs
  p.rect(16, 3, 21, 7, body); p.rect(16, 3, 21, 3, lit);             // cab
  p.rect(18, 4, 21, 5, cond === "burnt" ? "#1a1a1a" : GLASS);          // windscreen
  p.rect(22, 6, 23, 8, body); p.set(23, 7, cond === "burnt" ? "#1a1a1a" : "#ffe28a"); // bonnet, headlight
  if (cond !== "burnt") star(p, 16, 8, WHITE);
  wheel(p, 2, 10); wheel(p, 7, 10); wheel(p, 17, 10);
  if (cond === "wrecked") { p.clear(10, 13); p.rect(7, 13, 10, 13, TIRE); }
  if (cond === "burnt") { p.set(10, 1, SMOKE_FAINT); p.set(11, 0, SMOKE_FAINT); p.set(6, 3, "#5a3a28"); p.set(19, 6, "#5a3a28"); }
  return p;
}
function mixHex(a, b, f) { const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b); return toHex(r1 + (r2 - r1) * f, g1 + (g2 - g1) * f, b1 + (b2 - b1) * f); }
// The abandoned Army convoy (sim/miltrucks.js): two trucks nose to tail on a strip of road, a burnt one behind.
function paintConvoySite() {
  const p = painter(26, 16);
  p.rect(0, 12, 25, 15, "#4b4b50"); for (let x = 1; x < 26; x += 4) p.rect(x, 14, x + 1, 14, "#b9b39a");
  blit(p, paintMilTruck(OLIVE, "burnt"), 0, 0);
  blit(p, paintMilTruck(OLIVE, "intact"), 3, 2);
  return p;
}
// A truck spotted on the road (markers.js "miltruck"): a small Army truck with a white star.
function paintMilTruckMarker() { return paintMilTruck(OLIVE, "wrecked"); }

// A vehicle's upgrades (sim/vehicles.js) painted over its sprite: steel plates riveted along the body (a second row up
// the cab at level 2; patchy rust and grey for scrap plating), a dark grille or a thick green tint over the windows, and
// a machine gun on a ring on the roof. u: the code from upsCode ("" for none).
const PLATE = "#6f757c", PLATE_DK = "#4d5258", SCRAP_A = "#7b5a44", SCRAP_B = "#5f6158", BGLASS = "#7fb3a6", MESH = "#3e4044";
const ARMOUR_AT = { // band: [x0, x1, y0, y1] the body, band2: up the cab, roof: where the gun's ring sits
  truck: { band: [1, 20, 6, 8], band2: [11, 11, 3, 4], roof: [13, 1] },
  sedan: { band: [1, 20, 6, 8], band2: [5, 6, 3, 4], roof: [9, 1] },
  suv: { band: [1, 20, 6, 8], band2: [3, 4, 3, 4], roof: [8, 0] },
  van: { band: [1, 20, 6, 8], band2: [1, 1, 2, 4], roof: [8, 1] },
  hummer: { band: [1, 20, 5, 8], band2: [5, 5, 2, 3], roof: [9, 1] },
  miltruck: { band: [1, 22, 8, 9], band2: [16, 17, 4, 7], roof: [17, 2] },
};
// "p<plating>s<scrap>g<glass>m<mesh>t<gun>" from v.upgrades, "" when it has none.
export function upsCode(u) {
  if (!u || !(u.plating || u.scrapPlate || u.glass || u.mesh || u.turret)) return "";
  return `p${u.plating || 0}s${u.scrapPlate || 0}g${u.glass || 0}m${u.mesh || 0}t${u.turret ? u.turret.gun : ""}`;
}
function armourOverlay(p, kind, code) {
  const A = ARMOUR_AT[kind];
  if (!A || !code) return p;
  const n = (k) => Number(code[code.indexOf(k) + 1]) || 0; // the code is fixed: p#s#g#m#t<gun>
  const gun = code.slice(code.indexOf("t") + 1);
  const keep = (c) => !c || c === TIRE || c === HUB || c === GLASS || c === "#e4f1f8" || c === "#ffe28a" || c === "#d24a3a";
  const plate = ([x0, x1, y0, y1], scrap) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (keep(p.get(x, y))) continue;
      p.set(x, y, scrap ? (((x >> 1) + y) % 2 ? SCRAP_A : SCRAP_B) : x % 4 === 0 && y === y0 ? PLATE_DK : PLATE);
    }
  };
  if (n("s")) plate(A.band, true);
  if (n("p")) { plate(A.band, false); if (n("p") > 1) plate(A.band2, false); }
  if (n("m") || n("g")) for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const c = p.get(x, y);
    if (c !== GLASS && c !== "#e4f1f8") continue;
    p.set(x, y, n("m") ? ((x + y) % 2 ? MESH : c) : BGLASS);
  }
  if (gun) {
    const [x, y] = A.roof;
    p.rect(x, y, x + 1, y, PLATE_DK); p.set(x, y - 1, PLATE_DK);         // the ring and the gunner's shield
    p.rect(x + 1, y - 1, x + (gun === "m2hb" ? 7 : 5), y - 1, "#26272a"); // the barrel, forward
  }
  return p;
}

// Sedan: the cabin set back on a long low body, a pillar between its doors' windows.
function paintSedan(color) {
  const p = painter(22, 13);
  carSide(p, color, { cab: [7, 12], pillars: [10] });
  return p;
}
// SUV: a tall long cabin running back to the tailgate, two pillars, a rack on the roof.
function paintSuv(color) {
  const p = painter(22, 13);
  carSide(p, color, { cab: [5, 13], pillars: [8, 12], rack: true });
  return p;
}
// Work van: one tall box from the sloped windscreen to the straight back doors, the sliding door's line down it.
function paintVan(color) {
  const p = painter(22, 13);
  carSide(p, color, { cab: [1, 14], top: 1, backStraight: true, pillars: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] });
  p.rect(2, 2, 12, 4, color); p.rect(8, 2, 8, 4, shade(color, -0.35)); // the box's blank side, the sliding door's line
  return p;
}
// Hummer of the team's (humvee: a group's, armed): a wide low slab with a long flat bonnet and a squat cab; the gun on
// its roof only as an upgrade (armourOverlay).
function paintHummer(color) {
  const p = painter(22, 13);
  const body = mixHex(OLIVE, color, 0.45);
  carSide(p, body, { cab: [5, 12], top: 2, belt: 4, backStraight: true, frontStraight: true, pillars: [9] });
  return p;
}
// A few walkers with packs (1–3 figures by team size); armed for raids.
function paintWalkers(color, count, armed) {
  const p = painter(20, 14);
  const pos = [[7, 3], [1, 1], [13, 2]].slice(0, Math.max(1, Math.min(3, count)));
  pos.sort((a, b) => a[1] - b[1]); // back row first
  pos.forEach(([x, y], i) => walker(p, x, y, i % 2 ? shade(color, -0.15) : color, armed));
  return p;
}

// Rowboat with the team (and their gear), or a log raft with the vehicle lashed on top.
function paintBoat(color, raft) {
  const p = painter(24, 13);
  if (raft) {
    p.rect(1, 9, 22, 11, WOOD);
    for (let x = 1; x <= 22; x += 3) p.rect(x, 9, x, 11, shade(WOOD, -0.3)); // logs
    p.rect(1, 9, 22, 9, WOOD_LIT);
    p.rect(4, 5, 17, 8, color);                        // the vehicle on deck
    p.rect(10, 2, 15, 4, color);
    p.rect(12, 3, 14, 4, GLASS);
    p.rect(4, 8, 17, 8, shade(color, -0.35));
    p.rect(19, 3, 19, 8, "#5c4128");                   // pole
    p.set(20, 2, "#5c4128");
    p.rect(18, 6, 19, 6, SKIN);
    return p;
  }
  p.rect(1, 7, 22, 8, WOOD_LIT);                       // gunwale
  p.rect(2, 9, 21, 9, WOOD);
  p.rect(3, 10, 20, 10, WOOD);
  p.rect(5, 11, 18, 11, shade(WOOD, -0.3));
  p.rect(21, 5, 22, 6, WOOD_LIT);                      // bow
  for (const x of [6, 13]) {                           // two rowers
    p.rect(x + 1, 1, x + 2, 2, SKIN);
    p.rect(x, 3, x + 2, 6, color);
    p.set(x, 6, shade(color, -0.35));
  }
  p.rect(16, 4, 19, 6, "#8c7a52");                     // gear
  p.rect(3, 4, 4, 6, PACK);
  p.set(2, 8, "#5c4128"); p.set(1, 9, "#5c4128"); p.set(0, 10, "#5c4128"); // oar
  return p;
}

// ---------- place parts ----------
// Copies another painter's pixels in at (ox, oy).
function blit(p, src, ox, oy) {
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) p.set(ox + x, oy + y, src.get(x, y));
}

// House seen from the front: wall from (x, y) w × h, a gable roof rh rows tall above it, door and lit windows.
function house(p, x, y, w, h, wall, roof, { rh = 3, door = true, win = true } = {}) {
  p.rect(x, y, x + w - 1, y + h - 1, wall);
  p.rect(x, y, x + w - 1, y, shade(wall, -0.25));                 // shadow under the eaves
  for (let r = 0; r < rh; r++) {
    const inset = rh - 1 - r;
    p.rect(x - 1 + inset, y - rh + r, x + w - inset, y - rh + r, r === 0 ? shade(roof, 0.3) : r === rh - 1 ? shade(roof, -0.25) : roof);
  }
  if (door) { const dx = x + Math.floor(w / 2) - 1; p.rect(dx, y + h - 3, dx + 1, y + h - 1, shade(wall, -0.6)); }
  if (win && w >= 6) { p.set(x + 1, y + 2, LIT_WIN); p.set(x + w - 2, y + 2, LIT_WIN); }
}

// Sharpened stakes from x0 to x1 standing on row yb, h tall (every other one a pixel shorter); metal: sheet patches.
function palisade(p, x0, x1, yb, h, metal = false) {
  for (let x = x0; x <= x1; x++) {
    const odd = (x - x0) % 2, top = yb - h + 1 + odd, c = odd ? WOOD : WOOD_LIT;
    p.rect(x, top, x, yb, c);
    p.set(x, top, shade(c, 0.35));
  }
  p.rect(x0, yb - h + 3, x1, yb - h + 3, shade(WOOD, -0.4));    // crossbeam
  if (metal) for (let x = x0 + 1; x <= x1 - 2; x += 5) { p.rect(x, yb - 2, x + 2, yb, METAL); p.set(x, yb - 2, shade(METAL, 0.3)); }
}

// Low picket fence on row yb from x0 to x1, with a gap from gx0 to gx1.
function picket(p, x0, x1, yb, gx0 = -1, gx1 = -2) {
  for (let x = x0; x <= x1; x++) {
    if (x >= gx0 && x <= gx1) continue;
    p.set(x, yb - 1, WOOD);
    if ((x - x0) % 3 === 0) { p.rect(x, yb - 2, x, yb, WOOD_LIT); p.set(x, yb - 2, shade(WOOD_LIT, 0.3)); }
  }
}

// The base's front wall by wall level: 0 picket fence, 1 palisade, 2 taller with side walls, 3 plated with guard posts.
function frontWall(p, x0, x1, yb, lvl, top) {
  const gx = Math.floor((x0 + x1) / 2) - 1;
  if (lvl <= 0) { picket(p, x0, x1, yb, gx, gx + 3); return; }
  const h = [0, 5, 6, 7][Math.min(3, lvl)];
  if (lvl >= 2) for (const sx of [x0, x1 - 1]) {                 // side walls running back
    for (let x = sx; x <= sx + 1; x++) { p.rect(x, top + (x - sx), x, yb, x === sx ? WOOD_LIT : WOOD); p.set(x, top + (x - sx), shade(WOOD_LIT, 0.35)); }
  }
  palisade(p, x0, gx - 1, yb, h, lvl >= 3);
  palisade(p, gx + 4, x1, yb, h, lvl >= 3);
  const gate = shade(WOOD, -0.45);                               // double gate
  p.rect(gx, yb - h + 3, gx + 3, yb, gate);
  p.rect(gx, yb - h + 3, gx + 3, yb - h + 3, shade(WOOD, -0.2));
  p.rect(gx + 1, yb - h + 4, gx + 1, yb, shade(gate, -0.3));
  p.set(gx + 2, yb - 2, shade(METAL, 0.2));
  if (lvl >= 3) for (const gx2 of [x0, x1 - 2]) {                 // guard posts on the corners
    p.rect(gx2, yb - h - 2, gx2 + 2, yb - h, METAL);
    p.rect(gx2 - 1, yb - h - 3, gx2 + 3, yb - h - 3, shade(METAL, -0.3));
    p.set(gx2 + 1, yb - h - 1, OUTLINE);
  }
}

// Watchtower: lookout hut on stilts, x..x+4, standing on row yb.
function watchtower(p, x, yb, h = 14) {
  p.rect(x, yb - h + 4, x, yb, WOOD);
  p.rect(x + 4, yb - h + 4, x + 4, yb, WOOD);
  for (let i = 0; i < 3; i++) p.set(x + 1 + i, yb - h + 6 + i * 2, shade(WOOD, -0.3)); // brace
  p.rect(x, yb - h + 1, x + 4, yb - h + 3, BOARDS);
  p.set(x + 2, yb - h + 2, OUTLINE);                              // lookout slot
  p.rect(x - 1, yb - h, x + 5, yb - h, ROOF_GRAY);
  p.rect(x, yb - h - 1, x + 4, yb - h - 1, shade(ROOF_GRAY, 0.3));
}

// Radio mast from row top down to yb at column x, with crossbars and a red light.
function mast(p, x, top, yb) {
  p.rect(x, top + 1, x, yb, METAL);
  for (let y = top + 3; y < yb - 1; y += 3) { p.set(x - 1, y, shade(METAL, -0.2)); p.set(x + 1, y, shade(METAL, -0.2)); }
  p.set(x, top, RED);
  p.set(x - 1, top, "#ff6a5a55"); p.set(x + 1, top, "#ff6a5a55");
}

// Flag on a pole from row top, pole length len; the flag hangs to the right.
function flag(p, x, top, color, len = 7, fw = 4) {
  p.rect(x, top, x, top + len, "#c9c9c9");
  p.rect(x + 1, top, x + fw, top + 2, color);
  p.rect(x + 1, top + 2, x + fw, top + 2, shade(color, -0.3));
  p.set(x + fw, top + 1, shade(color, 0.25));
}

// Chimney at (x, y) with a plume of smoke drifting right.
function smoke(p, x, y) {
  p.rect(x, y, x + 1, y + 2, shade(STONE, -0.3));
  p.set(x, y - 1, SMOKE); p.set(x + 1, y - 2, SMOKE); p.set(x + 1, y - 3, SMOKE_FAINT);
  p.set(x + 2, y - 3, SMOKE); p.set(x + 3, y - 4, SMOKE_FAINT); p.set(x + 2, y - 5, SMOKE_FAINT);
}

const redCross = (p, x, y) => { p.set(x + 1, y, RED); p.rect(x, y + 1, x + 2, y + 1, RED); p.set(x + 1, y + 2, RED); };

// A-frame tent centered on cx, standing on row yb, half rows tall; door: dark opening.
function tent(p, cx, yb, half, c, door = true) {
  for (let r = 0; r <= half; r++) {
    const y = yb - half + r;
    p.rect(cx - r, y, cx, y, c);
    p.rect(cx + 1, y, cx + r, y, shade(c, -0.22));
  }
  p.set(cx, yb - half, shade(c, 0.3));
  if (door) { p.rect(cx, yb - Math.floor(half / 2), cx, yb, shade(c, -0.65)); p.set(cx + 1, yb, shade(c, -0.65)); }
}

// Campfire: crossed logs from x..x+3 on row yb, flames above (lit) or grey ash.
function campfire(p, x, yb, lit = true) {
  p.rect(x, yb, x + 3, yb, WOOD);
  p.set(x, yb - 1, WOOD_LIT); p.set(x + 3, yb - 1, WOOD_LIT);
  if (!lit) { p.rect(x + 1, yb - 1, x + 2, yb - 1, "#6a6a66"); return; }
  for (const [dx, dy] of [[-1, 0], [4, 0], [-1, -2], [4, -2], [0, -4], [3, -4], [1, -5], [2, -5]]) p.set(x + dx, yb + dy, GLOW);
  p.rect(x + 1, yb - 1, x + 2, yb - 1, FIRE_RED);
  p.set(x + 1, yb - 2, FIRE); p.set(x + 2, yb - 2, FIRE_HOT);
  p.set(x + 2, yb - 3, FIRE); p.set(x + 1, yb - 4, "#ffb43b99");
}

// Crop rows from (x0, y0) to (x1, y1).
function crops(p, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    p.set(x, y, (y - y0) % 2 ? SOIL : (x + y) % 2 ? CROP : CROP_LIT);
  }
}

// Burning oil drum, 2 wide, standing on row yb.
function barrel(p, x, yb, fire = true) {
  p.rect(x, yb - 2, x + 1, yb, RUST);
  p.rect(x, yb - 1, x + 1, yb - 1, shade(RUST, -0.35));
  if (fire) { p.set(x, yb - 3, FIRE); p.set(x + 1, yb - 3, FIRE_HOT); p.set(x, yb - 4, "#ffb43b99"); p.set(x - 1, yb - 3, GLOW); p.set(x + 2, yb - 3, GLOW); }
}

// Crate, w × h, top-left at (x, y).
function crate(p, x, y, w, h, c = WOOD_LIT) {
  p.rect(x, y, x + w - 1, y + h - 1, c);
  p.rect(x, y, x + w - 1, y, shade(c, 0.25));
  p.rect(x, y + h - 1, x + w - 1, y + h - 1, shade(c, -0.35));
  for (let i = 1; i < h - 1; i++) p.set(x + Math.round((i * (w - 1)) / (h - 1)), y + i, shade(c, -0.3));
}

// ---------- your bases ----------
// look: { kind: "hub" | "outpost", color, walls (0–3 built), tower, radio, hosp (tier 0–4), farms (0–2), workshop, big }
function paintHub(L) {
  const p = painter(38, 30);
  const yb = 27, c = L.color;
  p.rect(3, 18, 34, yb, YARD);                                    // yard
  p.rect(3, 18, 34, 18, shade(YARD, -0.25));
  if (L.radio) mast(p, 35, 2, 19);
  if (L.tower) watchtower(p, 0, 22, 16);
  // Left: hospital (clinic and up) or a house.
  if (L.hosp >= 3) {
    house(p, 4, L.hosp >= 4 ? 11 : 13, 9, L.hosp >= 4 ? 8 : 6, WHITE, shade(RED, -0.2), { win: false });
    redCross(p, 7, L.hosp >= 4 ? 13 : 14);
    if (L.hosp >= 4) { p.set(5, 13, LIT_WIN); p.set(11, 13, LIT_WIN); p.set(5, 16, LIT_WIN); p.set(11, 16, LIT_WIN); }
  } else house(p, 5, 14, 8, 5, PLASTER, ROOF_RUST);
  // Main hall in your color with the flag on top.
  flag(p, 19, 1, c, 9, 5);
  house(p, 14, 12, 11, 7, BOARDS, c, { rh: 4 });
  p.rect(18, 14, 20, 14, LIT_WIN);
  // Right: workshop (smoking chimney when there are stations) or a store.
  if (L.workshop) smoke(p, 30, 10);
  house(p, 26, 14, 7, 5, "#8e8a80", ROOF_GRAY);
  // Yard: farm plots, and a medical tent for the lower hospital tiers.
  if (L.farms >= 1) crops(p, 4, 20, 12, 22);
  if (L.farms >= 2) crops(p, 14, 20, 17, 22);
  if (L.hosp === 1 || L.hosp === 2) {
    const half = L.hosp === 2 ? 4 : 3;
    tent(p, 25, 22, half, WHITE, false);
    redCross(p, 24, 22 - 2);
  }
  frontWall(p, 2, 35, yb, L.walls, 16);
  return p;
}

// A shelter (tier 0, sim/buildings.js SHELTER): the camp built up. The shack roofed in your color with a
// stovepipe, a lean-to and the tarp, rain barrels and a fire pit in a yard of trampled earth, the scrap barricade
// closed all round with a gap for a gate, the flag up. Built-up: rain catchers, a drying rack, a farm plot.
function paintShelter(L) {
  const p = painter(32, 23);
  const yb = 21, c = L.color, tarp = shade(c, 0.12);
  p.rect(1, 14, 30, yb, DIRT);
  p.rect(1, 14, 30, 14, shade(DIRT, -0.25));
  for (const [x, y] of [[5, 17], [13, 19], [21, 16], [27, 18]]) p.set(x, y, shade(DIRT, 0.18));
  flag(p, 29, 0, c, 9, 3);
  house(p, 15, 8, 10, 7, BOARDS, c, { rh: 3 });                    // the shack
  p.rect(23, 2, 23, 5, shade(METAL, -0.1)); p.set(23, 1, SMOKE); p.set(24, 0, SMOKE_FAINT); // stovepipe
  p.rect(9, 10, 14, 10, WOOD_LIT); p.rect(9, 11, 9, 14, WOOD);      // lean-to on the shack's side
  p.rect(10, 11, 14, 14, shade(BOARDS, -0.15));
  tent(p, 5, 16, 5, tarp);                                          // the tarp shelter
  if (L.farms) crops(p, 2, 18, 8, 19);
  barrel(p, 26, 18, false); p.set(26, 15, shade(METAL, 0.3)); p.set(27, 15, shade(METAL, 0.3)); // rain barrel
  if (L.rain) { barrel(p, 28, 18, false); p.rect(25, 14, 29, 14, shade(tarp, -0.2)); }
  if (L.rack) for (let x = 18; x <= 22; x += 2) { p.rect(x, 16, x, 18, WOOD); p.set(x + 1, 16, "#8a4a2a"); }
  campfire(p, 11, 18, L.fire !== false);
  crate(p, 22, 17, 3, 2, BOARDS);
  palisade(p, 0, 12, yb + 1, 5);                                    // the barricade, a gap for the gate
  palisade(p, 17, 31, yb + 1, 5);
  p.rect(13, yb - 1, 16, yb, shade(WOOD, -0.45));
  return p;
}

function paintOutpost(L) {
  const p = painter(28, 22);
  const yb = 19, c = L.color;
  p.rect(2, 13, 25, yb, YARD);
  p.rect(2, 13, 25, 13, shade(YARD, -0.25));
  if (L.radio) mast(p, 25, 1, 14);
  if (L.tower) watchtower(p, 0, 15, 13);
  if (L.big) house(p, 19, 10, 5, 4, "#8e8a80", ROOF_GRAY, { rh: 2, win: false });
  if (L.workshop) smoke(p, 9, 5);
  flag(p, 16, 0, c, 6, 4);
  const clinic = L.hosp >= 3;
  house(p, 7, 9, 10, 5, clinic ? WHITE : BOARDS, c);
  if (clinic) { p.clear(11, 13); p.clear(12, 13); redCross(p, 11, 10); p.rect(11, 13, 12, 13, shade(WHITE, -0.6)); }
  if (L.farms >= 1) crops(p, 3, 15, 8, 16);
  if (L.hosp === 1 || L.hosp === 2) { const half = L.hosp + 2; tent(p, 21, 16, half, WHITE, false); redCross(p, 20, 14); }
  frontWall(p, 1, 26, yb, L.walls, 11);
  return p;
}

// ---------- other groups' bases (tinted with the group's color) ----------
function paintRaiderBase(c) {
  const p = painter(36, 28);
  const yb = 25;
  p.rect(2, 19, 33, yb, DIRT);
  // Scrap shacks: corrugated sheets, one roofed with a tarp in the gang's color.
  const shack = (x0, y0, x1, y1, roof) => {
    p.rect(x0, y0, x1, y1, RUST);
    for (let x = x0; x <= x1; x += 2) p.rect(x, y0, x, y1, shade(RUST, -0.2));
    p.rect(x0 + 1, y0 + 2, x0 + 2, y0 + 3, OUTLINE);
    p.rect(x0 - 1, y0 - 2, x1 + 1, y0 - 1, roof);
    p.rect(x0 - 1, y0 - 2, x1 + 1, y0 - 2, shade(roof, 0.25));
    p.rect(x1 - 3, y1 - 3, x1 - 2, y1, OUTLINE);
  };
  shack(4, 13, 13, 20, shade(METAL, -0.1));
  shack(21, 10, 31, 20, c);
  p.set(26, 13, LIT_WIN);
  // Pole with a skull flag.
  p.rect(17, 2, 17, 19, "#9a8a70");
  p.rect(18, 2, 23, 6, c);
  p.rect(18, 6, 23, 6, shade(c, -0.35));
  p.rect(20, 3, 21, 4, BONE); p.set(20, 5, BONE); p.set(21, 5, BONE); p.set(20, 4, OUTLINE);
  barrel(p, 15, 22);
  // Tires.
  for (const [x, y] of [[28, 22], [30, 22], [29, 20]]) { p.rect(x, y, x + 1, y + 1, TIRE); p.set(x, y, "#3a3a3c"); }
  // Spiked barricade across the front.
  for (let x = 2; x <= 33; x++) p.set(x, yb - 1, shade(WOOD, -0.3));
  for (let x = 3; x <= 32; x += 4) {
    for (let i = 0; i < 4; i++) { p.set(x + i, yb - i, WOOD_LIT); p.set(x + 3 - i, yb - i, WOOD); }
    p.set(x, yb - 4, BONE); p.set(x + 3, yb - 4, BONE);
  }
  return p;
}

function paintMilitaryBase(c) {
  const p = painter(36, 28);
  const yb = 25;
  p.rect(2, 18, 33, yb, "#6a6450");
  // Quonset huts.
  const hut = (x0, x1, yb2) => {
    const r = Math.floor((x1 - x0) / 2);
    for (let y = 0; y <= 5; y++) {
      const inset = y === 0 ? 2 : y === 1 ? 1 : 0;
      p.rect(x0 + inset, yb2 - 5 + y, x1 - inset, yb2 - 5 + y, y === 0 ? shade(OLIVE, 0.25) : OLIVE);
    }
    for (let x = x0 + 1; x < x1; x += 3) p.rect(x, yb2 - 4, x, yb2, shade(OLIVE, -0.25));
    p.rect(x0 + r - 1, yb2 - 2, x0 + r, yb2, OUTLINE);
    return r;
  };
  hut(3, 13, 18);
  hut(22, 33, 18);
  p.set(25, 15, LIT_WIN); p.set(30, 15, LIT_WIN);
  // Flagpole and radio antenna.
  flag(p, 17, 1, c, 16, 5);
  p.set(18, 4, WHITE); p.set(20, 4, WHITE); p.set(19, 3, WHITE);   // stars on the flag
  mast(p, 34, 4, 18);
  // Chain-link fence with barbed wire, sandbags at the gate.
  for (let x = 2; x <= 33; x++) {
    if (x >= 15 && x <= 20) continue;
    for (let y = yb - 4; y <= yb; y++) if ((x + y) % 2 === 0) p.set(x, y, "#8a9096");
    if ((x - 2) % 5 === 0) p.rect(x, yb - 5, x, yb, "#5a6066");
    if (x % 2) p.set(x, yb - 6, "#6e7378");
  }
  for (const x of [13, 21]) { p.rect(x, yb - 2, x + 2, yb, SAND); p.rect(x, yb - 3, x + 2, yb - 3, shade(SAND, 0.25)); p.set(x + 1, yb - 1, shade(SAND, -0.3)); }
  return p;
}

function paintFortressBase(c) {
  const p = painter(36, 28);
  const yb = 26;
  // Keep behind the wall, roofed in the group's color.
  house(p, 12, 8, 12, 6, STONE, c, { rh: 4, door: false });
  // Curtain wall with battlements.
  p.rect(5, 15, 30, yb, STONE);
  for (let x = 5; x <= 30; x += 2) p.set(x, 14, STONE);
  for (let y = 16; y <= yb; y += 2) for (let x = 5 + (y % 4 ? 0 : 2); x <= 30; x += 4) p.set(x, y, shade(STONE, -0.2));
  // Towers with banners.
  for (const tx of [1, 29]) {
    p.rect(tx, 9, tx + 5, yb, shade(STONE, 0.08));
    for (let x = tx; x <= tx + 5; x += 2) p.set(x, 8, shade(STONE, 0.08));
    p.rect(tx + 1, 11, tx + 4, 16, c);
    p.rect(tx + 1, 16, tx + 4, 16, shade(c, -0.35));
    p.set(tx + 2, 17, c); p.set(tx + 3, 17, c);
    p.set(tx + 2, 13, GOLD); p.set(tx + 3, 13, GOLD);
    p.rect(tx + 2, 20, tx + 3, 21, OUTLINE);                      // arrow slit
  }
  // Gate.
  p.rect(15, 19, 20, yb, shade(WOOD, -0.3));
  p.rect(16, 18, 19, 18, shade(WOOD, -0.3));
  for (let x = 15; x <= 20; x += 2) p.rect(x, 19, x, yb, shade(WOOD, -0.5));
  p.rect(14, 17, 21, 17, shade(STONE, -0.3));
  return p;
}

function paintZealotBase(c) {
  const p = painter(36, 28);
  const yb = 25;
  p.rect(2, 21, 33, yb, DIRT);
  const wall = "#cfc7b4";
  // Church: nave, steeple with a sun sign, a round window in the group's color.
  house(p, 8, 13, 20, 9, wall, shade(c, -0.35), { rh: 4, door: false, win: false });
  p.rect(15, 5, 20, 12, wall);
  p.rect(15, 5, 15, 12, shade(wall, 0.15));
  for (let r = 0; r < 4; r++) { const inset = Math.max(0, r - 1); p.rect(15 + inset, 4 - r, 20 - inset, 4 - r, shade(c, -0.35 + r * 0.12)); } // spire
  p.rect(17, 0, 18, 1, GOLD);
  p.set(16, 0, "#e8c04a77"); p.set(19, 0, "#e8c04a77");          // the sun sign glints
  p.rect(17, 7, 18, 9, c); p.set(17, 7, shade(c, 0.35));
  p.rect(16, 18, 19, 21, OUTLINE);                                // door
  p.rect(17, 17, 18, 17, OUTLINE);
  for (const x of [10, 12, 23, 25]) { p.rect(x, 16, x, 18, shade(c, 0.1)); p.set(x, 16, LIT_WIN); }
  // Bonfire and banners on stakes.
  campfire(p, 4, 23);
  for (const x of [29, 33]) { p.rect(x, 14, x, yb, WOOD); p.rect(x - 2, 14, x - 1, 18, c); p.set(x - 1, 19, c); }
  // Stake fence with ribbons.
  for (let x = 2; x <= 33; x += 3) { if (x >= 14 && x <= 21) continue; p.rect(x, yb - 2, x, yb, WOOD_LIT); p.set(x, yb - 3, shade(WOOD_LIT, 0.3)); p.set(x + 1, yb - 1, c); }
  return p;
}

function paintExpansionistBase(c) {
  const p = painter(36, 28);
  const yb = 26;
  // Concrete block with a long banner in the group's color.
  p.rect(5, 6, 30, 19, CONCRETE);
  p.rect(5, 6, 30, 6, shade(CONCRETE, 0.25));
  p.rect(4, 5, 31, 5, shade(CONCRETE, -0.3));
  for (let y = 8; y <= 17; y += 3) for (let x = 7; x <= 28; x += 3) if (x < 15 || x > 20) p.set(x, y, (x * 7 + y) % 5 ? OUTLINE : LIT_WIN);
  p.rect(15, 7, 20, 17, c);
  p.rect(15, 7, 20, 7, shade(c, 0.3));
  p.rect(16, 18, 19, 18, c); p.rect(17, 19, 18, 19, c);
  p.rect(17, 10, 18, 13, WHITE); p.rect(16, 11, 19, 11, WHITE);   // emblem
  // Searchlight tower.
  p.rect(32, 4, 32, 21, METAL); p.rect(31, 2, 34, 4, shade(METAL, -0.2)); p.set(33, 3, FIRE_HOT); p.set(34, 3, "#fff0a066");
  // Concrete wall topped with barbed wire, steel gate.
  p.rect(1, 20, 34, yb, shade(CONCRETE, -0.12));
  p.rect(1, 20, 34, 20, shade(CONCRETE, 0.15));
  for (let x = 1; x <= 34; x += 6) p.rect(x, 21, x, yb, shade(CONCRETE, -0.3));
  for (let x = 1; x <= 34; x++) p.set(x, 18 + (x % 2), (x % 3) ? "#8a9096" : "#5a6066");
  p.rect(14, 21, 21, yb, METAL);
  for (let x = 15; x <= 21; x += 2) p.rect(x, 21, x, yb, shade(METAL, -0.3));
  p.rect(14, 21, 21, 21, c);
  return p;
}

function paintTraderBase(c) {
  const p = painter(36, 28);
  const yb = 25;
  p.rect(2, 19, 33, yb, DIRT);
  // Sign on poles, and the convoy truck parked between the stalls.
  p.rect(12, 2, 12, 9, WOOD); p.rect(23, 2, 23, 9, WOOD);
  p.rect(11, 2, 24, 5, c); p.rect(11, 2, 24, 2, shade(c, 0.3)); p.rect(11, 5, 24, 5, shade(c, -0.35));
  for (let x = 13; x <= 22; x += 2) p.set(x, 3 + (x % 4 ? 0 : 1), WHITE);
  blit(p, paintTruck("#8a8f96"), 7, 10);
  // Market stalls with striped awnings in the group's color.
  const stall = (x0, x1, y) => {
    for (let x = x0; x <= x1; x++) { p.rect(x, y, x, y + 1, Math.floor((x - x0) / 2) % 2 ? WHITE : c); p.set(x, y + 2, (x - x0) % 2 ? c : null); }
    p.rect(x0, y + 2, x0, y + 8, WOOD); p.rect(x1, y + 2, x1, y + 8, WOOD);
    p.rect(x0, y + 6, x1, y + 7, BOARDS); p.rect(x0, y + 6, x1, y + 6, shade(BOARDS, 0.25));
    for (let x = x0 + 1; x < x1; x += 2) p.set(x, y + 5, [GOLD, CROP_LIT, RED, "#d9d0b8"][x % 4]);
  };
  stall(1, 8, 12);
  stall(27, 34, 12);
  crate(p, 3, 21, 4, 3); crate(p, 7, 22, 3, 2, shade(WOOD_LIT, -0.15)); crate(p, 12, 22, 4, 3, shade(WOOD_LIT, 0.08));
  barrel(p, 28, 24, false); barrel(p, 30, 24, false);
  p.set(28, 22, shade(METAL, 0.2)); p.set(30, 22, shade(METAL, 0.2));
  return p;
}

function paintCommuneBase(c) {
  const p = painter(36, 28);
  const yb = 25;
  // Silo, then a barn in the group's color with white trim and a gambrel roof.
  p.rect(26, 5, 31, 19, shade(METAL, 0.1));
  p.rect(26, 5, 26, 19, shade(METAL, 0.35));
  for (let y = 8; y <= 19; y += 3) p.rect(26, y, 31, y, shade(METAL, -0.15));
  p.rect(27, 3, 30, 4, ROOF_GRAY); p.rect(28, 2, 29, 2, ROOF_GRAY);
  const barn = shade(c, -0.15);
  p.rect(6, 11, 23, 19, barn);
  for (let x = 6; x <= 23; x += 2) p.rect(x, 12, x, 19, shade(barn, -0.12));
  for (let r = 0; r < 5; r++) {                                    // gambrel roof
    const inset = r < 2 ? 3 - r * 1.5 : 0;
    p.rect(5 + Math.ceil(inset) + (r === 0 ? 3 : 0), 6 + r, 24 - Math.ceil(inset) - (r === 0 ? 3 : 0), 6 + r, r === 0 ? shade(ROOF_GRAY, 0.3) : r === 4 ? shade(ROOF_GRAY, -0.25) : ROOF_GRAY);
  }
  p.rect(12, 13, 17, 19, shade(barn, -0.4));                       // barn doors with a white X
  for (let i = 0; i < 6; i++) { p.set(12 + i, 13 + i, WHITE); p.set(17 - i, 13 + i, WHITE); }
  p.rect(12, 13, 17, 13, WHITE); p.rect(11, 13, 11, 19, WHITE); p.rect(18, 13, 18, 19, WHITE);
  p.rect(14, 8, 15, 9, LIT_WIN);                                   // hayloft
  // Fields and a rail fence.
  crops(p, 2, 21, 33, 24);
  for (let x = 1; x <= 34; x++) { p.set(x, yb - 2, WOOD_LIT); p.set(x, yb, WOOD); if ((x - 1) % 4 === 0) p.rect(x, yb - 3, x, yb, WOOD); }
  return p;
}

const FACTION_PAINT = { raider: paintRaiderBase, military: paintMilitaryBase, fortress: paintFortressBase, zealot: paintZealotBase,
  expansionist: paintExpansionistBase, traders: paintTraderBase, commune: paintCommuneBase };

// ---------- camps and markers ----------
// A team's camp: tent (tinted with the team's color) and a campfire; abandoned: grey, torn, cold.
function paintCamp(color, lit = true) {
  const p = painter(18, 11);
  const canvas = lit ? shade(color, -0.1) : "#8a8478";
  tent(p, 6, 9, 6, canvas);
  if (!lit) { p.clear(3, 6); p.clear(2, 7); p.set(3, 7, OUTLINE); p.clear(9, 5); }
  p.set(6, 3, lit ? shade(canvas, 0.35) : canvas);
  p.rect(0, 10, 12, 10, shade(DIRT, 0.1));
  campfire(p, 13, 9, lit);
  return p;
}

// Your camp (sim/staging.js) by how far its step up has got (stage 0–3): 0 a tarp shelter, crates and a fire on
// trampled ground with a pile of stakes; 1 the first stretch of barricade and the posts of a shack; 2 the shack half
// boarded, the barricade on both sides; 3 the shack roofed in your color, the barricade all but closed, a flag up.
// The tarp, roof and flag are in your color (like the camp and base sprites).
function paintStaging(stage, color, lit = true) {
  const p = painter(30, 21);
  const yb = 19, tarp = shade(color, 0.12);
  p.rect(1, 13, 28, yb, DIRT);                                    // trampled ground
  p.rect(1, 13, 28, 13, shade(DIRT, -0.25));
  for (const [x, y] of [[4, 16], [11, 18], [19, 15], [25, 17], [8, 14]]) p.set(x, y, shade(DIRT, 0.18));
  // The shack going up at the back right: posts, then boards, then a roof.
  if (stage >= 1) {
    for (const x of [17, 25]) p.rect(x, stage >= 2 ? 6 : 8, x, 13, WOOD);
    p.rect(17, stage >= 2 ? 6 : 8, 25, stage >= 2 ? 6 : 8, WOOD_LIT); // the top beam
  }
  if (stage === 2) { p.rect(18, 10, 24, 13, BOARDS); for (let x = 18; x <= 24; x += 2) p.set(x, 10, shade(BOARDS, 0.2)); p.rect(20, 11, 21, 13, shade(BOARDS, -0.6)); }
  if (stage >= 3) { house(p, 17, 8, 9, 6, BOARDS, color, { rh: 3 }); flag(p, 27, 0, color, 9, 3); }
  // The tarp shelter at the back left, with a bedroll; the crates at the front right.
  tent(p, 7, 15, 6, tarp);
  p.rect(1, 14, 3, 15, shade(OLIVE, 0.1));                          // bedroll
  crate(p, 19, 15, 4, 3);
  crate(p, 23, 14, 3, 4, BOARDS);
  if (stage < 2) crate(p, 21, 12, 3, 3, shade(WOOD_LIT, -0.1));
  campfire(p, 12, 17, lit);
  // A pile of stakes waiting (fewer as the barricade grows) and the barricade itself along the front.
  const pile = 3 - Math.min(3, stage);
  for (let i = 0; i < pile; i++) p.rect(23 - i, 18 - i, 28 - i, 18 - i, i % 2 ? WOOD : WOOD_LIT);
  const runs = [[], [[1, 7]], [[1, 9], [22, 28]], [[1, 10], [16, 28]]][Math.max(0, Math.min(3, stage))];
  for (const [x0, x1] of runs) palisade(p, x0, x1, yb + 1, 5);
  return p;
}



function paintWreck() {
  const p = paintSedan("#7d5a43");
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const v = p.get(x, y);
    if (v === GLASS || v === "#e4f1f8") p.set(x, y, (x + y) % 3 ? "#2a2d30" : "#5a6870");
    if (v === "#ffe28a" || v === "#d24a3a") p.set(x, y, "#3a3020");
  }
  for (const [x, y] of [[4, 6], [9, 5], [13, 7], [17, 6], [7, 3]]) p.set(x, y, "#a2643a");
  for (let y = 8; y <= 11; y++) for (let x = 15; x <= 18; x++) p.clear(x, y); // a wheel gone, sitting on the rim
  p.rect(15, 9, 18, 9, shade("#7d5a43", -0.35));
  return p;
}


// ---------- map sites (POIs) ----------
// One sprite per LOCATIONS type, seen from the front like the bases, standing on the bottom row. The canvas size
// follows the type's usual zone (city blocks a little taller, countryside smaller, landmarks wider), so sprites of
// one zone come out the same size on the map; render.js puts a plate in the site's zone color under each one.
const DARK_WIN = "#28313b", ASPHALT = "#4b4b50", BRICK = "#8e4f3c", GLASS_BLUE = "#5b8db3", GLASS_LIT = "#a6cde6",
  POLICE_BLUE = "#2f5597", SIREN_BLUE = "#3a8bff", SIREN_RED = "#ff3b30", NEON_PINK = "#ff5fa2", NEON_CYAN = "#5fe8ff",
  BUS_YELLOW = "#e8b22a", GREEN_CROSS = "#3cc055", WATER_BLUE = "#3f7fb5", FOAM = "#d8ecf4", COPPER = "#5f9e8a",
  HAY = "#d8b85a", GRASS = "#5f8a3c", PINE = "#2f5a34", BARN_RED = "#a8382a", OLIVE_DARK = "#454f2a", ORANGE = "#e07b2a",
  STEEL = "#b8bec4", LOG = "#7a5232", BLOOD = "#7a1c18";

// Flat-roofed block from (x0, y0) to (x1, y1): lit parapet on top, shaded right side.
function block(p, x0, y0, x1, y1, wall) {
  p.rect(x0, y0, x1, y1, wall);
  p.rect(x0, y0, x1, y0, shade(wall, 0.25));
  p.rect(x1, y0 + 1, x1, y1, shade(wall, -0.2));
}
// Window grid from (x0, y0) to (x1, y1): w × h panes every sx columns and sy rows; a few still lit.
function windows(p, x0, y0, x1, y1, sx = 2, sy = 2, glass = DARK_WIN, w = 1, h = 1) {
  for (let y = y0; y + h - 1 <= y1; y += sy) for (let x = x0; x + w - 1 <= x1; x += sx) {
    p.rect(x, y, x + w - 1, y + h - 1, (x * 7 + y * 13) % 9 === 0 ? LIT_WIN : glass);
  }
}
// Five-pointed star, 5 wide and 4 tall, top-left at (x, y).
function star(p, x, y, c) {
  p.set(x + 2, y, c); p.rect(x, y + 1, x + 4, y + 1, c); p.rect(x + 1, y + 2, x + 3, y + 2, c);
  p.set(x + 1, y + 3, c); p.set(x + 3, y + 3, c);
}
// Plus-shaped cross, arm length r and thickness t, centered on the t × t square at (x, y).
function plus(p, x, y, r, t, c) {
  p.rect(x - r, y, x + t - 1 + r, y + t - 1, c);
  p.rect(x, y - r, x + t - 1, y + t - 1 + r, c);
}
// Red and blue light bar, 6 wide on row y, glowing.
function lightBar(p, x, y) {
  p.rect(x, y + 1, x + 5, y + 1, "#2a2a2e");
  p.rect(x, y, x + 2, y, SIREN_BLUE); p.rect(x + 3, y, x + 5, y, SIREN_RED);
  p.set(x - 1, y, SIREN_BLUE + "66"); p.set(x + 6, y, SIREN_RED + "66"); p.set(x + 1, y - 1, SIREN_BLUE + "55"); p.set(x + 4, y - 1, SIREN_RED + "55");
}
// Pine tree centered on cx, standing on row yb, h tall.
function pine(p, cx, yb, h, c = PINE) {
  p.set(cx, yb, WOOD);
  for (let r = 0; r < h - 1; r++) {
    const y = yb - 1 - r, hw = Math.floor((h - 1 - r) / 2.2);
    p.rect(cx - hw, y, cx + hw, y, (r % 3) === 2 ? shade(c, 0.18) : c);
    p.set(cx + hw, y, shade(c, -0.25));
  }
}
// Small vehicle, 8 wide and 5 tall, top-left at (x, y): body color, cabin glass, wheels.
function car(p, x, y, body, top = null) {
  p.rect(x + 2, y + 1, x + 5, y + 1, top || shade(body, -0.1));
  p.rect(x + 3, y + 1, x + 5, y + 1, GLASS);
  p.rect(x, y + 2, x + 7, y + 3, body);
  p.rect(x, y + 3, x + 7, y + 3, shade(body, -0.3));
  p.rect(x + 1, y + 4, x + 2, y + 4, TIRE); p.rect(x + 5, y + 4, x + 6, y + 4, TIRE);
}
// Leaning plume of smoke rising from (x, y), n puffs.
function plume(p, x, y, n = 4) {
  for (let i = 0; i < n; i++) {
    const cx = x + Math.round(i * 0.7), cy = y - i * 2;
    p.set(cx, cy, i < 2 ? SMOKE : SMOKE_FAINT); p.set(cx + 1, cy, SMOKE_FAINT); if (i > 1) p.set(cx - 1, cy - 1, SMOKE_FAINT);
  }
}
// Tire stack, 3 wide, standing on row yb, n tires.
function tires(p, x, yb, n) {
  for (let i = 0; i < n; i++) { p.rect(x, yb - i * 2 - 1, x + 2, yb - i * 2, TIRE); p.set(x + 1, yb - i * 2 - 1, "#3a3a3c"); }
}

// ---- city blocks ----
function paintPolice(arg) {
  const L = lookOf(arg), s = L ? L.style | 0 : 0, p = painter(22, 20);
  // With a look (sim/data-shops.js FRANCHISES: a precinct, a sheriff's substation, a state patrol post): its wall, its
  // name on the band (0), on a board on the roof over the light bar (1), on a monument sign by the flag (2) or over a
  // tall glass entrance (3); the star in the accent when it is bright.
  const wall = L ? L.wall : "#a3a9b1";
  flag(p, 0, 3, POLICE_BLUE, 15, 3);
  block(p, 2, 8, 17, 18, wall);
  if (!L) { p.rect(2, 9, 17, 10, POLICE_BLUE); p.rect(2, 10, 17, 10, shade(POLICE_BLUE, -0.3)); }
  else if (s === 0 || s === 3) signBoard(p, L, 2, 9, 17, 10);
  else { p.rect(2, 9, 17, 9, L.trim); p.rect(2, 10, 17, 10, shade(L.trim, -0.3)); }
  if (s === 1) roofSign(p, L, 3, 1, 16, 3, 8);
  lightBar(p, 7, 6);
  for (const x of [3, 14]) { p.rect(x, 12, x + 1, 13, DARK_WIN); p.set(x, 12, shade(DARK_WIN, 0.4)); }
  star(p, 7, 11, L && lum(L.accent) > 150 ? L.accent : GOLD);
  if (s === 3) { glassFront(p, L, 5, 15, 13, 18, 2); p.rect(4, 14, 14, 14, L.trim); p.rect(9, 16, 9, 18, shade(GLASS, -0.4)); }
  else { p.rect(7, 15, 11, 18, GLASS); p.rect(9, 15, 9, 18, shade(GLASS, -0.4)); p.rect(6, 14, 12, 14, L ? L.trim : shade("#a3a9b1", -0.35)); }
  // Black-and-white cruiser at the curb.
  p.set(16, 13, SIREN_BLUE); p.set(17, 13, SIREN_RED);
  p.rect(15, 14, 18, 14, "#1d1f24"); p.rect(16, 14, 18, 14, GLASS);
  p.rect(13, 15, 20, 16, "#1d1f24"); p.rect(15, 15, 18, 16, WHITE);
  p.rect(13, 17, 20, 17, shade("#1d1f24", 0.2)); p.rect(14, 18, 15, 18, TIRE); p.rect(18, 18, 19, 18, TIRE);
  p.set(20, 15, "#ffe28a");
  if (s === 2) { signBoard(p, L, 1, 14, 6, 16); p.rect(3, 17, 4, 18, STONE); p.rect(1, 16, 6, 16, L.accent); }
  return p;
}

function paintHospital() {
  const p = painter(22, 20);
  block(p, 1, 8, 20, 18, WHITE);
  for (const x0 of [2, 15]) windows(p, x0, 10, x0 + 4, 17, 2, 2, GLASS_BLUE);
  block(p, 7, 3, 14, 18, shade(WHITE, -0.04));
  p.rect(8, 4, 13, 9, WHITE);                                     // the sign
  plus(p, 10, 6, 2, 2, RED);
  windows(p, 8, 11, 13, 14, 2, 3, GLASS_BLUE);
  p.rect(6, 15, 15, 15, RED); p.rect(6, 15, 15, 15, shade(RED, 0.15));// emergency canopy
  p.rect(9, 16, 12, 18, GLASS); p.rect(10, 16, 11, 18, shade(GLASS, -0.3));
  return p;
}

function paintPharmacy() {
  const p = painter(22, 20);
  const wall = "#d6ccb6";
  block(p, 2, 8, 19, 18, wall);
  p.rect(2, 9, 19, 10, shade(GREEN_CROSS, -0.35));                 // sign band
  for (let x = 9; x <= 17; x += 2) p.set(x, 9, WHITE);
  p.rect(3, 12, 18, 16, GLASS); p.rect(3, 12, 18, 12, GLASS_LIT);  // storefront
  for (const x of [7, 14]) p.rect(x, 12, x, 16, shade(wall, -0.3));
  for (const [x, c] of [[4, RED], [5, WHITE], [12, GOLD], [16, "#e88aa0"]]) p.set(x, 15, c);
  p.rect(9, 13, 11, 18, shade(GLASS, -0.25)); p.rect(10, 13, 10, 18, shade(GLASS, -0.45));
  // Lit green cross on a bracket above the roof.
  p.rect(3, 6, 3, 8, METAL);
  p.rect(2, 0, 8, 6, "#1d2420");
  plus(p, 5, 3, 2, 1, GREEN_CROSS); p.set(5, 3, shade(GREEN_CROSS, 0.5));
  for (const [x, y] of [[1, 3], [9, 3], [5, -1], [5, 7]]) p.set(x, y, GREEN_CROSS + "55");
  return p;
}

function paintSupermarket() {
  const p = painter(22, 20);
  const wall = "#c9c2b2";
  p.rect(3, 6, 6, 7, METAL); p.rect(15, 6, 18, 7, METAL);         // roof units
  block(p, 0, 8, 21, 17, wall);
  p.rect(6, 6, 15, 8, wall); p.rect(6, 6, 15, 6, shade(wall, 0.25)); // raised front
  p.rect(1, 9, 20, 10, RED); p.rect(1, 10, 20, 10, shade(RED, -0.3));
  for (let x = 4; x <= 17; x += 2) p.set(x, 9, WHITE);
  p.rect(1, 12, 20, 15, GLASS); p.rect(1, 12, 20, 12, GLASS_LIT);
  for (let x = 4; x <= 18; x += 4) p.rect(x, 12, x, 15, shade(wall, -0.25));
  p.rect(9, 12, 12, 17, shade(GLASS, -0.35));
  p.rect(0, 18, 21, 19, ASPHALT); p.set(0, 18, shade(ASPHALT, 0.2));
  // Shopping carts.
  for (const x of [2, 5]) { p.rect(x, 17, x + 2, 18, "#aab0b6"); p.set(x + 1, 18, OUTLINE); p.set(x + 3, 17, "#aab0b6"); }
  for (let x = 15; x <= 20; x += 3) p.rect(x, 19, x, 19, "#d8d4c8");
  return p;
}

function paintGunStore(arg) {
  const L = lookOf(arg), s = L ? L.style | 0 : 1, p = painter(22, 20);
  // With a look: the rifle board in the sign colour (its face dark), standing on the roof (1, as it always was),
  // flush on a taller front over an awning (0) or over barred plate glass (3), or a target on a pylon by a narrower
  // shop (2).
  const wall = L ? L.wall : "#5e4a3e", frame = L ? L.sign : ORANGE, face = !L ? "#1f1c1a" : lum(L.text) < 110 ? L.text : shade(L.sign, -0.6);
  const bx1 = s === 2 ? 15 : 19, bx0 = s === 2 ? 0 : 2, top = s === 0 || s === 3 ? 2 : 9;
  block(p, bx0, top, bx1, 18, wall);
  for (let y = top + 2; y <= 18; y += 2) for (let x = bx0 + 1 + (y % 4 ? 0 : 1); x <= bx1 - 1; x += 3) p.set(x, y, shade(wall, -0.18));
  if (s !== 2) {
    const oy = s === 1 ? 0 : 2;                                   // the sign board with a rifle on it
    if (s === 1) { p.rect(4, 3, 4, 8, METAL); p.rect(17, 3, 17, 8, METAL); }
    p.rect(2, 1 + oy, 19, 6 + oy, frame); p.rect(3, 2 + oy, 18, 5 + oy, face);
    p.rect(4, 3 + oy, 14, 3 + oy, STEEL);                         // barrel and receiver
    p.rect(9, 4 + oy, 15, 4 + oy, STEEL); p.rect(15, 3 + oy, 17, 5 + oy, "#a2713f"); // stock
    p.rect(9, 2 + oy, 11, 2 + oy, STEEL);                         // scope
    p.set(12, 5 + oy, STEEL); p.set(10, 5 + oy, STEEL);
  } else {
    p.rect(19, 8, 19, 18, METAL);                                 // the pylon: a target on it
    p.rect(16, 1, 21, 7, frame); p.rect(17, 2, 20, 6, face);
    p.rect(17, 3, 20, 5, WHITE); p.rect(18, 2, 19, 6, WHITE); p.rect(18, 3, 19, 5, L.accent); p.rect(18, 4, 19, 4, face);
    p.rect(16, 7, 21, 7, L.accent);
  }
  if (s === 0) awning(p, 2, 19, 9, L.accent);
  // Barred windows and a steel door.
  const wins = s === 2 ? [1, 11] : [3, 14], dx = s === 2 ? 6 : 9;
  if (s === 3) { glassFront(p, L, 3, 11, 18, 16, 5); for (let x = 3; x <= 18; x += 2) p.rect(x, 11, x, 16, "#2a2a2a"); }
  else for (const x0 of wins) { p.rect(x0, 11, x0 + 3, 14, GLASS); for (let x = x0; x <= x0 + 3; x += 1) if ((x - x0) % 2 === 0) p.rect(x, 11, x, 14, "#2a2a2a"); }
  p.rect(dx, 13, dx + 3, 18, METAL); p.rect(dx, 13, dx + 3, 13, shade(METAL, 0.3)); p.set(dx + 2, 16, OUTLINE);
  return p;
}

function paintHardware(arg) {
  const L = lookOf(arg), s = L ? L.style | 0 : 0, p = painter(22, 20);
  // With a look: the band and the hammer in the chain's colours, the big door in its accent; the name on the band (0),
  // on a board on the roof (1), on a pylon by a narrower store (2) or over sliding glass doors (3).
  const wall = L ? L.wall : "#a7adb3", band = L ? L.sign : ORANGE, mark = L ? L.text : WHITE, door = L ? L.accent : ORANGE;
  const bx1 = s === 2 ? 16 : 20;
  if (s === 2) pylon(p, L, 17, 0, 5, 5, 18);
  block(p, 1, 7, bx1, 18, wall);
  const hammer = (x, y) => { p.rect(x, y, x + 3, y + 1, mark); p.rect(x + 1, y, x + 1, y + 2, WOOD_LIT); };
  if (s === 1) { roofSign(p, L, 2, 1, 19, 4, 7); hammer(15, 2); p.rect(1, 8, bx1, 8, L.trim); p.rect(1, 9, bx1, 9, L.accent); }
  else {
    p.rect(1, 8, bx1, 10, band); p.rect(1, 10, bx1, 10, shade(band, -0.3));
    // Hammer on the sign.
    if (s !== 2) { p.rect(13, 8, 16, 9, mark); p.rect(14, 8, 14, 10, WOOD_LIT); p.rect(14, 10, 14, 10, WOOD_LIT); }
    if (L) signText(p, 3, s === 2 ? 15 : 11, 9, mark, L); else for (let x = 3; x <= 11; x += 2) p.set(x, 9, WHITE);
  }
  if (s === 2) hammer(18, 1);
  if (s === 3) { glassFront(p, L, 7, 12, 13, 18, 2); p.rect(10, 12, 10, 18, L.trim); }
  else { p.rect(7, 12, 13, 18, shade(door, -0.45)); p.rect(7, 12, 13, 12, shade(door, -0.2)); for (let y = 13; y <= 18; y += 2) p.rect(8, y, 12, y, shade(door, -0.6)); } // big door
  if (s === 3) glassFront(p, L, 15, 12, 19, 16, 2); else p.rect(s === 2 ? 12 : 16, 12, s === 2 ? 15 : 19, 14, GLASS);
  // Lumber stack and a wheelbarrow out front.
  for (let i = 0; i < 3; i++) { p.rect(0, 16 - i * 1, 5 - (i === 2 ? 1 : 0), 16 - i * 1, i % 2 ? "#c9a46a" : "#d8b47a"); }
  p.rect(0, 17, 5, 18, "#b08a52"); for (let x = 0; x <= 5; x += 2) p.set(x, 17, "#8a6838");
  p.rect(16, 16, 19, 17, "#3f7a4a"); p.set(15, 16, METAL); p.set(14, 15, METAL); p.set(18, 18, TIRE);
  return p;
}

function paintAutoShop(arg) {
  const L = lookOf(arg), s = L ? L.style | 0 : 1, p = painter(22, 20);
  // With a look: the wrench board in the chain's sign and text colours, the car on the lift in its accent; the board
  // on posts over the roof (1, as it always was), flush on a taller front (0), the name on a band with a pylon by the
  // tires (2), or a band over a glass office in place of the shut bay (3).
  const wall = L ? L.wall : "#7f8790", board = L ? L.sign : RED, mark = L ? L.text : WHITE, body = L ? L.accent : "#3a68a8";
  const top = s === 0 ? 3 : s === 3 ? 5 : 8;
  if (s === 2) pylon(p, L, 17, 1, 5, 5, 18);
  if (s === 0 || s === 1) {
    const oy = s === 0 ? 3 : 0;                                  // the sign board with a double-ended wrench
    if (s === 1) { p.rect(5, 6, 5, 8, METAL); p.rect(13, 6, 13, 8, METAL); }
    else block(p, 0, top, 18, 18, wall);
    p.rect(2, 1 + oy, 16, 6 + oy, board); p.rect(2, 1 + oy, 16, 1 + oy, shade(board, 0.3)); p.rect(2, 6 + oy, 16, 6 + oy, shade(board, -0.35));
    p.rect(5, 3 + oy, 13, 4 + oy, mark); p.rect(3, 2 + oy, 4, 2 + oy, mark); p.rect(3, 5 + oy, 4, 5 + oy, mark); p.rect(14, 2 + oy, 15, 2 + oy, mark); p.rect(14, 5 + oy, 15, 5 + oy, mark);
  }
  if (s !== 0) block(p, 0, top, 18, 18, wall);
  if (s === 2) signBoard(p, L, 0, 9, 18, 10);
  if (s === 3) { signBoard(p, L, 0, 6, 18, 8); p.rect(0, 9, 18, 9, L.accent); }
  // Closed bay (ribbed roll-up door) and an open one with a car on the lift; the glass office for the glass fronts.
  if (s === 3) glassFront(p, L, 1, 11, 7, 18, 3);
  else { p.rect(1, 11, 7, 18, "#9aa0a6"); for (let y = 12; y <= 18; y += 2) p.rect(1, y, 7, y, "#7a8086"); }
  p.rect(10, 11, 16, 18, "#1e2024");
  p.rect(10, 14, 16, 15, body); p.rect(11, 13, 15, 13, shade(body, 0.3)); p.set(16, 15, "#ffe28a");
  p.rect(11, 16, 11, 18, METAL); p.rect(15, 16, 15, 18, METAL);
  tires(p, 19, 18, s === 2 ? 2 : 4);
  return p;
}

function paintApartments() {
  const p = painter(22, 20);
  p.rect(5, 0, 7, 1, WOOD); p.rect(5, 2, 5, 2, WOOD); p.rect(7, 2, 7, 2, WOOD); // water tank on the roof
  block(p, 3, 3, 18, 18, BRICK);
  windows(p, 5, 5, 16, 15, 3, 3, DARK_WIN, 2, 2);
  // Fire escape down the right side.
  for (let y = 6; y <= 15; y += 3) { p.rect(16, y + 1, 19, y + 1, "#2a2a2e"); p.set(19, y, "#2a2a2e"); p.set(17 + ((y / 3) % 2), y + 2, "#2a2a2e"); }
  p.rect(9, 16, 12, 18, OUTLINE); p.rect(8, 15, 13, 15, shade(RED, -0.3)); // door and awning
  return p;
}

function paintOffice(arg) {
  const L = lookOf(arg);
  if (L) return paintTower(L); // a firm's corporate tower (sim/data-offices.js, issue #27)
  const p = painter(22, 20);
  p.rect(10, 0, 10, 2, METAL); p.set(10, 0, RED);
  block(p, 5, 3, 15, 18, GLASS_BLUE);
  for (let y = 5; y <= 17; y += 2) p.rect(6, y, 14, y, shade(GLASS_BLUE, -0.28));      // floors
  for (let x = 8; x <= 14; x += 3) p.rect(x, 4, x, 18, shade(GLASS_BLUE, -0.15));     // mullions
  for (let i = 0; i < 6; i++) p.set(6 + i, 16 - i * 2, GLASS_LIT);                     // reflection
  for (let i = 0; i < 4; i++) p.set(7 + i, 17 - i * 2, GLASS_LIT);
  for (const [x, y] of [[12, 8], [13, 12], [7, 10]]) p.set(x, y, DARK_WIN);           // broken panes
  block(p, 15, 10, 20, 18, CONCRETE);
  windows(p, 16, 12, 19, 17, 2, 2, DARK_WIN);
  block(p, 1, 13, 5, 18, shade(CONCRETE, -0.1));
  windows(p, 2, 15, 4, 17, 2, 2, DARK_WIN);
  p.rect(9, 16, 11, 18, OUTLINE);
  return p;
}

function paintSchool() {
  const p = painter(22, 20);
  block(p, 1, 8, 20, 17, BRICK);
  windows(p, 2, 10, 7, 14, 2, 4, GLASS, 1, 2); windows(p, 14, 10, 19, 14, 2, 4, GLASS, 1, 2);
  // Entrance with a bell cupola.
  p.rect(8, 7, 13, 17, shade(BRICK, 0.1));
  p.rect(9, 3, 12, 6, WHITE); p.rect(10, 4, 11, 5, GOLD); p.set(10, 5, shade(GOLD, -0.3));
  p.rect(8, 2, 13, 2, ROOF_GRAY); p.rect(9, 1, 12, 1, ROOF_GRAY); p.rect(10, 0, 11, 0, shade(ROOF_GRAY, 0.3));
  p.rect(8, 7, 13, 7, WHITE);
  flag(p, 19, 1, "#3a68a8", 6, 2);
  // Yellow school bus parked in front.
  p.rect(2, 14, 13, 17, BUS_YELLOW); p.rect(2, 14, 13, 14, shade(BUS_YELLOW, 0.25));
  for (let x = 3; x <= 11; x += 2) p.set(x, 15, DARK_WIN);
  p.rect(2, 16, 13, 16, "#2a2a2e"); p.set(13, 15, GLASS); p.set(13, 17, "#ffe28a");
  wheel(p, 3, 16); wheel(p, 10, 16);
  return p;
}

function paintFireStation(arg) {
  const L = lookOf(arg), s = L ? L.style | 0 : 0, p = painter(22, 20);
  // With a look: the station's brick or block, its name on the band (0), on a board on the roof (1) or on a sign on a
  // post by the tower (2), glass bay doors for the glass fronts (3); the bays' header in its accent.
  const wall = L ? L.wall : "#9a4a3a";
  block(p, 14, 1, 19, 18, shade(wall, -0.1));                     // hose tower
  windows(p, 16, 3, 17, 9, 2, 3, DARK_WIN);
  block(p, 0, 7, 16, 18, wall);
  if (!L) p.rect(0, 8, 16, 8, WHITE);
  else if (s === 1 || s === 2) p.rect(0, 8, 16, 8, L.trim);
  else signBoard(p, L, 0, 8, 16, 8);
  if (s === 1) roofSign(p, L, 1, 2, 12, 4, 7);
  const head = L ? L.accent : WHITE;
  // Two bays: one with the engine nosing out, one shut.
  p.rect(1, 10, 7, 18, "#1e2024"); p.rect(1, 10, 7, 10, head);
  p.rect(1, 12, 7, 17, RED); p.rect(2, 12, 6, 13, GLASS); p.rect(1, 15, 7, 15, WHITE);
  p.rect(1, 11, 7, 11, METAL); p.set(1, 16, "#ffe28a"); p.set(7, 16, "#ffe28a"); p.rect(3, 16, 5, 16, STEEL);
  p.rect(2, 18, 3, 18, TIRE); p.rect(5, 18, 6, 18, TIRE);
  if (s === 3) { glassFront(p, L, 9, 11, 15, 18, 2); p.rect(9, 10, 15, 10, head); }
  else { p.rect(9, 10, 15, 18, "#d6d2c8"); p.rect(9, 10, 15, 10, head); for (let y = 12; y <= 18; y += 2) p.rect(9, y, 15, y, "#a8a49a"); }
  p.set(15, 1, RED); p.set(18, 1, RED);
  if (s === 2) { p.rect(20, 14, 20, 18, METAL); signBoard(p, L, 18, 11, 21, 13); }
  return p;
}

function paintWarehouse() {
  const p = painter(22, 20);
  const wall = "#8a8f94";
  // Sawtooth roof: sloped runs with glazed uprights.
  for (let t = 0; t < 4; t++) {
    const x0 = 1 + t * 5;
    for (let i = 0; i < 5; i++) p.rect(x0 + i, 8 - Math.floor(i * 0.8), x0 + i, 9, i === 4 ? GLASS_LIT : shade(ROOF_GRAY, (i % 2) * 0.08));
    p.rect(x0 + 4, 5, x0 + 4, 9, GLASS);
  }
  block(p, 0, 10, 21, 18, wall);
  for (let x = 1; x <= 20; x += 2) p.rect(x, 11, x, 18, shade(wall, -0.12));
  // Loading docks and pallets.
  for (const x of [2, 9, 16]) { p.rect(x, 13, x + 4, 18, "#5a5f64"); for (let y = 14; y <= 18; y += 2) p.rect(x, y, x + 4, y, "#4a4f54"); }
  p.rect(9, 13, 13, 18, "#1e2024");
  crate(p, 9, 16, 3, 3, WOOD_LIT);
  p.rect(0, 19, 21, 19, ASPHALT);
  return p;
}

function paintMall() {
  const p = painter(26, 20);
  block(p, 0, 9, 25, 18, "#c9b8a0");
  block(p, 0, 7, 6, 18, "#b4a48c"); block(p, 19, 7, 25, 18, "#a89a88"); // anchor stores
  p.rect(1, 9, 5, 9, RED); p.rect(20, 9, 24, 9, "#3a68a8");
  // Glass atrium with an arched roof over the entrance.
  for (let r = 0; r < 4; r++) p.rect(9 + Math.max(0, 2 - r), 3 + r, 16 - Math.max(0, 2 - r), 3 + r, r === 0 ? GLASS_LIT : GLASS);
  p.rect(9, 7, 16, 18, GLASS); p.rect(9, 7, 16, 7, GLASS_LIT);
  for (let x = 10; x <= 15; x += 2) p.rect(x, 4, x, 18, shade(GLASS, -0.25));
  for (let i = 0; i < 4; i++) p.set(10 + i, 12 - i, GLASS_LIT);
  p.rect(11, 15, 14, 18, shade(GLASS, -0.45));
  for (const [x, c] of [[2, GOLD], [4, RED], [21, CROP_LIT], [23, GOLD]]) p.rect(x, 12, x, 14, c); // shop fronts
  windows(p, 7, 11, 8, 15, 1, 2, DARK_WIN); windows(p, 17, 11, 18, 15, 1, 2, DARK_WIN);
  p.rect(0, 19, 25, 19, ASPHALT); for (let x = 1; x <= 24; x += 4) p.set(x, 19, "#d8d4c8");
  return p;
}

function paintUniversity() {
  const p = painter(22, 20);
  const stone = "#cbc2aa";
  block(p, 0, 9, 21, 18, stone);
  windows(p, 1, 11, 4, 16, 2, 3, DARK_WIN, 1, 2); windows(p, 17, 11, 20, 16, 2, 3, DARK_WIN, 1, 2);
  // Copper dome with a gold finial.
  p.set(10, 0, GOLD); p.set(11, 0, GOLD);
  for (let r = 0; r < 4; r++) p.rect(8 - Math.min(r, 2) + 2 - (r ? 1 : 0), 1 + r, 13 + Math.min(r, 2) - 2 + (r ? 1 : 0), 1 + r, r === 0 ? shade(COPPER, 0.3) : COPPER);
  p.rect(7, 4, 14, 5, shade(stone, -0.08)); p.rect(7, 4, 14, 4, shade(stone, 0.2));
  // Pediment and columns.
  for (let r = 0; r < 3; r++) p.rect(9 - r * 2, 6 + r, 12 + r * 2, 6 + r, r === 2 ? shade(stone, -0.2) : WHITE);
  p.rect(5, 9, 16, 17, shade(stone, -0.3));
  for (let x = 5; x <= 16; x += 2) p.rect(x, 9, x, 17, WHITE);
  p.rect(4, 18, 17, 18, shade(stone, 0.15)); p.rect(3, 19, 18, 19, shade(stone, -0.1));
  return p;
}

// ---- small-town shops and services ----
function paintGrocery(arg) {
  const L = lookOf(arg), s = L ? L.style | 0 : 0, p = painter(20, 17);
  // With a look: the chain's wall, its name on the false front (0), on a board on the roof (1), on a pylon by the
  // door (2) or over a plate-glass front (3); the awning in its accent.
  const wall = L ? L.wall : "#9a6248";
  block(p, 1, 4, 18, 15, wall);
  p.rect(1, 4, 18, 6, shade(wall, 0.1));
  if (s === 0) {
    p.rect(5, 2, 14, 4, shade(wall, 0.1)); p.rect(5, 2, 14, 2, shade(wall, 0.3)); // false front
    if (L) signBoard(p, L, 6, 3, 13, 3); else p.rect(6, 3, 13, 3, WHITE);
  }
  if (s === 1) roofSign(p, L, 3, 0, 14, 2, 4);
  if (s === 3) {
    signBoard(p, L, 1, 5, 18, 7); p.rect(1, 8, 18, 8, L.accent);
    glassFront(p, L, 2, 9, 16, 15); p.rect(13, 10, 15, 15, shade(GLASS, -0.4));
  } else {
    // Striped awning over the window.
    awning(p, 1, 18, 7, L ? L.accent : "#3e8a4a");
    p.rect(2, 10, 12, 13, GLASS); p.rect(2, 10, 12, 10, GLASS_LIT);
    p.rect(14, 10, 16, 15, OUTLINE);
  }
  if (s === 2) pylon(p, L, 15, 0, 5, 4, 15);
  // Produce crates out front.
  for (const [x, c] of [[1, RED], [5, ORANGE], [9, CROP_LIT]]) { p.rect(x, 14, x + 3, 15, WOOD_LIT); p.rect(x, 13, x + 3, 13, c); p.set(x + 1, 13, shade(c, 0.3)); }
  return p;
}

function paintClinic(arg) {
  const L = lookOf(arg), s = L ? L.style | 0 : 1, p = painter(20, 17);
  // With a look: the wall, the band in its trim, the cross in the sign's colours: on a sign on the roof (1, as it
  // always was), on the band (0), on a sign on a post by the door (2), or over a glass front (3).
  const wall = L ? L.wall : WHITE, board = L ? L.sign : WHITE, cross = L ? L.text : RED;
  block(p, 0, 7, 11, 15, wall);
  p.rect(0, 9, 11, 9, L ? L.trim : "#3a68a8");
  if (s === 1) { p.rect(3, 2, 7, 6, board); p.rect(3, 2, 7, 2, shade(board, 0.3)); p.rect(4, 6, 6, 6, shade(board, -0.25)); plus(p, 5, 4, 1, 1, cross); } // sign on the roof
  if (s === 0 || s === 3) { signBoard(p, L, 0, 8, 11, 9); p.rect(0, 7, 3, 9, L.sign); plus(p, 1, 8, 1, 1, cross); }
  if (s === 3) { glassFront(p, L, 1, 10, 10, 15, 3); p.rect(4, 11, 6, 15, shade(GLASS, -0.35)); p.rect(5, 11, 5, 15, shade(GLASS, -0.5)); }
  else {
    p.rect(4, 11, 6, 15, GLASS); p.rect(5, 11, 5, 15, shade(GLASS, -0.4));
    p.rect(1, 11, 2, 12, GLASS_BLUE); p.rect(8, 11, 10, 12, GLASS_BLUE);
  }
  if (s === 2) { p.rect(0, 10, 3, 12, board); p.rect(0, 10, 3, 10, shade(board, 0.25)); plus(p, 1, 11, 1, 1, cross); p.set(3, 11, cross); p.rect(1, 13, 2, 15, METAL); }
  // Ambulance parked beside it.
  p.set(12, 7, SIREN_RED); p.set(13, 7, SIREN_BLUE);
  p.rect(12, 8, 16, 14, WHITE); p.rect(17, 10, 19, 14, WHITE); p.rect(18, 10, 19, 11, GLASS);
  p.rect(12, 12, 19, 12, RED); plus(p, 14, 9, 1, 1, RED);
  p.rect(12, 14, 19, 14, shade(WHITE, -0.3)); p.set(19, 13, "#ffe28a");
  p.rect(13, 15, 14, 16, TIRE); p.rect(17, 15, 18, 16, TIRE);
  return p;
}

function paintGas(arg) {
  const L = lookOf(arg), s = L ? L.style | 0 : 2, p = painter(20, 17);
  // With a look: the canopy's stripe in the trim, the pumps in the sign colour with an accent band; the price sign on
  // its pole (2, as it always was), the name along the canopy (0), a board on the store's roof (1), or the name on the
  // canopy over a store of plate glass (3).
  const store = L ? L.wall : PLASTER, stripe = L ? L.trim : RED, pump = L ? L.sign : RED, band = L ? L.accent : WHITE;
  // Price sign on a pole.
  if (s === 2) {
    p.rect(18, 4, 18, 15, METAL);
    if (L) { signBoard(p, L, 16, 0, 19, 3); p.rect(16, 4, 19, 4, L.accent); }
    else { p.rect(16, 0, 19, 4, WHITE); p.rect(16, 0, 19, 0, RED); p.set(17, 2, OUTLINE); p.set(18, 2, OUTLINE); p.set(17, 3, OUTLINE); }
  }
  if (s === 1) roofSign(p, L, 14, 2, 19, 4, 8);
  // Store behind.
  block(p, 10, 8, 16, 15, store);
  if (s === 3) { glassFront(p, L, 11, 9, 15, 15, 2); p.rect(14, 11, 15, 15, shade(GLASS, -0.4)); }
  else { p.rect(11, 10, 13, 12, GLASS); p.rect(14, 11, 15, 15, OUTLINE); }
  // Canopy on two posts over the pumps.
  if (s === 0 || s === 3) { p.rect(0, 4, 13, 6, L.sign); p.rect(0, 4, 13, 4, shade(L.sign, 0.22)); signText(p, 1, 12, 5, L.text, L); p.rect(0, 6, 13, 6, shade(L.sign, -0.35)); }
  else { p.rect(0, 4, 13, 6, L ? L.wall : WHITE); p.rect(0, 5, 13, 5, stripe); p.rect(0, 6, 13, 6, shade(L ? L.wall : WHITE, -0.35)); }
  p.rect(1, 7, 1, 15, STEEL); p.rect(11, 7, 11, 15, STEEL);
  for (const x of [3, 7]) { p.rect(x, 11, x + 1, 15, pump); p.rect(x, 12, x + 1, 12, band); p.set(x + 2, 12, "#2a2a2e"); p.set(x + 2, 13, "#2a2a2e"); }
  p.rect(0, 16, 15, 16, ASPHALT);
  return p;
}

function paintDiner(arg) {
  const L = lookOf(arg), s = L ? L.style | 0 : 2, p = painter(20, 17);
  // With a look: the car's skin in the wall colour, its stripe in the trim, the neon in the sign's colours; the neon
  // sign on its pole (2, as it always was), the name along the roof over a little awning (0) or over a long glass
  // front (3), a board on posts on the roof (1); without the pole sign a car is parked at the end.
  const skin = L ? L.wall : STEEL, stripe = L ? L.trim : RED;
  // Stainless-steel diner car with rounded ends.
  p.rect(1, 7, 14, 14, skin); p.clear(1, 7); p.clear(14, 7);
  p.rect(2, 6, 13, 6, shade(skin, 0.25));
  for (let y = 8; y <= 13; y += 2) p.rect(1, y, 14, y, shade(skin, 0.15));
  if (s === 3) { p.rect(2, 8, 13, 11, "#f0d890"); p.rect(2, 8, 13, 8, LIT_WIN); for (let x = 4; x <= 13; x += 3) p.rect(x, 8, x, 11, L.trim); }
  else { p.rect(2, 9, 13, 10, "#f0d890"); for (let x = 4; x <= 13; x += 3) p.rect(x, 9, x, 10, shade(skin, -0.2)); }
  p.rect(1, 13, 14, 14, stripe); p.rect(1, 14, 14, 14, shade(stripe, -0.35));
  p.rect(6, 9, 7, 14, shade(skin, -0.45));
  if (s === 2) {
    // Neon sign on a pole.
    const board = L ? L.sign : "#20202a", n1 = L ? L.text : NEON_PINK, n2 = L ? L.accent : NEON_CYAN;
    p.rect(17, 7, 17, 15, METAL);
    p.rect(15, 0, 19, 6, board);
    p.rect(16, 1, 18, 1, n1); p.rect(16, 3, 18, 3, n2); p.rect(16, 5, 18, 5, n1);
    for (const [x, y] of [[14, 1], [14, 5], [17, -1], [17, 7]]) p.set(x, y, n1 + "66");
  } else {
    if (s === 1) roofSign(p, L, 2, 1, 13, 3, 6);
    else { signBoard(p, L, 3, 4, 12, 5); for (const x of [4, 11]) p.set(x, 6, METAL); }
    if (s === 0) awning(p, 5, 8, 7, L.accent);
    car(p, 12, 11, L.accent === L.wall ? RED : L.accent);
  }
  p.rect(0, 15, 15, 15, ASPHALT);
  return p;
}

function paintMotel(arg) {
  const L = lookOf(arg), s = L ? L.style | 0 : 2, p = painter(20, 17);
  // With a look: the wall, the roof in the trim, the room doors in the accent and the sign colour; the roadside sign
  // with its bulbs and arrow (2, as it always was), the name along the fascia with an office at the end (0, 3: the
  // office of glass), a board with bulbs on the roof (1).
  const wall = L ? L.wall : "#d8c4a8", roof = L ? L.trim : ROOF_RUST;
  if (L && (s === 0 || s === 3)) { p.rect(0, 7, 15, 8, L.sign); p.rect(0, 7, 15, 7, shade(L.sign, 0.25)); signText(p, 1, 14, 7, L.text, L); p.rect(0, 8, 15, 8, shade(L.sign, -0.3)); }
  else { p.rect(0, 8, 15, 8, roof); p.rect(0, 7, 15, 7, shade(roof, 0.3)); }
  block(p, 0, 9, 15, 15, wall);
  for (let i = 0; i < 4; i++) {
    const x = 1 + i * 4;
    p.rect(x, 11, x, 15, i % 2 ? (L ? L.accent : "#3f8a8a") : (L ? L.sign : "#a84a3a")); // room doors
    p.rect(x + 1, 11, x + 2, 12, i === 2 ? DARK_WIN : LIT_WIN);
  }
  if (s === 2) {
    // Roadside sign with bulbs and an arrow pointing in.
    p.rect(18, 5, 18, 15, METAL);
    if (L) signBoard(p, L, 15, 0, 19, 4); else { p.rect(15, 0, 19, 4, RED); p.rect(16, 2, 18, 2, WHITE); }
    for (let x = 15; x <= 19; x += 2) { p.set(x, 0, GOLD); p.set(x, 4, GOLD); }
    p.rect(13, 6, 17, 6, GOLD); p.set(12, 6, GOLD); p.set(13, 5, GOLD); p.set(13, 7, GOLD);
    for (const [x, y] of [[11, 6], [14, -1], [20, 2]]) p.set(x, y, "#ffd06a66");
  } else {
    if (s === 1) { roofSign(p, L, 2, 1, 13, 4, 7); for (let x = 2; x <= 13; x += 2) { p.set(x, 1, GOLD); p.set(x, 4, GOLD); } }
    block(p, 16, 9, 19, 15, shade(wall, -0.08)); p.rect(16, 8, 19, 8, roof);         // the office
    if (s === 3) glassFront(p, L, 16, 10, 19, 15, 2);
    else { p.rect(17, 11, 18, 12, LIT_WIN); p.rect(17, 13, 18, 15, shade(L.accent, -0.3)); }
  }
  return p;
}

function paintChurch(arg) {
  const L = lookOf(arg), s = L ? L.style | 0 : 0, p = painter(20, 17);
  // With a look: the wall, the roofs in the trim, the door in the accent, the windows' glass in the sign colours; a
  // round window in the tower in place of the belfry (1), a letter board on posts on the lawn (2), tall stained glass
  // down the nave and over the door (3).
  const wall = L ? L.wall : "#e2ddd0", roof = L ? L.trim : ROOF_GRAY, door = L ? shade(L.accent, -0.3) : shade(WOOD, -0.3);
  const g1 = L ? L.sign : "#5a7ac8", g2 = L ? (L.accent === L.sign ? GOLD : L.accent) : "#c85a7a";
  // Steeple with a cross.
  p.rect(9, 0, 9, 2, GOLD); p.rect(8, 1, 10, 1, GOLD);
  for (let r = 0; r < 4; r++) p.rect(9 - Math.floor(r / 2), 3 + r, 9 + Math.floor((r + 1) / 2), 3 + r, r === 0 ? shade(roof, 0.3) : roof);
  p.rect(7, 7, 11, 15, wall); p.rect(7, 7, 7, 15, shade(wall, 0.2));
  if (s === 1) { p.rect(8, 8, 10, 9, g1); p.set(9, 8, shade(g1, 0.4)); p.set(9, 9, g2); }        // the rose window
  else { p.rect(8, 8, 10, 9, OUTLINE); p.set(9, 9, GOLD); }                // belfry and bell
  // Nave.
  house(p, 2, 10, 16, 6, wall, roof, { rh: 3, door: false, win: false });
  p.rect(7, 10, 11, 15, wall);
  p.rect(8, 12, 10, 15, door); p.set(9, 11, door);
  if (s === 3) { p.set(8, 11, g1); p.set(10, 11, g2); for (const x of [3, 5, 13, 15]) { p.rect(x, 11, x, 14, x % 4 === 1 ? g1 : g2); p.set(x, 11, shade(g1, 0.3)); } }
  else for (const x of [4, 14]) { p.rect(x, 12, x, 13, g1); p.set(x, 12, g2); }
  if (s === 2) { signBoard(p, L, 15, 11, 19, 13); p.rect(16, 14, 16, 15, WOOD); p.rect(18, 14, 18, 15, WOOD); p.rect(15, 13, 19, 13, shade(L.sign, -0.3)); }
  return p;
}

function paintFeedStore() {
  const p = painter(20, 17);
  // Grain silo.
  p.rect(13, 3, 18, 15, STEEL); p.rect(13, 3, 13, 15, shade(STEEL, 0.3));
  for (let y = 5; y <= 15; y += 3) p.rect(13, y, 18, y, shade(STEEL, -0.18));
  p.rect(14, 1, 17, 2, shade(STEEL, 0.1)); p.rect(15, 0, 16, 0, shade(STEEL, 0.3));
  // Store with a gable roof and a FEED band.
  house(p, 1, 8, 12, 8, "#9a6a48", ROOF_RUST, { rh: 3, door: false, win: false });
  p.rect(2, 9, 11, 10, HAY); for (let x = 3; x <= 10; x += 2) p.set(x, 9, shade(HAY, -0.45));
  p.rect(4, 12, 8, 15, shade(WOOD, -0.4)); p.rect(4, 12, 8, 12, WOOD);
  // Feed sacks.
  for (const [x, y] of [[1, 14], [3, 14], [2, 13]]) { p.rect(x, y, x + 1, y + 1, "#d8cba0"); p.set(x, y, shade("#d8cba0", 0.2)); }
  p.rect(10, 14, 11, 15, "#d8cba0");
  return p;
}

// ---- countryside ----
function paintFarm() {
  const p = painter(18, 15);
  house(p, 1, 5, 8, 5, WHITE, BARN_RED, { rh: 3 });
  // Windpump: lattice tower with a bladed wheel.
  for (let y = 6; y <= 10; y++) { const o = y >= 9 ? 1 : 0; p.set(13 - o, y, METAL); p.set(15 + o, y, METAL); }
  p.rect(13, 8, 15, 8, shade(METAL, -0.25));
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    if (dx * dx + dy * dy > 10) continue;
    const spoke = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
    p.set(14 + dx, 3 + dy, spoke ? shade(STEEL, -0.35) : STEEL);
  }
  p.set(14, 3, OUTLINE); p.rect(16, 4, 17, 5, shade(METAL, 0.1));
  crops(p, 0, 11, 17, 14);
  return p;
}

function paintBarn() {
  const p = painter(18, 15);
  // Red barn with a gambrel roof, hayloft and white X doors.
  for (let r = 0; r < 5; r++) {
    const inset = [4, 2, 1, 0, 0][r];
    p.rect(2 + inset, 1 + r, 13 - inset, 1 + r, r === 0 ? shade(ROOF_GRAY, 0.3) : r === 4 ? shade(ROOF_GRAY, -0.25) : ROOF_GRAY);
  }
  p.rect(3, 6, 12, 14, BARN_RED);
  for (let x = 3; x <= 12; x += 2) p.rect(x, 7, x, 14, shade(BARN_RED, -0.12));
  p.rect(7, 3, 8, 4, HAY);
  p.rect(5, 8, 10, 14, shade(BARN_RED, -0.35));
  for (let i = 0; i < 6; i++) { p.set(5 + i, 9 + i, WHITE); p.set(10 - i, 9 + i, WHITE); }
  p.rect(5, 8, 10, 8, WHITE); p.rect(4, 8, 4, 14, WHITE); p.rect(11, 8, 11, 14, WHITE);
  // Round hay bale.
  p.rect(14, 11, 17, 14, HAY); p.rect(15, 10, 16, 10, HAY); p.set(15, 12, shade(HAY, -0.3)); p.set(16, 13, shade(HAY, -0.3));
  return p;
}

function paintRanch() {
  const p = painter(18, 15);
  // Ranch gate: two posts and a crossbeam with a hanging brand sign.
  p.rect(1, 1, 1, 14, WOOD); p.rect(16, 1, 16, 14, WOOD);
  p.rect(0, 1, 17, 2, WOOD_LIT); p.rect(0, 2, 17, 2, WOOD);
  p.set(7, 3, METAL); p.set(10, 3, METAL);
  p.rect(6, 4, 11, 6, BOARDS); p.rect(8, 5, 9, 5, shade(BOARDS, -0.5)); p.set(7, 5, shade(BOARDS, -0.5));
  // Split-rail fence and a cow.
  for (let x = 0; x <= 17; x++) { p.set(x, 11, WOOD_LIT); p.set(x, 13, WOOD); if (x % 4 === 0) p.rect(x, 10, x, 14, WOOD); }
  p.rect(5, 8, 10, 10, WHITE); p.rect(6, 8, 7, 9, "#2a2a2a"); p.set(9, 10, "#2a2a2a");
  p.rect(11, 7, 12, 9, WHITE); p.set(12, 9, "#e8a0a0"); p.set(11, 6, BONE);
  for (const x of [5, 6, 9, 10]) p.set(x, 11 + (x % 2), "#2a2a2a");
  return p;
}

function paintCabin() {
  const p = painter(18, 15);
  pine(p, 15, 14, 12);
  // Stone chimney with smoke.
  p.rect(2, 3, 3, 8, STONE); p.set(2, 4, shade(STONE, -0.25)); p.set(3, 6, shade(STONE, -0.25));
  plume(p, 3, 2, 3);
  // Log walls under a pitched roof.
  for (let r = 0; r < 4; r++) p.rect(3 + 3 - r, 4 + r, 12 - 3 + r, 4 + r, r === 0 ? shade(PINE, 0.25) : r === 3 ? shade(PINE, -0.3) : shade(PINE, -0.1));
  p.rect(2, 8, 13, 8, shade(PINE, -0.3));
  for (let y = 9; y <= 14; y++) p.rect(3, y, 12, y, y % 2 ? LOG : shade(LOG, 0.18));
  for (const y of [9, 11, 13]) { p.set(2, y, shade(LOG, 0.3)); p.set(13, y, shade(LOG, 0.3)); }
  p.rect(7, 11, 8, 14, shade(WOOD, -0.5)); p.rect(4, 10, 5, 11, LIT_WIN); p.rect(10, 10, 11, 11, DARK_WIN);
  return p;
}

function paintLodge() {
  const p = painter(18, 15);
  pine(p, 16, 14, 11);
  // Long log lodge under a red-brown gable, a trophy rack over the door, smoke from a stone chimney.
  const roof = "#7a3e2c";
  p.rect(13, 1, 14, 5, STONE); p.set(13, 2, shade(STONE, -0.25)); plume(p, 14, 0, 2);
  for (let r = 0; r < 6; r++) {
    const hw = Math.round(r * 1.5);
    p.rect(8 - hw, 1 + r, 9 + hw, 1 + r, r === 0 ? shade(roof, 0.3) : r === 5 ? shade(roof, -0.3) : roof);
  }
  p.rect(7, 3, 10, 5, shade(LOG, 0.18)); p.rect(8, 3, 9, 4, LIT_WIN);
  for (let y = 7; y <= 14; y++) p.rect(1, y, 15, y, y % 2 ? LOG : shade(LOG, 0.18));
  for (let y = 7; y <= 14; y += 2) { p.set(0, y, shade(LOG, 0.3)); p.set(16, y, shade(LOG, 0.3)); }
  for (const [x, y] of [[4, 7], [6, 7], [4, 8], [5, 8], [6, 8], [11, 7], [13, 7], [11, 8], [12, 8], [13, 8], [6, 9], [7, 9], [10, 9], [11, 9]]) p.set(x, y, BONE);
  p.rect(8, 9, 9, 10, BONE); p.set(8, 10, OUTLINE); p.set(9, 10, OUTLINE);
  p.rect(7, 11, 10, 14, shade(WOOD, -0.5)); p.rect(2, 10, 4, 11, LIT_WIN); p.rect(13, 10, 14, 11, DARK_WIN);
  return p;
}

function paintCampground() {
  const p = painter(18, 15);
  pine(p, 9, 8, 8);
  tent(p, 4, 13, 5, ORANGE);
  tent(p, 13, 13, 4, "#3a78b0");
  campfire(p, 7, 13);
  p.rect(0, 14, 17, 14, shade(DIRT, 0.15));
  return p;
}

function paintRanger() {
  const p = painter(18, 15);
  // Fire lookout tower.
  p.rect(12, 5, 12, 14, WOOD); p.rect(16, 5, 16, 14, WOOD);
  for (let i = 0; i < 4; i++) { p.set(13 + (i % 2) * 2, 7 + i * 2, shade(WOOD, -0.3)); p.set(14, 8 + i * 2, shade(WOOD, -0.3)); }
  p.rect(11, 2, 17, 4, BOARDS); p.rect(12, 3, 16, 3, GLASS); p.set(14, 3, LIT_WIN);
  p.rect(11, 1, 17, 1, "#3f6a3a"); p.rect(12, 0, 16, 0, shade("#3f6a3a", 0.3));
  // Station cabin with a green roof, a flag and the park sign.
  house(p, 1, 9, 9, 5, BOARDS, "#3f6a3a", { rh: 3 });
  flag(p, 10, 3, "#3f6a3a", 11, 2);
  p.rect(0, 12, 0, 14, WOOD);
  return p;
}

function paintRadioTower() {
  const p = painter(18, 22);
  // Lattice mast in red and white bands, narrowing to a red light.
  const top = 2, yb = 19;
  for (let y = top; y <= yb; y++) {
    const hw = Math.round(((y - top) / (yb - top)) * 3);
    const band = Math.floor((y - top) / 3) % 2 ? WHITE : RED;
    p.set(8 - hw, y, band); p.set(9 + hw, y, band);
    if ((y - top) % 3 === 0) p.rect(8 - hw, y, 9 + hw, y, shade(band, -0.15));
    else if (hw > 0) p.set(8 - hw + ((y - top) % 3 === 1 ? 1 : hw * 2 - 1), y, shade(METAL, -0.1));
  }
  p.rect(8, 0, 9, 1, METAL); p.set(8, 0, SIREN_RED); p.set(9, 0, SIREN_RED);
  for (const [x, y] of [[7, 0], [10, 0], [8, -1], [9, 1]]) p.set(x, y, "#ff6a5a55");
  p.rect(10, 6, 11, 7, WHITE); p.set(11, 6, shade(WHITE, -0.3));  // dish
  // Guy wires and the equipment shed.
  for (let i = 0; i <= 7; i++) { p.set(7 - i, 6 + i * 2, "#9a9a9a88"); p.set(10 + i, 6 + i * 2, "#9a9a9a88"); }
  block(p, 11, 16, 16, 20, CONCRETE); p.rect(12, 18, 13, 20, OUTLINE);
  p.rect(0, 21, 17, 21, shade(DIRT, 0.15));
  return p;
}

function paintTruckStop() {
  const p = painter(22, 15);
  // Diesel canopy and pump.
  p.rect(0, 3, 7, 4, WHITE); p.rect(0, 4, 7, 4, "#3a68a8");
  p.rect(1, 5, 1, 13, STEEL); p.rect(6, 5, 6, 13, STEEL);
  p.rect(3, 9, 4, 13, "#3a68a8"); p.rect(3, 10, 4, 10, WHITE);
  // Semi rig: trailer and red cab.
  p.rect(7, 4, 17, 10, "#d8d4c8"); p.rect(7, 4, 17, 4, shade("#d8d4c8", 0.3)); p.rect(7, 8, 17, 8, ORANGE);
  p.rect(7, 11, 17, 11, "#2a2a2e");
  p.rect(18, 6, 21, 11, RED); p.rect(18, 6, 21, 6, shade(RED, 0.3)); p.rect(19, 7, 21, 8, GLASS); p.rect(18, 3, 18, 6, STEEL);
  p.set(21, 10, "#ffe28a");
  wheel(p, 8, 10); wheel(p, 13, 10); wheel(p, 18, 10);
  p.rect(0, 14, 21, 14, ASPHALT);
  return p;
}

function paintQuarry() {
  const p = painter(20, 15);
  // Open pit seen from above: terraces stepping down to a puddle; the far walls show as darker bands.
  const rings = [[10, 9, 9.6, 5.6, "#b9a37a"], [10, 9.4, 8.2, 4.7, "#8d8a82"], [10, 10, 7.4, 4.1, "#a8a090"], [10, 10.5, 5.8, 3.2, "#76736c"],
    [10, 11, 5, 2.6, "#948e80"], [10, 11.6, 3.4, 1.7, "#5e5b55"], [10, 12, 2.4, 1.1, WATER_BLUE]];
  for (const [cx, cy, rx, ry, c] of rings) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) p.set(x, y, c);
    }
  }
  p.set(9, 12, shade(WATER_BLUE, 0.35));
  // Gravel pile and an excavator on the rim, a haul road down the side.
  for (let r = 0; r < 3; r++) p.rect(1 + r, 4 - r, 5 - r, 4 - r, r ? "#a89a80" : "#8a7c64");
  p.rect(12, 1, 15, 3, BUS_YELLOW); p.rect(12, 1, 15, 1, shade(BUS_YELLOW, 0.25)); p.set(14, 2, GLASS);
  p.rect(12, 4, 15, 4, TIRE);
  p.set(16, 2, BUS_YELLOW); p.set(17, 3, BUS_YELLOW); p.set(18, 4, BUS_YELLOW); p.rect(17, 5, 18, 6, shade(BUS_YELLOW, -0.35));
  for (let i = 0; i < 4; i++) p.set(3 + i, 7 + i, "#c9b994");
  return p;
}

function paintCrashSite() {
  const p = painter(18, 15);
  p.rect(0, 13, 17, 14, "#3a342c"); p.rect(2, 12, 15, 12, "#4a4034");   // scorched ground
  // Tail section with its fin.
  p.rect(0, 8, 6, 11, "#d8d8d4"); p.rect(0, 8, 6, 8, WHITE); p.rect(0, 11, 6, 11, shade(STEEL, -0.2));
  p.rect(0, 3, 2, 7, "#d8d8d4"); p.rect(0, 5, 2, 5, RED); p.set(3, 7, "#d8d8d4");
  p.set(3, 9, DARK_WIN); p.set(5, 9, DARK_WIN);
  // Nose section broken off and tipped forward, a wing sticking up.
  p.rect(9, 9, 14, 12, "#d8d8d4"); p.rect(9, 9, 14, 9, WHITE); p.rect(15, 10, 16, 12, "#d8d8d4"); p.set(17, 12, "#d8d8d4");
  p.rect(15, 10, 16, 10, GLASS_BLUE); p.set(11, 10, DARK_WIN); p.set(13, 10, DARK_WIN);
  p.rect(9, 9, 9, 12, "#3a3a3a"); p.rect(6, 8, 6, 11, "#3a3a3a");
  for (let i = 0; i < 4; i++) { p.set(10 + i, 8 - i, "#c8c8c4"); p.set(11 + i, 8 - i, shade(STEEL, -0.15)); }
  // Fire in the gap, smoke above.
  p.set(7, 10, FIRE_RED); p.set(8, 10, FIRE); p.set(7, 9, FIRE_HOT); p.set(8, 9, FIRE); p.set(7, 8, FIRE); p.set(8, 7, "#ffb43b99");
  for (const [x, y] of [[6, 7], [9, 7], [7, 6]]) p.set(x, y, GLOW);
  plume(p, 7, 5, 3);
  for (const [x, y] of [[4, 13], [12, 13], [16, 14]]) p.set(x, y, "#8a8a8a");
  return p;
}

// ---- landmarks ----
function paintDam() {
  const p = painter(26, 21);
  // Hills on both sides and the reservoir behind the wall.
  for (let y = 4; y <= 18; y++) { const w = Math.min(6, Math.floor((y - 2) / 2)); p.rect(0, y, w, y, y < 7 ? GRASS : shade(GRASS, -0.15)); p.rect(25 - w, y, 25, y, y < 7 ? GRASS : shade(GRASS, -0.15)); }
  p.rect(2, 5, 23, 6, WATER_BLUE); p.rect(3, 5, 22, 5, shade(WATER_BLUE, 0.25));
  // The wall, its road and the spillway.
  p.rect(4, 7, 21, 7, shade(CONCRETE, 0.3));
  for (let y = 8; y <= 17; y++) { const inset = Math.floor((y - 8) / 4); p.rect(4 + inset, y, 21 - inset, y, CONCRETE); }
  for (let x = 6; x <= 19; x += 3) p.rect(x, 8, x, 16, shade(CONCRETE, -0.12));
  p.rect(11, 8, 14, 17, FOAM); for (let y = 9; y <= 17; y += 2) { p.set(12, y, WATER_BLUE); p.set(13, y + 1, shade(FOAM, -0.15)); }
  p.rect(3, 18, 22, 20, WATER_BLUE); p.rect(9, 18, 16, 18, FOAM); p.set(8, 19, FOAM); p.set(17, 19, FOAM); p.set(12, 19, FOAM);
  // Powerhouse and a pylon.
  block(p, 16, 14, 20, 17, shade(CONCRETE, -0.2)); p.set(17, 15, LIT_WIN);
  for (let y = 4; y <= 13; y++) { const hw = Math.floor((y - 4) / 4); p.set(23 - hw, y, METAL); p.set(23 + hw, y, METAL); }
  p.rect(21, 5, 25, 5, METAL); p.rect(22, 8, 24, 8, METAL);
  return p;
}

function paintAirport() {
  const p = painter(26, 21);
  // Control tower.
  p.rect(3, 9, 5, 19, CONCRETE); p.rect(3, 9, 3, 19, shade(CONCRETE, 0.2));
  p.rect(1, 4, 7, 8, shade(CONCRETE, -0.15)); p.rect(2, 5, 6, 7, GLASS_BLUE); p.rect(2, 5, 6, 5, GLASS_LIT); p.set(4, 6, LIT_WIN);
  p.rect(1, 3, 7, 3, shade(CONCRETE, 0.25)); p.rect(4, 1, 4, 2, METAL); p.set(4, 0, SIREN_RED);
  // Hangar with an arched roof.
  for (let r = 0; r < 4; r++) p.rect(10 + [3, 1, 0, 0][r], 6 + r, 24 - [3, 1, 0, 0][r], 6 + r, r === 0 ? shade(METAL, 0.3) : METAL);
  p.rect(10, 10, 24, 17, shade(METAL, 0.12));
  p.rect(12, 11, 22, 17, "#22262a");
  // Plane parked out front, tail up.
  p.rect(9, 15, 21, 17, WHITE); p.rect(9, 17, 21, 17, shade(WHITE, -0.25)); p.rect(10, 16, 20, 16, "#3a68a8");
  p.rect(9, 11, 11, 14, WHITE); p.rect(9, 11, 10, 12, RED); p.rect(21, 15, 22, 16, WHITE); p.set(21, 15, GLASS);
  for (let x = 12; x <= 19; x += 2) p.set(x, 15, DARK_WIN);
  p.rect(14, 18, 17, 18, shade(WHITE, -0.15)); p.set(11, 18, TIRE); p.set(20, 18, TIRE);
  p.rect(0, 19, 25, 20, ASPHALT); for (let x = 1; x <= 24; x += 4) p.rect(x, 20, x + 1, 20, WHITE);
  return p;
}

// An air base (sim/data.js LOCATIONS airbase, issue #25): an olive arched hangar, a grey fighter on the apron, a
// control tower, the runway's edge.
function paintAirBase() {
  const p = painter(26, 21);
  // Control tower.
  p.rect(21, 8, 23, 18, CONCRETE); p.rect(21, 8, 21, 18, shade(CONCRETE, 0.2));
  p.rect(19, 4, 25, 7, shade(CONCRETE, -0.15)); p.rect(20, 5, 24, 6, GLASS_BLUE); p.rect(20, 5, 24, 5, GLASS_LIT);
  p.rect(22, 2, 22, 3, METAL); p.set(22, 1, SIREN_RED);
  // Hangar with an arched olive roof, the doors open.
  for (let r = 0; r < 4; r++) p.rect(1 + [3, 1, 0, 0][r], 5 + r, 17 - [3, 1, 0, 0][r], 5 + r, r === 0 ? shade(OLIVE, 0.3) : OLIVE);
  p.rect(1, 9, 17, 16, shade(OLIVE, 0.1)); p.rect(3, 10, 15, 16, "#22262a"); star(p, 8, 6, WHITE);
  // A grey fighter on the apron: swept wings, twin fins.
  p.rect(4, 15, 16, 16, "#8a9098"); p.rect(16, 15, 17, 15, GLASS); p.rect(8, 13, 11, 18, shade("#8a9098", -0.15)); p.rect(4, 13, 5, 14, "#8a9098");
  p.rect(0, 19, 25, 20, ASPHALT); for (let x = 1; x <= 24; x += 4) p.rect(x, 20, x + 1, 20, "#d8c040");
  return p;
}

function paintFactory() {
  const p = painter(26, 21);
  // Smokestacks with red bands, smoking.
  for (const x of [17, 22]) {
    p.rect(x, 4, x + 2, 19, BRICK); p.rect(x, 4, x, 19, shade(BRICK, 0.15));
    p.rect(x, 5, x + 2, 5, WHITE); p.rect(x, 7, x + 2, 7, RED); p.rect(x - 1, 3, x + 3, 3, shade(BRICK, -0.3));
    plume(p, x + 1, 2, x === 17 ? 2 : 3);
  }
  // Main hall with a stepped roof and a tank.
  block(p, 1, 8, 18, 19, shade(BRICK, -0.08));
  p.rect(1, 6, 9, 8, shade(BRICK, -0.08)); p.rect(1, 6, 9, 6, shade(BRICK, 0.2));
  windows(p, 2, 10, 17, 13, 3, 3, GLASS, 2, 2);
  p.rect(11, 15, 16, 19, METAL); for (let y = 16; y <= 19; y += 2) p.rect(11, y, 16, y, shade(METAL, -0.25));
  p.rect(20, 13, 25, 19, STEEL); p.rect(20, 13, 25, 13, shade(STEEL, 0.3)); p.rect(20, 16, 25, 16, shade(STEEL, -0.2));
  p.rect(0, 20, 25, 20, ASPHALT);
  return p;
}

function paintPrison() {
  const p = painter(26, 21);
  const wall = "#9a9890";
  // Cell block behind the wall: rows of barred slits.
  block(p, 8, 4, 23, 12, "#c2b9a2");
  for (let y = 6; y <= 10; y += 2) for (let x = 9; x <= 22; x += 2) p.set(x, y, OUTLINE);
  // Perimeter wall with razor wire and a barred gate.
  p.rect(0, 12, 25, 19, wall); p.rect(0, 12, 25, 12, shade(wall, 0.25));
  for (let x = 0; x <= 25; x++) p.set(x, 11, x % 2 ? "#b8bcc0" : "#6a6e72");
  for (let x = 3; x <= 25; x += 5) p.rect(x, 13, x, 19, shade(wall, -0.15));
  p.rect(13, 14, 18, 19, "#22262a"); for (let x = 13; x <= 18; x += 1) if (x % 2) p.rect(x, 14, x, 19, STEEL);
  p.rect(12, 13, 19, 13, shade(wall, -0.35));
  // Guard tower with a searchlight beam.
  p.rect(1, 6, 5, 19, shade(wall, -0.08)); p.rect(1, 6, 1, 19, shade(wall, 0.15));
  p.rect(0, 2, 6, 5, shade(wall, -0.2)); p.rect(1, 3, 5, 4, GLASS); p.set(3, 3, LIT_WIN);
  p.rect(0, 1, 6, 1, ROOF_GRAY);
  for (let i = 1; i <= 6; i++) p.set(6 + i, 3 + Math.floor(i / 2), "#fff0a055");
  for (let i = 2; i <= 6; i++) p.set(6 + i, 4 + Math.floor(i / 2), "#fff0a033");
  return p;
}

function paintMilitarySite(depot) {
  const p = painter(26, 21);
  p.rect(0, 19, 25, 20, "#6a6450");
  if (depot) {
    // Army depot: a motor pool shed, stacked crates and a canvas-topped truck.
    block(p, 1, 6, 15, 15, OLIVE);
    p.rect(0, 5, 16, 5, shade(OLIVE, 0.2));
    for (const x of [2, 9]) { p.rect(x, 9, x + 4, 15, OLIVE_DARK); for (let y = 10; y <= 15; y += 2) p.rect(x, y, x + 4, y, shade(OLIVE_DARK, -0.25)); }
    star(p, 6, 6, WHITE);
    crate(p, 17, 11, 4, 4, OLIVE); crate(p, 21, 11, 4, 4, shade(OLIVE, -0.1)); crate(p, 19, 7, 4, 4, shade(OLIVE, 0.1));
    p.rect(3, 13, 12, 16, OLIVE_DARK); p.rect(3, 13, 12, 13, shade("#8a8a5a", 0.1));     // truck canvas
    p.rect(12, 14, 15, 18, OLIVE); p.rect(13, 15, 14, 16, GLASS);
    p.rect(3, 17, 15, 18, shade(OLIVE, -0.3)); wheel(p, 4, 16); wheel(p, 11, 16);
    flag(p, 24, 0, "#3a5a3a", 10, 2);
  } else {
    // National Guard base: Quonset hut, flag, a tank behind sandbags.
    for (let y = 0; y <= 5; y++) { const inset = [3, 1, 0, 0, 0, 0][y]; p.rect(2 + inset, 6 + y, 15 - inset, 6 + y, y === 0 ? shade(OLIVE, 0.25) : OLIVE); }
    for (let x = 3; x < 15; x += 3) p.rect(x, 7, x, 11, shade(OLIVE, -0.25));
    p.rect(8, 9, 9, 11, OUTLINE);
    flag(p, 18, 0, "#3a5a3a", 12, 4); star(p, 19, 0, WHITE); p.rect(19, 0, 22, 0, "#3a5a3a"); p.set(21, 0, WHITE);
    // Tank.
    p.rect(10, 13, 21, 15, OLIVE); p.rect(10, 13, 21, 13, shade(OLIVE, 0.25));
    p.rect(13, 11, 18, 12, shade(OLIVE, 0.08)); p.rect(1, 11, 12, 11, OLIVE_DARK);
    p.rect(9, 16, 22, 18, "#2a2c24"); for (let x = 10; x <= 21; x += 3) p.set(x, 17, METAL);
    star(p, 17, 13, WHITE);
    // Sandbags.
    for (let x = 0; x <= 8; x += 2) { p.rect(x, 17, x + 1, 18, SAND); p.set(x, 17, shade(SAND, 0.2)); }
    for (let x = 1; x <= 7; x += 2) { p.rect(x, 16, x + 1, 16, shade(SAND, 0.1)); }
    p.rect(23, 16, 25, 18, SAND); p.rect(23, 15, 24, 15, shade(SAND, 0.2));
  }
  return p;
}

// Crashlanding (sim/crashstart.js, 2026-10-24: "once you leave change the military base sprite on the world map to a
// hive infested one"): the Guard base with the hive grown through it: the hut's roof caved, the flag down, dark veins
// and glowing pods over the sandbags, the tank half swallowed by the mound.
function paintInfestedBase() {
  const p = paintMilitarySite(false);
  const POOL = "#2a1018", VEIN = "#8a1c22", POD = "#ff5a3a", POD_HOT = "#ffb43b";
  p.rect(0, 19, 25, 20, shade("#6a6450", -0.35));
  for (let x = 0; x <= 25; x += 3) { p.set(x, 19, POOL); p.set(x + 1, 20, VEIN); }           // the ground gone dark
  for (let x = 4; x <= 13; x += 2) p.rect(x, 6, x, 7, shade(OLIVE, -0.55));                   // the hut's roof caved in
  p.rect(18, 1, 18, 11, shade("#3a5a3a", -0.5)); for (let x = 19; x <= 22; x++) for (let y = 0; y <= 1; y++) p.clear(x, y); // the flag gone from the pole
  p.set(19, 1, shade("#3a5a3a", -0.3)); p.set(20, 2, shade("#3a5a3a", -0.3));                 // ... hanging in rags
  for (const [x, y] of [[2, 15], [6, 14], [12, 16], [16, 15], [21, 14], [9, 12]]) { p.set(x, y, FLESH); p.set(x + 1, y, shade(FLESH, 0.3)); p.set(x, y - 1, shade(FLESH, -0.2)); } // the mound creeping over the sandbags and the tank
  for (const [x, y] of [[3, 14], [13, 15], [22, 13], [10, 11]]) { p.set(x, y, POD); p.set(x + 1, y, POD_HOT); }  // pods
  for (let t = 0; t < 6; t++) { p.set(1 + t * 4, 18, VEIN); p.set(3 + t * 4, 17, shade(VEIN, 0.3)); }          // veins
  p.set(8, 9, BONE); p.set(9, 10, BONE); p.set(23, 17, BONE);                                                     // bones at the door and the bags
  return p;
}
// A flag on a pole with a star: the "crashhome" marker (sim/markers.js), where the unit's base is.
function paintUnitFlag() {
  const p = painter(12, 14);
  p.rect(2, 0, 2, 13, METAL); p.set(2, 0, shade(METAL, 0.3));
  p.rect(3, 1, 10, 5, "#3a5a3a"); p.rect(3, 1, 10, 1, shade("#3a5a3a", 0.25)); p.set(10, 3, shade("#3a5a3a", -0.3));
  p.set(5, 3, WHITE); p.set(4, 3, WHITE); p.set(6, 3, WHITE); p.set(5, 2, WHITE); p.set(5, 4, WHITE);
  p.rect(0, 13, 4, 13, shade(METAL, -0.4));
  return p;
}

function paintCityCenter() {
  const p = painter(28, 26);
  // Skyline: a tall glass tower with a spire between older towers, low blocks in front.
  block(p, 2, 8, 9, 25, "#b9a88c"); windows(p, 3, 10, 8, 23, 2, 2, DARK_WIN);
  block(p, 18, 5, 25, 25, "#6f7880"); windows(p, 19, 7, 24, 23, 2, 2, DARK_WIN);
  p.rect(20, 3, 23, 4, shade("#6f7880", -0.2));
  block(p, 10, 3, 17, 25, GLASS_BLUE);
  for (let y = 5; y <= 24; y += 2) p.rect(11, y, 16, y, shade(GLASS_BLUE, -0.28));
  for (let i = 0; i < 8; i++) p.set(11 + Math.floor(i * 0.7), 22 - i * 2, GLASS_LIT);
  p.rect(13, 0, 14, 2, METAL); p.set(13, 0, SIREN_RED);
  // A fire still smoking in the gray tower.
  p.set(21, 9, FIRE); p.set(22, 9, FIRE_HOT); p.set(21, 10, FIRE_RED); plume(p, 22, 7, 4);
  block(p, 0, 18, 6, 25, BRICK); windows(p, 1, 20, 5, 24, 2, 2, DARK_WIN);
  block(p, 21, 19, 27, 25, "#9a8a6a"); windows(p, 22, 21, 26, 24, 2, 2, DARK_WIN);
  return p;
}

function paintTownCenter() {
  const p = painter(24, 20);
  // Water tower behind Main Street.
  for (const x of [14, 20]) p.rect(x, 7, x, 12, METAL);
  p.set(15, 9, shade(METAL, -0.3)); p.set(19, 9, shade(METAL, -0.3)); p.set(16, 10, shade(METAL, -0.3)); p.set(18, 10, shade(METAL, -0.3));
  p.rect(13, 2, 21, 6, "#a8c4cc"); p.rect(13, 2, 13, 6, shade("#a8c4cc", 0.25)); p.rect(13, 6, 21, 6, shade("#a8c4cc", -0.25));
  p.rect(14, 1, 20, 1, shade("#a8c4cc", -0.1)); p.rect(16, 0, 18, 0, shade("#a8c4cc", -0.1));
  p.rect(15, 4, 19, 4, "#3a68a8");
  // Storefronts with false fronts and awnings.
  const fronts = [[0, 6, 9, "#9a6248", RED], [7, 15, 7, "#c9b48c", "#3e8a4a"], [16, 23, 10, "#7a8a9a", GOLD]];
  for (const [x0, x1, top, wall, awn] of fronts) {
    block(p, x0, top, x1, 19, wall);
    windows(p, x0 + 1, top + 2, x1 - 1, top + 3, 2, 2, DARK_WIN);
    for (let x = x0; x <= x1; x++) p.set(x, 14, Math.floor((x - x0) / 2) % 2 ? WHITE : awn);
    p.rect(x0 + 1, 15, x1 - 1, 17, GLASS); p.rect(x0 + 2, 16, x0 + 3, 19, OUTLINE);
  }
  return p;
}

// ---- crash events (sim/crashes.js): temporary sites where something came down ----
// A helicopter on its side on scorched ground, tail boom snapped, a rotor blade bent up, burning. mark: "star"
// (Army), "cross" (medevac), "stripe" (news).
function paintHeliWreck(body, trim, mark) {
  const p = painter(22, 15);
  p.rect(1, 13, 20, 14, "#3a342c"); p.rect(3, 12, 18, 12, "#4a4034");
  p.rect(5, 8, 13, 12, body); p.rect(5, 8, 13, 8, shade(body, 0.25)); p.rect(5, 12, 13, 12, shade(body, -0.3));
  p.rect(12, 9, 14, 11, body); p.set(15, 10, body); p.rect(13, 9, 14, 10, GLASS_BLUE); p.set(14, 10, DARK_WIN);
  p.rect(7, 9, 8, 11, DARK_WIN);
  for (let i = 0; i < 5; i++) { p.set(4 - i, 10 - i, shade(body, -0.1)); p.set(4 - i, 11 - i, shade(body, -0.25)); }
  p.rect(0, 3, 1, 6, trim);
  for (let i = 0; i < 8; i++) p.set(9 + i, 7 - Math.floor(i / 2), "#2c2c2c");
  p.rect(9, 7, 10, 7, "#454545");
  if (mark === "star") star(p, 9, 8, WHITE);
  if (mark === "cross") { p.rect(9, 9, 11, 11, WHITE); redCross(p, 9, 9); }
  if (mark === "stripe") { p.rect(5, 10, 6, 10, trim); p.rect(9, 10, 11, 10, trim); }
  p.set(15, 11, FIRE_RED); p.set(16, 11, FIRE); p.set(16, 10, FIRE_HOT); p.set(17, 11, FIRE); p.set(15, 9, FIRE); p.set(16, 9, "#ffb43b99");
  for (const [x, y] of [[14, 8], [17, 9], [18, 11]]) p.set(x, y, GLOW);
  plume(p, 16, 7, 4);
  for (const [x, y] of [[2, 13], [19, 13], [11, 14]]) p.set(x, y, "#8a8a8a");
  return p;
}
// A cargo plane in olive drab, broken in two, crates spilled from the hold.
function paintCargoWreck() {
  const p = painter(22, 15);
  const B = OLIVE, L = shade(OLIVE, 0.25), D = shade(OLIVE, -0.3);
  p.rect(0, 13, 21, 14, "#3a342c"); p.rect(2, 12, 19, 12, "#4a4034");
  p.rect(0, 8, 7, 11, B); p.rect(0, 8, 7, 8, L); p.rect(0, 11, 7, 11, D);
  p.rect(0, 3, 2, 7, B); p.rect(0, 3, 2, 3, L); p.set(3, 7, B);
  p.set(3, 9, DARK_WIN); p.set(5, 9, DARK_WIN);
  p.rect(10, 9, 16, 12, B); p.rect(10, 9, 16, 9, L); p.rect(17, 10, 18, 12, B); p.set(19, 12, B);
  p.rect(17, 10, 18, 10, GLASS_BLUE); p.set(12, 10, DARK_WIN); p.set(14, 10, DARK_WIN);
  p.rect(10, 9, 10, 12, "#3a3a3a"); p.rect(7, 8, 7, 11, "#3a3a3a");
  for (let i = 0; i < 4; i++) { p.set(12 + i, 8 - i, L); p.set(13 + i, 8 - i, D); }
  crate(p, 7, 12, 3, 2); crate(p, 19, 11, 3, 3, WOOD);
  p.set(8, 10, FIRE_RED); p.set(9, 10, FIRE); p.set(8, 9, FIRE_HOT); p.set(9, 9, FIRE); p.set(9, 8, "#ffb43b99");
  for (const [x, y] of [[7, 7], [10, 7]]) p.set(x, y, GLOW);
  plume(p, 8, 6, 3);
  return p;
}
// A supply drop: a striped parachute draped over the ground, pallets of crates strapped down.
function paintAirDrop() {
  const p = painter(20, 14);
  p.rect(0, 12, 19, 13, shade(YARD, 0.15));
  for (let y = 3; y <= 7; y++) {
    const half = y - 2;
    for (let x = 5 - half; x <= 5 + half; x++) p.set(x, y, ((x + 10) >> 1) % 2 ? "#e8743a" : WHITE);
  }
  for (const [x0, x1] of [[1, 6], [5, 7], [9, 8]]) for (let i = 0; i <= 3; i++) p.set(Math.round(x0 + ((x1 - x0) * i) / 3), 8 + i, "#c9c2b0");
  crate(p, 6, 8, 5, 4, WOOD_LIT); crate(p, 11, 9, 4, 3, WOOD); crate(p, 15, 8, 4, 4, OLIVE);
  for (const x of [8, 13, 17]) p.rect(x, 8, x, 11, "#2c2c2c");
  return p;
}
// Where something came down but nobody has found it: a smoke column over the trees.
function paintSearchSmoke() {
  const p = painter(10, 16);
  p.rect(1, 14, 8, 15, shade("#3e5a32", -0.1)); p.rect(2, 12, 4, 14, "#3e5a32"); p.rect(5, 11, 7, 14, "#456a38");
  p.set(4, 12, FIRE); p.set(5, 12, FIRE_RED); p.set(4, 11, "#ffb43b99");
  for (let i = 0; i < 6; i++) {
    const cx = 4 + Math.round(Math.sin(i * 0.9) * 1.2), cy = 10 - i * 2;
    p.set(cx, cy, i < 3 ? "#5a5a5acc" : SMOKE); p.set(cx + 1, cy, SMOKE_FAINT); p.set(cx - 1, cy - 1, SMOKE_FAINT); if (i > 2) p.set(cx + 1, cy - 1, SMOKE_FAINT);
  }
  return p;
}

// ---- points of interest (sim/pois.js kinds: the small places a tile holds besides its site) ----
// Town kinds are drawn at the town shops' size (20 × 17), countryside kinds at the farms' and cabins' (18 × 15), so
// a house or a shed reads next to a diner or a barn; each keeps one plain silhouette so it is told at low zoom.
function paintHouse() {
  const p = painter(20, 17);
  // Two-storey family house with a gable roof, a brick chimney and a porch; the family car in the drive.
  const wall = "#d8cfae", roof = "#6b4a3a";
  p.rect(13, 1, 14, 5, BRICK); p.set(13, 2, shade(BRICK, -0.25));
  house(p, 4, 6, 11, 9, wall, roof, { rh: 4, door: false, win: false });
  for (const x of [5, 12]) { p.rect(x, 7, x + 1, 8, DARK_WIN); p.rect(x, 11, x + 1, 12, (x === 5 ? LIT_WIN : DARK_WIN)); }
  p.rect(8, 11, 10, 14, shade(wall, -0.6)); p.set(10, 13, GOLD);              // front door and its knob
  p.rect(7, 10, 11, 10, shade(roof, 0.15)); p.set(7, 11, WOOD); p.set(11, 11, WOOD); // porch roof on two posts
  p.rect(3, 15, 15, 15, "#6f6a60");                                          // the path
  car(p, 0, 11, "#3a68a8");                                                   // the car in the drive
  pine(p, 18, 15, 7, "#4a7a3a");
  return p;
}

function paintNeighbourhood() {
  const p = painter(20, 17);
  // A row of three small houses along a kerb: a block of a suburb.
  const walls = ["#d8cfae", "#b9c8d2", "#d6b9a2"], roofs = ["#6b4a3a", "#55606a", "#7a3e2c"];
  for (let i = 0; i < 3; i++) {
    const x = 1 + i * 7, y = i === 1 ? 6 : 8;
    house(p, x, y, 5, 14 - y, walls[i], roofs[i], { rh: 3, door: true, win: false });
    p.set(x + 1, y + 1, i === 1 ? LIT_WIN : DARK_WIN); p.set(x + 3, y + 1, DARK_WIN);
  }
  p.rect(0, 14, 19, 14, shade(CONCRETE, 0.1));                                // the pavement
  p.rect(0, 15, 19, 16, ASPHALT); for (let x = 1; x <= 18; x += 4) p.set(x, 16, "#8a8a80"); // the street, its centre line
  p.rect(19, 9, 19, 13, METAL); p.rect(18, 8, 19, 8, "#2a2a2e"); p.set(19, 7, LIT_WIN); // a street lamp
  return p;
}

function paintGarage() {
  const p = painter(20, 17);
  // Flat-roofed repair shop: a roll-up door half open on a car up on jacks, an oil drum and a tyre stack beside it.
  const wall = "#8c8f94";
  block(p, 1, 5, 15, 15, wall);
  p.rect(1, 6, 15, 6, "#2f3236");
  p.rect(2, 4, 14, 4, shade(wall, 0.3)); p.rect(5, 2, 11, 4, "#2a2a2e"); p.rect(6, 3, 10, 3, GOLD); // the sign over the roof
  p.rect(3, 8, 12, 15, "#1e2024");                                            // the open bay
  for (let y = 8; y <= 9; y++) p.rect(3, y, 12, y, y % 2 ? "#7a8086" : "#9aa0a6"); // the door rolled up
  p.rect(4, 11, 11, 13, RED); p.rect(5, 11, 10, 11, GLASS); p.rect(4, 13, 11, 13, shade(RED, -0.35)); p.set(11, 12, "#ffe28a");
  p.rect(5, 14, 5, 15, METAL); p.rect(10, 14, 10, 15, METAL);                 // the jacks
  p.rect(13, 12, 14, 15, shade(wall, -0.55));                                 // the side door
  tires(p, 16, 15, 3);
  barrel(p, 0, 15, false);
  p.rect(1, 16, 18, 16, ASPHALT);
  return p;
}

function paintCorner(arg) {
  const L = lookOf(arg), s = L ? L.style | 0 : 0, p = painter(20, 17);
  // Brick corner shop: a striped awning over a tall window, an open sign, a newspaper rack and a crate by the door.
  // With a look: the wall, the awning in the accent, the name on the board (0), on a board on the roof (1), on a pylon
  // over the crate (2), or over plate glass (3).
  const wall = L ? L.wall : BRICK;
  block(p, 2, 3, 17, 15, wall);
  p.rect(2, 3, 17, 5, shade(wall, 0.12));
  if (!L) { p.rect(3, 4, 16, 4, WHITE); for (let x = 5; x <= 14; x += 3) p.set(x, 4, RED); } // the name board
  else if (s === 0) signBoard(p, L, 3, 4, 16, 4);
  else if (s === 3) signBoard(p, L, 2, 3, 17, 5);
  else p.rect(2, 4, 17, 4, L.trim);
  if (s === 1) roofSign(p, L, 3, 0, 16, 1, 3);
  if (s === 3) { glassFront(p, L, 3, 6, 11, 15, 4); p.rect(6, 10, 7, 11, NEON_PINK); p.rect(12, 6, 16, 6, L.accent); }
  else {
    awning(p, 2, 17, 6, L ? L.accent : RED);
    p.rect(3, 9, 10, 13, GLASS); p.rect(3, 9, 10, 9, GLASS_LIT); p.rect(6, 10, 7, 11, NEON_PINK); // the window and the open sign
  }
  p.rect(12, 9, 15, 15, "#2a2a2e"); p.set(15, 12, GOLD);                       // the door
  p.rect(0, 12, 1, 15, METAL); p.rect(0, 13, 1, 13, WHITE); p.rect(0, 15, 1, 15, shade(METAL, -0.3)); // the paper rack
  if (s === 2) pylon(p, L, 15, 0, 5, 4, 12);
  p.rect(17, 13, 19, 15, WOOD_LIT); p.rect(17, 12, 19, 12, ORANGE); p.set(18, 12, shade(ORANGE, 0.3)); // a crate of oranges
  p.rect(2, 16, 17, 16, ASPHALT);
  return p;
}

function paintPizza(arg) {
  const L = lookOf(arg), s = L ? L.style | 0 : 0, p = painter(20, 17);
  // Pizza place: a shopfront under a red-and-white chequered awning, a round pizza sign on the roof with a slice gone.
  // With a look: the wall, the chequers in the accent, the name along the parapet (0, 2), on a board on the roof
  // beside the pizza (1), or over plate glass (3); the pizza up on its own pylon by the door (2).
  const wall = L ? L.wall : "#d9b98a", chk = L ? (lum(L.accent) > 200 ? L.sign : L.accent) : RED;
  block(p, 2, 7, 17, 15, wall);
  if (L && s !== 1) signBoard(p, L, 2, 7, 17, 7);
  if (s === 3) {
    signBoard(p, L, 2, 7, 17, 9); p.rect(2, 10, 17, 10, chk);
    glassFront(p, L, 3, 11, 16, 15); p.rect(5, 12, 7, 13, "#f0d890"); p.rect(12, 11, 15, 15, shade(GLASS, -0.4));
  } else {
    for (let y = 8; y <= 9; y++) for (let x = 2; x <= 17; x++) p.set(x, y, (Math.floor(x / 2) + y) % 2 ? WHITE : chk);
    p.rect(3, 11, 9, 14, GLASS); p.rect(3, 11, 9, 11, GLASS_LIT); p.rect(5, 12, 7, 13, "#f0d890");   // the window, the counter lit
    p.rect(12, 11, 15, 15, "#2a2a2e"); p.set(15, 13, GOLD);                                           // the door
  }
  if (s === 1) roofSign(p, L, 14, 1, 19, 3, 7);
  // The sign: a pizza on a pole, cheese and pepperoni, one slice cut out at the top right.
  const cx = s === 2 ? 16 : 10;
  if (s === 2) p.rect(cx, 7, cx, 15, METAL); else p.rect(cx, 5, cx, 6, METAL);
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    if (dx * dx + dy * dy > 11) continue;
    if (dx > 0 && dy < 0 && dx >= -dy) continue;
    const rim = dx * dx + dy * dy > 6;
    p.set(cx + dx, 3 + dy, rim ? "#c9873c" : "#f0d070");
  }
  for (const [x, y] of [[9, 2], [11, 4], [8, 4], [10, 5]]) p.set(x - 10 + cx, y, RED);
  p.rect(2, 16, 17, 16, ASPHALT);
  return p;
}

function paintPawnShop(arg) {
  const L = lookOf(arg), s = L ? L.style | 0 : 0, p = painter(20, 17);
  // Pawn shop (sim/shops.js): a brick shopfront with barred windows, the three gold balls hung over the door, a
  // guitar and a rifle in the window. With a look: the wall, the board in the trim with the name in the sign colour
  // (0), a board on the roof (1), the balls hung from a pylon (2), a deep band over a wider window (3); the balls in
  // the accent.
  const wall = L ? L.wall : BRICK, balls = L ? L.accent : GOLD;
  block(p, 2, 6, 17, 15, wall);
  for (let y = 8; y <= 14; y += 2) for (let x = 3 + (y % 4 ? 0 : 1); x <= 16; x += 3) p.set(x, y, shade(wall, -0.2));
  if (!L) { p.rect(2, 6, 17, 7, "#3c3a36"); p.rect(4, 6, 13, 6, GOLD); }                             // the sign board
  else if (s === 3) signBoard(p, L, 2, 5, 17, 7);
  else { p.rect(2, 6, 17, 7, L.trim); if (s === 0) signBoard(p, L, 4, 6, 13, 6); }
  if (s === 1) roofSign(p, L, 3, 0, 12, 2, 6);
  const wx1 = s === 3 ? 11 : 10;
  p.rect(3, 9, wx1, 13, GLASS); p.rect(3, 9, wx1, 9, GLASS_LIT);                                     // the window
  p.rect(4, 10, 4, 13, WOOD_LIT); p.rect(4, 12, 5, 13, WOOD);                                         // a guitar
  p.rect(6, 11, 10, 11, STEEL); p.rect(9, 12, 10, 12, WOOD_LIT);                                      // a rifle on the rack
  for (let x = 3; x <= wx1; x += 2) p.rect(x, 9, x, 13, "#2a2a2a");                                   // the bars
  p.rect(12, 10, 15, 15, METAL); p.rect(12, 10, 15, 10, shade(METAL, 0.3)); p.set(14, 13, OUTLINE);  // a steel door
  if (s === 2) {
    pylon(p, L, 15, 0, 5, 4, 15);
    for (const [x, y] of [[15, 5], [18, 5], [16, 7]]) { p.rect(x, y, x + 1, y + 1, balls); p.set(x, y, shade(balls, 0.3)); } // the balls under it
  } else {
    p.rect(16, 3, 16, 6, METAL); p.rect(15, 3, 17, 3, METAL);                                         // the bracket
    for (const [x, y] of [[14, 4], [17, 4], [15, 1]]) { p.rect(x, y, x + 1, y + 1, balls); p.set(x, y, shade(balls, 0.3)); } // the three balls
  }
  p.rect(2, 16, 17, 16, ASPHALT);
  return p;
}

function paintFarmstand() {
  const p = painter(18, 15);
  // Roadside stand: a shingle roof on posts over a counter of baskets, a painted sign leaning by the road.
  p.rect(1, 3, 14, 3, shade(ROOF_RUST, 0.3)); p.rect(0, 4, 15, 5, ROOF_RUST); p.rect(0, 5, 15, 5, shade(ROOF_RUST, -0.3));
  for (const x of [1, 14]) p.rect(x, 6, x, 13, WOOD);
  p.rect(2, 9, 13, 13, WOOD_LIT); p.rect(2, 9, 13, 9, shade(WOOD_LIT, 0.25)); for (let y = 10; y <= 13; y += 2) p.rect(2, y, 13, y, shade(WOOD_LIT, -0.15));
  for (const [x, c] of [[3, RED], [6, ORANGE], [9, CROP_LIT]]) { p.rect(x, 7, x + 2, 8, c); p.set(x, 7, shade(c, 0.3)); }
  p.rect(12, 7, 13, 8, "#f0d070");                                            // a jar of honey
  p.rect(15, 8, 17, 11, WHITE); p.rect(16, 9, 16, 10, RED); p.rect(16, 12, 16, 13, WOOD); // the sign
  p.rect(0, 14, 17, 14, shade(DIRT, 0.15));
  return p;
}

function paintShed() {
  const p = painter(18, 15);
  // Small tin-roofed shed with a padlocked door, a wheelbarrow and a jerrycan beside it, a tree behind.
  pine(p, 15, 13, 10, "#4a7a3a");
  p.rect(1, 4, 11, 4, shade(METAL, 0.3)); p.rect(0, 5, 12, 5, METAL); p.rect(0, 6, 12, 6, shade(METAL, -0.3));
  for (let y = 7; y <= 13; y++) p.rect(1, y, 11, y, y % 2 ? BOARDS : shade(BOARDS, 0.12));
  p.rect(5, 9, 7, 13, shade(BOARDS, -0.5)); p.set(7, 11, GOLD);               // the door and its padlock
  p.rect(2, 8, 3, 9, DARK_WIN);
  p.rect(12, 11, 14, 12, "#3f7a4a"); p.set(15, 11, METAL); p.set(14, 13, TIRE); // the wheelbarrow
  p.rect(0, 12, 1, 13, RED); p.set(0, 11, "#2a2a2e");                           // the jerrycan
  p.rect(0, 14, 17, 14, shade(DIRT, 0.15));
  return p;
}

function paintBlind() {
  const p = painter(18, 15);
  // Hunting blind: a camouflaged box stand on stilts with a ladder, among the pines, its shooting slot dark.
  pine(p, 2, 14, 11); pine(p, 16, 14, 9);
  for (const x of [7, 12]) p.rect(x, 7, x, 13, WOOD);
  p.set(8, 10, shade(WOOD, -0.3)); p.set(9, 11, shade(WOOD, -0.3)); p.set(10, 12, shade(WOOD, -0.3)); // a brace
  p.rect(6, 2, 13, 6, OLIVE_DARK); for (const [x, y] of [[7, 3], [10, 5], [12, 3], [8, 5], [11, 2]]) p.set(x, y, shade(OLIVE_DARK, 0.25));
  p.rect(5, 1, 14, 1, shade(OLIVE_DARK, -0.3)); p.rect(6, 0, 13, 0, shade(OLIVE_DARK, 0.1));
  p.rect(8, 4, 11, 4, OUTLINE); p.set(9, 4, "#3a3a30");                      // the slot
  p.rect(4, 8, 4, 13, WOOD_LIT); for (let y = 8; y <= 13; y += 2) p.set(5, y, WOOD_LIT); // the ladder
  p.rect(0, 14, 17, 14, shade(GRASS, -0.2));
  return p;
}

function paintCampsite() {
  const p = painter(18, 15);
  // A campsite (sim/campsite.js): a ring of tents of mixed sizes round a lit fire in a clearing, pines behind.
  pine(p, 1, 9, 8); pine(p, 16, 8, 7);
  p.rect(0, 14, 17, 14, shade(DIRT, 0.15)); p.rect(3, 13, 14, 13, shade(DIRT, 0.3));
  tent(p, 4, 8, 4, "#3a78b0");                                                 // a big tent at the back
  tent(p, 12, 8, 3, "#6f7452");                                                // an olive one beside it
  tent(p, 14, 13, 3, ORANGE);                                                  // a small one in front
  tent(p, 2, 13, 2, "#a03a2a", false);                                         // a pup tent
  for (const dx of [-1, 0, 1, 2, 3, 4]) p.set(6 + dx, 14, STONE);             // the fire ring
  campfire(p, 7, 13, true);
  return p;
}

function paintHikercamp() {
  const p = painter(18, 15);
  // Hiker camp on a trail: a small dome tent, a pack against it, a line of washing and a trail sign.
  pine(p, 2, 14, 12); pine(p, 16, 13, 8);
  for (let r = 0; r <= 4; r++) { const hw = Math.round(Math.sqrt(16 - (4 - r) * (4 - r)) * 0.9); p.rect(8 - hw, 8 + r, 8 + hw, 8 + r, r < 2 ? shade(ORANGE, 0.1) : ORANGE); }
  p.rect(10, 10, 11, 12, shade(ORANGE, -0.6));                                 // the flap
  p.rect(4, 10, 5, 12, PACK); p.set(4, 10, shade(PACK, 0.3));                  // the pack
  p.rect(5, 5, 12, 5, "#c9c9c9"); p.rect(7, 6, 7, 7, RED); p.rect(10, 6, 10, 7, "#3a78b0"); // the washing line
  p.rect(13, 7, 13, 13, WOOD); p.rect(12, 7, 15, 8, WOOD_LIT); p.set(15, 7, WHITE); // the trail sign
  p.rect(0, 13, 17, 13, shade(DIRT, 0.15)); p.rect(3, 13, 14, 13, shade(DIRT, 0.35));
  return p;
}

function paintMineshack() {
  const p = painter(18, 15);
  // Mine shack: a timbered adit into the hillside, a tin shack beside it, an ore cart on its rails.
  for (let y = 2; y <= 13; y++) p.rect(0, y, Math.min(17, 4 + y), y, y % 3 ? "#6e6a60" : "#7a766c"); // the hillside
  p.rect(5, 5, 11, 13, OUTLINE); p.rect(5, 5, 11, 5, WOOD_LIT); p.rect(5, 5, 5, 13, WOOD_LIT); p.rect(11, 5, 11, 13, WOOD); // the adit
  p.rect(6, 6, 10, 12, "#111214"); p.set(7, 9, "#3a3a3a"); p.set(8, 10, "#3a3a3a");
  p.rect(3, 3, 13, 3, WOOD); p.rect(4, 2, 12, 2, shade(WOOD, 0.25));            // the lintel
  p.rect(12, 9, 16, 9, shade(METAL, 0.3)); p.rect(12, 10, 17, 13, METAL); p.rect(12, 13, 17, 13, shade(METAL, -0.3)); // the shack
  p.rect(14, 11, 15, 13, shade(METAL, -0.55)); p.set(12, 11, LIT_WIN);
  p.rect(1, 12, 4, 13, "#4a4a4e"); p.rect(2, 11, 3, 11, "#7a6a4a"); p.set(1, 14, TIRE); p.set(4, 14, TIRE); // the ore cart
  p.rect(0, 14, 17, 14, shade(DIRT, 0.1)); for (let x = 0; x <= 17; x += 2) p.set(x, 14, shade(METAL, -0.3));
  return p;
}

// ---- bunkers (sim/bunkerlayout.js, issue #26) ----
// A bunker's portal cut into the hillside: the rock, a concrete face with the blast door (hazard bands round it), a vent
// stack on the rock above; the military's with a wire fence and a guard hut, the government's with a flag on a pole.
function paintBunkerPortal(gov) {
  const p = painter(20, 17);
  for (let y = 1; y <= 14; y++) p.rect(Math.max(0, 6 - y), y, Math.min(19, 13 + y), y, y % 3 ? "#6e6a60" : "#7a766c"); // the hill
  p.rect(5, 7, 14, 14, OUTLINE); p.rect(6, 8, 13, 14, "#9c9e98"); p.rect(6, 8, 13, 8, "#b8bab4"); // the concrete face
  p.rect(8, 10, 11, 14, "#4d5258"); for (let x = 8; x <= 11; x++) p.set(x, 9, x % 2 ? "#e0b020" : "#1c1c1e"); p.set(10, 12, "#8a8a8a"); // the blast door
  p.rect(14, 2, 15, 5, "#4d5258"); p.rect(13, 1, 16, 1, "#6f757c");               // the vent stack
  p.rect(0, 15, 19, 16, "#5a5648");
  if (gov) { p.rect(3, 3, 3, 14, "#c9ced3"); p.rect(4, 3, 6, 4, "#3a6fb0"); p.set(4, 5, "#c8402f"); p.set(5, 5, "#eef0f2"); } // a flag on its pole
  else { for (let x = 0; x <= 19; x += 2) p.set(x, 15, "#9aa1a8"); p.rect(16, 11, 18, 14, OLIVE); p.set(17, 12, LIT_WIN); } // the wire fence, the guard hut
  return p;
}
function paintFalloutShelter() {
  const p = painter(20, 17);
  // A public fallout shelter: a grassy mound, a concrete stair kiosk, the yellow and black shelter sign on a post.
  for (let y = 6; y <= 14; y++) p.rect(Math.max(0, 9 - y), y, Math.min(19, 10 + y), y, y % 2 ? "#5d7a3e" : "#678446");
  p.rect(6, 8, 13, 14, OUTLINE); p.rect(7, 9, 12, 14, "#a8a8a0"); p.rect(7, 9, 12, 9, "#c4c4bc"); p.rect(9, 11, 11, 14, "#1c1c1e"); // the kiosk, its stairway
  p.rect(15, 4, 15, 14, "#8a8a8a"); p.rect(14, 2, 18, 5, "#e0b020"); p.rect(15, 3, 17, 4, "#1c1c1e"); p.set(16, 3, "#e0b020"); // the sign
  p.rect(0, 15, 19, 16, "#4b4b50");
  return p;
}
function paintPrepper() {
  const p = painter(18, 15);
  // A prepper's place: a plank shed in the yard, a solar panel on its roof, the steel hatch in the ground beside it.
  p.rect(0, 12, 17, 14, "#5d7a3e");
  p.rect(2, 5, 10, 12, OUTLINE); p.rect(3, 6, 9, 12, WOOD); for (let x = 3; x <= 9; x += 2) p.rect(x, 6, x, 12, shade(WOOD, -0.2)); // the shed
  p.rect(1, 4, 11, 4, shade(WOOD, -0.35)); p.rect(3, 2, 8, 3, "#2a3a5a"); p.set(4, 2, "#5a7ab0"); p.set(7, 3, "#5a7ab0"); // the roof, the panel
  p.rect(5, 9, 7, 12, shade(WOOD, -0.45));
  p.rect(12, 10, 16, 12, "#4d5258"); p.rect(13, 11, 15, 11, "#6f757c"); p.set(14, 10, "#c9ced3"); // the hatch
  return p;
}

// ---- shops and services by franchise (sim/data-shops.js FRANCHISES) ----
// A kind with franchises is painted in its franchise's look (poiSpriteCanvas: the place's own by its variant, else the
// kind's first): { wall, trim, sign, text, accent, style }. The wall; the trim (the footing, the sills, the mullions);
// the sign board and the name on it (a row of letters in the text colour, its words drawn from the look, so two chains
// never spell alike); the accent (the awning's stripes, the door, the kind's own touches). style is the front's shape:
// 0 a flat front, its name band over a striped awning; 1 a sign board standing on the roof on two posts; 2 a pylon
// sign on a pole by the door (the building a little narrower); 3 a big glass front under a deep name band. Each kind
// adds its emblem (the goods in the window, a mast, columns and steps, a lot of cars) so the kinds read apart at a
// glance and the chains apart by colour and shape. The old shops' painters take the same look (with none, or a kind
// without franchises, they draw as they always did).
const lookOf = (v) => (v && typeof v === "object" && v.wall ? v : null);
const firstLook = (kind) => FRANCHISES[kind][0].look;
const lum = (c) => { const [r, g, b] = rgb(c); return r * 0.3 + g * 0.59 + b * 0.11; };
// Draws only inside the box [x0, y0, x1, y1] (a window's goods).
const clipTo = (p, [x0, y0, x1, y1]) => (x, y, c) => { if (x >= x0 && x <= x1 && y >= y0 && y <= y1) p.set(x, y, c); };

// The name on a sign: letters as runs of 1–3 pixels in the text colour from x0 to x1 on row y, a gap between words,
// the runs from a hash of the look's colours.
function signText(p, x0, x1, y, c, L) {
  let h = 7;
  for (const ch of L.wall + L.sign + L.text + L.accent + L.trim) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  for (let x = x0; x <= x1;) {
    h = (h * 1103515245 + 12345) >>> 0;
    const n = 1 + ((h >>> 16) % 3);
    for (let i = 0; i < n && x <= x1; i++, x++) p.set(x, y, c);
    x++;
  }
}
// A sign board from (x0, y0) to (x1, y1) in the sign colour: lit along the top, shaded along the bottom, the name across.
function signBoard(p, L, x0, y0, x1, y1, text = true) {
  p.rect(x0, y0, x1, y1, L.sign);
  if (y1 > y0) { p.rect(x0, y0, x1, y0, shade(L.sign, 0.22)); p.rect(x0, y1, x1, y1, shade(L.sign, -0.3)); }
  if (text) signText(p, x0 + 1, x1 - 1, y0 + Math.floor((y1 - y0) / 2), L.text, L);
}
// A striped awning from x0 to x1, rows y and y + 1, its scallops on y + 2: the accent and white (a dark stripe when
// the accent is pale itself).
function awning(p, x0, x1, y, c) {
  const c2 = lum(c) > 200 ? shade(c, -0.45) : WHITE;
  for (let x = x0; x <= x1; x++) p.rect(x, y, x, y + 1, Math.floor((x - x0) / 2) % 2 ? c2 : c);
  for (let x = x0; x <= x1; x += 2) p.set(x, y + 2, c);
}
// A board x0..x1, y0..y1 standing on two posts down to the roof row.
function roofSign(p, L, x0, y0, x1, y1, roof) {
  for (const x of [x0 + 1, x1 - 1]) p.rect(x, y1 + 1, x, roof - 1, METAL);
  signBoard(p, L, x0, y0, x1, y1);
}
// A pylon sign w × h from (x0, y0): the board, an accent band under it, the pole down to row yb.
function pylon(p, L, x0, y0, w, h, yb) {
  const px = x0 + (w >> 1);
  p.rect(px, y0 + h, px, yb, METAL); p.set(px, y0 + h, shade(METAL, -0.3));
  signBoard(p, L, x0, y0, x0 + w - 1, y0 + h - 2);
  p.rect(x0, y0 + h - 1, x0 + w - 1, y0 + h - 1, L.accent);
}
// Plate glass from (x0, y0) to (x1, y1): mullions in the trim every step columns, a lit head, a streak of reflection.
function glassFront(p, L, x0, y0, x1, y1, step = 4) {
  p.rect(x0, y0, x1, y1, GLASS); p.rect(x0, y0, x1, y0, GLASS_LIT);
  for (let x = x0 + step; x < x1; x += step) p.rect(x, y0, x, y1, L.trim);
  for (let i = 0; i < 3 && y1 - 1 - i > y0; i++) p.set(x0 + 1 + i, y1 - 1 - i, GLASS_LIT);
}

// A franchise's shopfront from x0 to x1 standing on row yb (the footing): the wall, the sign by style, a window and a
// door (in the accent). Gives where things went: { s, x0, xr (the building's right end), top (its roof row), yb, sign,
// win, door } (boxes [x0, y0, x1, y1]), so the kind can fill the window and put its emblem on the sign.
function shopFront(p, L, x0, x1, yb) {
  const s = L.style | 0, xr = s === 2 ? x1 - 5 : x1;
  const top = yb - (s === 1 ? 8 : s === 3 ? 11 : 10), dx = xr - 4;
  block(p, x0, top, xr, yb, L.wall);
  p.rect(x0, yb, xr, yb, L.trim);                                            // the footing
  let sign, wy;
  if (s === 0) {                                                             // the name band over a striped awning
    sign = [x0, top + 1, xr, top + 2]; signBoard(p, L, ...sign);
    awning(p, x0, xr, top + 3, L.accent); wy = top + 6;
  } else if (s === 1) {                                                      // a board on the roof
    sign = [x0 + 1, top - 6, xr - 1, top - 3]; roofSign(p, L, ...sign, top);
    p.rect(x0, top + 1, xr, top + 1, L.trim); p.rect(x0, top + 2, xr, top + 2, L.accent); wy = top + 3;
  } else if (s === 2) {                                                      // a pylon by the door
    sign = [x1 - 4, top - 5, x1, top - 2]; pylon(p, L, x1 - 4, top - 5, 5, 5, yb);
    p.rect(x0, top + 1, xr, top + 1, L.trim); p.rect(x0, top + 2, xr, top + 2, L.accent); wy = top + 4;
  } else {                                                                   // a deep name band over plate glass
    sign = [x0, top + 1, xr, top + 3]; signBoard(p, L, ...sign);
    p.rect(x0, top + 4, xr, top + 4, L.accent); wy = top + 5;
  }
  let win;
  if (s === 3) {
    glassFront(p, L, x0 + 1, wy, xr - 1, yb - 1);
    win = [x0 + 1, wy + 1, dx - 2, yb - 1];
    p.rect(dx - 1, wy, dx + 3, yb - 1, L.trim); p.rect(dx, wy + 1, dx + 2, yb - 1, shade(GLASS, -0.35)); p.rect(dx + 1, wy + 1, dx + 1, yb - 1, shade(GLASS, -0.5));
  } else {
    win = [x0 + 1, wy, dx - 2, yb - 2];
    p.rect(win[0], wy, win[2], yb - 2, GLASS); p.rect(win[0], wy, win[2], wy, GLASS_LIT);
    p.rect(win[0], yb - 1, win[2], yb - 1, L.trim);                          // the sill
    p.rect(dx, wy, dx + 2, yb - 1, L.accent); p.rect(dx + 1, wy + 1, dx + 1, wy + 2, GLASS); p.set(dx + 2, yb - 3, shade(L.accent, -0.5));
  }
  return { s, x0, xr, top, yb, sign, win, door: [dx, wy, dx + 2, yb - 1] };
}
// Where an icon w × h sits on the sign: its left end, centred on the board's rows (a two-row band: the icon stands a
// row proud of it); the text under it cleared.
function signIcon(p, L, g, w, h) {
  const [x0, y0, , y1] = g.sign, x = x0 + 1, y = Math.floor((y0 + y1) / 2) - Math.floor((h - 1) / 2);
  p.rect(x, y0, Math.min(g.sign[2], x + w), y1, L.sign);
  if (y1 > y0) p.rect(x, y0, Math.min(g.sign[2], x + w), y0, shade(L.sign, 0.22));
  return [x, y];
}
// Icons: an open book, a burger, a bottle, a coat hanger, a paw (5 × 3), a cross.
function bookIcon(p, x, y) {
  p.rect(x, y, x + 1, y + 1, WHITE); p.rect(x + 3, y, x + 4, y + 1, WHITE); p.rect(x + 2, y, x + 2, y + 2, "#5a3a20");
  p.rect(x, y + 2, x + 4, y + 2, shade(WHITE, -0.3)); p.set(x + 2, y + 2, "#5a3a20");
}
function burgerIcon(p, x, y) {
  p.rect(x + 1, y, x + 3, y, "#e0a050"); p.set(x, y, shade("#e0a050", -0.15)); p.set(x + 4, y, shade("#e0a050", -0.15));
  p.rect(x, y + 1, x + 4, y + 1, "#6a3a20"); p.set(x, y + 1, CROP_LIT); p.set(x + 4, y + 1, GOLD);
  p.rect(x, y + 2, x + 4, y + 2, "#c98a44");
}
function bottleIcon(p, x, y, c) { p.set(x + 1, y, shade(c, 0.3)); p.rect(x, y + 1, x + 2, y + 2, c); p.set(x, y + 1, shade(c, 0.3)); }
function hangerIcon(p, x, y, c) { p.set(x + 2, y, c); p.rect(x + 1, y + 1, x + 3, y + 1, c); p.rect(x, y + 2, x + 4, y + 2, c); p.clear(x + 2, y + 1); }
function pawIcon(p, x, y, c) { p.set(x, y, c); p.set(x + 2, y, c); p.set(x + 4, y, c); p.rect(x + 1, y + 1, x + 3, y + 2, c); }
// A small satellite dish facing up and left, its foot on (x + 1, y).
function dish(p, x, y) { p.rect(x, y - 1, x + 1, y - 1, STEEL); p.set(x - 1, y - 2, STEEL); p.set(x, y - 2, shade(STEEL, 0.25)); p.set(x + 2, y - 2, METAL); p.set(x + 1, y, METAL); }

function paintSportShop(arg) {
  const L = lookOf(arg) || firstLook("sportshop"), p = painter(20, 17);
  // Sporting goods: the chain's front, a basketball hoop on a pole by the wall, a tent, a ball and a bat in the window,
  // a canoe racked on the roof (when the roof is free).
  const g = shopFront(p, L, 4, 19, 15);
  p.rect(1, 4, 1, 15, METAL); p.rect(0, 1, 3, 3, WHITE); p.rect(0, 1, 3, 1, shade(WHITE, 0.2)); p.rect(1, 3, 2, 3, RED); // the hoop's pole and board
  p.rect(2, 4, 3, 4, ORANGE); p.set(2, 5, "#e8e4da99"); p.set(3, 5, "#e8e4da99"); p.set(3, 6, "#e8e4da66");            // the rim and net
  p.rect(2, 14, 3, 15, ORANGE); p.set(3, 14, shade(ORANGE, -0.45));                                                     // a ball under it
  const put = clipTo(p, g.win), [wx0, , , wy1] = g.win;
  for (let r = 0; r < 3; r++) for (let x = wx0 + 2 - r; x <= wx0 + 2 + r; x++) put(x, wy1 - 2 + r, r === 2 && x === wx0 + 2 ? DARK_WIN : x > wx0 + 2 ? shade(L.accent, -0.25) : L.accent); // a tent
  put(wx0 + 6, wy1, ORANGE); put(wx0 + 7, wy1, ORANGE); put(wx0 + 6, wy1 - 1, ORANGE); put(wx0 + 7, wy1 - 1, shade(ORANGE, -0.4)); // a ball
  put(wx0 + 9, wy1, WOOD); put(wx0 + 10, wy1 - 1, WOOD_LIT); put(wx0 + 10, wy1 - 2, WOOD_LIT); put(wx0 + 11, wy1 - 3, WOOD_LIT); // a bat
  if (g.s !== 1) { const c = L.sign, y = g.top - 2; p.rect(g.x0 + 4, y - 1, g.xr - 4, y, c); p.rect(g.x0 + 5, y - 1, g.xr - 5, y - 1, shade(c, 0.25)); p.set(g.x0 + 3, y - 2, c); p.set(g.xr - 3, y - 2, c); p.set(g.x0 + 5, y + 1, METAL); p.set(g.xr - 5, y + 1, METAL); } // the canoe
  p.rect(0, 16, 19, 16, ASPHALT);
  return p;
}

function paintElectronics(arg) {
  const L = lookOf(arg) || firstLook("electronics"), p = painter(22, 20);
  // Electronics store (a city block): the chain's front with an upper storey, rows of TVs glowing in the window, a
  // satellite dish on the roof.
  const g = shopFront(p, L, 1, 20, 18);
  if (g.s !== 1) { block(p, g.x0 + 2, g.top - 4, g.xr - 2, g.top, shade(L.wall, -0.08)); windows(p, g.x0 + 4, g.top - 2, g.xr - 4, g.top - 1, 3, 2, DARK_WIN, 2, 1); }
  dish(p, g.s === 2 ? g.x0 + 4 : g.s === 1 ? g.x0 + 5 : g.xr - 5, g.s === 1 ? g.top - 1 : g.top - 5);
  const put = clipTo(p, g.win), [wx0, wy0, wx1, wy1] = g.win, th = Math.min(4, wy1 - wy0 + 1), glow = [L.accent, NEON_CYAN, "#9ad0ff"];
  for (let x = wx0 + 1, i = 0; x + 3 <= wx1 + 1; x += 5, i++) {
    const y = wy1 - th + 1, c = glow[i % 3];
    for (let yy = y; yy <= wy1; yy++) for (let xx = x; xx <= x + 3; xx++) put(xx, yy, "#1c1f24");
    for (let yy = y + 1; yy < wy1 || yy === y + 1; yy++) { put(x + 1, yy, c); put(x + 2, yy, shade(c, 0.3)); }
    if (y - 1 >= wy0) { put(x + 1, y - 1, c + "55"); put(x + 2, y - 1, c + "55"); }
  }
  p.rect(0, 19, 21, 19, ASPHALT);
  return p;
}

function paintRadioShop(arg) {
  const L = lookOf(arg) || firstLook("radioshop"), p = painter(20, 17);
  // Radio shop: the chain's front, a lattice antenna mast beside it with a red light on top and a beam on its arm,
  // radios on the shelf in the window.
  const g = shopFront(p, L, 5, 19, 15);
  for (let y = 2; y <= 15; y++) {                                                              // the mast, banded red and white
    const w = Math.round(((y - 2) * 2) / 13), c = Math.floor(y / 3) % 2 ? RED : WHITE;
    for (let x = 2 - w; x <= 2 + w; x++) p.set(x, y, (x + y) % 2 ? c : shade(c, -0.35));     // the lattice
  }
  p.rect(2, 1, 2, 1, METAL); p.set(2, 0, RED); p.set(1, 0, "#ff6a5a55"); p.set(3, 0, "#ff6a5a55");
  p.rect(0, 5, 4, 5, STEEL); for (const x of [0, 4]) p.set(x, 4, STEEL);                        // the beam
  p.set(3, 8, "#c9c9c955"); p.set(4, 10, "#c9c9c955");                                          // a guy wire to the wall
  const put = clipTo(p, g.win), [wx0, , wx1, wy1] = g.win;
  for (let x = wx0, i = 0; x + 2 <= wx1; x += 4, i++) {
    const c = i % 2 ? WOOD_LIT : "#3a3d44";
    for (let xx = x; xx <= x + 2; xx++) { put(xx, wy1, c); put(xx, wy1 - 1, c); }
    put(x, wy1 - 1, GOLD); put(x + 2, wy1, shade(c, -0.4)); put(x + 2, wy1 - 2, METAL); put(x + 2, wy1 - 3, METAL); // the dial, a knob, the aerial
  }
  p.rect(0, 16, 19, 16, ASPHALT);
  return p;
}

const SPINES = ["#c8402f", "#3a6fb0", "#e8c04a", "#3f6b3a", "#5b3a7a", "#e8e4d8", "#a2713f", "#2d4a5e"];
function shelfOfBooks(p, box, seed = 0) { // spines of every colour standing on shelves, a shelf every 3 rows from the bottom
  const put = clipTo(p, box), [x0, y0, x1, y1] = box;
  for (let sy = y1; sy >= y0; sy -= 3) {
    for (let x = x0; x <= x1; x++) put(x, sy, WOOD);
    for (let x = x0; x <= x1; x++) {
      const k = (x * 5 + sy * 3 + seed) % 7, h = k === 0 ? 0 : k < 4 ? 2 : 1;
      for (let i = 1; i <= h; i++) put(x, sy - i, SPINES[(x * 3 + sy + seed) % SPINES.length]);
    }
  }
}
function paintBookstore(arg) {
  const L = lookOf(arg) || firstLook("bookstore"), p = painter(20, 17);
  // Bookstore: the chain's front, the window full of books on their shelves, an open book on the sign, a cart of
  // bargain books by the door.
  const g = shopFront(p, L, 1, 18, 15);
  shelfOfBooks(p, g.win, lum(L.wall) | 0);
  const [ix, iy] = signIcon(p, L, g, 5, 3); bookIcon(p, ix, iy);
  p.rect(16, 13, 19, 14, WOOD_LIT); p.rect(16, 15, 16, 15, WOOD); p.rect(19, 15, 19, 15, WOOD);   // the cart
  for (const [x, c] of [[16, RED], [17, "#3a6fb0"], [18, GOLD], [19, "#3f6b3a"]]) p.set(x, 12, c);
  p.rect(0, 16, 19, 16, ASPHALT);
  return p;
}

function paintLibrary(arg) {
  const L = lookOf(arg) || firstLook("library"), s = L.style | 0, p = painter(24, 17);
  // Library: a pedimented portico on columns over wide steps, two wings with tall windows full of books (glass
  // wings for the modern ones), the door in the accent; the name on the frieze, on a board on a wing's roof or on a
  // monument sign on the lawn.
  const wall = L.wall, col = shade(L.trim, 0.25);
  block(p, 1, 6, 22, 14, wall);
  for (const [y, x0, x1] of [[2, 11, 12], [3, 9, 14], [4, 7, 16], [5, 6, 17]]) p.rect(x0, y, x1, y, y === 2 ? shade(L.trim, 0.3) : y === 5 ? shade(L.trim, -0.2) : L.trim); // the pediment
  p.set(11, 3, L.accent); p.set(12, 3, L.accent);                                               // the roundel in the pediment
  p.rect(6, 6, 17, 6, s === 0 ? L.sign : L.trim);
  if (s === 0) signText(p, 7, 16, 6, L.text, L);                                                // the name on the frieze
  p.rect(6, 7, 17, 13, shade(wall, -0.35));                                                     // the portico's shade
  for (const x of [7, 9, 14, 16]) { p.rect(x, 7, x, 13, col); p.set(x, 7, shade(col, 0.3)); }
  p.rect(11, 9, 12, 13, L.accent); p.rect(11, 8, 12, 8, GLASS_LIT); p.set(12, 11, GOLD);        // the door and its fanlight
  for (const x0 of [2, 18]) {                                                                   // the wings
    if (s === 3) { glassFront(p, L, x0, 7, x0 + 3, 13, 2); shelfOfBooks(p, [x0, 9, x0 + 3, 13], x0); }
    else for (const x of [x0, x0 + 2]) { p.rect(x, 8, x + 1, 12, DARK_WIN); p.set(x, 8, shade(DARK_WIN, 0.4)); shelfOfBooks(p, [x, 9, x + 1, 12], x); }
  }
  if (s === 3) { p.rect(1, 6, 5, 6, L.sign); p.rect(18, 6, 22, 6, L.sign); signText(p, 2, 4, 6, L.text, L); signText(p, 19, 21, 6, L.text, L); }
  p.rect(1, 14, 22, 14, L.accent === wall ? shade(wall, -0.3) : shade(L.accent, -0.2));         // the base course
  p.rect(5, 14, 18, 14, shade(STONE, 0.15)); p.rect(4, 15, 19, 15, STONE); p.rect(3, 16, 20, 16, shade(STONE, -0.15)); // the steps
  p.rect(0, 16, 2, 16, GRASS); p.rect(21, 16, 23, 16, GRASS); p.rect(0, 15, 3, 15, GRASS); p.rect(20, 15, 23, 15, GRASS);
  if (s === 1) roofSign(p, L, 1, 1, 6, 3, 6);                                                   // a board on the left wing
  if (s === 2) { p.rect(20, 14, 22, 15, STONE); p.rect(20, 14, 22, 14, shade(STONE, 0.2)); signBoard(p, L, 19, 11, 23, 13); } // the monument sign
  return p;
}

function paintPetStore(arg) {
  const L = lookOf(arg) || firstLook("petstore"), p = painter(20, 17);
  // Pet store: the chain's front, a paw print on the glass, a fish tank in the window (fish, weed and bubbles), a
  // paw on the board, a dog house by the door.
  const g = shopFront(p, L, 1, 17, 15);
  const put = clipTo(p, g.win), [wx0, wy0, wx1, wy1] = g.win;
  for (const [dx, dy] of [[0, 0], [2, 0], [4, 0], [1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [3, 2]]) put(wx0 + dx, wy0 + dy, L.accent);
  const tx0 = wx1 - 4;
  for (let y = wy1 - 2; y <= wy1; y++) for (let x = tx0; x <= wx1; x++) put(x, y, y === wy1 - 2 ? shade(WATER_BLUE, 0.35) : WATER_BLUE);
  put(tx0 + 1, wy1 - 1, ORANGE); put(tx0 + 3, wy1, GOLD); put(tx0, wy1, CROP); put(tx0, wy1 - 1, CROP); put(tx0 + 2, wy1 - 3, "#d8ecf499");
  if (g.s === 1 || g.s === 2) { const [ix, iy] = signIcon(p, L, g, 5, 3); pawIcon(p, ix, iy, L.text); }
  p.rect(18, 12, 19, 15, "#a84a3a"); p.set(18, 11, shade("#a84a3a", 0.3)); p.set(19, 11, shade("#a84a3a", 0.3)); p.set(19, 10, shade("#a84a3a", 0.3)); // the dog house
  p.rect(18, 14, 18, 15, OUTLINE);
  p.rect(0, 16, 19, 16, ASPHALT);
  return p;
}

function paintGarden(arg) {
  const L = lookOf(arg) || firstLook("garden"), s = L.style | 0, p = painter(20, 17);
  // Garden center: a gabled greenhouse of glass, green rows inside, the shop beside it in the chain's colours (its
  // name by style; all glass for the glass-front chains), potted plants and flowers along the front.
  for (let r = 0; r < 4; r++) p.rect(5 - r * 2 + (r ? 1 : 0), 4 + r, 6 + r * 2 - (r ? 1 : 0), 4 + r, r === 0 ? GLASS_LIT : GLASS);
  p.rect(0, 7, 11, 7, L.trim); p.rect(5, 4, 6, 4, L.trim);                                      // the eave and the ridge
  glassFront(p, L, 0, 8, 11, 14, 3);
  for (let x = 1; x <= 10; x++) { p.set(x, 13, (x % 2) ? CROP : CROP_LIT); p.set(x, 12, x % 3 ? CROP_LIT : GLASS); } // rows of seedlings inside
  p.set(3, 9, CROP); p.set(8, 9, CROP);                                                         // hanging baskets
  const sx0 = 12, sx1 = s === 2 ? 16 : 19, top = s === 1 ? 8 : 6;
  if (s === 3) { block(p, sx0, top, sx1, 15, L.wall); glassFront(p, L, sx0 + 1, top + 4, sx1 - 1, 15, 3); signBoard(p, L, sx0, top + 1, sx1, top + 3); }
  else {
    block(p, sx0, top, sx1, 15, L.wall);
    if (s === 0) { signBoard(p, L, sx0, top + 1, sx1, top + 2); awning(p, sx0, sx1, top + 3, L.accent); }
    if (s === 1) { roofSign(p, L, sx0, 2, sx1, 5, top); p.rect(sx0, top + 1, sx1, top + 1, L.accent); }
    if (s === 2) { p.rect(sx0, top + 1, sx1, top + 1, L.accent); pylon(p, L, 17, 2, 3, 5, 15); }
    const dy = s === 0 ? top + 6 : top + 3;
    p.rect(sx0 + 1, dy, sx0 + 3, 15, L.accent); p.rect(sx0 + 2, dy + 1, sx0 + 2, dy + 2, GLASS);
  }
  for (const x of [1, 4, 7, 10, 14, 17]) {                                                      // the pots along the front
    p.rect(x, 15, x + 1, 15, "#b06a46"); p.set(x + 1, 15, shade("#b06a46", -0.25));
    p.set(x, 14, CROP); p.set(x + 1, 14, CROP_LIT); p.set(x + (x % 2), 13, x % 3 ? L.accent : "#e88aa0");
  }
  p.rect(0, 16, 19, 16, shade(DIRT, 0.15));
  return p;
}

function paintClothing(arg) {
  const L = lookOf(arg) || firstLook("clothing"), p = painter(20, 17);
  // Clothing store: the chain's front, mannequins dressed in the window, a hanger on the board, a rail of clothes
  // wheeled out by the door.
  const g = shopFront(p, L, 1, 17, 15);
  const put = clipTo(p, g.win), [wx0, wy0, wx1, wy1] = g.win, cloth = [L.accent, L.sign, "#3a5f8e", "#c8402f"];
  for (let x = wx0, i = 0; x + 2 <= wx1; x += 4, i++) {
    const c = cloth[i % cloth.length];
    put(x + 1, wy0, SKIN);
    put(x, wy0 + 1, c); put(x + 1, wy0 + 1, c); put(x + 2, wy0 + 1, shade(c, -0.25));
    for (let y = wy0 + 2; y <= wy1; y++) { if (y === wy0 + 2 && i % 2) { put(x, y, c); put(x + 1, y, c); put(x + 2, y, c); } else { put(x, y, PANTS); put(x + 2, y, PANTS); } }
    put(x + 1, wy1, METAL);
  }
  if (g.s === 1 || g.s === 2) { const [ix, iy] = signIcon(p, L, g, 5, 3); hangerIcon(p, ix, iy, L.text); }
  p.rect(18, 10, 18, 15, METAL); p.rect(18, 10, 19, 10, METAL);                                 // the rail
  for (const [y, c] of [[11, RED], [12, "#3a5f8e"]]) p.rect(19, y, 19, y + 1, c);
  p.rect(0, 16, 19, 16, ASPHALT);
  return p;
}

function paintVet(arg) {
  const L = lookOf(arg) || firstLook("vet"), p = painter(20, 17);
  // Veterinary clinic: the chain's front, a cross and a paw on the sign (a plaque on the parapet for the flat
  // fronts), a dog on its lead waiting by the door.
  const g = shopFront(p, L, 1, 15, 15);
  if (g.s === 1 || g.s === 2) {
    const [ix, iy] = signIcon(p, L, g, 3, 3); plus(p, ix + 1, iy + 1, 1, 1, L.text);
  } else {
    const x = g.x0 + 1, y = g.top - 3;
    p.rect(x, y, x + 4, y + 3, L.sign); p.rect(x, y, x + 4, y, shade(L.sign, 0.25)); plus(p, x + 2, y + 1, 1, 1, L.text); // the plaque
  }
  const put = clipTo(p, g.win), [wx0, wy0] = g.win;
  for (const [dx, dy] of [[0, 0], [2, 0], [4, 0], [1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [3, 2]]) put(wx0 + 1 + dx, wy0 + dy, L.accent); // a paw on the glass
  const dog = "#8b6a48";                                                                        // the dog
  p.rect(16, 13, 18, 14, dog); p.rect(19, 12, 19, 13, dog); p.set(19, 11, shade(dog, -0.3)); p.set(16, 12, shade(dog, -0.2));
  p.set(16, 15, shade(dog, -0.3)); p.set(18, 15, shade(dog, -0.3)); p.set(19, 13, OUTLINE);
  p.set(17, 12, RED); p.set(15, 11, "#c9c9c9"); p.set(16, 11, "#c9c9c9");                      // its collar and lead
  p.rect(0, 16, 19, 16, ASPHALT);
  return p;
}

function paintDealer(arg) {
  const L = lookOf(arg) || firstLook("dealer"), p = painter(24, 17);
  // Car dealership: the showroom in the chain's front with a new car behind the glass, a car on the lot with its
  // price on the windshield, a string of pennants from the roof to a pole, the lot's lines on the asphalt.
  p.rect(0, 15, 23, 16, ASPHALT); for (let x = 14; x <= 23; x += 4) p.set(x, 16, "#d8d4c8");
  const g = shopFront(p, L, 0, 13, 14);
  const put = clipTo(p, g.win), [wx0, , , wy1] = g.win, show = L.accent === L.wall ? RED : L.accent;
  for (let x = wx0 + 1; x <= wx0 + 6; x++) put(x, wy1, show);
  for (let x = wx0 + 2; x <= wx0 + 5; x++) put(x, wy1 - 1, x > wx0 + 3 ? GLASS_LIT : shade(show, 0.15));
  put(wx0 + 2, wy1, TIRE); put(wx0 + 5, wy1, TIRE);
  p.rect(23, 2, 23, 15, METAL); p.set(23, 1, shade(METAL, 0.3));                                // the pennants' pole
  const x0 = g.xr + 1, y0 = g.top + 1, cols = [L.accent, WHITE, L.sign === L.accent ? GOLD : L.sign];
  for (let x = x0; x <= 22; x++) {
    const t = (x - x0) / (22 - x0), y = Math.round(y0 + (2 - y0) * t + Math.sin(t * Math.PI) * 1.5);
    p.set(x, y, "#d8d8d8aa");                                                                    // the string (see-through: no outline)
    if ((x - x0) % 2 === 1) p.set(x, y + 1, cols[((x - x0) >> 1) % 3]);
  }
  car(p, 14, 10, L.sign === L.wall ? "#3a68a8" : L.sign); p.set(18, 11, WHITE);                 // the car on the lot, its price
  return p;
}

function paintRestaurant(arg) {
  const L = lookOf(arg) || firstLook("restaurant"), p = painter(20, 17);
  // Restaurant: the chain's front, a burger on the sign, tables laid in the window under warm lamps, a patio table
  // under an umbrella in the accent by the door.
  const g = shopFront(p, L, 1, 16, 15);
  const [ix, iy] = signIcon(p, L, g, 5, 3); burgerIcon(p, ix, iy);
  const put = clipTo(p, g.win), [wx0, wy0, wx1, wy1] = g.win;
  for (let x = wx0; x <= wx1; x++) put(x, wy0, "#f0d89066");
  for (let x = wx0 + 1; x + 1 <= wx1; x += 4) { put(x, wy1, WOOD); put(x + 1, wy1, WOOD); put(x, wy1 - 1, WHITE); put(x + 1, wy1 - 1, METAL); put(x + 1, wy0, LIT_WIN); }
  const uc = lum(L.accent) > 200 ? L.sign : L.accent;                                          // the patio umbrella
  p.rect(17, 9, 19, 9, shade(uc, 0.25)); p.rect(16, 10, 19, 10, uc); p.set(17, 10, WHITE); p.set(19, 10, WHITE);
  p.rect(18, 11, 18, 15, METAL); p.rect(17, 13, 19, 13, WOOD_LIT); p.set(17, 14, WOOD); p.set(19, 14, WOOD);
  p.rect(0, 16, 19, 16, ASPHALT);
  return p;
}

function paintBank(arg) {
  const L = lookOf(arg) || firstLook("bank"), s = L.style | 0, p = painter(22, 17);
  // Bank: a heavy cornice over four thick columns, the round steel vault door shining between the middle ones, a gold
  // coin in the pediment, an ATM in the wall, steps; the name on the frieze, a board on the roof, a monument sign by
  // the steps or a band over glass bays (the modern ones).
  const wall = L.wall, col = shade(wall, 0.18), gold = L.accent;
  block(p, 1, 5, 20, 14, wall);
  if (s !== 1 && s !== 3) { for (let r = 0; r < 3; r++) p.rect(9 - r * 2, 1 + r, 12 + r * 2, 1 + r, r === 0 ? shade(L.trim, 0.3) : L.trim); p.rect(10, 2, 11, 3, gold); p.set(10, 2, shade(gold, 0.35)); }
  p.rect(0, 4, 21, 5, L.trim); p.rect(0, 4, 21, 4, shade(L.trim, 0.25));                       // the cornice
  p.rect(1, 6, 20, 6, s === 0 || s === 3 ? L.sign : shade(wall, -0.15));
  if (s === 0 || s === 3) signText(p, 3, 18, 6, L.text, L);                                    // the name on the frieze
  p.rect(5, 7, 16, 13, shade(wall, -0.4));
  for (const x of [5, 15]) { if (s === 3) glassFront(p, L, x, 8, x + 1, 13, 2); else { p.rect(x, 8, x + 1, 12, DARK_WIN); p.set(x, 8, shade(DARK_WIN, 0.4)); } }
  for (const x of [3, 7, 13, 17]) { p.rect(x, 7, x + 1, 13, col); p.rect(x, 7, x + 1, 7, shade(col, 0.3)); p.set(x + 1, 10, shade(col, -0.15)); }
  for (const [y, x0, x1] of [[8, 10, 11], [9, 9, 12], [10, 9, 12], [11, 9, 12], [12, 10, 11]]) p.rect(x0, y, x1, y, STEEL); // the vault door
  p.set(9, 9, shade(STEEL, 0.3)); p.rect(10, 10, 11, 10, gold); p.set(12, 11, METAL); p.set(10, 12, METAL); p.set(9, 13, METAL);
  p.rect(1, 9, 2, 11, "#2a2c30"); p.set(1, 9, NEON_CYAN); p.set(2, 9, NEON_CYAN); p.set(1, 11, METAL);  // the ATM
  p.rect(1, 13, 20, 13, shade(wall, -0.25)); p.rect(3, 14, 18, 14, shade(L.trim, 0.1));
  p.rect(2, 15, 19, 15, STONE); p.rect(1, 16, 20, 16, shade(STONE, -0.15));                     // the steps
  if (s === 1) roofSign(p, L, 3, 0, 18, 2, 4);
  if (s === 2) { p.rect(21, 13, 21, 16, METAL); signBoard(p, L, 18, 10, 21, 12); p.set(20, 13, gold); }
  return p;
}

function paintBar(arg) {
  const L = lookOf(arg) || firstLook("bar"), p = painter(20, 17);
  // Bar: the chain's front with the window dimmed, a neon cocktail glass and a neon bottle glowing in it, a dark
  // wooden door, a keg out front.
  const g = shopFront(p, L, 1, 18, 15);
  const [wx0, wy0, wx1, wy1] = g.win, put = clipTo(p, g.win);
  for (let y = wy0; y <= wy1; y++) for (let x = wx0; x <= wx1; x++) put(x, y, y === wy0 ? "#3a3440" : "#24202a");
  const neon = lum(L.accent) > 90 ? L.accent : NEON_PINK, neon2 = lum(L.text) > 120 && L.text !== neon ? L.text : NEON_CYAN;
  const gx = wx0 + 1;
  for (let x = gx; x <= gx + 4; x++) put(x, wy0, neon);
  put(gx + 1, wy0 + 1, neon); put(gx + 3, wy0 + 1, neon); put(gx + 2, wy0 + 1, shade(neon, 0.4)); put(gx + 2, wy0 + 2, neon);
  if (wy1 > wy0 + 2) { put(gx + 1, wy0 + 3, neon); put(gx + 2, wy0 + 3, neon); put(gx + 3, wy0 + 3, neon); }
  put(gx - 1, wy0, neon + "66"); put(gx + 5, wy0, neon + "66");
  const bx = gx + 7;
  if (bx <= wx1) { put(bx, wy0, neon2); for (let y = wy0 + 1; y <= wy1; y++) { put(bx, y, neon2); put(bx + 1, y, neon2); } put(bx + 2, wy0 + 1, neon2 + "55"); }
  const [dx, dy, , dyb] = g.door;
  p.rect(dx, dy, dx + 2, dyb, shade(WOOD, -0.25)); p.set(dx + 1, dy + 1, "#f0c86099"); p.set(dx + 2, dyb - 2, GOLD);
  p.rect(18, 13, 19, 15, METAL); p.rect(18, 14, 19, 14, shade(METAL, -0.35)); p.set(18, 13, shade(METAL, 0.3)); // the keg
  p.rect(0, 16, 19, 16, ASPHALT);
  return p;
}

const BOTTLES = ["#3f6b3a", "#a8642a", "#c9e2ec", "#7a1c2a", "#d9a520", "#5f9e8a"];
function paintLiquor(arg) {
  const L = lookOf(arg) || firstLook("liquor"), p = painter(20, 17);
  // Liquor store: the chain's front, the window lined with bottles on shelves (green, amber, clear, red), bars over
  // it for the flat fronts, a bottle on the sign, cases stacked by the door.
  const g = shopFront(p, L, 1, 17, 15);
  const [wx0, wy0, wx1, wy1] = g.win, put = clipTo(p, g.win);
  for (let sy = wy1; sy >= wy0 + 1; sy -= 3) {
    for (let x = wx0; x <= wx1; x++) put(x, sy, WOOD);
    for (let x = wx0, i = 0; x <= wx1; x += 2, i++) { const c = BOTTLES[(i + sy) % BOTTLES.length]; put(x, sy - 1, c); put(x, sy - 2, shade(c, 0.3)); }
  }
  if (g.s === 0 || g.s === 2) for (let x = wx0 + 1; x <= wx1; x += 3) for (let y = wy0; y <= wy1; y++) put(x, y, "#2a2a2a");
  const [ix, iy] = signIcon(p, L, g, 3, 3); bottleIcon(p, ix, iy, lum(L.text) > 150 ? "#3f6b3a" : L.text);
  crate(p, 18, 12, 2, 2, "#8a6838"); crate(p, 18, 14, 2, 2, WOOD_LIT);                         // the cases
  p.rect(0, 16, 19, 16, ASPHALT);
  return p;
}

// ---------- the office buildings (sim/data-offices.js, issue #27), each painted in its firm's look ----------
// The emblem on a storefront's or a station's sign (look.icon), 5 × 3 at (x, y).
function officeIcon(p, x, y, icon, c) {
  if (icon === "scales") { p.rect(x + 2, y, x + 2, y + 2, c); p.rect(x, y, x + 4, y, c); p.set(x, y + 1, c); p.set(x + 4, y + 1, c); p.rect(x + 1, y + 2, x + 3, y + 2, c); }
  else if (icon === "house") { p.set(x + 2, y, c); p.rect(x + 1, y + 1, x + 3, y + 1, c); p.rect(x, y + 2, x + 4, y + 2, c); p.clear(x + 2, y + 2); }
  else if (icon === "plane") { p.rect(x, y + 1, x + 4, y + 1, c); p.set(x + 2, y, c); p.set(x + 2, y + 2, c); p.set(x + 4, y, c); }
  else if (icon === "tooth") { p.rect(x + 1, y, x + 3, y + 1, WHITE); p.set(x + 1, y + 2, WHITE); p.set(x + 3, y + 2, WHITE); }
  else if (icon === "cross") plus(p, x + 2, y + 1, 1, 1, GREEN_CROSS);
  else if (icon === "tv") { p.rect(x, y, x + 4, y + 2, c); p.rect(x + 1, y + 1, x + 3, y + 1, NEON_CYAN); }
  else if (icon === "radio") { p.rect(x + 2, y, x + 2, y + 2, c); p.set(x + 1, y + 2, c); p.set(x + 3, y + 2, c); p.set(x, y, NEON_CYAN); p.set(x + 4, y, NEON_CYAN); }
  else if (icon === "paper") { p.rect(x, y, x + 4, y + 2, WHITE); p.rect(x + 1, y + 1, x + 3, y + 1, "#5d6168"); }
  else { p.rect(x, y + 1, x + 4, y + 2, c); p.rect(x + 1, y, x + 3, y, c); p.set(x + 2, y + 1, GOLD); } // a briefcase
}
// A storefront office: the firm's front with its emblem on the sign, blinds in the window (a dentist's, a doctor's
// white ones), a bench by the door.
function paintStorefront(arg) {
  const L = lookOf(arg) || firstLook("storefront"), p = painter(20, 17);
  const g = shopFront(p, L, 1, 18, 15);
  const [ix, iy] = signIcon(p, L, g, 5, 3);
  officeIcon(p, ix, iy, L.icon, lum(L.text) > 150 ? L.text : shade(L.text, 0.4));
  const put = clipTo(p, g.win), [wx0, wy0, wx1, wy1] = g.win;
  for (let y = wy0 + 1; y <= wy1; y += 2) for (let x = wx0; x <= wx1; x++) put(x, y, L.icon === "tooth" || L.icon === "cross" ? shade(WHITE, -0.1) : shade(L.wall, -0.15)); // the blinds
  p.rect(0, 16, 19, 16, ASPHALT);
  return p;
}
// A business park's low-rise: a long two-storey block of ribbon windows in the firm's trim, a glass entrance under its
// name, a lot of parked cars.
function paintBizpark(arg) {
  const L = lookOf(arg) || firstLook("bizpark"), p = painter(24, 18);
  block(p, 1, 4, 22, 12, L.wall);
  for (const y of [6, 9]) { p.rect(2, y, 21, y + 1, GLASS_BLUE); p.rect(2, y, 21, y, GLASS_LIT); for (let x = 5; x <= 20; x += 4) p.rect(x, y, x, y + 1, L.trim); }
  glassFront(p, L, 9, 5, 14, 12, 3);
  signBoard(p, L, 8, 2, 15, 3);
  p.rect(1, 12, 22, 12, L.accent);
  p.rect(0, 13, 23, 17, ASPHALT);
  for (let x = 1; x <= 21; x += 5) p.rect(x, 13, x, 14, WHITE);
  car(p, 2, 13, L.accent); car(p, 14, 13, "#5d6168");
  return p;
}
// A corporate tower: a tall glass shaft in the firm's colours, its floors' bands, the name on a crown (a board on the
// roof, or a band), a lit lobby at its foot.
function paintTower(L) {
  const p = painter(22, 22), glass = L.wall, s = L.style | 0;
  p.rect(10, 0, 10, 2, METAL); p.set(10, 0, RED);
  block(p, 5, 3, 16, 20, glass);
  for (let y = 5; y <= 19; y += 2) p.rect(6, y, 15, y, shade(glass, -0.3));
  for (let x = 8; x <= 15; x += 3) p.rect(x, 4, x, 19, L.trim);
  for (let i = 0; i < 6; i++) p.set(6 + i, 18 - i * 2, GLASS_LIT);
  if (s === 1) roofSign(p, L, 4, 0, 9, 1, 3); else { p.rect(5, 3, 16, 4, L.sign); signText(p, 6, 15, 4, L.text, L); }
  block(p, 16, 12, 20, 20, shade(glass, -0.15)); windows(p, 17, 14, 19, 19, 2, 2, DARK_WIN);
  block(p, 1, 15, 5, 20, shade(L.trim, 0.2)); windows(p, 2, 17, 4, 19, 2, 2, DARK_WIN);
  p.rect(9, 18, 12, 20, GLASS_LIT); p.rect(9, 17, 12, 17, L.accent);
  p.rect(0, 21, 21, 21, ASPHALT);
  return p;
}
// City hall: a pale civic block with a clock tower over the door, columns, steps, a flagpole.
function paintCityHall(arg) {
  const L = lookOf(arg) || firstLook("cityhall"), p = painter(24, 20);
  block(p, 1, 9, 22, 17, L.wall);
  windows(p, 2, 11, 7, 15, 2, 3, DARK_WIN, 1, 2); windows(p, 16, 11, 21, 15, 2, 3, DARK_WIN, 1, 2);
  block(p, 9, 3, 14, 17, shade(L.wall, 0.08)); p.rect(10, 0, 13, 2, L.trim); p.rect(11, 0, 12, 0, shade(L.trim, 0.3));
  for (const [x, y] of [[11, 5], [12, 5], [11, 6], [12, 6]]) p.set(x, y, WHITE); p.set(12, 5, OUTLINE); p.set(11, 6, OUTLINE); // the clock
  p.rect(9, 8, 14, 8, L.sign); signText(p, 10, 13, 8, L.text, L);
  for (const x of [9, 11, 13]) p.rect(x, 10, x, 16, shade(L.trim, 0.3));
  p.rect(10, 13, 13, 16, L.accent);
  p.rect(7, 17, 16, 17, STONE); p.rect(6, 18, 17, 18, shade(STONE, -0.15)); p.rect(0, 19, 23, 19, GRASS);
  p.rect(20, 3, 20, 9, METAL); p.rect(21, 3, 22, 4, RED); p.set(21, 3, WHITE);
  return p;
}
// The courthouse: a pediment on columns over wide steps, the scales of justice in the pediment, two wings.
function paintCourthouse(arg) {
  const L = lookOf(arg) || firstLook("courthouse"), p = painter(24, 18), col = shade(L.wall, 0.2);
  block(p, 1, 6, 22, 14, L.wall);
  for (const [y, x0, x1] of [[1, 11, 12], [2, 9, 14], [3, 7, 16], [4, 5, 18], [5, 4, 19]]) p.rect(x0, y, x1, y, y === 1 ? shade(L.trim, 0.3) : L.trim);
  officeIcon(p, 9, 2, "scales", GOLD);
  p.rect(4, 6, 19, 6, L.sign); signText(p, 6, 17, 6, L.text, L);
  p.rect(5, 7, 18, 13, shade(L.wall, -0.35));
  for (const x of [5, 8, 11, 12, 15, 18]) { p.rect(x, 7, x, 13, col); p.set(x, 7, shade(col, 0.3)); }
  p.rect(10, 10, 13, 13, L.accent);
  windows(p, 2, 8, 3, 12, 2, 2, DARK_WIN, 1, 2); windows(p, 20, 8, 21, 12, 2, 2, DARK_WIN, 1, 2);
  p.rect(4, 14, 19, 14, STONE); p.rect(3, 15, 20, 15, shade(STONE, -0.1)); p.rect(2, 16, 21, 16, shade(STONE, -0.2)); p.rect(0, 17, 23, 17, GRASS);
  return p;
}
// A call center: a wide low box with long ribbon windows, its name on a roof board or a band, a dish on the roof, cars.
function paintCallCenter(arg) {
  const L = lookOf(arg) || firstLook("callcenter"), p = painter(24, 17);
  block(p, 1, 5, 22, 12, L.wall);
  for (const y of [7, 10]) { p.rect(2, y, 21, y, DARK_WIN); for (let x = 3; x <= 21; x += 4) p.set(x, y, LIT_WIN); }
  if ((L.style | 0) === 1) roofSign(p, L, 4, 0, 12, 2, 5); else { p.rect(1, 5, 22, 6, L.sign); signText(p, 3, 20, 6, L.text, L); }
  dish(p, 18, 4);
  glassFront(p, L, 10, 9, 13, 12, 2);
  p.rect(0, 13, 23, 16, ASPHALT); car(p, 1, 12, L.accent); car(p, 15, 12, "#7d848c");
  return p;
}
// A tech office: a glass box with a bright accent stripe, the logo on its corner, a roof deck with a plant.
function paintTechOffice(arg) {
  const L = lookOf(arg) || firstLook("techoffice"), p = painter(20, 19);
  block(p, 2, 4, 17, 17, L.wall);
  glassFront(p, L, 3, 6, 16, 16, 3);
  p.rect(2, 11, 17, 11, L.accent);
  signBoard(p, L, 3, 4, 12, 5);
  p.rect(14, 2, 17, 3, L.accent); p.set(15, 1, GRASS); p.set(16, 1, shade(GRASS, 0.2)); // the roof deck's planter
  p.rect(0, 18, 19, 18, ASPHALT);
  return p;
}
// A station: the newsroom's block in the station's colours, its emblem on the sign, and a mast of red and white
// beside it (a TV's or a radio's); the paper's a roof sign over a loading door.
function paintStation(arg) {
  const L = lookOf(arg) || firstLook("station"), p = painter(22, 22);
  block(p, 1, 10, 15, 20, L.wall);
  windows(p, 2, 13, 14, 15, 3, 2, DARK_WIN, 2, 1);
  signBoard(p, L, 2, 10, 14, 11);
  officeIcon(p, 3, 7, L.icon, L.accent);
  p.rect(6, 17, 8, 20, L.accent);
  if (L.icon === "paper") { p.rect(10, 17, 14, 20, shade(L.wall, -0.4)); for (let y = 17; y <= 20; y += 1) p.rect(10, y, 14, y, y % 2 ? shade(L.wall, -0.5) : shade(L.wall, -0.35)); }
  else {
    for (let y = 1; y <= 20; y++) { p.set(18, y, Math.floor(y / 3) % 2 ? WHITE : RED); if (y % 4 === 0) { p.set(17, y, METAL); p.set(19, y, METAL); } }
    p.set(18, 0, SIREN_RED);
    if (L.icon === "tv") dish(p, 13, 9);
  }
  p.rect(0, 21, 21, 21, ASPHALT);
  return p;
}

// Type → painter; the variant (a franchise's id for the kinds with franchises, else only "depot") and picked-over fading are applied by poiSpriteCanvas.
const POI_PAINT = {
  city: paintCityCenter, town: paintTownCenter, police: paintPolice, hospital: paintHospital, pharmacy: paintPharmacy,
  supermarket: paintSupermarket, gunstore: paintGunStore, hardware: paintHardware, autoshop: paintAutoShop, apartments: paintApartments,
  office: paintOffice, school: paintSchool, firestation: paintFireStation, warehouse: paintWarehouse, mall: paintMall, univ: paintUniversity,
  grocery: paintGrocery, clinic: paintClinic, gas: paintGas, diner: paintDiner, motel: paintMotel, church: paintChurch, feedstore: paintFeedStore,
  farm: paintFarm, barn: paintBarn, ranch: paintRanch, cabin: paintCabin, lodge: paintLodge, campground: paintCampground, ranger: paintRanger,
  radiotower: paintRadioTower, truckstop: paintTruckStop, quarry: paintQuarry, crashsite: paintCrashSite,
  dam: paintDam, airport: paintAirport, airbase: paintAirBase, factory: paintFactory, prison: paintPrison, military: paintMilitarySite,
  crash_mil: () => paintHeliWreck(OLIVE, shade(OLIVE, -0.3), "star"), crash_med: () => paintHeliWreck(WHITE, RED, "cross"),
  crash_news: () => paintHeliWreck("#3d6fb0", "#e8c04a", "stripe"), crash_cargo: paintCargoWreck, airdrop: paintAirDrop,
  convoy: paintConvoySite, // sim/miltrucks.js: the abandoned Army convoy
  military_hive: paintInfestedBase, bunker_mil: () => paintMilitarySite(true), // sim/crashstart.js: Crashlanding's overrun Guard base (loc.look "hivebase", ui/render.js siteLook) and the unit's mountain bunker
  // Points of interest (sim/pois.js): the small places a tile holds besides its site.
  house: paintHouse, neighbourhood: paintNeighbourhood, garage: paintGarage, corner: paintCorner, pizza: paintPizza,
  farmstand: paintFarmstand, shed: paintShed, blind: paintBlind, campsite: paintCampsite, hikercamp: paintHikercamp, mineshack: paintMineshack, bunker: () => paintBunkerPortal(false), govbunker: () => paintBunkerPortal(true), shelter: paintFalloutShelter, prepper: paintPrepper, // bunkers (issue #26)
  pawnshop: paintPawnShop, // sim/shops.js
  // The shops and services (sim/data-shops.js NEW_KINDS), each painted in its franchise's look.
  sportshop: paintSportShop, electronics: paintElectronics, radioshop: paintRadioShop, bookstore: paintBookstore, library: paintLibrary,
  petstore: paintPetStore, garden: paintGarden, clothing: paintClothing, vet: paintVet, dealer: paintDealer, restaurant: paintRestaurant,
  bank: paintBank, bar: paintBar, liquor: paintLiquor,
  // The office buildings (sim/data-offices.js, issue #27); the office tower's firms: paintOffice's look.
  storefront: paintStorefront, bizpark: paintBizpark, cityhall: paintCityHall, courthouse: paintCourthouse, callcenter: paintCallCenter,
  techoffice: paintTechOffice, station: paintStation,
};

// A kind with no painter of its own (a point of interest added without one, pois.js): a plain small building on a
// plate, so the map draws something readable until its sprite is painted.
function paintGenericPoi() {
  const p = painter(18, 15);
  const wall = "#9a8f80", roof = "#5c5650";
  for (let r = 0; r < 3; r++) p.rect(4 + 2 - r, 4 + r, 13 - 2 + r, 4 + r, r === 0 ? shade(roof, 0.25) : shade(roof, -0.1 * r));
  p.rect(3, 7, 14, 7, shade(roof, -0.3));
  p.rect(4, 8, 13, 14, wall);
  p.rect(4, 8, 4, 14, shade(wall, 0.15)); p.rect(13, 8, 13, 14, shade(wall, -0.2));
  p.rect(8, 11, 9, 14, shade(wall, -0.55));
  p.rect(5, 9, 6, 10, DARK_WIN); p.rect(11, 9, 12, 10, DARK_WIN);
  return p;
}

// Grays a painter's colors (keeping see-through pixels see-through): picked-over sites.
function fade(p, f = 0.7, dark = 0.18) {
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const v = p.get(x, y);
    if (!v) continue;
    const [r, g, b] = rgb(v), l = r * 0.3 + g * 0.59 + b * 0.11, k = 1 - dark;
    p.set(x, y, toHex((r + (l - r) * f) * k, (g + (l - g) * f) * k, (b + (l - b) * f) * k) + (v.length > 7 ? v.slice(7) : ""));
  }
  return p;
}

// Danger pip: a skull, 7 x 7 on a 9 x 9 grid so it gets a dark outline all round and reads on any ground.
function paintSkull() {
  const p = painter(9, 9);
  const lit = shade(BONE, 0.3), dark = shade(BONE, -0.55);
  p.rect(2, 1, 6, 1, BONE); p.rect(1, 2, 7, 5, BONE); p.rect(2, 6, 6, 7, BONE);   // cranium, cheekbones, jaw
  p.rect(2, 1, 4, 1, lit); p.set(1, 2, lit); p.set(2, 2, lit);                      // light on the crown
  p.rect(2, 3, 3, 4, OUTLINE); p.rect(5, 3, 6, 4, OUTLINE);                         // eye sockets
  p.set(4, 5, dark);                                                                // nose
  p.set(3, 7, dark); p.set(5, 7, dark);                                             // gaps between the teeth
  p.set(1, 5, shade(BONE, -0.2)); p.set(7, 5, shade(BONE, -0.2));
  return p;
}

// ---------- the dead: hordes and hives ----------
// Skin and rags follow the zombie look settings (sprites.js): palette and eye glow.
const ZSKIN = { rotten: ["#8ea36b", "#7f9a62", "#9aa877"], ashen: ["#a7a69b", "#8f8e86", "#b5b2a5"], pale: ["#9fb0b5", "#8fa3aa", "#b4c2c4"], burnt: ["#6b5446", "#5c463a", "#7a6152"] };
const ZRAGS = ["#56606e", "#6a4a3a", "#55603f", "#6d6f73", "#7a3b32", "#45454a", "#8a7a5a", "#45606b"];
const ZEYES = { glow: "#e8e07a", red: "#e2412f", dead: null };

// One shambling zombie, 7 wide and 11 tall, top-left at (x, y), reaching to the right. i varies the pose.
function shambler(p, x, y, skin, rag, eye, i) {
  const lean = i % 3 === 1 ? 1 : 0, pants = shade(rag, -0.45);
  p.rect(x + 1, y + 7, x + 1, y + 10, pants);                      // shuffling legs
  p.rect(x + 3, y + 7, x + 3, y + 9, pants); p.set(x + 4, y + 10, pants);
  p.rect(x + 1, y + 2, x + 3, y + 6, rag);                          // torn torso
  p.set(x + 1, y + 6, shade(rag, -0.3));
  if (i % 2) p.clear(x + 3, y + 6); else p.set(x + 2, y + 4, shade(skin, -0.1));
  if (i % 4 === 2) p.set(x + 2, y + 3, BLOOD);
  p.rect(x + 2 + lean, y, x + 3 + lean, y + 1, skin);              // head, tipped forward on some
  p.set(x + 2 + lean, y, shade(skin, -0.35));
  p.set(x + 3 + lean, y + 1, shade(skin, -0.45));                  // gaping mouth
  if (eye) p.set(x + 3 + lean, y, eye);
  p.set(x + 4, y + 3, rag); p.rect(x + 5, y + 3, x + 6, y + 3, skin); // arms reaching out
  if (i % 3 === 2) p.set(x + 1, y + 5, skin);                      // one arm hanging
  else p.rect(x + 4, y + 4, x + 5, y + 4, shade(skin, -0.15));
}

// Paints onto p through a fresh layer, outlining the new pixels where they overlap what is already there (so
// figures in a crowd stay apart).
function layer(p, paint) {
  const q = painter(p.w, p.h);
  paint(q);
  const solid = (x, y) => { const v = q.get(x, y); return !!v && v.length <= 7; };
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (solid(x, y) || !p.get(x, y)) continue;
    if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) p.set(x, y, OUTLINE);
  }
  blit(p, q, 0, 0);
}

// A crowd of the dead: n figures (2–7) in two staggered rows, the front row lower.
function paintHorde(n, look = {}) {
  const front = Math.ceil(n / 2), back = n - front;
  const p = painter(Math.max(front * 6, back * 6 + 3) + 2, 15);
  const pals = look.palette && ZSKIN[look.palette] ? [ZSKIN[look.palette]] : [ZSKIN.rotten, ZSKIN.ashen, ZSKIN.pale, ZSKIN.rotten];
  const eye = look.eyes in ZEYES ? ZEYES[look.eyes] : ZEYES.glow;
  const fig = (k, x, y) => layer(p, (q) => {
    const pal = pals[(k * 3) % pals.length];
    shambler(q, x, y, pal[k % pal.length], ZRAGS[(k * 5 + 2) % ZRAGS.length], eye, k);
  });
  for (let i = 0; i < back; i++) fig(i * 2 + 1, 3 + i * 6, 0);
  for (let i = 0; i < front; i++) fig(i * 2, i * 6, 4);
  return p;
}

// A hive: a festering mound of bodies over a dark pool, pods glowing, bones sticking out. level 0–2 by how
// infected the ground is (bigger, redder, more pods).
function paintHive(level = 0) {
  const p = painter(28, 18);
  const POOL = "#2a1018", POOL_LIT = "#4a1a28", VEIN = "#8a1c22", POD = "#ff5a3a", POD_HOT = "#ffb43b";
  // The pool, with veins running out of the mound.
  const prx = 10 + level * 1.6, pry = 3 + level * 0.4;
  for (let y = 11; y <= 17; y++) for (let x = 0; x < 28; x++) {
    const d = ((x + 0.5 - 14) / prx) ** 2 + ((y + 0.5 - 14) / pry) ** 2;
    if (d <= 1) p.set(x, y, d > 0.6 ? POOL_LIT : POOL);
  }
  for (const [dx, dy] of [[-1, 0], [1, 0], [-0.8, 0.5], [0.8, 0.5], [-0.4, 0.9], [0.4, 0.9]]) {
    for (let t = 3; t < prx - 1; t++) { const x = Math.round(14 + dx * t), y = Math.round(14 + dy * t * pry / prx); if (p.get(x, y)) p.set(x, y, (t + level) % 4 ? VEIN : shade(VEIN, 0.3)); }
  }
  // The mound.
  const h = 8 + level * 2, hw = 6 + level;
  for (let r = 0; r < h; r++) {
    const y = 14 - r, t = r / h, w = Math.round(hw * Math.sqrt(1 - t * t)) - ((r * 7) % 3 === 0 ? 1 : 0);
    if (w < 0) continue;
    p.rect(14 - w, y, 13 + w, y, r > h * 0.6 ? shade(FLESH, 0.3) : r > h * 0.3 ? FLESH : shade(FLESH, -0.25));
  }
  for (let i = 0; i < 4 + level * 2; i++) {                        // ridges of bodies
    const x = 14 - hw + 2 + ((i * 5) % (hw * 2 - 3)), y = 14 - 1 - ((i * 3) % (h - 3));
    if (p.get(x, y) && p.get(x + 1, y)) { p.set(x, y, shade(FLESH, 0.45)); p.set(x + 1, y, shade(FLESH, 0.2)); }
  }
  // Bones: ribs arching out of one flank, a long bone, an arm reaching up from the top, a skull in the pool.
  const rx = 14 - hw;
  for (let i = 0; i < 3; i++) { const y = 12 - i * 2; p.set(rx, y, BONE); p.set(rx + 1, y - 1, BONE); p.set(rx + 2, y - 1, BONE); p.set(rx + 3, y, shade(BONE, -0.2)); }
  for (let i = 0; i < 4; i++) p.set(17 + level + i, 12 - i, i % 3 ? shade(BONE, -0.1) : BONE);
  p.rect(15, 14 - h - 2, 15, 14 - h + 1, BONE); p.set(16, 14 - h - 2, BONE); p.set(14, 14 - h - 1, BONE); p.set(16, 14 - h - 3, BONE);
  const sx = 19 + level, sy = 13;                                  // skull
  p.rect(sx, sy, sx + 2, sy + 1, BONE); p.set(sx, sy, OUTLINE); p.set(sx + 2, sy, OUTLINE); p.set(sx + 1, sy - 1, BONE); p.set(sx, sy - 1, BONE); p.set(sx + 2, sy - 1, BONE);
  p.set(sx, sy + 2, BONE); p.set(sx + 2, sy + 2, BONE);
  // Glowing pods.
  const pods = [[11, 11], [17, 10], [14, 8], [10, 13], [16, 13], [13, 5], [16, 6], [12, 9]].slice(0, 3 + level * 2 + (level === 2 ? 1 : 0));
  for (const [x, y] of pods) {
    if (!p.get(x, y)) continue;
    p.set(x, y, POD); p.set(x + 1, y, level ? POD_HOT : POD); p.set(x, y - 1, shade(POD, -0.3));
    if (level >= 1) { p.set(x - 1, y, "#ff3a3066"); p.set(x + 2, y, "#ff3a3066"); }
  }
  if (level === 2) for (const [x, y] of [[8, 4], [20, 3], [6, 9], [23, 8]]) p.set(x, y, "#ff3a3044");
  return p;
}

// ---------- other groups' parties ----------
// Groups send convoys (by vehicle between their bases, or on foot when no road leads there) and raids (on foot,
// besieging their target when they arrive). Each group type has its own look; clothes, banners or paint carry the
// group's color.

// One person, 5 wide and 11 tall, top-left at (x, y), facing right. o: { cloth, pants, skin, hat ("helmet" |
// "mohawk" | "hood" | "straw" | "cap"), hatColor, robe, pack, band (patch color), arm ("rifle" | "raised" | "spear" |
// "fork" | "torch" | "banner" | "shield" | "binoc"), armColor }.
function person(p, x, y, o) {
  const cloth = o.cloth, skin = o.skin || SKIN, pants = o.pants || PANTS;
  if (o.robe) {
    p.rect(x + 1, y + 2, x + 3, y + 9, cloth); p.rect(x, y + 7, x + 4, y + 10, cloth);
    p.rect(x, y + 10, x + 4, y + 10, shade(cloth, -0.35)); p.rect(x + 1, y + 3, x + 1, y + 8, shade(cloth, -0.18));
  } else {
    p.rect(x + 1, y + 7, x + 1, y + 10, pants);
    p.rect(x + 3, y + 7, x + 3, y + 9, pants); p.set(x + 4, y + 10, pants);
    p.rect(x + 1, y + 2, x + 3, y + 6, cloth);
    p.set(x + 1, y + 6, shade(cloth, -0.35));
  }
  if (o.band) p.set(x + 1, y + 3, o.band);
  if (o.pack) { p.rect(x, y + 2, x, y + 5, PACK); p.set(x, y + 2, shade(PACK, 0.25)); }
  p.rect(x + 2, y, x + 3, y + 1, skin);
  const hc = o.hatColor || cloth;
  if (o.hat === "helmet") { p.rect(x + 2, y - 1, x + 3, y - 1, hc); p.rect(x + 1, y, x + 4, y, hc); p.set(x + 4, y, shade(hc, -0.3)); }
  else if (o.hat === "mohawk") { p.set(x + 2, y, shade(skin, -0.25)); p.rect(x + 2, y - 2, x + 2, y - 1, hc); p.set(x + 3, y - 1, hc); }
  else if (o.hat === "hood") { p.rect(x + 2, y - 1, x + 3, y - 1, hc); p.rect(x + 1, y, x + 3, y, hc); p.rect(x + 1, y + 1, x + 2, y + 1, hc); p.set(x + 3, y + 1, shade(skin, -0.5)); }
  else if (o.hat === "straw") { p.rect(x + 1, y - 1, x + 4, y - 1, HAY); p.rect(x + 2, y - 2, x + 3, y - 2, shade(HAY, 0.2)); }
  else if (o.hat === "cap") { p.rect(x + 2, y - 1, x + 3, y - 1, hc); p.set(x + 4, y - 1, shade(hc, -0.3)); }
  const metal = "#3a3a3a", ac = o.armColor || cloth;
  switch (o.arm) {
    case "rifle": p.rect(x + 3, y + 4, x + 7, y + 4, metal); p.set(x + 4, y + 4, skin); p.set(x + 3, y + 5, metal); break;
    case "raised": p.set(x + 4, y + 3, skin); p.set(x + 5, y + 2, metal); p.set(x + 6, y + 1, metal); p.set(x + 7, y, metal); break;
    case "spear": p.set(x + 4, y + 4, skin); p.rect(x + 5, y - 3, x + 5, y + 9, WOOD); p.set(x + 5, y - 4, STEEL); p.set(x + 5, y - 3, STEEL); break;
    case "fork": p.set(x + 4, y + 4, skin); p.rect(x + 5, y - 2, x + 5, y + 9, WOOD); p.rect(x + 4, y - 3, x + 6, y - 3, METAL); p.set(x + 4, y - 4, METAL); p.set(x + 6, y - 4, METAL); p.set(x + 5, y - 4, METAL); break;
    case "torch": p.set(x + 4, y + 4, skin); p.rect(x + 5, y, x + 5, y + 5, WOOD); p.set(x + 5, y - 1, FIRE); p.set(x + 5, y - 2, FIRE_HOT); p.set(x + 4, y - 1, FIRE_RED); p.set(x + 6, y - 2, GLOW); p.set(x + 4, y - 3, GLOW); break;
    case "banner": p.set(x + 4, y + 4, skin); p.rect(x + 5, y - 6, x + 5, y + 9, WOOD); p.rect(x + 6, y - 6, x + 9, y - 2, ac); p.rect(x + 6, y - 2, x + 9, y - 2, shade(ac, -0.3)); p.set(x + 7, y - 4, GOLD); p.set(x + 8, y - 4, GOLD); break;
    case "shield": p.rect(x + 4, y + 2, x + 6, y + 7, ac); p.rect(x + 4, y + 2, x + 6, y + 2, shade(ac, 0.3)); p.set(x + 5, y + 4, STEEL); break;
    case "binoc": p.rect(x + 3, y + 1, x + 4, y + 1, "#2a2a2e"); p.set(x + 4, y + 2, skin); break;
    case "staff": p.set(x + 4, y + 6, skin); p.rect(x + 5, y, x + 5, y + 12, WOOD); p.set(x + 5, y - 1, shade(WOOD, 0.3)); break; // a walking stick
    case "bar": p.set(x + 4, y + 4, skin); p.rect(x + 5, y + 1, x + 5, y + 6, METAL); p.set(x + 6, y + 1, METAL); p.set(x + 4, y + 6, METAL); break; // a crowbar
    default: p.set(x + 4, y + 4, skin);
  }
}

// Motorbike with a rider, 11 wide and 11 tall, top-left at (x, y).
function biker(p, x, y, color, hair) {
  const bike = "#2a2a2e";
  for (const wx of [x, x + 8]) { p.rect(wx, y + 8, wx + 2, y + 10, TIRE); p.set(wx + 1, y + 9, HUB); }
  p.rect(x + 2, y + 8, x + 8, y + 8, bike); p.rect(x + 3, y + 7, x + 7, y + 7, color); p.rect(x + 4, y + 6, x + 6, y + 6, shade(color, 0.25));
  p.set(x + 8, y + 6, STEEL); p.set(x + 9, y + 5, STEEL); p.set(x + 1, y + 9, STEEL); p.set(x, y + 7, STEEL); // bars, exhaust
  p.rect(x + 3, y + 2, x + 5, y + 5, "#3a3028"); p.set(x + 6, y + 3, SKIN); p.set(x + 7, y + 4, SKIN);           // leather jacket
  p.rect(x + 4, y, x + 5, y + 1, SKIN); p.rect(x + 4, y - 2, x + 4, y - 1, hair); p.set(x + 5, y - 1, hair); p.set(x + 4, y, shade(SKIN, -0.25));
  p.set(x + 3, y + 6, PANTS); p.set(x + 4, y + 7, PANTS);
}

// Generic pickup in a body color with an open bed (cargo painted by the caller).
function pickup(p, x, y, body) {
  const dark = shade(body, -0.35), lit = shade(body, 0.25);
  p.rect(x + 1, y + 6, x + 20, y + 9, body); p.rect(x + 1, y + 9, x + 20, y + 9, dark);
  p.rect(x + 1, y + 6, x + 11, y + 6, lit);
  p.rect(x + 12, y + 2, x + 16, y + 6, body); p.rect(x + 12, y + 2, x + 16, y + 2, lit);
  p.rect(x + 14, y + 3, x + 16, y + 5, GLASS);
  p.rect(x + 17, y + 5, x + 20, y + 6, body); p.set(x + 20, y + 7, "#ffe28a"); p.set(x + 1, y + 7, "#d24a3a");
  wheel(p, x + 3, y + 9); wheel(p, x + 15, y + 9);
}

// Spiked pickup with scrap plating and a pipe cage over the bed; a mohawk at the wheel.
function paintRaiderTruck(c) {
  const p = painter(24, 13);
  pickup(p, 0, 0, c);
  for (const [x0, x1] of [[3, 6], [8, 10], [13, 16]]) { p.rect(x0, 7, x1, 8, RUST); p.set(x0, 7, shade(RUST, 0.3)); p.set(x1, 8, OUTLINE); }
  for (let x = 1; x <= 11; x += 3) p.rect(x, 2, x, 5, METAL);
  p.rect(1, 2, 11, 2, METAL);
  p.rect(5, 4, 8, 5, "#5a4a3a");
  p.rect(14, 3, 15, 5, "#2a2a2e"); p.set(15, 2, c === RED ? GOLD : RED);
  for (const y of [6, 8]) { p.set(21, y, BONE); p.set(22, y, BONE); p.set(23, y, BONE); }
  p.set(21, 7, METAL); p.set(22, 7, METAL);
  return p;
}

// Humvee: a wide, low olive truck with a roof gun; a pennant in the group's color.
function paintHumvee(c) {
  const p = painter(24, 14);
  humvee(p, c);
  return p;
}
// A painter that draws everything shifted by (ox, oy) into another (a vehicle beside a wagon in one sprite).
function shifted(p, ox, oy) {
  return { w: p.w, h: p.h, set: (x, y, c) => p.set(x + ox, y + oy, c), get: (x, y) => p.get(x + ox, y + oy), rect: (x0, y0, x1, y1, c) => p.rect(x0 + ox, y0 + oy, x1 + ox, y1 + oy, c), clear: (x, y) => p.clear(x + ox, y + oy) };
}
function humvee(p, c) {
  const body = OLIVE, dark = shade(OLIVE, -0.35);
  p.rect(1, 6, 21, 10, body); p.rect(1, 10, 21, 10, dark); p.rect(1, 6, 21, 6, shade(body, 0.2));
  p.rect(6, 3, 16, 6, body); p.rect(6, 3, 16, 3, shade(body, 0.25));
  p.rect(13, 4, 16, 5, GLASS); p.rect(8, 4, 11, 5, shade(GLASS, -0.35));
  p.rect(17, 5, 21, 6, shade(body, 0.1)); p.set(21, 8, "#ffe28a");
  p.rect(9, 1, 11, 2, dark); p.rect(11, 1, 16, 1, "#3a3a3a");      // roof gun
  p.rect(3, 0, 3, 5, METAL); p.rect(4, 0, 6, 1, c);                 // antenna pennant
  p.set(4, 8, c); p.set(5, 8, c);
  for (const wx of [3, 15]) { p.rect(wx, 9, wx + 4, 13, TIRE); p.rect(wx + 1, 10, wx + 3, 12, "#3a3a3c"); p.set(wx + 2, 11, HUB); }
}
// An MRAP: a tall, slab-sided olive truck with a V hull, small armoured windows and a turret on the roof.
function mrap(p, c) {
  const body = OLIVE, dark = shade(OLIVE, -0.35);
  p.rect(1, 4, 22, 11, body); p.rect(1, 4, 22, 4, shade(body, 0.22)); p.rect(1, 11, 22, 11, dark);
  p.rect(3, 12, 20, 12, dark);                                        // the V hull
  p.rect(15, 5, 18, 7, shade(GLASS, -0.3)); p.rect(19, 6, 21, 7, shade(GLASS, -0.3));
  p.rect(7, 2, 11, 3, dark); p.rect(11, 2, 17, 2, "#3a3a3a");        // turret and gun
  p.rect(3, 0, 3, 4, METAL); p.rect(4, 0, 6, 1, c);
  p.set(22, 9, "#ffe28a");
  for (const wx of [3, 16]) { p.rect(wx, 11, wx + 4, 15, TIRE); p.rect(wx + 1, 12, wx + 3, 14, "#3a3a3c"); p.set(wx + 2, 13, HUB); }
}

// Armored truck: riveted steel box with slit windows and a big banner on a pole.
function paintArmoredTruck(c) {
  const p = painter(24, 16);
  p.rect(2, 1, 2, 7, "#9a8a70"); p.rect(3, 1, 9, 5, c); p.rect(3, 5, 9, 5, shade(c, -0.35)); p.rect(5, 2, 7, 4, WHITE); p.rect(6, 2, 6, 4, c);
  p.rect(1, 6, 21, 12, METAL); p.rect(1, 6, 21, 6, shade(METAL, 0.3)); p.rect(1, 12, 21, 12, shade(METAL, -0.35));
  for (let x = 3; x <= 19; x += 4) { p.set(x, 8, shade(METAL, 0.4)); p.set(x, 11, shade(METAL, 0.4)); }
  p.rect(15, 4, 21, 6, shade(METAL, 0.1)); p.rect(17, 5, 20, 5, "#1e2024");
  p.rect(5, 9, 12, 10, c); p.rect(22, 9, 23, 11, "#3a3a3a");
  for (const wx of [3, 9, 16]) wheel(p, wx, 12);
  return p;
}

// Trader caravan: a covered wagon with a stripe in the group's color, pulled by a mule.
function paintWagon(c) {
  const p = painter(26, 14);
  for (let r = 0; r < 3; r++) p.rect(2 + (r === 0 ? 2 : r === 1 ? 1 : 0), 2 + r, 14 - (r === 0 ? 2 : r === 1 ? 1 : 0), 2 + r, r === 0 ? WHITE : "#e2dccb");
  p.rect(2, 5, 14, 7, "#e2dccb"); p.rect(2, 5, 14, 5, c); for (let x = 4; x <= 12; x += 4) p.rect(x, 3, x, 7, "#c8c0aa");
  p.rect(1, 8, 15, 9, WOOD); p.rect(1, 8, 15, 8, WOOD_LIT); crate(p, 0, 5, 3, 3);
  for (const wx of [2, 10]) { p.rect(wx, 9, wx + 4, 13, "#5c4128"); p.rect(wx + 1, 10, wx + 3, 12, "#3a2a1a"); p.set(wx + 2, 11, WOOD_LIT); p.set(wx + 2, 9, WOOD_LIT); p.set(wx, 11, WOOD_LIT); }
  p.rect(16, 8, 18, 8, WOOD);                                        // shaft
  const mule = "#7a5a40";                                            // mule
  p.rect(18, 6, 23, 9, mule); p.rect(18, 6, 23, 6, shade(mule, 0.2)); p.rect(23, 4, 24, 7, mule); p.set(25, 6, mule); p.set(23, 3, mule); p.set(24, 3, mule);
  p.set(24, 5, OUTLINE); p.rect(19, 10, 19, 13, mule); p.rect(22, 10, 22, 13, mule); p.set(18, 7, shade(mule, -0.3));
  p.rect(19, 6, 21, 7, c);                                           // saddle blanket
  return p;
}

// Commune tractor hauling a wagon of hay and produce.
function paintTractor(c) {
  const p = painter(26, 14);
  p.rect(0, 6, 11, 9, WOOD); p.rect(0, 6, 11, 6, WOOD_LIT);         // hay wagon
  p.rect(1, 2, 6, 5, HAY); p.rect(1, 2, 6, 2, shade(HAY, 0.25)); p.rect(7, 4, 10, 5, HAY); p.set(3, 4, shade(HAY, -0.25));
  for (const [x, col] of [[8, RED], [9, CROP_LIT], [10, ORANGE]]) p.set(x, 3, col);
  wheel(p, 2, 9); wheel(p, 7, 9); p.rect(12, 8, 13, 8, METAL);
  // The tractor.
  p.rect(14, 5, 23, 9, c); p.rect(14, 5, 23, 5, shade(c, 0.25)); p.rect(19, 5, 23, 6, shade(c, 0.1));
  p.rect(14, 1, 17, 5, shade(c, -0.1)); p.rect(15, 2, 17, 4, GLASS); p.rect(13, 0, 18, 0, shade(c, -0.3));
  p.rect(21, 2, 21, 4, "#3a3a3a"); p.set(21, 1, SMOKE_FAINT);
  p.rect(13, 8, 18, 13, TIRE); p.rect(14, 9, 17, 12, "#3a3a3c"); p.rect(15, 10, 16, 11, HUB);
  p.rect(21, 10, 24, 13, TIRE); p.rect(22, 11, 23, 12, HUB);
  return p;
}

// Zealot procession cart: a pale cart under a tall banner with the sun sign, torches at the corners.
function paintZealotCart(c) {
  const p = painter(24, 16);
  p.rect(9, 0, 9, 9, WOOD); p.rect(10, 0, 15, 5, c); p.rect(10, 5, 15, 5, shade(c, -0.35)); p.rect(12, 2, 13, 3, GOLD); p.set(11, 2, "#e8c04a88"); p.set(14, 3, "#e8c04a88");
  p.rect(2, 8, 17, 11, "#d8cfb8"); p.rect(2, 8, 17, 8, shade("#d8cfb8", 0.2)); p.rect(2, 11, 17, 11, shade("#d8cfb8", -0.3));
  for (let x = 4; x <= 16; x += 4) p.set(x, 10, c);
  for (const wx of [3, 12]) { p.rect(wx, 11, wx + 3, 14, "#5c4128"); p.rect(wx + 1, 12, wx + 2, 13, WOOD_LIT); }
  for (const tx of [2, 17]) { p.rect(tx, 5, tx, 8, WOOD); p.set(tx, 4, FIRE); p.set(tx, 3, FIRE_HOT); p.set(tx + 1, 3, GLOW); p.set(tx - 1, 4, GLOW); }
  person(p, 18, 4, { cloth: shade(c, -0.2), hat: "hood", robe: true, arm: "none" });
  p.rect(18, 10, 19, 10, WOOD);
  return p;
}

// Fortress supply truck: a box truck in the group's color with a shield crest and sandbags on the roof.
function paintFortressTruck(c) {
  const p = painter(24, 14);
  p.rect(1, 2, 14, 10, shade(STONE, -0.05)); p.rect(1, 2, 14, 2, shade(STONE, 0.25)); p.rect(1, 10, 14, 10, shade(STONE, -0.35));
  for (let y = 4; y <= 9; y += 2) for (let x = 2 + (y % 4 ? 0 : 2); x <= 13; x += 4) p.set(x, y, shade(STONE, -0.2));
  p.rect(6, 3, 9, 7, c); p.rect(7, 8, 8, 8, c); p.rect(7, 4, 8, 6, GOLD);
  p.rect(2, 0, 5, 1, SAND); p.rect(9, 0, 12, 1, SAND);
  p.rect(15, 4, 20, 10, c); p.rect(15, 4, 20, 4, shade(c, 0.25)); p.rect(17, 5, 20, 7, GLASS); p.rect(21, 7, 22, 10, c); p.set(22, 8, "#ffe28a");
  wheel(p, 3, 10); wheel(p, 9, 10); wheel(p, 16, 10);
  return p;
}

// One of a group's people by group type: i is the figure's place in the party (0 leads: the banner, the binoculars);
// raid: weapons raised. The options for person().
function groupLook(type, c, i, raid) {
  switch (type) {
    case "raider": return { cloth: i % 2 ? "#3a3028" : shade(c, -0.25), hat: "mohawk", hatColor: c, band: c, arm: raid ? "raised" : "rifle", pants: "#2a2a30" };
    case "military": return { cloth: OLIVE, pants: OLIVE_DARK, hat: "helmet", hatColor: shade(OLIVE, -0.15), band: c, arm: i === 0 && !raid ? "banner" : "rifle", armColor: c, pack: !raid };
    case "zealot": return { cloth: i === 0 ? shade(c, -0.1) : "#cfc7b4", hat: "hood", hatColor: shade(c, -0.25), robe: true, arm: i === 0 ? "banner" : i === 1 ? "torch" : raid ? "raised" : "none", armColor: c };
    case "expansionist": return { cloth: "#5a6068", pants: "#3a3e44", hat: "helmet", hatColor: c, band: c, arm: i === 0 ? "banner" : raid ? "shield" : "rifle", armColor: c, pack: !raid };
    case "traders": return { cloth: i % 2 ? "#8a7a5a" : shade(c, -0.15), hat: "cap", hatColor: c, pack: true, arm: i === 0 ? "rifle" : "none" };
    case "commune": return { cloth: i % 2 ? "#6a7a9a" : shade(c, -0.1), pants: "#4a5a7a", hat: "straw", arm: i % 2 ? "fork" : raid ? "raised" : "fork", pack: !raid };
    default: return { cloth: shade(c, -0.1), hat: "helmet", hatColor: STONE, arm: i === 0 ? "spear" : "shield", armColor: c }; // fortress militia
  }
}

// The people a group sends on foot, by group type. kind: "raid" (weapons raised) or "walk" (convoys on foot).
function paintGroupWalkers(type, c, n, kind) {
  const raid = kind === "raid", scav = kind === "scav";
  const p = painter(type === "raider" && raid ? 26 : 24, 17);
  // Scavengers (aiscav.js): up to three, packs on, the last one hauling a stuffed sack.
  const slots = (scav ? [[6, 5], [0, 3], [12, 4]] : type === "traders" && !raid ? [[1, 4], [7, 3]] : [[8, 5], [1, 3], [15, 4], [19, 6]]).slice(0, Math.max(1, Math.min(scav ? 3 : 4, n))).sort((a, b) => a[1] - b[1]);
  const look = (i) => groupLook(type, c, i, raid);
  if (type === "raider" && raid) { biker(p, 14, 6, c, c); slots.splice(2); }
  if (scav) {
    slots.forEach(([x, y], i) => person(p, x, y + 2, { ...look(i), pack: true, arm: i === 0 ? "bar" : look(i).arm === "banner" ? "rifle" : look(i).arm }));
    lootSack(p, 18, 8);
    return p;
  }
  if (type === "traders" && !raid) {                                // a pack mule with the walkers
    const mule = "#7a5a40", dark = shade(mule, -0.35);
    p.rect(14, 10, 20, 12, mule); p.rect(14, 12, 20, 12, dark);       // body
    p.rect(20, 7, 21, 10, mule); p.rect(22, 8, 23, 9, mule); p.set(23, 9, dark); p.set(20, 6, mule); p.set(21, 6, dark); // neck, head, ears
    for (const x of [14, 16, 18, 20]) { p.rect(x, 13, x, 15, x % 4 ? mule : dark); p.set(x, 16, OUTLINE); } // legs
    p.set(13, 10, dark); p.set(12, 11, dark);                          // tail
    p.rect(15, 8, 19, 9, "#8c7a52"); p.rect(15, 8, 19, 8, shade("#8c7a52", 0.25)); p.rect(17, 9, 17, 11, c); // packs and strap
    slots.splice(2);
  }
  slots.forEach(([x, y], i) => person(p, x, y + 2, look(i)));
  return p;
}

// A stuffed burlap sack with a pipe and a can sticking out (group scavengers' haul).
function lootSack(p, x, y) {
  const s = "#9a8358", d = shade(s, -0.35), l = shade(s, 0.25);
  p.rect(x + 1, y + 2, x + 4, y + 7, s); p.rect(x, y + 4, x + 5, y + 7, s); p.rect(x, y + 8, x + 5, y + 8, d);
  p.rect(x + 1, y + 2, x + 2, y + 3, l); p.rect(x + 2, y + 1, x + 3, y + 1, d);
  p.rect(x + 4, y - 2, x + 4, y + 1, METAL); p.set(x + 4, y - 3, shade(METAL, 0.3));
  p.rect(x + 1, y - 1, x + 2, y, RUST); p.set(x + 1, y - 1, shade(RUST, 0.3));
}

// Group party sprite: kind "convoy" (vehicle), "raid", "scav" (scavengers with their haul) or "walk" (on foot). type: FACTION_TYPES key.
function paintGroupParty(type, kind, c, n) {
  if (kind !== "convoy") return paintGroupWalkers(type, c, n, kind);
  switch (type) {
    case "raider": return paintRaiderTruck(c);
    case "military": return paintHumvee(c);
    case "expansionist": return paintArmoredTruck(c);
    case "traders": return paintWagon(c);
    case "commune": return paintTractor(c);
    case "zealot": return paintZealotCart(c);
    default: return paintFortressTruck(c);
  }
}

// Siege camp pitched next to a besieged base: tents in the attacker's color, a spiked barricade, a fire, a banner.
function paintSiegeCamp(c) {
  const p = painter(24, 14);
  tent(p, 5, 11, 5, shade(c, -0.1));
  tent(p, 14, 10, 4, shade(c, -0.3));
  flag(p, 20, 0, c, 11, 3);
  campfire(p, 9, 12);
  for (let x = 0; x <= 23; x += 4) { for (let i = 0; i < 3; i++) { p.set(x + i, 13 - i, WOOD_LIT); p.set(x + 2 - i, 13 - i, WOOD); } p.set(x, 10, BONE); p.set(x + 2, 10, BONE); }
  p.rect(0, 13, 23, 13, shade(WOOD, -0.3));
  return p;
}

// ---------- outsiders (sim/visitors.js) ----------
// Raiders from outside the state: dark red rags and hoods, a biker and walkers with weapons up under a ragged
// black-and-red banner. Merchants: a big covered wagon in gold canvas behind two oxen, a guard walking ahead.
// Travellers: grey walkers with bedrolls (scouts with binoculars, refugees with a handcart of bundles, wanderers
// with a walking staff).
const OUT_RED = "#7a1a1a", OUT_GOLD = "#d9a520", OUT_GRAY = "#8a8a86";
function paintOutsiderRaiders(n) {
  const p = painter(n >= 3 ? 33 : 28, 19);
  p.rect(1, 0, 1, 13, WOOD); p.rect(2, 0, 7, 3, "#1a1414"); p.rect(2, 3, 7, 3, OUT_RED); p.set(7, 2, "#1a1414"); p.clear(7, 3); p.set(6, 4, OUT_RED);
  p.set(4, 1, BONE); p.set(5, 1, BONE); p.set(4, 2, BONE);                         // the skull sign on the banner
  biker(p, 16, 7, OUT_RED, "#1a1a1a");
  const slots = [[3, 6], [9, 4], [27, 5]].slice(0, Math.max(1, Math.min(3, n)));
  slots.forEach(([x, y], i) => person(p, x, y + 2, { cloth: i % 2 ? "#2c2420" : shade(OUT_RED, -0.2), hat: "hood", hatColor: shade(OUT_RED, -0.35), band: "#c03030", arm: i === 1 ? "rifle" : "raised", pants: "#24222a" }));
  return p;
}
// The merchants' escort (sim/escorts.js): light, a guard walking ahead; armed, a pickup behind the wagon; armoured, a
// Humvee or an MRAP leading it.
function paintOutsiderMerchants(tier = "", vehicle = "") {
  if (tier === "armed" || tier === "armoured") {
    const p = painter(62, 18);
    wagonAndOxen(shifted(p, 26, 1));
    if (vehicle === "mrap") mrap(p, OUT_GOLD);
    else if (vehicle === "hummer") humvee(shifted(p, 0, 3), OUT_GOLD);
    else pickup(shifted(p, 1, 4), 0, 0, "#5a5a52");
    if (tier === "armoured") person(p, 57, 6, { cloth: "#4d5440", pants: "#34363c", hat: "helmet", hatColor: "#3a4030", arm: "rifle" });
    return p;
  }
  const p = painter(44, 17);
  wagonAndOxen(p);
  person(p, 38, 4, { cloth: "#6a5a3a", pants: "#34363c", hat: "cap", hatColor: "#4a3a2a", arm: "rifle" }); // a guard walking ahead
  return p;
}
function wagonAndOxen(p) {
  // Two oxen in harness.
  const ox = "#6a4a34";
  for (const x0 of [24, 29]) { p.rect(x0, 8, x0 + 5, 11, ox); p.rect(x0, 8, x0 + 5, 8, shade(ox, 0.2)); p.rect(x0 + 5, 6, x0 + 6, 9, ox); p.set(x0 + 6, 5, BONE); p.set(x0 + 4, 5, BONE); p.rect(x0, 12, x0, 14, ox); p.rect(x0 + 4, 12, x0 + 4, 14, ox); }
  p.rect(22, 9, 24, 9, WOOD); p.rect(26, 7, 31, 7, WOOD_LIT);                 // shaft and yoke
  // The wagon: a tall gold canvas over hoops, crates at the back, a lantern.
  for (let r = 0; r < 3; r++) p.rect(2 + (2 - r), 1 + r, 20 - (2 - r), 1 + r, r === 0 ? shade(OUT_GOLD, 0.3) : OUT_GOLD);
  p.rect(2, 4, 20, 8, OUT_GOLD); p.rect(2, 8, 20, 8, shade(OUT_GOLD, -0.3)); for (let x = 5; x <= 17; x += 4) p.rect(x, 2, x, 8, shade(OUT_GOLD, -0.18));
  p.rect(2, 5, 20, 5, "#7a2a1a");                                               // a red stripe
  p.rect(1, 9, 21, 10, WOOD); p.rect(1, 9, 21, 9, WOOD_LIT); crate(p, 0, 6, 3, 3);
  for (const wx of [3, 15]) { p.rect(wx, 10, wx + 4, 14, "#5c4128"); p.rect(wx + 1, 11, wx + 3, 13, "#3a2a1a"); p.set(wx + 2, 12, WOOD_LIT); p.set(wx + 2, 10, WOOD_LIT); }
  p.rect(21, 2, 21, 6, METAL); p.set(22, 2, FIRE); p.set(22, 3, FIRE_HOT);      // lantern pole
}
function paintOutsiderTravellers(sub, n) {
  const p = painter(sub === "refugees" ? 28 : 22, 17);
  const cloth = (i) => (i % 2 ? "#6e6a60" : OUT_GRAY);
  const bedroll = (x, y) => { p.rect(x - 1, y + 1, x + 1, y + 1, "#a08a60"); p.set(x - 1, y, "#a08a60"); };
  if (sub === "refugees") {
    p.rect(17, 9, 25, 12, WOOD); p.rect(17, 9, 25, 9, WOOD_LIT);              // handcart of bundles
    p.rect(18, 5, 21, 8, "#8a7a6a"); p.rect(22, 6, 24, 8, "#6a7a8a"); p.rect(19, 4, 20, 4, "#b0a080");
    p.rect(19, 13, 21, 15, "#5c4128"); p.set(20, 14, WOOD_LIT); p.rect(14, 10, 16, 10, WOOD);
  }
  const slots = (sub === "refugees" ? [[9, 4], [2, 5], [5, 3]] : [[8, 4], [1, 3], [14, 5]]).slice(0, Math.max(1, Math.min(3, n))).sort((a, b) => a[1] - b[1]);
  slots.forEach(([x, y], i) => {
    const arm = sub === "scouts" && i === 0 ? "binoc" : sub === "scouts" ? "rifle" : "none";
    person(p, x, y + 2, { cloth: cloth(i), pants: "#4a4840", hat: sub === "wanderers" && i === 0 ? "straw" : "cap", hatColor: "#5a5850", pack: true, arm });
    bedroll(x, y + 2);
    if (sub === "wanderers") { p.rect(x + 5, y, x + 5, y + 12, WOOD); p.set(x + 4, y + 6, SKIN); }
  });
  return p;
}
export const OUTSIDER_COLORS = { raiders: OUT_RED, merchants: OUT_GOLD, explorers: OUT_GRAY };

// ---------- your convoys and special teams ----------
// Trade-route convoy: a pickup with a high load of crates under a tarp and a pennant in the route color.
// Supply run: a pickup loaded with drums and jerry cans under a tarp in the run's color.
function paintConvoyTruck(color, supply) {
  const p = painter(24, 14);
  pickup(p, 1, 1, color);
  if (supply) {
    for (const x of [2, 5, 8]) { p.rect(x, 3, x + 2, 6, x === 5 ? "#3a68a8" : RUST); p.rect(x, 4, x + 2, 4, shade(RUST, -0.35)); p.set(x, 3, shade(x === 5 ? "#3a68a8" : RUST, 0.3)); }
    p.rect(2, 1, 10, 2, shade(color, -0.2)); p.rect(2, 1, 10, 1, shade(color, 0.15));
    p.rect(11, 4, 12, 6, RED); p.set(11, 3, RED);
  } else {
    crate(p, 2, 1, 5, 6); crate(p, 7, 3, 5, 4, shade(WOOD_LIT, -0.1)); crate(p, 4, -1, 4, 3, shade(WOOD_LIT, 0.1));
    p.rect(0, 0, 0, 7, "#c9c9c9"); p.rect(1, 0, 3, 1, color); p.set(3, 1, shade(color, -0.3));
  }
  return p;
}

// On-foot convoy: walkers pulling a handcart of goods.
function paintHandcart(color, supply) {
  const p = painter(24, 14);
  person(p, 15, 2, { cloth: color, pack: true, arm: "none" });
  person(p, 2, 1, { cloth: shade(color, -0.15), pack: true, arm: "rifle" });
  p.rect(7, 6, 14, 9, WOOD); p.rect(7, 6, 14, 6, WOOD_LIT);
  if (supply) { p.rect(8, 3, 9, 5, RUST); p.rect(11, 3, 12, 5, "#3a68a8"); } else { crate(p, 8, 3, 3, 3); crate(p, 11, 4, 3, 2, shade(WOOD_LIT, -0.1)); }
  p.rect(8, 9, 10, 11, "#5c4128"); p.set(9, 10, WOOD_LIT); p.rect(15, 8, 16, 8, WOOD);
  return p;
}

// Recon team: one or two scouts, the lead glassing ahead with binoculars.
function paintScouts(color, count) {
  const p = painter(16, 14);
  if (count > 1) person(p, 1, 2, { cloth: shade(color, -0.15), pack: true, hat: "cap", hatColor: shade(color, -0.4), arm: "rifle" });
  person(p, 8, 3, { cloth: color, pack: true, hat: "cap", hatColor: shade(color, -0.4), arm: "binoc" });
  return p;
}

// Relief squad: armed walkers behind a banner in your color.
function paintRelief(color, count) {
  const p = painter(24, 17);
  const slots = [[8, 5], [1, 3], [15, 4]].slice(0, Math.max(1, Math.min(3, count))).sort((a, b) => a[1] - b[1]);
  slots.forEach(([x, y], i) => person(p, x, y + 2, { cloth: i % 2 ? shade(color, -0.15) : color, pack: true, hat: "helmet", hatColor: shade(color, -0.45), arm: i === 0 ? "banner" : "raised", armColor: WHITE }));
  if (p.get(15, 2)) { p.rect(15, 1, 16, 3, RED); p.rect(14, 2, 17, 2, RED); }
  return p;
}

// ---------- a team of one ----------
// A lone walker, drawn bigger than a group's figures and animated: frame 0 stands (feet together, upright), 1 and 3
// are the two strides (a leg forward, leaning into the walk), 2 is the passing step (feet under the body, the back foot
// lifted). render.js picks the frame from the clock in step with the bob. o: person() options (cloth, hat, arm, pack,
// robe…); light: "torch" (held up, burning) or another light (a lamp's beam ahead) when it is dark and they carry one.
// gait: "limp" (wounded: a bandage on the hurt far leg; frame 4 drags it, toe down, behind the good one) or "heavy" (over
// a comfortable load: a big pack with a bedroll on top, head down and the body bent forward even standing).
const SOLO = { w: 16, h: 18, x: 5, y: 6 }; // the grid and where the figure stands in it (centered, room for a banner)
// Legs by frame, [x, y] from the figure's top-left: the far leg (a shade darker) then the near one, each with its boot.
const LEGS = [
  { far: [[1, 7], [1, 8], [1, 9]], farBoot: [[1, 10]], near: [[3, 7], [3, 8], [3, 9]], nearBoot: [[3, 10], [4, 10]] },         // standing
  { far: [[1, 7], [1, 8], [0, 9]], farBoot: [[0, 10]], near: [[3, 7], [3, 8], [4, 9]], nearBoot: [[4, 10], [5, 10]] },         // near leg forward
  { far: [[2, 7], [2, 8], [2, 9]], farBoot: [[2, 10], [3, 10]], near: [[3, 7], [4, 8]], nearBoot: [[4, 9]] },                   // passing, near foot up
  { far: [[2, 7], [3, 8], [4, 9]], farBoot: [[4, 10], [5, 10]], near: [[3, 7], [2, 8], [1, 9]], nearBoot: [[0, 10], [1, 10]] }, // far leg forward
  { far: [[1, 7], [0, 8], [-1, 9]], farBoot: [[-1, 10]], near: [[3, 7], [3, 8], [3, 9]], nearBoot: [[3, 10], [4, 10]] },        // limp: the hurt leg dragged
];
function soloFigure(p, x, y, o, frame, light, gait = "") {
  const heavy = gait === "heavy", lean = heavy || frame === 1 || frame === 3 || frame === 4 ? 1 : 0;
  person(p, x + lean, y, light === "torch" ? { ...o, arm: "torch" } : heavy ? { ...o, pack: false } : o);
  if (heavy) {
    // Hunched: the head (and hat) a pixel forward and down, over the chest.
    const hx = x + lean, head = [];
    for (let yy = y - 2; yy <= y + 1; yy++) for (let xx = hx + 1; xx <= hx + 4; xx++) { const c = p.get(xx, yy); if (c) head.push([xx, yy, c]); p.clear(xx, yy); }
    for (const [xx, yy, c] of head) p.set(xx + 1, yy + 1, c);
    // A big pack riding high, a bedroll strapped on top.
    p.rect(hx - 2, y + 1, hx, y + 6, PACK); p.rect(hx - 2, y + 1, hx, y + 1, shade(PACK, 0.25)); p.set(hx - 1, y + 4, shade(PACK, -0.3));
    p.rect(hx - 2, y, hx, y, "#a08a60"); p.set(hx - 3, y, shade("#a08a60", -0.2));
  }
  if (!o.robe) { // person()'s legs off, this frame's on
    const pants = o.pants || PANTS;
    for (let yy = y + 7; yy <= y + 10; yy++) for (let xx = x - 1; xx <= x + 6; xx++) if (p.get(xx, yy) === pants) p.clear(xx, yy);
    const L = LEGS[frame], put = (pts, c) => { for (const [lx, ly] of pts) p.set(x + lx, y + ly, c); };
    put(L.far, shade(pants, -0.25)); put(L.farBoot, shade(pants, -0.55));
    put(L.near, pants); put(L.nearBoot, shade(pants, -0.45));
    if (gait === "limp") { const [bx, by] = L.far[1]; p.set(x + bx, y + by, "#e8e4da"); } // the bandage on the hurt leg
  } else if (frame) p.set(x + (frame === 3 ? -1 : 5), y + 10, shade(o.cloth, -0.35)); // a robe's hem swings
  if (light && light !== "torch") { // a lamp in the leading hand and its beam ahead (see-through: no outline)
    p.set(x + lean + 4, y + 5, "#f6f2d0");
    for (let i = 1; i <= 3; i++) for (let j = 1 - Math.min(i, 2); j <= Math.min(i, 2) - 1; j++) p.set(x + lean + 4 + i, y + 5 + j, i === 1 ? "#fff3b080" : "#fff3b040");
  }
}
function paintSolo(o, frame, light, gait = "") {
  const p = painter(SOLO.w, SOLO.h);
  soloFigure(p, SOLO.x, SOLO.y, o, frame, light, gait);
  return p;
}
// Your lone walker's look by what the team is doing: "walkers" a pack, "raid" a rifle, "scouts" a cap and binoculars
// (while standing), "relief" a helmet and a raised weapon.
function soloLook(kind, color, frame) {
  const base = { cloth: color, pack: true };
  if (kind === "raid") return { ...base, arm: frame ? "rifle" : "raised" };
  if (kind === "scouts") return { ...base, hat: "cap", hatColor: shade(color, -0.4), arm: frame ? "none" : "binoc" };
  if (kind === "relief") return { ...base, hat: "helmet", hatColor: shade(color, -0.45), arm: "raised" };
  return { ...base, arm: "none" };
}

// A lone rider on a bicycle (the frame in the team colour, like the parked bikes): frame 0 stands astride it, a foot
// down; 1 and 2 pedal (the cranks half a turn apart, the wheels' spokes turning).
function paintCyclist(color, frame) {
  const p = painter(19, 17);
  const frameC = desatHex(color, 0.2), cloth = color, dark = "#3a3a3a";
  const wheel = (cx, cy) => { // a 7-pixel tyre, the hub, two spokes (a quarter turn on between frames)
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (Math.round(Math.hypot(x, y)) === 3) p.set(cx + x, cy + y, TIRE);
    p.set(cx, cy, HUB);
    for (const [x, y] of frame === 2 ? [[-1, -1], [1, 1], [-1, 1], [1, -1]] : [[0, -1], [0, 1], [-1, 0], [1, 0]]) p.set(cx + x, cy + y, "#9aa0a6aa");
  };
  wheel(4, 12); wheel(14, 12);
  p.rect(5, 12, 8, 12, frameC);                                        // chainstay
  p.set(8, 11, frameC); p.set(8, 10, frameC);                          // seat tube
  p.rect(8, 9, 12, 9, frameC);                                         // top tube
  p.set(10, 11, frameC); p.set(11, 10, frameC);                        // down tube
  p.set(13, 10, frameC); p.set(13, 11, frameC);                        // fork
  p.set(12, 8, dark); p.rect(12, 7, 13, 7, dark);                      // stem, bars
  p.rect(6, 8, 8, 8, "#2a2a2a");                                       // saddle
  // The rider, leaning over the bars: pack on the back, torso, head, an arm to the bars.
  p.rect(6, 4, 6, 6, PACK); p.set(6, 4, shade(PACK, 0.25));
  p.rect(7, 5, 8, 7, cloth); p.rect(8, 4, 9, 5, cloth); p.set(7, 7, shade(cloth, -0.35));
  p.rect(10, 2, 11, 3, SKIN); p.set(10, 2, shade(PACK, -0.3));         // head, hair
  p.set(10, 5, cloth); p.set(11, 6, SKIN);                             // arm, hand on the bars
  // Legs from the hip (8, 8), the crank at (9, 12); far leg a shade darker. Stopped (frame 0): the near foot on the ground.
  const near = PANTS, far = shade(PANTS, -0.25), boot = shade(PANTS, -0.5);
  const leg = (pts, c, b) => { pts.forEach(([x, y], i) => p.set(x, y, i === pts.length - 1 ? b : c)); };
  if (frame === 0) {
    leg([[8, 9], [8, 10], [9, 11]], far, boot);                         // far foot on the pedal
    leg([[9, 8], [10, 9], [10, 10], [11, 11], [11, 12], [11, 13], [11, 14], [11, 15]], near, boot); p.set(12, 15, boot); // the near foot down
  } else {
    p.set(9, 12, dark);                                                 // the crank
    const up = [[9, 8], [10, 8], [11, 9], [11, 10]], down = [[8, 9], [8, 10], [9, 11], [9, 13], [9, 14]];
    leg(frame === 1 ? down : up, far, boot);
    leg(frame === 1 ? up : down, near, boot);
  }
  return p;
}

// Boat wake: two foam lines spreading behind.
function paintWake() {
  const p = painter(26, 6);
  for (let i = 0; i < 12; i++) {
    const a = i < 4 ? "cc" : i < 8 ? "88" : "44";
    p.set(20 - i * 2, 1 + Math.floor(i / 3), FOAM + a); p.set(19 - i * 2, 1 + Math.floor(i / 3), FOAM + a);
    p.set(20 - i * 2, 4 - Math.floor(i / 4), FOAM + a);
  }
  p.rect(21, 2, 24, 3, FOAM + "cc");
  return p;
}

// Road bridge: a concrete deck bank to bank (drawn turned along the road, as wide as the hex: render.js BRIDGE_W)
// between two steel railings on kerbs, with its piers showing under the edges and the road's centre line on it.
function paintBridge() {
  const p = painter(40, 11);
  const deck = "#8c8a80", kerb = "#6a6760", rail = "#b8bcc2", post = "#5e626a", pier = "#4f4c48";
  p.rect(0, 2, 39, 8, deck);
  p.rect(0, 2, 39, 2, shade(deck, 0.18)); p.rect(0, 8, 39, 8, shade(deck, -0.18));
  for (let x = 4; x <= 36; x += 8) p.rect(x, 3, x, 7, shade(deck, -0.1)); // slab joints
  for (let x = 2; x <= 37; x += 6) p.rect(x, 5, x + 2, 5, "#b9ad7a");    // the dashed centre line
  for (const y of [1, 9]) p.rect(0, y, 39, y, kerb);                      // kerbs
  for (const y of [0, 10]) { p.rect(0, y, 39, y, rail); for (let x = 1; x <= 38; x += 5) p.set(x, y, post); } // railings and posts
  for (const x of [8, 20, 31]) { p.set(x, 9, pier); p.set(x + 1, 9, pier); p.set(x, 1, pier); p.set(x + 1, 1, pier); } // piers
  return p;
}

// ---------- status icons ----------
// Small badges drawn over teams and bases: "alert" (waiting for orders / a base alert), "work" (busy on the spot),
// "radio" (in radio contact), "siege" (crossed swords), "unknown" (estimated position, in the team's color).
function paintIcon(kind, color = "#ffd166") {
  const p = painter(9, 9);
  const disc = (c) => { for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) if ((x - 4) ** 2 + (y - 4) ** 2 <= 17) p.set(x, y, (x - 4) ** 2 + (y - 4) ** 2 > 12 ? shade(c, -0.3) : c); };
  switch (kind) {
    case "alert": disc(color); p.rect(4, 1, 4, 5, OUTLINE); p.set(4, 7, OUTLINE); p.set(3, 2, shade(color, 0.4)); break;
    case "unknown": disc(color); p.rect(3, 1, 5, 1, OUTLINE); p.set(6, 2, OUTLINE); p.set(6, 3, OUTLINE); p.set(5, 4, OUTLINE); p.set(4, 5, OUTLINE); p.set(4, 7, OUTLINE); p.set(2, 2, OUTLINE); break;
    case "work": // wrench
      p.rect(1, 0, 2, 0, STEEL); p.set(0, 1, STEEL); p.set(0, 2, STEEL); p.set(3, 1, STEEL); p.set(1, 2, shade(STEEL, 0.3)); p.set(2, 3, STEEL); p.set(3, 2, STEEL);
      for (let i = 0; i < 5; i++) { p.set(3 + i, 3 + i, STEEL); p.set(4 + i, 3 + i, shade(STEEL, -0.3)); }
      p.set(8, 8, shade(STEEL, -0.3)); p.set(7, 8, STEEL);
      break;
    case "radio": // walkie-talkie with signal arcs
      p.rect(2, 3, 5, 8, "#2a2a2e"); p.rect(3, 4, 4, 5, "#7fd08a"); p.set(3, 7, METAL); p.set(4, 7, METAL);
      p.rect(2, 0, 2, 2, METAL);
      p.set(6, 1, "#9be39b"); p.set(7, 2, "#9be39b"); p.set(7, 3, "#9be39b"); p.set(8, 1, "#9be39bcc"); p.set(8, 4, "#9be39b99");
      break;
    case "siege": // crossed swords
      for (let i = 0; i < 6; i++) { p.set(1 + i, 1 + i, STEEL); p.set(7 - i, 1 + i, STEEL); }
      p.set(0, 0, shade(STEEL, 0.3)); p.set(8, 0, shade(STEEL, 0.3));
      p.rect(5, 6, 7, 6, GOLD); p.rect(1, 6, 3, 6, GOLD); p.set(7, 7, WOOD); p.set(8, 8, WOOD); p.set(1, 7, WOOD); p.set(0, 8, WOOD);
      p.set(4, 4, "#ff5a4f");
      break;
  }
  return p;
}

// ---------- map markers ----------
// Abandoned vehicle: your truck or sedan parked and dusty; a red jerry can over it when it needs fuel, smoke and an
// open hood when it is badly damaged.
// Bicycles left lying on the ground: two wheels, a frame in the team color.
function paintBikes(color, damaged) {
  const p = painter(20, 14);
  const frame = desatHex(color, 0.35);
  const wheel = (cx, cy) => { for (const [x, y] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1]]) p.set(cx + x, cy + y, TIRE); p.set(cx, cy, HUB); };
  wheel(4, 10); wheel(13, 10);
  p.rect(5, 7, 11, 7, frame); p.set(4, 8, frame); p.set(8, 8, frame); p.set(9, 9, frame); p.set(12, 8, frame); p.set(13, 9, frame);
  p.rect(5, 6, 6, 6, "#2a2a2a"); p.rect(11, 5, 12, 5, "#3a3a3a"); // saddle, bars
  if (damaged) { p.clear(15, 10); p.clear(15, 9); p.set(16, 12, TIRE); }
  wheel(15, 4); p.rect(16, 2, 19, 2, shade(frame, -0.2)); // a second bike leaning behind
  return p;
}

function paintParked(type, color, needsFuel, damaged, ups = "") {
  if (type === "bike") return paintBikes(color, damaged);
  const faded = desatHex(color, 0.45);
  const base = armourOverlay(type === "sedan" ? paintSedan(faded) : type === "suv" ? paintSuv(faded) : type === "van" ? paintVan(faded) : type === "hummer" ? paintHummer(faded) : type === "miltruck" ? paintMilTruck(faded, damaged ? "wrecked" : "intact") : paintTruck(faded), type, ups); // its upgrades, by its type (render.js markerLook)
  const p = painter(base.w + 2, base.h + 6);
  blit(p, base, 0, 6);
  for (const [x, y] of [[3, 13], [7, 14], [12, 13], [16, 14], [9, 12], [18, 12]]) if (p.get(x, y)) p.set(x, y, "#9a8a6a");
  if (type === "sedan") { p.clear(17, 17); p.rect(15, 17, 18, 17, TIRE); } // flat tire
  if (damaged) {
    p.rect(17, 9, 20, 9, shade(desatHex(color, 0.45), -0.2)); p.set(20, 8, shade(desatHex(color, 0.45), -0.2));
    p.set(19, 7, SMOKE); p.set(20, 5, SMOKE); p.set(19, 4, SMOKE_FAINT); p.set(21, 3, SMOKE_FAINT); p.set(20, 1, SMOKE_FAINT);
  }
  if (needsFuel) { // jerry can
    p.rect(1, 1, 4, 5, RED); p.rect(1, 1, 4, 1, shade(RED, 0.3)); p.rect(2, 0, 3, 0, "#3a3a3a"); p.set(2, 3, shade(RED, -0.35)); p.set(3, 4, shade(RED, -0.35));
  }
  return p;
}
const desatHex = (hex, f) => { const [r, g, b] = rgb(hex), l = r * 0.3 + g * 0.59 + b * 0.11; return toHex(r + (l - r) * f, g + (l - g) * f, b + (l - b) * f); };

// Wrecked car: rusted, a wheel gone, the door hanging open. Stripped: up on blocks, no wheels, hood up.
function paintWreckMarker(stripped) {
  const p = paintWreck();
  const body = "#7d5a43";
  if (!stripped) {
    p.rect(11, 3, 11, 7, shade(body, 0.25)); p.rect(10, 5, 10, 8, shade(body, -0.3)); // rear door hanging open
    return p;
  }
  // Stripped: up on blocks with the wheels gone, the doors pulled off and the hood propped open.
  for (let y = 8; y <= 11; y++) for (let x = 0; x < p.w; x++) { const v = p.get(x, y); if (v === TIRE || v === HUB || v === shade(HUB, -0.3)) p.clear(x, y); }
  for (const x of [4, 16]) { p.rect(x, 9, x + 2, 10, STONE); p.set(x, 9, shade(STONE, 0.2)); }
  p.rect(6, 3, 9, 7, "#2a2018"); p.rect(11, 3, 14, 7, "#2a2018"); p.set(7, 5, shade(PACK, -0.2)); p.set(12, 6, shade(PACK, -0.2));
  for (let x = 15; x <= 21; x++) p.clear(x, 4);
  p.rect(16, 1, 18, 1, body); p.set(19, 2, body); p.set(20, 3, body); p.set(15, 2, shade(body, -0.3)); // hood up
  p.rect(16, 4, 19, 4, "#3a3a3a");
  for (const [x, y] of [[3, 6], [17, 6], [2, 7]]) p.set(x, y, "#5a3a28");
  return p;
}

// Supply cache: crates under an olive tarp and a duffel bag. Emptied: a crate with its lid off, the tarp thrown aside.
function paintCacheMarker(emptied) {
  const p = painter(18, 11);
  if (emptied) {
    crate(p, 5, 4, 7, 6, shade(WOOD_LIT, -0.1)); p.rect(6, 4, 10, 5, "#2a2018"); p.rect(6, 4, 10, 4, "#1a140e");
    p.rect(13, 3, 14, 9, WOOD_LIT); p.rect(14, 3, 14, 9, WOOD); p.set(13, 6, shade(WOOD, -0.2)); // the lid, leaning
    p.rect(1, 8, 3, 9, shade(OLIVE, -0.1)); p.rect(1, 8, 3, 8, OLIVE);  // a folded tarp
    p.set(16, 9, "#9a9a9a"); p.set(17, 10, "#7a7a7a");                // an empty can
    return p;
  }
  crate(p, 1, 4, 6, 6); crate(p, 7, 5, 6, 5, shade(WOOD_LIT, -0.12)); crate(p, 3, 0, 5, 4, shade(WOOD_LIT, 0.1));
  p.rect(6, 3, 12, 4, OLIVE); p.rect(6, 3, 12, 3, shade(OLIVE, 0.25)); p.set(12, 5, OLIVE); p.set(6, 5, OLIVE);
  p.rect(12, 7, 17, 10, "#3a4a5a"); p.rect(12, 7, 17, 7, shade("#3a4a5a", 0.3)); p.rect(13, 6, 14, 6, "#2a2a2e"); p.set(15, 6, "#2a2a2e");
  p.set(14, 8, shade("#3a4a5a", -0.35)); p.set(16, 9, shade("#3a4a5a", -0.35));
  return p;
}

// Abandoned camp; emptied: the tent collapsed and the camp picked through.
function paintCampMarker(emptied) {
  if (!emptied) return paintCamp("#8a8478", false);
  const p = painter(18, 11);
  for (let x = 1; x <= 11; x++) p.set(x, 9 - (x > 4 && x < 9 ? 1 : 0), "#8a8478");
  p.rect(2, 9, 11, 9, shade("#8a8478", -0.2)); p.set(6, 7, shade("#8a8478", 0.2));
  p.rect(0, 10, 12, 10, shade(DIRT, 0.1));
  campfire(p, 13, 9, false);
  p.set(4, 8, WOOD); p.set(9, 7, WOOD);
  return p;
}

// Death site: a cross over the grave; with the gear still lying there, a pack and a rifle.
function paintGraveMarker(items) {
  const p = painter(16, 12);
  p.rect(1, 9, 10, 10, DIRT); p.rect(2, 8, 9, 8, shade(DIRT, 0.2));
  p.rect(5, 1, 6, 8, WOOD_LIT); p.rect(3, 3, 8, 3, WOOD_LIT); p.rect(3, 4, 8, 4, WOOD);
  p.set(5, 1, shade(WOOD_LIT, 0.3));
  if (items) {
    p.rect(10, 7, 13, 10, PACK); p.rect(10, 7, 13, 7, shade(PACK, 0.25)); p.set(12, 9, shade(PACK, -0.35));
    for (let i = 0; i < 6; i++) p.set(15 - i, 10 - Math.floor(i * 1.2), "#3a3a3a");
    p.rect(4, 0, 7, 0, OLIVE); p.rect(5, -1, 6, -1, OLIVE);             // helmet on the cross
    p.rect(4, 1, 7, 1, shade(OLIVE, -0.2));
  }
  return p;
}

// ---------- cache and public API ----------
const cache = new Map();
function cached(key, paint) {
  let cv = cache.get(key);
  if (cv === undefined) {
    if (cache.size > 500) cache.clear();
    cv = toCanvas(paint());
    cache.set(key, cv);
  }
  return cv;
}

// Your parties. kind: "truck" | "sedan" | "walkers" | "raid" | "scouts" | "relief" | "boat" | "raft" for teams;
// "convoy" | "supply" for trade-route and supply-run convoys by vehicle, "cart" | "supplycart" for the same on foot.
// count: people shown for walkers, raids, scouts and relief squads.
const PEOPLE_KINDS = new Set(["walkers", "raid", "scouts", "relief"]);
// ups: the vehicle's upgrades (upsCode: plates, glass or grilles, a gun on the roof) for "truck" | "sedan" | "suv" |
// "van" | "hummer" | "miltruck" (the team's vehicle by its type: render.js partyLook).
export function partySpriteCanvas(kind, color, count = 3, ups = "") {
  const n = Math.max(1, Math.min(3, count));
  return cached(`${kind}:${color}:${PEOPLE_KINDS.has(kind) ? n : ""}${ups ? `:${ups}` : ""}`, () => {
    if (kind === "truck") return armourOverlay(paintTruck(color), kind, ups);
    if (kind === "sedan") return armourOverlay(paintSedan(color), kind, ups);
    if (kind === "suv") return armourOverlay(paintSuv(color), kind, ups);
    if (kind === "van") return armourOverlay(paintVan(color), kind, ups);
    if (kind === "hummer") return armourOverlay(paintHummer(color), kind, ups);
    if (kind === "miltruck") return armourOverlay(paintMilTruck(color), kind, ups); // an Army truck got running (sim/foundcars.js)
    if (kind === "boat" || kind === "raft") return paintBoat(color, kind === "raft");
    if (kind === "convoy" || kind === "supply") return paintConvoyTruck(color, kind === "supply");
    if (kind === "cart" || kind === "supplycart") return paintHandcart(color, kind === "supplycart");
    if (kind === "scouts") return paintScouts(color, n);
    if (kind === "relief") return paintRelief(color, n);
    return paintWalkers(color, n, kind === "raid");
  });
}

// Another group's party by group type. kind: "convoy" (by vehicle), "raid", "scav" (scavengers, aiscav.js) or "walk" (on
// foot); n: people (1–4).
export function groupPartyCanvas(type, kind, color, n = 3) {
  const k = kind === "convoy" ? 0 : Math.max(1, Math.min(4, n));
  return cached(`gp:${type}:${kind}:${color}:${k}`, () => paintGroupParty(type, kind, color, k || 3));
}

// A team of one on foot (render.js soloFrame): kind "walkers" | "raid" | "scouts" | "relief" (as partySpriteCanvas);
// frame 0 standing, 1–3 the walk (paintSolo); light: a carried light, lit at night ("torch" or any other kind).
const SOLO_KINDS = new Set(["walkers", "raid", "scouts", "relief"]);
export const soloKind = (kind) => SOLO_KINDS.has(kind);
// gait: "" | "limp" (wounded; frame 4 the dragged step) | "heavy" (hunched under a big load).
export function soloSpriteCanvas(kind, color, frame = 0, light = "", gait = "") {
  const g = gait === "limp" || gait === "heavy" ? gait : "", f = Math.max(0, Math.min(g === "limp" ? 4 : 3, frame | 0)), l = light ? (light === "torch" ? "torch" : "lamp") : "";
  return cached(`solo:${kind}:${color}:${f}:${l}:${g}`, () => paintSolo(soloLook(kind, color, f), f, l, g));
}
// Outsiders (sim/visitors.js) in ones and twos, walking: kind "raiders" | "explorers" (sub "scouts" | "refugees" |
// "wanderers"), i: 0 the lead, 1 the second (a shade apart). In their usual looks (paintOutsiderRaiders, paintOutsiderTravellers).
export function outsiderSoloCanvas(kind, sub, i = 0, frame = 0) {
  const f = Math.max(0, Math.min(3, frame | 0)), k = i ? 1 : 0;
  return cached(`osolo:${kind}:${sub || ""}:${k}:${f}`, () => {
    if (kind === "raiders") return paintSolo({ cloth: k ? "#2c2420" : shade(OUT_RED, -0.2), hat: "hood", hatColor: shade(OUT_RED, -0.35), band: "#c03030", arm: k ? "rifle" : "raised", pants: "#24222a" }, f, "");
    const arm = sub === "scouts" ? (k ? "rifle" : f ? "rifle" : "binoc") : sub === "wanderers" ? "staff" : "none";
    const o = { cloth: k ? "#6e6a60" : OUT_GRAY, pants: "#4a4840", hat: sub === "wanderers" && !k ? "straw" : "cap", hatColor: "#5a5850", pack: true, arm };
    return paintSolo(o, f, "", sub === "refugees" ? "heavy" : ""); // refugees carry all they own
  });
}
// A team of one on a bike: frame 0 stopped (a foot down), 1–2 pedalling.
export function cyclistSpriteCanvas(color, frame = 0) {
  const f = Math.max(0, Math.min(2, frame | 0));
  return cached(`cyclist:${color}:${f}`, () => paintCyclist(color, f));
}
// Another group's party of one on foot, in its group's look (groupLook: the lead figure); kind "walk" | "raid" | "scav"
// (a scavenger: pack on, a crowbar).
export function groupSoloCanvas(type, kind, color, frame = 0) {
  const f = Math.max(0, Math.min(3, frame | 0));
  return cached(`gsolo:${type}:${kind}:${color}:${f}`, () => {
    const o = groupLook(type, color, 0, kind === "raid");
    return paintSolo(kind === "scav" ? { ...o, pack: true, arm: "bar" } : o, f, "");
  });
}

// A base worker out on a job trip (sim/jobtrips.js; render.js drawWorkers): a lone walker (paintSolo's figure and
// frames) in the job's kit: an axe (wood), a rifle (hunt), a rod with its line (fish), a basket (forage), a crowbar and
// a sack (scavenge), two buckets (water). load: what they bring home ("" on the way out and at work): "logs" (a
// bundle on the shoulder), "game" (a deer across the shoulders), "fish" (a string of fish), "basket" (a full basket),
// "sack" (a full sack on the back), "buckets" (full buckets), "small" (a rabbit or two hung from the hand). A heavy load (logs, game) bends them under it.
export function workerSpriteCanvas(job, color, frame = 0, load = "") {
  const f = Math.max(0, Math.min(3, frame | 0));
  return cached(`worker:${job}:${color}:${f}:${load}`, () => {
    const p = painter(SOLO.w, SOLO.h);
    const x = SOLO.x, y = SOLO.y;
    const heavy = load === "logs" || load === "game";
    const arm = job === "hunt" ? "rifle" : job === "scavenge" ? "bar" : "none";
    soloFigure(p, x, y, { cloth: color, pack: job === "hunt" || job === "fish", arm, hat: job === "hunt" ? "cap" : job === "forage" || job === "wood" ? "straw" : "", hatColor: shade(color, -0.4) }, f, "", "");
    const lean = heavy || f === 1 || f === 3 ? 1 : 0, hx = x + lean;
    if (job === "wood" && !heavy) { // an axe in the leading hand, its head up
      p.set(hx + 4, y + 4, SKIN); p.set(hx + 5, y + 3, WOOD); p.set(hx + 5, y + 2, WOOD); p.set(hx + 6, y + 1, WOOD);
      p.rect(hx + 6, y - 1, hx + 7, y, STEEL); p.set(hx + 7, y + 1, shade(STEEL, -0.3));
    }
    if (job === "fish") { // a rod over the shoulder, its line hanging
      p.set(hx + 4, y + 4, SKIN);
      for (let i = 0; i < 6; i++) p.set(hx + 5 + i, y + 3 - i, i < 2 ? WOOD : "#c8b48a");
      if (!load) { p.set(hx + 11, y - 1, "#e8e4da80"); p.set(hx + 11, y, "#e8e4da60"); p.set(hx + 11, y + 1, "#e8e4da40"); }
    }
    if (job === "forage" || load === "basket") { // a basket on the arm, full on the way home
      p.rect(hx + 4, y + 5, hx + 6, y + 7, "#a0784a"); p.rect(hx + 4, y + 7, hx + 6, y + 7, shade("#a0784a", -0.3));
      if (load === "basket") { p.set(hx + 4, y + 4, "#c03a3a"); p.set(hx + 5, y + 4, "#5f9a3c"); p.set(hx + 6, y + 4, "#7a3a8a"); }
    }
    if (job === "water") { // two buckets, water at the brim on the way home
      for (const bx of [hx - 1, hx + 4]) {
        p.rect(bx, y + 6, bx + 1, y + 8, "#8a9096"); p.set(bx, y + 5, "#5a5e64"); p.set(bx + 1, y + 5, "#5a5e64");
        if (load === "buckets") { p.set(bx, y + 6, "#5aa0d8"); p.set(bx + 1, y + 6, "#7ab8e8"); }
      }
    }
    if (job === "scavenge" || load === "sack") { // a sack over the back
      const full = load === "sack";
      p.rect(hx - 2, y + (full ? 1 : 3), hx, y + 6, "#a08a60"); p.set(hx - 1, y + (full ? 1 : 3), shade("#a08a60", 0.25)); p.set(hx - 2, y + 6, shade("#a08a60", -0.3));
    }
    if (load === "logs") { // a bundle of logs on the shoulder, the cut ends showing
      p.rect(hx - 3, y + 1, hx + 5, y + 2, LOG); p.rect(hx - 3, y + 1, hx + 5, y + 1, shade(LOG, 0.2));
      p.set(hx - 3, y + 1, "#c8a070"); p.set(hx - 3, y + 2, "#b88e60"); p.set(hx + 5, y + 2, "#c8a070");
    }
    if (load === "game") { // a deer across the shoulders: body, legs hanging, the head with an antler
      const hide = "#8a6a48";
      p.rect(hx - 3, y + 1, hx + 4, y + 2, hide); p.rect(hx - 3, y + 1, hx + 4, y + 1, shade(hide, 0.2));
      p.set(hx - 3, y + 3, shade(hide, -0.3)); p.set(hx - 2, y + 3, shade(hide, -0.3)); p.set(hx - 3, y + 4, shade(hide, -0.45));
      p.set(hx + 5, y + 1, hide); p.set(hx + 5, y + 2, shade(hide, -0.2)); p.set(hx + 6, y, "#d8cdb0"); p.set(hx + 5, y - 1, "#d8cdb0");
    }
    if (load === "small") { // small game hung from the hand by the legs
      p.set(hx + 4, y + 4, SKIN); p.set(hx + 5, y + 5, "#6a4a30");
      p.rect(hx + 5, y + 6, hx + 6, y + 8, "#8a6a48"); p.set(hx + 5, y + 9, "#6a4a30"); p.set(hx + 6, y + 9, "#d8cdb0");
    }
    if (load === "fish") { // a string of fish from the hand
      p.set(hx + 4, y + 4, SKIN); p.set(hx + 5, y + 5, "#c8b48a");
      for (let i = 0; i < 3; i++) { p.set(hx + 5, y + 6 + i * 1, "#aab8c0"); p.set(hx + 6, y + 6 + i, "#8a9aa4"); }
    }
    return p;
  });
}

// Siege camp in the attacker's color, pitched beside a besieged base.
export const siegeCampCanvas = (color) => cached(`siege:${color}`, () => paintSiegeCamp(color));

// Outsiders (sim/visitors.js) by kind: "raiders" | "merchants" | "explorers" (sub: "scouts" | "refugees" |
// "wanderers"); n: people shown (1–3); escort: a merchant caravan's (sim/escorts.js { tier, vehicle }).
export function outsiderPartyCanvas(kind, sub = "", n = 3, escort = null) {
  const k = Math.max(1, Math.min(3, n));
  const tier = kind === "merchants" && escort ? escort.tier : "", veh = kind === "merchants" && escort ? escort.vehicle || "" : "";
  return cached(`out:${kind}:${sub || ""}:${kind === "merchants" ? `${tier}:${veh}` : k}`, () =>
    kind === "raiders" ? paintOutsiderRaiders(k) : kind === "merchants" ? paintOutsiderMerchants(tier, veh) : paintOutsiderTravellers(sub || "wanderers", k));
}

// A horde of n figures (2–7) in the current zombie look (palette and eyes from the Zombies settings).
export function hordeSpriteCanvas(n) {
  const look = zombieLook(), k = Math.max(2, Math.min(7, n));
  return cached(`horde:${k}:${look.palette}:${look.eyes}`, () => paintHorde(k, look));
}

// An infestation hive by how infected its ground is: level 0–2 (sim/hives.js).
export const hiveSpriteCanvas = (level = 0) => cached(`hive:${level}`, () => paintHive(level));

// Infested animals (sim/worm.js): n (1–3) gaunt grey deer or hogs with raw sores, heads hanging.
export function herdSpriteCanvas(kind, n) {
  const k = Math.max(1, Math.min(3, n));
  return cached(`herd:${kind}:${k}`, () => paintHerd(kind === "hog" ? "hog" : "deer", k));
}
function paintHerd(kind, n) {
  const p = painter(13 + (n - 1) * 7, 12 + (n > 1 ? 2 : 0));
  for (let i = n - 1; i >= 0; i--) infestedBeast(p, i * 7, i % 2 ? 0 : (n > 1 ? 2 : 0), kind, i);
  return p;
}
function infestedBeast(p, x, y, kind, k) {
  const HIDE = k % 2 ? "#8d877a" : "#7f796e", DARK = "#55504a", SORE = "#9a2a2c", EYE = "#ff6a3a";
  const deer = kind === "deer";
  const top = deer ? 4 : 5;
  p.rect(x + 1, y + top, x + 8, y + 7, deer ? HIDE : shade(HIDE, -0.1));         // body
  p.rect(x + 2, y + 7, x + 7, y + 7, DARK);                                      // ribs and belly
  for (const lx of [2, 4, 6, 8]) p.rect(x + lx, y + 8, x + lx, y + (deer ? 11 : 9), DARK); // legs
  p.set(x, y + top, HIDE);                                                        // tail
  p.rect(x + 9, y + top + 1, x + 10, y + top + 2, HIDE);                         // neck, low
  p.rect(x + 10, y + top + 3, x + 12, y + top + 4, HIDE);                        // head, hanging
  p.set(x + 11, y + top + 3, EYE);
  if (deer) { p.set(x + 10, y + top - 1, BONE); p.set(x + 11, y + top - 2, BONE); p.set(x + 10, y + top - 2, BONE); p.set(x + 11, y + top, BONE); } // antlers
  else p.set(x + 12, y + top + 4, shade(HIDE, 0.3));                            // snout
  p.set(x + 3, y + top + 1, SORE); p.set(x + 6, y + top, SORE); p.set(x + 5, y + top + 2, shade(SORE, 0.3));
}

// Status icon: "alert" | "unknown" (a disc in `color`) | "work" | "radio" | "siege".
export const iconCanvas = (kind, color = "#ffd166") => cached(`icon:${kind}:${color}`, () => paintIcon(kind, color));

// Road bridge over a river tile.
export const bridgeCanvas = () => cached("bridge", paintBridge);

// Foam wake behind a boat.
export const wakeCanvas = () => cached("wake", paintWake);

// One of your bases. look: { kind: "hub" | "outpost", color, walls, tower, radio, hosp, farms, workshop, big }.
export function baseSpriteCanvas(look) {
  const L = look;
  const key = `base:${L.kind}:${L.color}:${L.walls}:${+!!L.tower}${+!!L.radio}${+!!L.workshop}${+!!L.big}:${L.hosp}:${L.farms}:${+!!L.rain}${+!!L.rack}${+(L.fire !== false)}`;
  return cached(key, () => (L.kind === "shelter" ? paintShelter(L) : L.kind === "hub" ? paintHub(L) : paintOutpost(L)));
}

// Another group's base by group type (raider, military, fortress, zealot, expansionist, traders, commune).
export function factionBaseCanvas(type, color) {
  return cached(`fbase:${type}:${color}`, () => (FACTION_PAINT[type] || paintFortressBase)(color));
}

// A map site by LOCATIONS type. variant: a franchise's id for a kind with franchises (sim/data-shops.js FRANCHISES: the
// painter gets that franchise's look, or the kind's first one's for no or an unknown id), else "depot" (the Army depot
// look of a military site); faded: how picked over it is, the loot band (aiscav.js lootBand: 0 rich, 1 some, 2 little,
// 3 picked clean; true = 2).
const FADES = [null, [0.3, 0.06], [0.7, 0.18], [0.95, 0.42]];
export function poiSpriteCanvas(type, variant = "", faded = 0) {
  const lvl = faded === true ? 2 : Math.max(0, Math.min(3, +faded || 0));
  return cached(`poi:${type}:${variant}:${lvl}`, () => {
    const paint = POI_PAINT[type] || paintGenericPoi; // a kind without a painter yet (pois.js kinds): the plain building
    const fr = Object.prototype.hasOwnProperty.call(FRANCHISES, type) ? FRANCHISES[type] : null;
    const p = paint(fr && fr.length ? (fr.find((f) => f.id === variant) || fr[0]).look : variant === "depot");
    return lvl ? fade(p, ...FADES[lvl]) : p;
  });
}

// The smoke column over a crash search circle (render.js, sim/crashes.js).
export const searchSmokeCanvas = () => cached("searchsmoke", paintSearchSmoke);

// Danger pip (a skull): render.js draws a row of them under a site's name when zoomed in.
export const skullCanvas = () => cached("skull", paintSkull);

// Tent and campfire; lit = false for an abandoned camp.
export function campSpriteCanvas(color, lit = true) {
  return cached(`camp:${color}:${+lit}`, () => paintCamp(color, lit));
}

// Your camp by stage (0–3, ui/render.js campStage), tinted with your color.
export function stagingSpriteCanvas(stage, color, lit = true) {
  const k = Math.max(0, Math.min(3, stage | 0));
  return cached(`staging:${k}:${color}:${+!!lit}`, () => paintStaging(k, color, lit));
}

// The ruins of a razed base (render.js; sim/conquest.js and factions.js tile.ruin): scorched yard, two charred
// wall stubs with a gap where the gate was, fallen beams, rubble, a blackened chimney and a last wisp of smoke.
// yours: a torn blue rag on a bent pole (one of your bases burned there).
const ASH = "#3b3733", CHAR = "#26231f", EMBER = "#c4562a", SOOT = "#4d4741", BURNT_WOOD = "#4a3424";
function paintRuin(yours) {
  const p = painter(28, 18);
  const yb = 16;
  p.rect(1, 12, 26, yb, ASH);                                     // scorched yard
  for (const [x, y] of [[3, 13], [8, 15], [14, 14], [20, 15], [24, 13], [11, 12]]) p.set(x, y, shade(ASH, 0.25));
  // Left wall stub: jagged top, a burned-out window.
  const wall = "#6d655b";
  for (let x = 3; x <= 10; x++) {
    const top = 6 + [0, 2, 1, 3, 0, 4, 2, 5][x - 3];
    p.rect(x, top, x, 12, (x + top) % 3 ? wall : shade(wall, -0.3));
    p.set(x, top, shade(wall, 0.2));
  }
  p.rect(5, 8, 6, 10, CHAR);
  for (let x = 3; x <= 10; x++) p.set(x, 12 - ((x * 7) % 3 === 0 ? 1 : 0), SOOT); // soot up the base of the wall
  // Right wall stub, lower.
  for (let x = 17; x <= 24; x++) {
    const top = 8 + [3, 1, 0, 2, 4, 1, 3, 5][x - 17];
    p.rect(x, top, x, 12, (x + top) % 4 ? shade(wall, -0.1) : shade(wall, -0.35));
    p.set(x, top, shade(wall, 0.15));
  }
  p.rect(20, 10, 21, 11, CHAR);
  // Chimney standing alone, blackened, smoke drifting off it.
  p.rect(13, 3, 14, 12, shade(STONE, -0.45));
  p.set(13, 3, shade(STONE, -0.2));
  p.set(14, 1, SMOKE_FAINT); p.set(15, 0, SMOKE_FAINT); p.set(13, 2, SMOKE);
  // Fallen beams across the gap and a heap of rubble with a few embers.
  for (let i = 0; i < 7; i++) p.set(9 + i, 11 + (i >> 2), BURNT_WOOD);
  for (let i = 0; i < 6; i++) p.set(16 + i, 14 - (i >> 1), shade(BURNT_WOOD, 0.15));
  p.rect(10, 13, 17, 14, SOOT);
  for (const [x, y] of [[11, 12], [12, 13], [15, 12], [16, 13], [18, 14], [9, 14], [13, 14]]) p.set(x, y, shade(STONE, -0.15));
  for (const [x, y] of [[12, 14], [16, 14], [22, 15]]) p.set(x, y, EMBER);
  // Broken fence posts at the corners.
  for (const x of [1, 26]) p.rect(x, 13, x, yb, CHAR);
  p.set(2, 14, CHAR);
  if (yours) {                                                     // a bent pole with a torn blue rag
    p.rect(25, 4, 25, 12, "#9a9a9a");
    p.set(24, 4, "#9a9a9a");
    p.rect(21, 4, 23, 5, "#3f6fa8");
    p.set(22, 6, "#3f6fa8");
  }
  return p;
}
export const ruinSpriteCanvas = (yours = false) => cached(`ruin:${+!!yours}`, () => paintRuin(yours));

// An empty base (render.js; sim/groupworld.js state.abandoned, sim/occupy.js): an outpost left standing, grey and
// overgrown: a sagging fence with a gap, a house with a caved-in corner of its roof and dark windows, a lean-to,
// weeds and creepers up the walls, no smoke. yours: a faded blue rag still on the pole (your old outpost).
const WEED = "#5d7a3e", WEED_DK = "#435a2c", GREY_WALL = "#8a8780", GREY_ROOF = "#6b6966";
function paintEmptyBase(yours) {
  const p = painter(28, 18);
  const yb = 16;
  p.rect(1, 12, 26, yb, shade(YARD, -0.15));                     // the yard gone to seed
  for (const [x, y] of [[2, 13], [6, 15], [10, 14], [15, 15], [19, 13], [23, 14], [25, 16], [12, 16]]) p.set(x, y, WEED);
  // The house: grey walls, a dark doorway and windows, the roof caved in at its right end.
  p.rect(5, 7, 16, 12, GREY_WALL);
  p.rect(5, 12, 16, 12, shade(GREY_WALL, -0.25));
  p.rect(7, 9, 8, 10, CHAR); p.rect(13, 9, 14, 10, CHAR); p.rect(10, 10, 11, 12, CHAR);
  for (let x = 4; x <= 13; x++) p.rect(x, x <= 9 ? 5 : 6, x, 6, x % 2 ? GREY_ROOF : shade(GREY_ROOF, -0.15));
  p.set(14, 6, shade(GREY_ROOF, -0.3)); p.set(16, 7, shade(GREY_ROOF, -0.35)); // the caved-in end
  // Creepers up the walls.
  for (const [x, y] of [[5, 8], [5, 9], [6, 11], [15, 9], [16, 10], [16, 11], [9, 7]]) p.set(x, y, WEED_DK);
  // A lean-to, its tin sheet slipped.
  p.rect(19, 9, 23, 12, shade(METAL, -0.3));
  for (let i = 0; i < 6; i++) p.set(18 + i, 8 + (i >> 2), shade(METAL, -0.1));
  // The fence: posts and rails, one stretch fallen.
  for (const x of [1, 6, 11, 16, 21, 26]) p.rect(x, 13, x, yb, shade(BURNT_WOOD, 0.35));
  for (let x = 1; x <= 26; x++) if (x < 9 || x > 14) p.set(x, 14, shade(BURNT_WOOD, 0.5));
  for (const [x, y] of [[10, 16], [11, 16], [12, 15]]) p.set(x, y, shade(BURNT_WOOD, 0.3)); // the fallen rails
  for (const [x, y] of [[1, 12], [6, 12], [21, 12], [26, 12]]) p.set(x, y, WEED);
  if (yours) {                                                     // the pole with a faded blue rag
    p.rect(25, 3, 25, 12, "#9a9a9a");
    p.rect(22, 3, 24, 4, "#6f8fb4");
    p.set(23, 5, "#6f8fb4");
  }
  return p;
}
export const emptyBaseSpriteCanvas = (yours = false) => cached(`emptybase:${+!!yours}`, () => paintEmptyBase(yours));

// Map marker sprites: "death" | "cache" | "car" | "camp" | "vehicle" | "hive". opt: { emptied } for finds (stripped
// wreck, emptied cache, picked-through camp), { empty } for a death site with nothing left, { vehicle: "truck" |
// "sedan", needsFuel, damaged } for an abandoned vehicle (in `color`).
export function markerSpriteCanvas(type, color = "#4f8fd6", opt = {}) {
  const v = type === "vehicle" ? `${opt.vehicle || "truck"}${+!!opt.needsFuel}${+!!opt.damaged}${opt.ups || ""}` : `${+!!opt.emptied}${+!!opt.empty}`;
  return cached(`mark:${type}:${color}:${v}`, () => {
    if (type === "death") return paintGraveMarker(!opt.empty);
    if (type === "cache") return paintCacheMarker(!!opt.emptied);
    if (type === "car") return paintWreckMarker(!!opt.emptied);
    if (type === "miltruck") return paintMilTruckMarker(); // an Army truck seen on the road (sim/miltrucks.js)
    if (type === "camp") return paintCampMarker(!!opt.emptied);
    if (type === "nomadcamp") return paintCampMarker(false); // a nomad camp seen (sim/nomads.js): the camp's look, never emptied
    if (type === "hive") return paintHive(0);
    if (type === "crashhome") return paintUnitFlag(); // sim/crashstart.js: the unit's base (Crashlanding)
    return paintParked(opt.vehicle || "truck", color, !!opt.needsFuel, !!opt.damaged, opt.ups || ""); // ups: its upgrades (upsCode)
  });
}

// Width of a cached sprite in its own pixels (0 without a canvas, e.g. headless): draw sizes scale with it.
export const gridW = (cv) => (cv ? cv.width / UP : 0);

// Draws a cached sprite centered on (cx, cy), `w` world pixels wide. facing: 1 right, -1 left; angle: turned (radians).
// scale: device pixels per unit of the context's current transform, when the caller knows it (the map renderer
// does); otherwise it is read from the transform. The context's alpha and smoothing are left as they were.
export function drawMapSprite(ctx, cv, cx, cy, w, { facing = 1, alpha = 1, angle = 0 } = {}, scale) {
  if (!cv) return;
  const h = w * (cv.height / cv.width);
  if (scale == null) { const t = ctx.getTransform(); scale = Math.hypot(t.a, t.b); }
  const a0 = ctx.globalAlpha, s0 = ctx.imageSmoothingEnabled, q0 = ctx.imageSmoothingQuality;
  ctx.globalAlpha = alpha;
  // Crisp pixels when drawn large; smoothed when small so it does not shimmer when zoomed out.
  ctx.imageSmoothingEnabled = (w * scale) / (cv.width / UP) < 2;
  ctx.imageSmoothingQuality = "high";
  if (!angle && facing >= 0) ctx.drawImage(cv, cx - w / 2, cy - h / 2, w, h);
  else {
    ctx.save();
    ctx.translate(cx, cy);
    if (angle) ctx.rotate(angle);
    if (facing < 0) ctx.scale(-1, 1);
    ctx.drawImage(cv, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  ctx.globalAlpha = a0;
  ctx.imageSmoothingEnabled = s0;
  ctx.imageSmoothingQuality = q0;
}
onForgetPictures(() => cache.clear()); // ui/pictures.js: drawn again after a lost GPU context
