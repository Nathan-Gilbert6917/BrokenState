// Pixel sprites of the fallen, painted in code like the rest (sprites.js, hivesprites.js): a body seen from above,
// lying on the ground, head to the left, on a 26 × 14 grid. Every kind of unit has its own, built from the same
// look as its standing sprite (the same seed's colours, clothes, hair and kit), so the body is the one that fell:
//   - the dead (paintDownedZombie): sprawled on their back in a pool of blood: a walker in torn clothes, a runner
//     still mid-stride, a bloated one burst open, a brute's slab of a body; the hive's spitter (its acid sac burst,
//     an acid puddle), screamer (mouth still wide, arms flung over its head), crawler (no legs, arms reaching on),
//     shepherd (its shroud spread out, the bone crook beside it);
//     the dead soldier (camo, plate carrier, helmet) and riot cop (black shell, visored helmet); the Wallbreaker (its
//     concrete slab beside it) and the Broodmother (a collapsed mound, her egg sacs burst, the crown of bone).
//   - people (paintDownedSurvivor, paintDownedEnemy: anyone drawn by sprites.js paintSurvivor or paintEnemyHuman,
//     whatever side): "down" (wounded or knocked out: curled on their side, no pool; eyes shut when out cold) and
//     "dead" (sprawled on their back, a pool of blood, their weapon dropped beside the hand).
// searched: a searched body has its pockets turned out (pale linings at the hips) and its weapon gone.
// Drawn flat on the floor by the isometric battle view (isoview.js, drawDowned), which lays the picture onto the
// floor's two axes so it turns with the camera.
import { Rng } from "../sim/rng.js";
import { ensureAppearance } from "../sim/appearance.js";
import { spriteArmorKey } from "../sim/inventory.js";
import { zombieLookOf, enemyLookOf, armoredLookOf, zombieVariant, zombieLook, CAMO } from "./sprites.js";

export const DW = 26, DH = 14; // the grid
const UP = 4;
const OUTLINE = "#0b0c0e";
const BLOOD = "#8a1c18", BLOOD_D = "#5c1210", POOL = "#5a1210b8", SHOE = "#2a2622", BONE = "#d8d0bc";
const LINING = "#e6e2d8";

// ---------- painter and colour helpers ----------
export function downPainter() {
  const px = new Array(DW * DH).fill(null);
  const p = {
    px, w: DW, h: DH,
    set(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < DW && y < DH && c) px[y * DW + x] = c; },
    get(x, y) { return x >= 0 && y >= 0 && x < DW && y < DH ? px[y * DW + x] : null; },
    rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) p.set(x, y, c); },
    disc(cx, cy, rx, ry, c) { for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) p.set(x, y, c); },
    // Only where nothing is yet (a pool under the body).
    under(x, y, c) { if (!p.get(x, y)) p.set(x, y, c); },
  };
  return p;
}
function rgb(hex) { const h = hex.replace("#", "").slice(0, 6); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const toHex = (r, g, b) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
function shade(hex, f) { const [r, g, b] = rgb(hex); return f < 0 ? toHex(r * (1 + f), g * (1 + f), b * (1 + f)) : toHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f); }
const mixc = (a, b, t) => { const x = rgb(a), y = rgb(b); return toHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t); };

// Canvas with a dark outline round every solid pixel; see-through pixels (9-character colours: the pools) get none.
// makeCanvas: injectable for headless tools; a DOM canvas by default, or null without a document.
let makeCanvas = (w, h) => {
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  return cv;
};
export const setDownCanvasMaker = (fn) => { makeCanvas = fn; cache.clear(); };
function toCanvas(p) {
  const cv = makeCanvas(DW * UP, DH * UP);
  if (!cv) return null;
  const c = cv.getContext("2d");
  const solid = (x, y) => { const v = p.get(x, y); return !!v && v.length <= 7; };
  // The pools first (under the outline), then the outline, then the body.
  for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) { const v = p.get(x, y); if (v && v.length > 7) { c.fillStyle = v; c.fillRect(x * UP, y * UP, UP, UP); } }
  c.fillStyle = OUTLINE;
  for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) {
    if (solid(x, y)) continue;
    if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) c.fillRect(x * UP, y * UP, UP, UP);
  }
  for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) { const v = p.get(x, y); if (v && v.length <= 7) { c.fillStyle = v; c.fillRect(x * UP, y * UP, UP, UP); } }
  return cv;
}
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
export const clearDownCache = () => cache.clear();

// ---------- the body ----------
// Half the body's width (rows either side of the middle row) by build.
const HALF = { slim: 2, average: 3, heavy: 3, bloated: 5, brute: 4, robe: 3 };
const CY = 7;

// A pool of blood (or acid, or ooze) under where the body lies: see-through, drawn before it.
function pool(p, col = POOL, cx = 11, cy = CY, rx = 8.5, ry = 5) {
  p.disc(cx, cy, rx, ry, col);
  p.disc(cx + rx * 0.7, cy + ry * 0.55, rx * 0.35, ry * 0.4, col); // a run of it
}

