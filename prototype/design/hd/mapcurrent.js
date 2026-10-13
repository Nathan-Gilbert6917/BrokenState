// COMPARISON ONLY: a verbatim copy of the State Map's private painters from src/ui/mapsprites.js (the game's
// are module-private and the exported *Canvas functions need a DOM), so the "current vs HD" sheets can show the
// game's sprites scaled 2× next to the HD designs. Nothing here is used by the game; do not edit the art here.
// The painter is hdcore's (same set/get/rect/clear semantics) so scaled() can read its pixels.
import { painter } from "./hdcore.js";
const OUTLINE = "#0b0c0e";
const TIRE = "#1c1c1e", HUB = "#8a8a8a", GLASS = "#a9cbe0", WOOD = "#7a5230", WOOD_LIT = "#a2713f", PACK = "#6b5434", SKIN = "#d6a77a", PANTS = "#34363c";
// Places (bases, camps, map markers).
const PLASTER = "#b9a98a", BOARDS = "#8b6a48", ROOF_RUST = "#8a4b32", ROOF_GRAY = "#5d6168", LIT_WIN = "#f0c860",
  DIRT = "#6e5c40", YARD = "#584a34", SOIL = "#4a3824", CROP = "#5f9a3c", CROP_LIT = "#8cc45e", METAL = "#7d848c", STONE = "#8d8a82",
  CONCRETE = "#94948c", WHITE = "#e8e4da", RED = "#d0342c", CANVAS = "#b3a27a", SAND = "#b8a27a", OLIVE = "#5d6b3a",
  RUST = "#7b5a44", GOLD = "#e8c04a", FIRE = "#ffb43b", FIRE_HOT = "#fff0a0", FIRE_RED = "#e0542a",
  SMOKE = "#b4b4b4aa", SMOKE_FAINT = "#a0a0a066", GLOW = "#ff9a3a55", FLESH = "#5a2a2e", BONE = "#d8d0bc";
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
// A vehicle's upgrades (sim/vehicles.js) painted over its sprite: steel plates riveted along the body (a second row up
// the cab at level 2; patchy rust and grey for scrap plating), a dark grille or a thick green tint over the windows, and
// a machine gun on a ring on the roof. u: the code from upsCode ("" for none).
const PLATE = "#6f757c", PLATE_DK = "#4d5258", SCRAP_A = "#7b5a44", SCRAP_B = "#5f6158", BGLASS = "#7fb3a6", MESH = "#3e4044";
const ARMOUR_AT = { // band: [x0, x1, y0, y1] the body, band2: up the cab, roof: where the gun's ring sits
  truck: { band: [1, 20, 7, 8], band2: [12, 13, 3, 6], roof: [13, 1] },
  sedan: { band: [1, 20, 6, 7], band2: [5, 5, 3, 5], roof: [9, 1] },
  miltruck: { band: [1, 22, 8, 9], band2: [16, 17, 4, 7], roof: [17, 2] },
};
// "p<plating>s<scrap>g<glass>m<mesh>t<gun>" from v.upgrades, "" when it has none.
function upsCode(u) {
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
function blit(p, src, ox, oy) {
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) p.set(ox + x, oy + y, src.get(x, y));
}

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

function crate(p, x, y, w, h, c = WOOD_LIT) {
  p.rect(x, y, x + w - 1, y + h - 1, c);
  p.rect(x, y, x + w - 1, y, shade(c, 0.25));
  p.rect(x, y + h - 1, x + w - 1, y + h - 1, shade(c, -0.35));
  for (let i = 1; i < h - 1; i++) p.set(x + Math.round((i * (w - 1)) / (h - 1)), y + i, shade(c, -0.3));
}

// ---------- your bases ----------
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

const DARK_WIN = "#28313b", ASPHALT = "#4b4b50", BRICK = "#8e4f3c", GLASS_BLUE = "#5b8db3", GLASS_LIT = "#a6cde6",
  POLICE_BLUE = "#2f5597", SIREN_BLUE = "#3a8bff", SIREN_RED = "#ff3b30", NEON_PINK = "#ff5fa2", NEON_CYAN = "#5fe8ff",
  BUS_YELLOW = "#e8b22a", GREEN_CROSS = "#3cc055", WATER_BLUE = "#3f7fb5", FOAM = "#d8ecf4", COPPER = "#5f9e8a",
  HAY = "#d8b85a", GRASS = "#5f8a3c", PINE = "#2f5a34", BARN_RED = "#a8382a", OLIVE_DARK = "#454f2a", ORANGE = "#e07b2a",
  STEEL = "#b8bec4", LOG = "#7a5232", BLOOD = "#7a1c18";
function star(p, x, y, c) {
  p.set(x + 2, y, c); p.rect(x, y + 1, x + 4, y + 1, c); p.rect(x + 1, y + 2, x + 3, y + 2, c);
  p.set(x + 1, y + 3, c); p.set(x + 3, y + 3, c);
}
// Plus-shaped cross, arm length r and thickness t, centered on the t × t square at (x, y).
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
const OUTSIDER_COLORS = { raiders: OUT_RED, merchants: OUT_GOLD, explorers: OUT_GRAY };

// ---------- your convoys and special teams ----------
// Trade-route convoy: a pickup with a high load of crates under a tarp and a pennant in the route color.
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
  const base = armourOverlay(type === "sedan" ? paintSedan(desatHex(color, 0.45)) : type === "miltruck" ? paintMilTruck(desatHex(color, 0.45), damaged ? "wrecked" : "intact") : paintTruck(desatHex(color, 0.45)), type, ups); // its upgrades
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

// Road bridge over a river tile.

// Foam wake behind a boat.

export { paintTruck, paintSedan, paintWalkers, paintBoat, paintBikes, paintHandcart, paintConvoyTruck, paintScouts, paintRelief, paintSolo, soloLook, paintCyclist,
  paintRaiderTruck, paintHumvee, paintArmoredTruck, paintWagon, paintTractor, paintZealotCart, paintFortressTruck, paintMilTruck, paintGroupWalkers, paintGroupParty,
  paintOutsiderRaiders, paintOutsiderMerchants, paintOutsiderTravellers, paintHorde, paintHerd, paintHive, paintSkull, paintParked, paintWreckMarker, paintCacheMarker,
  paintCampMarker, paintGraveMarker, paintIcon, paintWake, paintSearchSmoke, armourOverlay, upsCode, groupLook };
