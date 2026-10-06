// Procedural pixel sprites for parties on the State Map (same approach as sprites.js: painted on a small
// pixel grid, outlined, upscaled once to an offscreen canvas and cached by look). A pickup truck or a sedan
// for motorized teams and convoys, a small group of walkers with packs for teams on foot (armed for raids),
// and a boat (or a raft carrying the vehicle) while a team crosses water. The body or clothes are tinted
// with the owner's color. Sprites face right; drawMapSprite mirrors them for travel to the left.
// Also the map's places and things: your bases, other groups' bases and parties (by group type), sites (one
// sprite per location type), hordes and hives, markers (vehicles, wrecks, caches, camps, graves) and status icons.
import { zombieLook } from "./sprites.js";

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
// Pickup truck: cab, hood and a bed with cargo under a tarp.
function paintTruck(color) {
  const p = painter(22, 13);
  const dark = shade(color, -0.35), lit = shade(color, 0.25);
  p.rect(1, 6, 20, 9, color);                          // body
  p.rect(1, 9, 20, 9, dark);
  p.rect(1, 6, 11, 6, lit);                            // bed rail
  p.rect(2, 3, 10, 5, "#8c7a52");                      // tarp-covered cargo
  p.rect(2, 3, 10, 3, shade("#8c7a52", 0.2));
  p.set(6, 4, shade("#8c7a52", -0.3)); p.set(6, 5, shade("#8c7a52", -0.3));
  p.rect(12, 2, 16, 6, color);                         // cab
  p.rect(12, 2, 16, 2, lit);
  p.rect(14, 3, 16, 5, GLASS);                         // window
  p.set(14, 3, "#e4f1f8");
  p.rect(17, 5, 20, 6, color);                         // hood
  p.set(20, 7, "#ffe28a");                             // headlight
  p.set(1, 7, "#d24a3a");                              // tail light
  wheel(p, 3, 9);
  wheel(p, 15, 9);
  return p;
}