// The head, seen from above: skull to the left (x 1), chin to the right (x 5).
function head(p, d, x0, y0) {
  const sk = d.skin, lo = shade(sk, -0.18);
  p.rect(x0, y0, x0 + 4, y0 + 4, sk);
  p.rect(x0, y0 + 4, x0 + 4, y0 + 4, lo);
  p.set(x0 + 2, y0 - 1, shade(sk, -0.1)); p.set(x0 + 2, y0 + 5, lo); // ears
  // Hair round the skull (on the ground behind the head when long).
  const hair = d.hair, hs = d.hairStyle;
  if (hair && hs && hs !== "bald") {
    const hi = shade(hair, 0.15);
    if (hs === "long" || hs === "curly") { p.rect(x0 - 1, y0, x0 + 1, y0 + 4, hair); p.rect(x0, y0 - 1, x0 + 1, y0 - 1, hair); p.rect(x0, y0 + 5, x0 + 1, y0 + 5, hair); p.rect(x0 - 1, y0 + 1, x0 - 1, y0 + 3, hi); }
    else if (hs === "ponytail") { p.rect(x0, y0, x0 + 1, y0 + 4, hair); p.rect(x0 - 2, y0 + 2, x0 - 1, y0 + 2, hair); }
    else if (hs === "mohawk") p.rect(x0, y0 + 2, x0 + 2, y0 + 2, hair);
    else if (hs === "buzz") p.rect(x0, y0, x0, y0 + 4, shade(hair, -0.2));
    else { p.rect(x0, y0, x0 + 1, y0 + 4, hair); p.rect(x0, y0 + 1, x0, y0 + 3, hi); }
  }
  // The face: eyes (open and dull, or shut), the mouth, a beard.
  const ex = x0 + 2, open = d.eye;
  p.set(ex, y0 + 1, open ? d.eye : lo); p.set(ex, y0 + 3, open ? d.eye : lo);
  if (d.mouth === "scream") { p.rect(x0 + 3, y0 + 1, x0 + 4, y0 + 3, "#1a0608"); p.set(x0 + 4, y0 + 2, "#5c1210"); }
  else p.set(x0 + 3, y0 + 2, d.mouth === "open" ? "#3a1412" : shade(sk, -0.35));
  if (d.facial === "beard" && hair) p.rect(x0 + 4, y0, x0 + 4, y0 + 4, hair);
  else if (d.facial === "stache" && hair) p.rect(x0 + 3, y0 + 1, x0 + 3, y0 + 3, hair);
  else if (d.facial === "stubble" && hair) { p.set(x0 + 4, y0 + 1, mixc(sk, hair, 0.5)); p.set(x0 + 4, y0 + 3, mixc(sk, hair, 0.5)); }
}
// Headgear over the head at (x0, y0).
function headgear(p, d, x0, y0) {
  const g = d.gear;
  if (!g) return;
  if (g.kind === "helmet") { // a combat helmet: a dome over the skull, its rim, the strap across the cheek
    p.rect(x0 - 1, y0, x0 + 2, y0 + 4, g.col); p.rect(x0, y0 - 1, x0 + 2, y0 - 1, g.col); p.rect(x0, y0 + 5, x0 + 2, y0 + 5, g.col);
    p.rect(x0, y0, x0 + 1, y0 + 1, shade(g.col, 0.18)); p.rect(x0 + 2, y0 - 1, x0 + 2, y0 + 5, shade(g.col, -0.25));
    p.set(x0 + 3, y0 + 4, "#2a2620");
  } else if (g.kind === "riot") { // a riot helmet, the visor cracked and pushed up
    p.rect(x0 - 1, y0, x0 + 2, y0 + 4, "#1c1e22"); p.rect(x0, y0 - 1, x0 + 1, y0 - 1, "#1c1e22"); p.rect(x0, y0 + 5, x0 + 1, y0 + 5, "#1c1e22");
    p.rect(x0 + 2, y0 - 1, x0 + 2, y0 + 5, "#9fb4c4"); p.set(x0 + 2, y0 + 1, "#d6e4ee"); p.set(x0 + 2, y0 + 3, "#5f7484");
  } else if (g.kind === "hood") {
    p.rect(x0 - 1, y0 - 1, x0 + 1, y0 + 5, g.col); p.rect(x0 + 2, y0 - 1, x0 + 2, y0 - 1, g.col); p.rect(x0 + 2, y0 + 5, x0 + 2, y0 + 5, shade(g.col, -0.2));
    if (g.mark) p.set(x0, y0 + 2, g.mark);
  } else if (g.kind === "bandana") { p.rect(x0 + 3, y0, x0 + 4, y0 + 4, g.col); p.set(x0 + 5, y0 + 2, shade(g.col, -0.3)); }
  else if (g.kind === "headband") p.rect(x0 + 1, y0, x0 + 1, y0 + 4, g.col);
  else if (g.kind === "beanie") p.rect(x0, y0, x0 + 1, y0 + 4, g.col);
  else if (g.kind === "glasses") { p.set(x0 + 2, y0 + 1, "#9fc6d8"); p.set(x0 + 2, y0 + 3, "#9fc6d8"); p.set(x0 + 2, y0 + 2, "#1d1f24"); }
  else if (g.kind === "cap") { p.rect(0, 11, 2, 12, g.col); p.rect(3, 12, 4, 12, shade(g.col, -0.3)); } // knocked off, beside the head
}

// Body armour over the torso (x 7..14, rows t0..t1).
function armour(p, d, t0, t1) {
  const a = d.armor;
  if (!a) return;
  const base = a.col;
  p.rect(8, t0 + 1, 13, t1 - 1, base);
  p.rect(8, t0 + 1, 13, t0 + 1, shade(base, 0.15)); p.rect(8, t1 - 1, 13, t1 - 1, shade(base, -0.25));
  if (a.kind === "plate" || a.kind === "carrier") { for (const y of [t0 + 2, t1 - 2]) { p.set(12, y, shade(base, -0.35)); p.set(13, y, shade(base, -0.35)); } }
  if (a.kind === "carrier") { for (let y = t0 + 2; y <= t1 - 2; y += 2) p.set(10, y, shade(base, -0.3)); p.rect(7, t0 + 1, 7, t0 + 1, shade(base, -0.2)); p.rect(7, t1 - 1, 7, t1 - 1, shade(base, -0.2)); }
  if (a.kind === "riot") { for (const x of [9, 11, 13]) p.rect(x, t0 + 1, x, t1 - 1, shade(base, -0.3)); p.rect(7, t0, 8, t0, base); p.rect(7, t1, 8, t1, base); }
  if (a.kind === "vest") p.rect(10, t0 + 1, 10, t1 - 1, shade(base, -0.2));
}

// The weapon dropped beside the hand (a dead person's, until the body is searched).
function droppedWeapon(p, key) {
  if (!key) return;
  const metal = "#9aa3ab", gun = "#2b2e33", wood = "#7a5230";
  const y = 13;
  switch (key) {
    case "pistol": case "revolver": p.rect(15, y, 17, y, gun); p.set(15, y - 1, gun); break;
    case "knife": case "baton": p.rect(15, y, 18, y, key === "baton" ? "#2b2e33" : metal); p.set(14, y, wood); break;
    case "machete": case "sawmachete": case "springmachete": p.rect(15, y, 20, y, metal); p.set(14, y, "#3a2a1c"); break;
    case "bat": case "spikedbat": case "nailbat": p.rect(14, y, 20, y, "#a07a48"); p.set(21, y, "#8a6638"); break;
    case "prybar": case "crowbar": case "pipespear": case "spear": p.rect(14, y, 21, y, "#6d7378"); break;
    case "fireaxe": case "sledge": p.rect(14, y, 20, y, wood); p.rect(21, y - 1, 21, y, key === "sledge" ? "#5b5f63" : "#a83a2a"); break;
    case "shotgun": case "pipegun": p.rect(12, y, 21, y, gun); p.rect(12, y - 1, 14, y - 1, wood); break;
    case "huntrifle": case "leverrifle": p.rect(12, y, 22, y, wood); p.rect(18, y, 22, y, gun); break;
    case "ar": case "carbine": p.rect(12, y, 21, y, gun); p.set(16, y - 1, gun); p.set(13, y - 1, gun); break;
    case "crossbow": case "compbow": case "xbow": case "pulleybow": p.rect(13, y, 20, y, wood); p.rect(20, y - 2, 20, y, metal); break;
    default: break;
  }
}

// Wounds on the body (seeded): dark red on what is painted.
function wounds(p, rng, n, x0 = 1, x1 = 22) {
  for (let i = 0; i < n; i++) {
    const x = rng.int(x0, x1), y = rng.int(2, 11), c = p.get(x, y);
    if (!c || c.length > 7) continue;
    p.set(x, y, rng.chance(0.6) ? BLOOD : BLOOD_D);
  }
}
// Pockets turned out at the hips: the body has been searched.
function linings(p, t0, t1) { p.set(14, t0, LINING); p.set(14, t1, LINING); p.set(15, t0, shade(LINING, -0.2)); }

// Lays a body down. d: { pose "dead" | "down", skin, top, sleeve, short (short sleeves), pants, shoe, hair, hairStyle,
// facial, build, eye (open eyes' colour) or null (shut), mouth, armor { kind, col }, gear (headgear), legs ("none":
// a crawler), arms ("up": both flung over the head; "forward": reaching on past it), stride, robe, bare (no top:
// a brute's tank top), pool colour (null: none), weapon, searched }. Returns { t0, t1 } (the torso's rows).
export function layBody(p, d) {
  const hh = HALF[d.build] ?? 3;
  const t0 = CY - hh, t1 = CY + hh;
  const top = d.top, sleeve = d.sleeve || top, sk = d.skin;
  const arm = (short) => (short ? sk : sleeve);
  if (d.pose === "down") return curled(p, d);
  if (d.pool) pool(p, d.pool, 11, CY, d.build === "bloated" || d.build === "brute" ? 10.5 : 9.5, d.build === "bloated" ? 6.8 : 5.8);
  // Legs: one splayed out, one straight; boots at the end. A crawler has stumps.
  const pants = d.robe ? shade(top, -0.1) : d.pants;
  if (d.legs === "none") {
    p.rect(15, CY - 2, 16, CY - 1, pants); p.rect(15, CY + 1, 16, CY + 2, shade(pants, -0.2));
    p.rect(17, CY - 2, 17, CY - 1, BLOOD_D); p.rect(17, CY + 1, 17, CY + 2, BLOOD_D);
  } else if (d.robe) {
    p.rect(15, CY - 3, 21, CY + 3, pants); p.rect(15, CY, 21, CY, shade(pants, -0.2)); p.rect(22, CY - 3, 23, CY - 2, SHOE); p.rect(22, CY + 2, 23, CY + 3, SHOE);
  } else {
    const lw = d.build === "brute" || d.build === "bloated" ? 3 : 2;
    const up = d.stride ? 3 : 1;
    p.rect(15, CY - 1 - lw, 18, CY - 2, pants);                       // the upper leg, thigh then shin bent out
    p.rect(19, CY - 1 - lw - up, 22, CY - 2 - up, pants);
    p.rect(23, CY - 1 - lw - up, 24, CY - 2 - up, d.shoe || SHOE);
    p.rect(15, CY + 1, 22, CY + lw, shade(pants, -0.18));             // the lower leg straight
    p.rect(23, CY + 1, 24, CY + lw, d.shoe || SHOE);
    p.rect(15, CY - 1, 16, CY, shade(pants, -0.3));                   // the crotch
  }
  // The torso; the belt.
  p.rect(7, t0, 14, t1, d.bare ? sk : top);
  p.rect(7, t0, 14, t0, shade(d.bare ? sk : top, 0.12)); p.rect(7, t1, 14, t1, shade(d.bare ? sk : top, -0.25));
  if (d.topStyle === "jacket") p.rect(7, CY, 14, CY, shade(top, -0.4));
  else if (d.topStyle === "flannel") for (let y = t0; y <= t1; y++) for (let x = 7; x <= 14; x++) if ((x + y) % 3 === 0) p.set(x, y, shade(top, -0.4));
  else if (d.topStyle === "hoodie") { p.rect(7, t0 + 1, 7, t1 - 1, shade(top, -0.25)); p.set(9, CY - 1, LINING); p.set(9, CY + 1, LINING); }
  else if (d.topStyle === "tank" && !d.bare) { p.rect(7, t0, 8, t0 + 1, sk); p.rect(7, t1 - 1, 8, t1, sk); }
  else if (d.topStyle === "camo") for (let y = t0; y <= t1; y++) for (let x = 7; x <= 14; x++) if (((x * 7 + y * 13) % 5) === 0) p.set(x, y, CAMO[1 + ((x + y) % 3)]);
  if (!d.robe) { p.rect(14, t0, 14, t1, "#2a2420"); p.set(14, CY, "#b89a50"); }
  armour(p, d, t0, t1);
  // Arms: flung out (one up past the head, one down along the body), both over the head (a screamer), both reaching
  // on (a crawler).
  const aw = d.build === "brute" ? 3 : 2;
  const handC = sk;
  if (d.arms === "forward") {
    p.rect(1, t0 - 2, 7, t0 - 1, arm(d.short)); p.rect(0, t0 - 2, 0, t0 - 1, handC);
    p.rect(1, t1 + 1, 7, t1 + 2, arm(d.short)); p.rect(0, t1 + 1, 0, t1 + 2, handC);
  } else if (d.arms === "up") {
    for (let i = 0; i < 4; i++) { p.rect(7 - i * 2, t0 - 1 - i, 8 - i * 2, t0 - 1 - i, i >= 3 ? handC : arm(d.short && i > 0)); p.rect(7 - i * 2, t1 + 1 + i, 8 - i * 2, t1 + 1 + i, i >= 3 ? handC : arm(d.short && i > 0)); }
  } else {
    for (let i = 0; i < 4; i++) { const y = t0 - 1 - i; if (y < 0) break; p.rect(8 - i, y, 8 - i + aw - 1, y, i >= 3 || y === 0 ? handC : arm(d.short && i > 0)); }
    for (let i = 0; i < 4; i++) { const y = t1 + 1 + i; if (y > DH - 1) break; p.rect(9 + i, y, 9 + i + aw - 1, y, i >= 3 || y === DH - 1 ? handC : arm(d.short && i > 0)); }
  }
  // Neck and head (the hood, a helmet over it).
  p.rect(6, CY - 1, 6, CY + 1, shade(sk, -0.2));
  head(p, d, 1, CY - 2);
  headgear(p, d, 1, CY - 2);
  if (!d.searched) droppedWeapon(p, d.weapon);
  else linings(p, t0, t1);
  return { t0, t1 };
}