// Old sedan: low body, cabin with two windows.
function paintSedan(color) {
  const p = painter(22, 12);
  const dark = shade(color, -0.35), lit = shade(color, 0.25);
  p.rect(1, 5, 20, 8, color);
  p.rect(1, 8, 20, 8, dark);
  p.rect(5, 2, 15, 4, color);                          // cabin
  p.rect(6, 2, 14, 2, lit);
  p.rect(6, 3, 9, 4, GLASS);
  p.rect(11, 3, 14, 4, GLASS);
  p.set(6, 3, "#e4f1f8");
  p.set(20, 6, "#ffe28a");
  p.set(1, 6, "#d24a3a");
  wheel(p, 3, 8);
  wheel(p, 15, 8);
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

// A shelter (tier 0, sim/buildings.js SHELTER): the staging camp finished. The shack roofed in your color with a
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

// Your staging camp (sim/staging.js) by how far the work has got (stage 0–3): 0 a tarp shelter, crates and a fire on
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
function paintPolice() {
  const p = painter(22, 20);
  flag(p, 0, 3, POLICE_BLUE, 15, 3);
  block(p, 2, 8, 17, 18, "#a3a9b1");
  p.rect(2, 9, 17, 10, POLICE_BLUE); p.rect(2, 10, 17, 10, shade(POLICE_BLUE, -0.3));
  lightBar(p, 7, 6);
  for (const x of [3, 14]) { p.rect(x, 12, x + 1, 13, DARK_WIN); p.set(x, 12, shade(DARK_WIN, 0.4)); }
  star(p, 7, 11, GOLD);
  p.rect(7, 15, 11, 18, GLASS); p.rect(9, 15, 9, 18, shade(GLASS, -0.4)); p.rect(6, 14, 12, 14, shade("#a3a9b1", -0.35));
  // Black-and-white cruiser at the curb.
  p.set(16, 13, SIREN_BLUE); p.set(17, 13, SIREN_RED);
  p.rect(15, 14, 18, 14, "#1d1f24"); p.rect(16, 14, 18, 14, GLASS);
  p.rect(13, 15, 20, 16, "#1d1f24"); p.rect(15, 15, 18, 16, WHITE);
  p.rect(13, 17, 20, 17, shade("#1d1f24", 0.2)); p.rect(14, 18, 15, 18, TIRE); p.rect(18, 18, 19, 18, TIRE);
  p.set(20, 15, "#ffe28a");
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

function paintGunStore() {
  const p = painter(22, 20);
  const wall = "#5e4a3e";
  block(p, 2, 9, 19, 18, wall);
  for (let y = 11; y <= 18; y += 2) for (let x = 3 + (y % 4 ? 0 : 1); x <= 18; x += 3) p.set(x, y, shade(wall, -0.18));
  // Sign board with a rifle on it.
  p.rect(4, 3, 4, 8, METAL); p.rect(17, 3, 17, 8, METAL);
  p.rect(2, 1, 19, 6, ORANGE); p.rect(3, 2, 18, 5, "#1f1c1a");
  p.rect(4, 3, 14, 3, STEEL);                                     // barrel and receiver
  p.rect(9, 4, 15, 4, STEEL); p.rect(15, 3, 17, 5, "#a2713f");     // stock
  p.rect(9, 2, 11, 2, STEEL);                                     // scope
  p.set(12, 5, STEEL); p.set(10, 5, STEEL);
  // Barred windows and a steel door.
  for (const x0 of [3, 14]) { p.rect(x0, 11, x0 + 3, 14, GLASS); for (let x = x0; x <= x0 + 3; x += 1) if ((x - x0) % 2 === 0) p.rect(x, 11, x, 14, "#2a2a2a"); }
  p.rect(9, 13, 12, 18, METAL); p.rect(9, 13, 12, 13, shade(METAL, 0.3)); p.set(11, 16, OUTLINE);
  return p;
}

function paintHardware() {
  const p = painter(22, 20);
  const wall = "#a7adb3";
  block(p, 1, 7, 20, 18, wall);
  p.rect(1, 8, 20, 10, ORANGE); p.rect(1, 10, 20, 10, shade(ORANGE, -0.3));
  // Hammer on the sign.
  p.rect(13, 8, 16, 9, WHITE); p.rect(14, 8, 14, 10, WOOD_LIT); p.rect(14, 10, 14, 10, WOOD_LIT);
  for (let x = 3; x <= 11; x += 2) p.set(x, 9, WHITE);
  p.rect(7, 12, 13, 18, shade(ORANGE, -0.45)); p.rect(7, 12, 13, 12, shade(ORANGE, -0.2)); // big door
  for (let y = 13; y <= 18; y += 2) p.rect(8, y, 12, y, shade(ORANGE, -0.6));
  p.rect(16, 12, 19, 14, GLASS);
  // Lumber stack and a wheelbarrow out front.
  for (let i = 0; i < 3; i++) { p.rect(0, 16 - i * 1, 5 - (i === 2 ? 1 : 0), 16 - i * 1, i % 2 ? "#c9a46a" : "#d8b47a"); }
  p.rect(0, 17, 5, 18, "#b08a52"); for (let x = 0; x <= 5; x += 2) p.set(x, 17, "#8a6838");
  p.rect(16, 16, 19, 17, "#3f7a4a"); p.set(15, 16, METAL); p.set(14, 15, METAL); p.set(18, 18, TIRE);
  return p;
}

function paintAutoShop() {
  const p = painter(22, 20);
  const wall = "#7f8790";
  // Sign board with a double-ended wrench.
  p.rect(5, 6, 5, 8, METAL); p.rect(13, 6, 13, 8, METAL);
  p.rect(2, 1, 16, 6, RED); p.rect(2, 1, 16, 1, shade(RED, 0.3)); p.rect(2, 6, 16, 6, shade(RED, -0.35));
  p.rect(5, 3, 13, 4, WHITE); p.rect(3, 2, 4, 2, WHITE); p.rect(3, 5, 4, 5, WHITE); p.rect(14, 2, 15, 2, WHITE); p.rect(14, 5, 15, 5, WHITE);
  block(p, 0, 8, 18, 18, wall);
  // Closed bay (ribbed roll-up door) and an open one with a car on the lift.
  p.rect(1, 11, 7, 18, "#9aa0a6"); for (let y = 12; y <= 18; y += 2) p.rect(1, y, 7, y, "#7a8086");
  p.rect(10, 11, 16, 18, "#1e2024");
  p.rect(10, 14, 16, 15, "#3a68a8"); p.rect(11, 13, 15, 13, shade("#3a68a8", 0.3)); p.set(16, 15, "#ffe28a");
  p.rect(11, 16, 11, 18, METAL); p.rect(15, 16, 15, 18, METAL);
  tires(p, 19, 18, 4);
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

function paintOffice() {
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

function paintFireStation() {
  const p = painter(22, 20);
  const wall = "#9a4a3a";
  block(p, 14, 1, 19, 18, shade(wall, -0.1));                     // hose tower
  windows(p, 16, 3, 17, 9, 2, 3, DARK_WIN);
  block(p, 0, 7, 16, 18, wall);
  p.rect(0, 8, 16, 8, WHITE);
  // Two bays: one with the engine nosing out, one shut.
  p.rect(1, 10, 7, 18, "#1e2024"); p.rect(1, 10, 7, 10, WHITE);
  p.rect(1, 12, 7, 17, RED); p.rect(2, 12, 6, 13, GLASS); p.rect(1, 15, 7, 15, WHITE);
  p.rect(1, 11, 7, 11, METAL); p.set(1, 16, "#ffe28a"); p.set(7, 16, "#ffe28a"); p.rect(3, 16, 5, 16, STEEL);
  p.rect(2, 18, 3, 18, TIRE); p.rect(5, 18, 6, 18, TIRE);
  p.rect(9, 10, 15, 18, "#d6d2c8"); p.rect(9, 10, 15, 10, WHITE);
  for (let y = 12; y <= 18; y += 2) p.rect(9, y, 15, y, "#a8a49a");
  p.set(15, 1, RED); p.set(18, 1, RED);
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
function paintGrocery() {
  const p = painter(20, 17);
  const wall = "#9a6248";
  block(p, 1, 4, 18, 15, wall);
  p.rect(1, 4, 18, 6, shade(wall, 0.1)); p.rect(5, 2, 14, 4, shade(wall, 0.1)); p.rect(5, 2, 14, 2, shade(wall, 0.3)); // false front
  p.rect(6, 3, 13, 3, WHITE);
  // Striped awning over the window.
  for (let x = 1; x <= 18; x++) p.rect(x, 7, x, 8, Math.floor((x - 1) / 2) % 2 ? WHITE : "#3e8a4a");
  for (let x = 1; x <= 18; x += 2) p.set(x, 9, "#3e8a4a");
  p.rect(2, 10, 12, 13, GLASS); p.rect(2, 10, 12, 10, GLASS_LIT);
  p.rect(14, 10, 16, 15, OUTLINE);
  // Produce crates out front.
  for (const [x, c] of [[1, RED], [5, ORANGE], [9, CROP_LIT]]) { p.rect(x, 14, x + 3, 15, WOOD_LIT); p.rect(x, 13, x + 3, 13, c); p.set(x + 1, 13, shade(c, 0.3)); }
  return p;
}

function paintClinic() {
  const p = painter(20, 17);
  block(p, 0, 7, 11, 15, WHITE);
  p.rect(0, 9, 11, 9, "#3a68a8");
  p.rect(3, 2, 7, 6, WHITE); p.rect(3, 2, 7, 2, shade(WHITE, 0.3)); p.rect(4, 6, 6, 6, shade(WHITE, -0.25)); // sign on the roof
  plus(p, 5, 4, 1, 1, RED);
  p.rect(4, 11, 6, 15, GLASS); p.rect(5, 11, 5, 15, shade(GLASS, -0.4));
  p.rect(1, 11, 2, 12, GLASS_BLUE); p.rect(8, 11, 10, 12, GLASS_BLUE);
  // Ambulance parked beside it.
  p.set(12, 7, SIREN_RED); p.set(13, 7, SIREN_BLUE);
  p.rect(12, 8, 16, 14, WHITE); p.rect(17, 10, 19, 14, WHITE); p.rect(18, 10, 19, 11, GLASS);
  p.rect(12, 12, 19, 12, RED); plus(p, 14, 9, 1, 1, RED);
  p.rect(12, 14, 19, 14, shade(WHITE, -0.3)); p.set(19, 13, "#ffe28a");
  p.rect(13, 15, 14, 16, TIRE); p.rect(17, 15, 18, 16, TIRE);
  return p;
}

function paintGas() {
  const p = painter(20, 17);
  // Price sign on a pole.
  p.rect(18, 4, 18, 15, METAL);
  p.rect(16, 0, 19, 4, WHITE); p.rect(16, 0, 19, 0, RED); p.set(17, 2, OUTLINE); p.set(18, 2, OUTLINE); p.set(17, 3, OUTLINE);
  // Store behind.
  block(p, 10, 8, 16, 15, PLASTER); p.rect(11, 10, 13, 12, GLASS); p.rect(14, 11, 15, 15, OUTLINE);
  // Canopy on two posts over the pumps.
  p.rect(0, 4, 13, 6, WHITE); p.rect(0, 5, 13, 5, RED); p.rect(0, 6, 13, 6, shade(WHITE, -0.35));
  p.rect(1, 7, 1, 15, STEEL); p.rect(11, 7, 11, 15, STEEL);
  for (const x of [3, 7]) { p.rect(x, 11, x + 1, 15, RED); p.rect(x, 12, x + 1, 12, WHITE); p.set(x + 2, 12, "#2a2a2e"); p.set(x + 2, 13, "#2a2a2e"); }
  p.rect(0, 16, 15, 16, ASPHALT);
  return p;
}

function paintDiner() {
  const p = painter(20, 17);
  // Stainless-steel diner car with rounded ends.
  p.rect(1, 7, 14, 14, STEEL); p.clear(1, 7); p.clear(14, 7);
  p.rect(2, 6, 13, 6, shade(STEEL, 0.25));
  for (let y = 8; y <= 13; y += 2) p.rect(1, y, 14, y, shade(STEEL, 0.15));
  p.rect(2, 9, 13, 10, "#f0d890"); for (let x = 4; x <= 13; x += 3) p.rect(x, 9, x, 10, shade(STEEL, -0.2));
  p.rect(1, 13, 14, 14, RED); p.rect(1, 14, 14, 14, shade(RED, -0.35));
  p.rect(6, 9, 7, 14, shade(STEEL, -0.45));
  // Neon sign on a pole.
  p.rect(17, 7, 17, 15, METAL);
  p.rect(15, 0, 19, 6, "#20202a");
  p.rect(16, 1, 18, 1, NEON_PINK); p.rect(16, 3, 18, 3, NEON_CYAN); p.rect(16, 5, 18, 5, NEON_PINK);
  for (const [x, y] of [[14, 1], [14, 5], [17, -1], [17, 7]]) p.set(x, y, NEON_PINK + "66");
  p.rect(0, 15, 15, 15, ASPHALT);
  return p;
}

function paintMotel() {
  const p = painter(20, 17);
  const wall = "#d8c4a8";
  p.rect(0, 8, 15, 8, ROOF_RUST); p.rect(0, 7, 15, 7, shade(ROOF_RUST, 0.3));
  block(p, 0, 9, 15, 15, wall);
  for (let i = 0; i < 4; i++) {
    const x = 1 + i * 4;
    p.rect(x, 11, x, 15, i % 2 ? "#3f8a8a" : "#a84a3a");          // room doors
    p.rect(x + 1, 11, x + 2, 12, i === 2 ? DARK_WIN : LIT_WIN);
  }
  // Roadside sign with bulbs and an arrow pointing in.
  p.rect(18, 5, 18, 15, METAL);
  p.rect(15, 0, 19, 4, RED); p.rect(16, 2, 18, 2, WHITE);
  for (let x = 15; x <= 19; x += 2) { p.set(x, 0, GOLD); p.set(x, 4, GOLD); }
  p.rect(13, 6, 17, 6, GOLD); p.set(12, 6, GOLD); p.set(13, 5, GOLD); p.set(13, 7, GOLD);
  for (const [x, y] of [[11, 6], [14, -1], [20, 2]]) p.set(x, y, "#ffd06a66");
  return p;
}

function paintChurch() {
  const p = painter(20, 17);
  const wall = "#e2ddd0";
  // Steeple with a cross.
  p.rect(9, 0, 9, 2, GOLD); p.rect(8, 1, 10, 1, GOLD);
  for (let r = 0; r < 4; r++) p.rect(9 - Math.floor(r / 2), 3 + r, 9 + Math.floor((r + 1) / 2), 3 + r, r === 0 ? shade(ROOF_GRAY, 0.3) : ROOF_GRAY);
  p.rect(7, 7, 11, 15, wall); p.rect(7, 7, 7, 15, shade(wall, 0.2));
  p.rect(8, 8, 10, 9, OUTLINE); p.set(9, 9, GOLD);                // belfry and bell
  // Nave.
  house(p, 2, 10, 16, 6, wall, ROOF_GRAY, { rh: 3, door: false, win: false });
  p.rect(7, 10, 11, 15, wall);
  p.rect(8, 12, 10, 15, shade(WOOD, -0.3)); p.set(9, 11, shade(WOOD, -0.3));
  for (const x of [4, 14]) { p.rect(x, 12, x, 13, "#5a7ac8"); p.set(x, 12, "#c85a7a"); }
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

// Type → painter; the variant (only "depot" for now) and picked-over fading are applied by poiSpriteCanvas.
const POI_PAINT = {
  city: paintCityCenter, town: paintTownCenter, police: paintPolice, hospital: paintHospital, pharmacy: paintPharmacy,
  supermarket: paintSupermarket, gunstore: paintGunStore, hardware: paintHardware, autoshop: paintAutoShop, apartments: paintApartments,
  office: paintOffice, school: paintSchool, firestation: paintFireStation, warehouse: paintWarehouse, mall: paintMall, univ: paintUniversity,
  grocery: paintGrocery, clinic: paintClinic, gas: paintGas, diner: paintDiner, motel: paintMotel, church: paintChurch, feedstore: paintFeedStore,
  farm: paintFarm, barn: paintBarn, ranch: paintRanch, cabin: paintCabin, lodge: paintLodge, campground: paintCampground, ranger: paintRanger,
  radiotower: paintRadioTower, truckstop: paintTruckStop, quarry: paintQuarry, crashsite: paintCrashSite,
  dam: paintDam, airport: paintAirport, factory: paintFactory, prison: paintPrison, military: paintMilitarySite,
  crash_mil: () => paintHeliWreck(OLIVE, shade(OLIVE, -0.3), "star"), crash_med: () => paintHeliWreck(WHITE, RED, "cross"),
  crash_news: () => paintHeliWreck("#3d6fb0", "#e8c04a", "stripe"), crash_cargo: paintCargoWreck, airdrop: paintAirDrop,
};

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
  const body = OLIVE, dark = shade(OLIVE, -0.35);
  p.rect(1, 6, 21, 10, body); p.rect(1, 10, 21, 10, dark); p.rect(1, 6, 21, 6, shade(body, 0.2));
  p.rect(6, 3, 16, 6, body); p.rect(6, 3, 16, 3, shade(body, 0.25));
  p.rect(13, 4, 16, 5, GLASS); p.rect(8, 4, 11, 5, shade(GLASS, -0.35));
  p.rect(17, 5, 21, 6, shade(body, 0.1)); p.set(21, 8, "#ffe28a");
  p.rect(9, 1, 11, 2, dark); p.rect(11, 1, 16, 1, "#3a3a3a");      // roof gun
  p.rect(3, 0, 3, 5, METAL); p.rect(4, 0, 6, 1, c);                 // antenna pennant
  p.set(4, 8, c); p.set(5, 8, c);
  for (const wx of [3, 15]) { p.rect(wx, 9, wx + 4, 13, TIRE); p.rect(wx + 1, 10, wx + 3, 12, "#3a3a3c"); p.set(wx + 2, 11, HUB); }
  return p;
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

// The people a group sends on foot, by group type. kind: "raid" (weapons raised) or "walk" (convoys on foot).
function paintGroupWalkers(type, c, n, kind) {
  const raid = kind === "raid", scav = kind === "scav";
  const p = painter(type === "raider" && raid ? 26 : 24, 17);
  // Scavengers (aiscav.js): up to three, packs on, the last one hauling a stuffed sack.
  const slots = (scav ? [[6, 5], [0, 3], [12, 4]] : type === "traders" && !raid ? [[1, 4], [7, 3]] : [[8, 5], [1, 3], [15, 4], [19, 6]]).slice(0, Math.max(1, Math.min(scav ? 3 : 4, n))).sort((a, b) => a[1] - b[1]);
  const look = (i) => {
    switch (type) {
      case "raider": return { cloth: i % 2 ? "#3a3028" : shade(c, -0.25), hat: "mohawk", hatColor: c, band: c, arm: raid ? "raised" : "rifle", pants: "#2a2a30" };
      case "military": return { cloth: OLIVE, pants: OLIVE_DARK, hat: "helmet", hatColor: shade(OLIVE, -0.15), band: c, arm: i === 0 && !raid ? "banner" : "rifle", armColor: c, pack: !raid };
      case "zealot": return { cloth: i === 0 ? shade(c, -0.1) : "#cfc7b4", hat: "hood", hatColor: shade(c, -0.25), robe: true, arm: i === 0 ? "banner" : i === 1 ? "torch" : raid ? "raised" : "none", armColor: c };
      case "expansionist": return { cloth: "#5a6068", pants: "#3a3e44", hat: "helmet", hatColor: c, band: c, arm: i === 0 ? "banner" : raid ? "shield" : "rifle", armColor: c, pack: !raid };
      case "traders": return { cloth: i % 2 ? "#8a7a5a" : shade(c, -0.15), hat: "cap", hatColor: c, pack: true, arm: i === 0 ? "rifle" : "none" };
      case "commune": return { cloth: i % 2 ? "#6a7a9a" : shade(c, -0.1), pants: "#4a5a7a", hat: "straw", arm: i % 2 ? "fork" : raid ? "raised" : "fork", pack: !raid };
      default: return { cloth: shade(c, -0.1), hat: "helmet", hatColor: STONE, arm: i === 0 ? "spear" : "shield", armColor: c }; // fortress militia
    }
  };
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
function paintOutsiderMerchants() {
  const p = painter(36, 17);
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
  return p;
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

function paintParked(type, color, needsFuel, damaged) {
  if (type === "bike") return paintBikes(color, damaged);
  const base =type === "sedan" ? paintSedan(desatHex(color, 0.45)) : paintTruck(desatHex(color, 0.45));
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
export function partySpriteCanvas(kind, color, count = 3) {
  const n = Math.max(1, Math.min(3, count));
  return cached(`${kind}:${color}:${PEOPLE_KINDS.has(kind) ? n : ""}`, () => {
    if (kind === "truck") return paintTruck(color);
    if (kind === "sedan") return paintSedan(color);
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

// Siege camp in the attacker's color, pitched beside a besieged base.
export const siegeCampCanvas = (color) => cached(`siege:${color}`, () => paintSiegeCamp(color));

// Outsiders (sim/visitors.js) by kind: "raiders" | "merchants" | "explorers" (sub: "scouts" | "refugees" |
// "wanderers"); n: people shown (1–3).
export function outsiderPartyCanvas(kind, sub = "", n = 3) {
  const k = Math.max(1, Math.min(3, n));
  return cached(`out:${kind}:${sub || ""}:${kind === "merchants" ? 0 : k}`, () =>
    kind === "raiders" ? paintOutsiderRaiders(k) : kind === "merchants" ? paintOutsiderMerchants() : paintOutsiderTravellers(sub || "wanderers", k));
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

// A map site by LOCATIONS type. variant: "depot" (the Army depot look of a military site); faded: how picked over it
// is, the loot band (aiscav.js lootBand: 0 rich, 1 some, 2 little, 3 picked clean; true = 2).
const FADES = [null, [0.3, 0.06], [0.7, 0.18], [0.95, 0.42]];
export function poiSpriteCanvas(type, variant = "", faded = 0) {
  const lvl = faded === true ? 2 : Math.max(0, Math.min(3, +faded || 0));
  return cached(`poi:${type}:${variant}:${lvl}`, () => {
    const paint = POI_PAINT[type] || paintTownCenter;
    const p = paint(variant === "depot");
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

// Your staging camp by stage (0–3, sim/staging.js stagingStage), tinted with your color.
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

// Map marker sprites: "death" | "cache" | "car" | "camp" | "vehicle" | "hive". opt: { emptied } for finds (stripped
// wreck, emptied cache, picked-through camp), { empty } for a death site with nothing left, { vehicle: "truck" |
// "sedan", needsFuel, damaged } for an abandoned vehicle (in `color`).
export function markerSpriteCanvas(type, color = "#4f8fd6", opt = {}) {
  const v = type === "vehicle" ? `${opt.vehicle || "truck"}${+!!opt.needsFuel}${+!!opt.damaged}` : `${+!!opt.emptied}${+!!opt.empty}`;
  return cached(`mark:${type}:${color}:${v}`, () => {
    if (type === "death") return paintGraveMarker(!opt.empty);
    if (type === "cache") return paintCacheMarker(!!opt.emptied);
    if (type === "car") return paintWreckMarker(!!opt.emptied);
    if (type === "camp") return paintCampMarker(!!opt.emptied);
    if (type === "hive") return paintHive(0);
    return paintParked(opt.vehicle || "truck", color, !!opt.needsFuel, !!opt.damaged);
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