// Down but alive (wounded, or knocked out): curled on the side, knees drawn up, an arm over the stomach and one
// under the head. No pool (a drop or two when wounded).
function curled(p, d) {
  const sk = d.skin, top = d.top, sleeve = d.sleeve || top;
  const hh = Math.max(2, (HALF[d.build] ?? 3) - 1);
  const t0 = CY - hh, t1 = CY + hh - 1;
  const pants = d.robe ? shade(top, -0.1) : d.pants;
  // Legs drawn up: thighs out to the knees, shins folded back, the shoes behind.
  p.rect(14, t0 + 1, 17, t1 - 1, pants); p.rect(14, t0 + 1, 17, t0 + 1, shade(pants, -0.2));
  p.rect(18, t0 + 2, 18, t1 - 1, shade(pants, -0.1));
  p.rect(13, t1, 18, t1 + 2, shade(pants, -0.15));
  p.rect(11, t1, 12, t1 + 2, d.shoe || SHOE);
  // The torso, hunched.
  p.rect(7, t0, 13, t1, top);
  p.rect(7, t0, 13, t0, shade(top, 0.12)); p.rect(7, t1, 13, t1, shade(top, -0.25));
  if (d.topStyle === "camo") for (let y = t0; y <= t1; y++) for (let x = 7; x <= 13; x++) if (((x * 7 + y * 13) % 5) === 0) p.set(x, y, CAMO[1 + ((x + y) % 3)]);
  armour(p, { armor: d.armor }, t0, t1);
  // An arm over the stomach (the hand on the wound), one under the head.
  p.rect(9, CY, 12, CY + 1, d.short ? sk : sleeve); p.set(13, CY + 1, sk);
  p.rect(2, t1 + 1, 6, t1 + 2, d.short ? sk : sleeve); p.set(1, t1 + 1, sk);
  p.rect(6, CY - 1, 6, CY + 1, shade(sk, -0.2));
  head(p, { ...d, eye: null }, 1, CY - 3);
  headgear(p, d, 1, CY - 3);
  if (!d.ko) { p.set(11, t0 + 1, BLOOD); p.set(12, CY + 1, BLOOD); p.set(12, t1 + 1, "#6a1612"); }
  if (d.searched) linings(p, t0, t1);
  return { t0, t1 };
}

// ---------- the dead ----------
// The ordinary dead by their sprite variant (sprites.js: walker, runner, bloated, brute), the same seed as standing.
export function paintDownedZombie(variant, seed, look = zombieLook(), searched = false) {
  const z = zombieLookOf(variant, seed, look);
  const rng = new Rng(seed * 7717 + 5);
  const p = downPainter();
  const torn = look.clothes === "intact" ? 1 : look.clothes === "rags" ? 8 : 4;
  const d = {
    pose: "dead", skin: z.skin, top: variant === "brute" ? z.skin : z.cloth, pants: z.pants, build: z.build, topStyle: z.style,
    short: z.style === "tshirt" || z.style === "tank", bare: variant === "brute", eye: look.eyes === "dead" ? null : shade(z.eye, -0.35), mouth: "open",
    hair: variant === "walker" && seed % 2 ? ["#3b2a1e", "#6b6b6b", "#8a6a3a"][seed % 3] : null, hairStyle: variant === "walker" && seed % 2 ? "long" : "bald",
    stride: variant === "runner", pool: z.gore ? POOL : "#3a1a14a0", searched,
  };
  const { t0, t1 } = layBody(p, d);
  if (variant === "bloated") {
    // Burst: the belly split open, yellow rot spilling out, an ooze pool round it.
    p.disc(11, CY, 3, 2.6, "#3a1412");
    for (const [x, y] of [[10, CY - 1], [12, CY + 1], [11, CY], [9, CY + 1]]) p.set(x, y, "#c9c26a");
    p.set(13, CY - 1, "#b4ad5a"); p.set(8, CY - 2, shade(z.skin, 0.2)); p.set(14, CY + 2, shade(z.skin, 0.2));
    p.disc(12, CY + 4.5, 5, 1.6, "#6a6a20a0");
  }
  if (variant === "brute") { p.rect(7, t0 + 1, 13, t0 + 1, shade(z.skin, -0.12)); p.rect(9, CY + 1, 12, CY + 1, shade(z.skin, -0.2)); }
  // Torn clothes: bites out of the edges, skin showing through.
  if (variant !== "brute") for (let i = 0; i < torn; i++) { const x = rng.int(7, 13), y = rng.int(t0, t1); p.set(x, y, shade(z.skin, -0.1)); }
  wounds(p, rng, z.gore === 0 ? 0 : z.gore === 1 ? 3 : 7);
  if (z.gore > 1) { p.set(9, t0, "#d8d0b8"); p.set(10, t0, "#d8d0b8"); }
  return p;
}

// The hive's special dead and the armoured dead (sim/zombietypes.js, deadsoldiers.js).
export function paintDownedZType(kind, seed = 0, look = zombieLook(), searched = false) {
  const rng = new Rng(seed * 9173 + 29);
  const p = downPainter();
  const eye = look.eyes === "dead" ? null : "#8a8448";
  if (kind === "spitter") {
    const SKIN = "#8ea36b";
    p.disc(9, CY, 8, 5.5, "#6a9a1aa8"); // the acid it spilled
    layBody(p, { pose: "dead", skin: SKIN, top: "#4a4f44", pants: "#4a4f44", build: "heavy", eye, mouth: "open", pool: POOL, searched });
    p.disc(10, CY - 3.2, 2.6, 2, "#9ad63a"); p.set(9, CY - 4, "#e2f8a0"); p.set(11, CY - 3, "#3a1412"); p.set(12, CY - 2, "#3a1412"); // the burst sac
    p.set(5, CY - 1, "#9ad63a"); p.set(5, CY + 1, "#9ad63a"); p.set(6, CY + 2, "#9ad63a");
  } else if (kind === "screamer") {
    layBody(p, { pose: "dead", skin: "#a7a69b", top: "#3d3d42", pants: "#3d3d42", build: "slim", eye: "#e2412f", mouth: "scream", arms: "up", pool: POOL, searched });
  } else if (kind === "crawler") {
    layBody(p, { pose: "dead", skin: "#9fb0b5", top: "#55603f", pants: "#55603f", build: "average", eye, mouth: "open", legs: "none", arms: "forward", pool: POOL, searched });
  } else if (kind === "shepherd") {
    // The Shepherd: its shroud spread out, the hood fallen back, the bone crook beside it.
    const SHROUD = "#5d5a66";
    layBody(p, { pose: "dead", skin: "#b9b4c8", top: SHROUD, robe: true, pants: SHROUD, build: "robe", eye: look.eyes === "dead" ? null : "#9a94ff", mouth: "open", gear: { kind: "hood", col: shade(SHROUD, -0.15) }, pool: POOL, searched });
    p.rect(3, 12, 22, 12, BONE); p.rect(22, 10, 22, 12, BONE); p.set(21, 10, BONE); // the crook
  } else if (kind === "soldier") {
    const z = armoredLookOf("soldier", seed, look);
    const r2 = new Rng(seed * 31 + 3);
    layBody(p, {
      pose: "dead", skin: z.skin, top: CAMO[0], topStyle: "camo", pants: shade(CAMO[0], -0.1), shoe: "#2a2620", build: "average", eye: eye && shade(z.eye, -0.35), mouth: "open",
      armor: { kind: "carrier", col: ["#6b6a4a", "#5b5a40", "#7a6a48"][seed % 3] }, gear: { kind: "helmet", col: ["#4f5a36", "#55603b", "#5b5a40"][r2.int(0, 2)] },
      pool: POOL, searched,
    });
    p.rect(10, CY + 5, 11, CY + 5, z.skin); p.set(11, CY + 5, BLOOD); // the torn sleeve: the bare, bitten forearm
    wounds(p, rng, z.gore ? 3 : 0, 7, 22);
  } else if (kind === "riot") {
    const z = armoredLookOf("riot", seed, look);
    layBody(p, {
      pose: "dead", skin: z.skin, top: "#23262d", pants: "#23262d", shoe: "#141518", build: "heavy", eye: eye && shade(z.eye, -0.35), mouth: "open",
      armor: { kind: "riot", col: "#3a3d44" }, gear: { kind: "riot" }, pool: POOL, searched,
    });
    p.rect(19, CY - 5, 21, CY - 4, "#2e3137"); p.rect(19, CY + 2, 21, CY + 3, "#2e3137"); // shin guards
    wounds(p, rng, z.gore ? 2 : 0, 7, 22);
  } else if (kind === "boneback") {
    // Plates of bone over its chest and face (sim/middead.js).
    layBody(p, { pose: "dead", skin: "#9a9483", top: "#4b4a42", pants: "#3e3d36", build: "heavy", eye, mouth: "open", pool: POOL, searched });
    p.rect(8, CY - 3, 13, CY + 3, BONE);
    for (const y of [CY - 2, CY, CY + 2]) p.rect(8, y, 13, y, shade(BONE, -0.28));
    p.rect(1, CY - 2, 4, CY + 1, BONE); p.set(2, CY - 1, "#3a1412"); p.set(2, CY + 1, "#3a1412");
  } else if (kind === "climber") {
    // Thin, arms flung up, hooked fingers.
    layBody(p, { pose: "dead", skin: "#a59a8c", top: "#4d4438", pants: "#3a352d", build: "slim", eye, mouth: "open", arms: "up", pool: POOL, searched });
    for (const [x, y] of [[0, CY - 6], [1, CY - 6], [0, CY + 6], [1, CY + 6]]) p.set(x, y, BONE);
  } else if (kind === "flinger") {
    // Long arms reaching on, the mass of worms it held spilled beside it.
    layBody(p, { pose: "dead", skin: "#8f9a86", top: "#3f4a3a", pants: "#353b31", build: "average", eye, mouth: "open", arms: "forward", pool: POOL, searched });
    p.disc(3, CY + 4.5, 2.6, 1.5, "#d9cfb2"); for (const [x, y] of [[1, CY + 4], [3, CY + 5], [5, CY + 4], [2, CY + 6]]) p.set(x, y, "#f0e4c0");
  } else if (kind === "sower") {
    // Swollen, its egg sacs split open.
    layBody(p, { pose: "dead", skin: "#a8a07a", top: "#5a5440", pants: "#4a4536", build: "bloated", eye, mouth: "open", pool: POOL, searched });
    for (const [x, y] of [[9, CY - 3], [12, CY + 2], [10, CY + 3]]) { p.disc(x, y, 1.6, 1.3, "#e8dca0"); p.set(x, y, "#b4a860"); }
    for (const [x, y] of [[6, CY + 5], [15, CY - 5], [17, CY + 5]]) p.set(x, y, "#e8dca0");
  } else if (kind === "nightmare") {
    // Dark and gaunt, the mouth still open on its scream.
    layBody(p, { pose: "dead", skin: "#6e6a78", top: "#1e1c24", pants: "#1e1c24", build: "slim", eye: "#e2412f", mouth: "scream", arms: "up", pool: POOL, searched });
  } else if (kind === "sleeper") {
    // A body split open down the middle, the worms spilling out of it (sim/sleepers.js).
    layBody(p, { pose: "dead", skin: "#9aa08a", top: "#4a4a44", pants: "#3c3c38", build: "average", eye: null, mouth: "open", pool: POOL, searched });
    p.rect(8, CY - 1, 14, CY + 1, "#3a1412");
    for (const [x, y] of [[9, CY], [11, CY - 1], [12, CY + 1], [13, CY], [7, CY + 2], [15, CY - 2], [16, CY + 3], [6, CY - 3], [10, CY + 4]]) p.set(x, y, "#f0e4c0");
  } else if (kind === "carrier") return paintDownedZombie("bloated", seed, look, searched); // burst open, the worms gone (sim/carriers.js)
  else return paintDownedZombie("walker", seed, look, searched);
  wounds(p, rng, 2, 7, 20);
  return p;
}

// The bosses: the Wallbreaker (a grey slab of a body, its concrete fist beside it) and the Broodmother (the mound
// collapsed, her egg sacs burst, the crown of bone).
export function paintDownedBoss(kind) {
  const p = downPainter();
  if (kind === "hivemind") { // burst open and sagging into its pool, grey and cold (sim/hivecrawl.js)
    p.disc(13, CY, 12.5, 7, "#2a1018c0");
    p.disc(13, CY, 10, 5.8, "#7a6066"); p.disc(12, CY - 1, 6.5, 3.4, "#9a8086");
    for (const [x, y] of [[6, CY - 2], [16, CY + 2], [11, CY + 3], [19, CY - 1]]) { p.set(x, y, "#3a1412"); p.set(x + 1, y, "#3a1412"); }
    p.rect(9, CY - 1, 15, CY, "#3a1412"); // split down the middle
    for (const [x, y] of [[3, 3], [23, 12], [4, 12]]) { p.disc(x, y, 1.4, 1.2, "#8a6a3a"); }
    return p;
  }
  if (kind === "broodmother") {
    const SKIN = "#9a7a86", DARK = "#5e3a48", LIT = "#c4a2ae";
    p.disc(13, CY, 12.5, 6.8, "#2a1018c0");
    p.disc(14, CY, 10, 5.5, SKIN); p.disc(15, CY + 0.5, 7, 3.6, LIT);
    for (const [x, y] of [[9, 3], [14, 2], [19, 4], [12, 11], [18, 10]]) { p.disc(x, y, 1.8, 1.5, "#e8b46a"); p.set(x, y, "#3a1412"); p.set(x + 1, y, "#b07a3a"); } // burst sacs
    for (const [x, y] of [[11, 6], [17, 8], [20, 6]]) p.set(x, y, "#8a1c22");
    p.rect(1, CY - 2, 5, CY + 2, SKIN); p.rect(1, CY + 2, 5, CY + 2, DARK);
    p.set(3, CY - 1, "#8a8448"); p.set(3, CY + 1, "#8a8448"); p.set(2, CY, "#8a8448");
    p.rect(4, CY - 1, 4, CY + 1, "#3a1412");
    for (const y of [CY - 2, CY, CY + 2]) p.set(0, y, BONE); // the crown of bone
    p.rect(23, 2, 24, 3, DARK); p.rect(23, 11, 24, 12, DARK); p.set(25, 3, BONE); p.set(25, 12, BONE);
    return p;
  }
  const SKIN = "#8f9a86", DARK = "#5e6858", SLAB = "#9a968c", PANTS = "#3a3a36";
  layBody(p, { pose: "dead", skin: SKIN, top: SKIN, bare: true, pants: PANTS, build: "brute", eye: "#8a2a20", mouth: "open", pool: POOL });
  p.rect(7, 2, 14, 3, DARK); p.rect(8, 5, 12, 5, DARK);
  for (const [x, y] of [[9, 6], [12, 9], [10, 10]]) p.set(x, y, BLOOD);
  p.rect(13, 11, 19, 13, SLAB); p.rect(13, 11, 19, 11, shade(SLAB, 0.3)); p.set(15, 12, "#7a4a30"); p.set(17, 13, "#7a4a30"); // the concrete slab
  return p;
}

// ---------- people ----------
// What a survivor looks like lying: their appearance (sim/appearance.js), body armour and weapon.
const ARMOR_COLS = { vest: ["vest", "#4d5440"], plate: ["plate", "#3c4148"], padding: ["vest", "#8a7f6a"], tirevest: ["vest", "#2a2a2a"], sportspads: ["plate", "#b8b0a0"], scrapvest: ["plate", "#6e5a48"], riotarms: null };
const armorOf = (key) => { const a = key ? ARMOR_COLS[key] : null; return a ? { kind: a[0], col: a[1] } : null; };
export function survivorDownDesc(app, weaponKey = null, armorKey = null, pose = "dead", opts = {}) {
  const gear = app.accessory === "cap" || app.accessory === "beanie" || app.accessory === "bandana" || app.accessory === "headband" || app.accessory === "glasses" ? { kind: app.accessory, col: app.accent } : null;
  return {
    pose, skin: app.skin, top: app.top, topStyle: app.topStyle, short: app.topStyle === "tshirt" || app.topStyle === "tank", pants: app.pants,
    hair: app.hair, hairStyle: app.hairStyle, facial: app.facial, build: app.build === "heavy" ? "heavy" : app.build === "slim" ? "slim" : "average",
    eye: pose === "dead" ? "#3a3a3a" : null, mouth: "closed", armor: armorOf(armorKey), gear, weapon: weaponKey, pool: pose === "dead" ? POOL : null, ...opts,
  };
}
export function paintDownedSurvivor(app, weaponKey = null, armorKey = null, pose = "dead", opts = {}) {
  const p = downPainter();
  layBody(p, survivorDownDesc(app, weaponKey, armorKey, pose, opts));
  if (app.accessory === "backpack" && pose === "dead") { p.rect(8, 1, 12, 2, "#6b4a2a"); p.rect(9, 1, 11, 1, "#5a3d22"); } // the pack slipped off
  return p;
}
// A hostile person by kit (sprites.js enemyLookOf: the same seed's look), tinted by their group's colour.
export function enemyDownDesc(kit, factionColor, weaponKey, armorKey, seed, pose = "dead", opts = {}) {
  const k = enemyLookOf(kit, seed);
  const fc = factionColor || "#a63a32";
  const base = { pose, skin: k.skin, hair: k.hair, facial: k.facial, eye: pose === "dead" ? "#3a3a3a" : null, mouth: "closed", weapon: weaponKey, pool: pose === "dead" ? POOL : null, build: "average", ...opts };
  if (kit === "soldiers") return { ...base, top: k.olive, topStyle: "jacket", pants: shade(k.olive, -0.1), hairStyle: "buzz", armor: armorOf(armorKey || "vest") || { kind: "vest", col: "#4d5440" }, gear: { kind: "helmet", col: shade(k.olive, -0.15) }, band: fc };
  if (kit === "zealots") return { ...base, top: k.robe, robe: true, topStyle: "tshirt", pants: shade(k.robe, -0.1), hairStyle: "bald", gear: { kind: "hood", col: shade(k.robe, -0.15), mark: fc }, sash: fc };
  const acc = k.acc === "cap" ? { kind: "cap", col: fc } : k.acc === "headband" ? { kind: "headband", col: fc } : { kind: "bandana", col: fc };
  return { ...base, top: k.jacket, topStyle: k.topStyle, short: k.armStyle === "tshirt", pants: k.pants, hairStyle: k.hairStyle, armor: armorOf(armorKey), gear: acc, studs: k.studs };
}
export function paintDownedEnemy(kit, factionColor, weaponKey, armorKey, seed, pose = "dead", opts = {}) {
  const p = downPainter();
  const d = enemyDownDesc(kit, factionColor, weaponKey, armorKey, seed, pose, opts);
  const { t0, t1 } = layBody(p, d);
  if (d.band && pose === "dead") { p.set(7, t0 - 1, d.band); p.set(8, t0 - 1, d.band); } // the armband, on the flung arm
  if (d.band && pose !== "dead") p.set(9, CY, d.band);
  if (d.sash) for (let i = 0; i <= t1 - t0; i++) p.set(8 + Math.round(i * 5 / Math.max(1, t1 - t0)), t0 + i, d.sash);
  if (d.studs) { p.set(9, t0 + 1, "#b8b0a0"); p.set(12, t1 - 1, "#b8b0a0"); }
  return p;
}

// ---------- canvases ----------
const lookKey = (a) => [a.build, a.skin, a.hairStyle, a.hair, a.facial, a.topStyle, a.top, a.pants, a.accessory, a.accent].join("|");
export const downedSurvivorCanvas = (app, weaponKey, armorKey, pose, opts = {}) =>
  cached(`ds:${lookKey(app)}:${weaponKey}:${armorKey}:${pose}:${opts.ko ? 1 : 0}:${opts.searched ? 1 : 0}`, () => paintDownedSurvivor(app, weaponKey, armorKey, pose, opts));
export const downedEnemyCanvas = (kit, color, weaponKey, armorKey, seed, pose, opts = {}) => {
  const s = Math.abs(seed | 0) % 61;
  return cached(`de:${kit}:${color}:${weaponKey}:${armorKey}:${s}:${pose}:${opts.ko ? 1 : 0}:${opts.searched ? 1 : 0}`, () => paintDownedEnemy(kit, color, weaponKey, armorKey, s, pose, opts));
};
export const downedZombieCanvas = (variant, seed, look = zombieLook(), searched = false) => {
  const s = Math.abs(seed | 0) % 97;
  return cached(`dz:${variant}:${s}:${look.palette}:${look.gore}:${look.eyes}:${look.clothes}:${searched ? 1 : 0}`, () => paintDownedZombie(variant, s, look, searched));
};
export const downedZTypeCanvas = (kind, seed, look = zombieLook(), searched = false) => {
  const s = Math.abs(seed | 0) % 97;
  return cached(`dt:${kind}:${kind === "soldier" || kind === "riot" ? s : 0}:${look.palette}:${look.gore}:${look.eyes}:${searched ? 1 : 0}`, () => paintDownedZType(kind, kind === "soldier" || kind === "riot" ? s : 0, look, searched));
};
export const downedBossCanvas = (kind) => cached(`db:${kind}`, () => paintDownedBoss(kind));
// A body lying on a battle map (sim/sleepers.js b.corpses): one of the ordinary dead (a walker, now and then a bloated
// one), a Sleeper split open, or burnt black where a fire went over it. A Sleeper not yet split looks like any other.
export function corpseCanvas(c, look = zombieLook()) {
  if (c.burnt) return cached(`dc:burnt:${c.seed % 7}`, () => charred(paintDownedZombie("walker", c.seed % 7, look)));
  if (c.burst) return downedZTypeCanvas("sleeper", 0, look);
  return downedZombieCanvas(c.seed % 5 === 0 ? "bloated" : "walker", c.seed, look);
}
function charred(p) {
  for (let i = 0; i < p.px.length; i++) {
    const v = p.px[i];
    if (!v) continue;
    const [r, g, b] = rgb(v);
    const k = (r * 0.3 + g * 0.5 + b * 0.2) * 0.32;
    p.px[i] = v.length > 7 ? "#1c1814a0" : toHex(k + 6, k + 3, k);
  }
  return p;
}

// The body container of a unit in a raid (sim/combat.js: kind "body", uid), if any: searched shows on the sprite.
// A field battle's body searched where it fell (sim/ground.js b.fieldLoot) the same way.
const bodySearched = (b, t) => { const L = b && (b.raid || b.fieldLoot); return !!(L && L.containers.some((c) => c.kind === "body" && c.uid === t.id && c.searched)); };
// The picture of a fallen unit (dead, or down: wounded / knocked out), the same look as its standing sprite
// (sprites.js unitCanvas). Every unit drawn by paintSurvivor (your people, anyone with an appearance) or
// paintEnemyHuman (any hostile kit) gets one, whatever its side.
export function unitDownCanvas(state, b, t, salt = 0) {
  const pose = t.dead ? "dead" : "down";
  const searched = t.dead && bodySearched(b, t);
  if (t.kind === "zombie") {
    if (t.boss) return downedBossCanvas(t.boss);
    const seed = (t.id * 131 + salt) | 0;
    if (t.ztype === "runner" || t.ztype === "brute") return downedZombieCanvas(t.ztype, seed, zombieLook(), searched);
    if (t.ztype) return downedZTypeCanvas(t.ztype, seed, zombieLook(), searched);
    return downedZombieCanvas(zombieVariant(t, seed), seed, zombieLook(), searched);
  }
  const opts = { ko: !!t.ko, searched };
  if (t.side === "player" || t.app) {
    const s = t.sid != null ? state.survivors.find((x) => x.id === t.sid) : null;
    const app = t.app || (s ? ensureAppearance(s, state.seed) : ensureAppearance({ id: t.id }, salt));
    return downedSurvivorCanvas(app, t.weapon && t.weapon !== "fists" ? t.weapon : null, s ? spriteArmorKey(s) : t.armorKey || null, pose, opts);
  }
  const seed = (t.id * 131 + salt) | 0;
  const f = b && b.setup && b.setup.enemy && b.setup.enemy.factionId != null ? (state.factions || []).find((x) => x.id === b.setup.enemy.factionId) : null;
  return downedEnemyCanvas(t.kit || "raiders", f ? f.color : null, t.weapon, t.armorKey, seed, pose, opts);
}

// Size of a fallen unit's picture against a tile (its length along the body): bosses and brutes are bigger.
export const downScale = (t) => (t.boss ? 1.45 : t.ztype === "brute" || t.ztype === "boneback" || t.ztype === "sower" ? 1.2 : 1.05);
// Draws it flat on the floor: (X, Y) the tile's middle on screen, ax / ay the screen vectors of one tile along the
// world's x and y (the projected floor axes). The body lies along x, head
// toward −x (facing −1: toward +x).
export function drawDowned(ctx, cv, X, Y, ax, ay, { facing = 1, scale = 1.05, alpha = 1 } = {}) {
  if (!cv) return;
  const k = scale / cv.width; // canvas px → tiles
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.imageSmoothingEnabled = false;
  const f = facing < 0 ? -1 : 1;
  ctx.transform(ax[0] * k * f, ax[1] * k * f, ay[0] * k, ay[1] * k, X, Y);
  ctx.drawImage(cv, -cv.width / 2, -cv.height / 2, cv.width, cv.height);
  ctx.restore();
}
