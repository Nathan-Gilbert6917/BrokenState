// Procedural pixel sprites (no image files). Every sprite is painted on a small pixel grid,
// outlined, upscaled once to an offscreen canvas and cached by its look. Used by the battle map
// (drawUnitSprite) and by the HTML panels (spriteURL -> <img>).
//
// Survivors are built from layers in s.appearance (sim/appearance.js): body build, skin, hair,
// facial hair, top style and color, pants, accessory, plus worn armor and the equipped weapon.
// Zombies come in four variants (walker, runner, bloated, brute) with pallor, torn clothes and
// wounds; the look is tuned by the zombie settings (palette, gore, variant style, eye glow).
// Human enemies get a kit outfit (raider, soldier, zealot) tinted with their group's color.
import { Rng } from "../sim/rng.js";
import { ensureAppearance } from "../sim/appearance.js";
import { spriteArmorKey } from "../sim/inventory.js";
import { BLADE_LOOK } from "../sim/data-blades.js"; // knives and swords: their looks
import { GUN_SPRITE } from "../sim/data-guns.js"; // a gun with no art spec: an existing gun's sprite
import { ownKey, isGunKey } from "./gunpaint.js"; // every gun's own small drawing (ui/gunspecs.js)
import { held, weaponLook, unitGun } from "./gunparts.js"; // ... in its finish, with its fitted parts
import { bossBattleCanvas, ztypeBattleCanvas } from "./hivesprites.js";
import { figureCanvas, zombieApp, unitFigure, BW as FW, BH as FH } from "./figures.js"; // the panels show the low-poly figures (a three-quarter heading); the flat painters stay for the fallbacks
import { onForgetPictures } from "./pictures.js";
const PANEL_YAW = 25;

const GW = 22, GH = 26;   // pixel grid
const GRID_W = GW, GRID_H = GH; // the painter's defaults (painter / toCanvas take their own size)
const UP = 4;             // pre-upscale factor for the cached canvas
const OUTLINE = "#0b0c0e";

// ---------- zombie look settings (persisted per browser) ----------
const ZKEY = "brokenstate.zombieLook";
export const ZOMBIE_LOOK_OPTIONS = {
  palette: { name: "Skin palette", tip: "Overall color of the dead", values: [["mixed", "Mixed"], ["rotten", "Rotten green"], ["ashen", "Ashen grey"], ["pale", "Pale blue"], ["burnt", "Burnt"]] },
  gore: { name: "Gore", tip: "How many wounds and how much blood", values: [["0", "None"], ["1", "Some"], ["2", "Heavy"]] },
  variants: { name: "Variants", tip: "Which kinds of dead appear. By strength: the stronger the dead (badly infected ground), the more runners, bloated ones and brutes among the walkers.", values: [["stats", "By strength"], ["mixed", "Random mix"], ["walkers", "Walkers only"]] },
  eyes: { name: "Eyes", tip: "Eye glow on the dead", values: [["glow", "Glowing"], ["red", "Red"], ["dead", "Dull"]] },
  clothes: { name: "Clothes", tip: "How torn their clothes are", values: [["torn", "Torn"], ["rags", "Rags"], ["intact", "Mostly intact"]] },
};
const ZDEFAULT = { palette: "mixed", gore: "1", variants: "stats", eyes: "glow", clothes: "torn" };
let zlook = loadZombieLook();
function loadZombieLook() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(ZKEY) : null;
    const v = raw ? JSON.parse(raw) : {};
    const out = { ...ZDEFAULT };
    for (const k of Object.keys(ZDEFAULT)) if (v && ZOMBIE_LOOK_OPTIONS[k].values.some(([x]) => x === String(v[k]))) out[k] = String(v[k]);
    return out;
  } catch {
    return { ...ZDEFAULT };
  }
}
export const zombieLook = () => zlook;
export function setZombieLook(k, v) {
  if (!ZOMBIE_LOOK_OPTIONS[k] || !ZOMBIE_LOOK_OPTIONS[k].values.some(([x]) => x === String(v))) return;
  zlook = { ...zlook, [k]: String(v) };
  try { localStorage.setItem(ZKEY, JSON.stringify(zlook)); } catch { /* storage blocked: keep for this session */ }
  cache.clear();
}
export function resetZombieLook() {
  zlook = { ...ZDEFAULT };
  try { localStorage.removeItem(ZKEY); } catch { /* ignore */ }
  cache.clear();
}

// ---------- color helpers ----------
function rgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (r, g, b) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
function shade(hex, f) { // f < 0 darker, f > 0 lighter
  const [r, g, b] = rgb(hex);
  return f < 0 ? toHex(r * (1 + f), g * (1 + f), b * (1 + f)) : toHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f);
}
function mix(a, b, t) {
  const x = rgb(a), y = rgb(b);
  return toHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}
const desat = (hex, t) => { const [r, g, b] = rgb(hex); const l = r * 0.3 + g * 0.59 + b * 0.11; return toHex(r + (l - r) * t, g + (l - g) * t, b + (l - b) * t); };

// ---------- painter ----------
// A pixel grid (w × h: the sprites' 22 × 26 by default; ui/gunart.js paints its guns on a bigger one) and its canvas.
export function painter(GW = GRID_W, GH = GRID_H) {
  const px = new Array(GW * GH).fill(null);
  const p = {
    px, w: GW, h: GH,
    set(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < GW && y < GH && c) px[y * GW + x] = c; },
    get(x, y) { return x >= 0 && y >= 0 && x < GW && y < GH ? px[y * GW + x] : null; },
    rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) p.set(x, y, c); },
    clear(x, y) { if (x >= 0 && y >= 0 && x < GW && y < GH) px[y * GW + x] = null; },
  };
  return p;
}

// up: canvas pixels a grid pixel (UP for the sprites).
export function toCanvas(p, up = UP) {
  if (typeof document === "undefined") return null;
  const GW = p.w || GRID_W, GH = p.h || GRID_H, UP = up;
  const cv = document.createElement("canvas");
  cv.width = GW * UP;
  cv.height = GH * UP;
  const c = cv.getContext("2d");
  // Outline: every empty pixel touching a filled one.
  const out = [];
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    if (p.get(x, y)) continue;
    if (p.get(x - 1, y) || p.get(x + 1, y) || p.get(x, y - 1) || p.get(x, y + 1)) out.push([x, y]);
  }
  c.fillStyle = OUTLINE;
  for (const [x, y] of out) c.fillRect(x * UP, y * UP, UP, UP);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const col = p.get(x, y);
    if (!col) continue;
    c.fillStyle = col;
    c.fillRect(x * UP, y * UP, UP, UP);
  }
  return cv;
}

// ---------- body layers ----------
const BUILD = { slim: [7, 13], average: [6, 14], heavy: [5, 15], bloated: [4, 16], brute: [4, 16] };
const SHOE = "#2a2622";

function drawLegs(p, L, R, pants, pose = "stand") {
  const mid = Math.floor((L + R) / 2);
  const dark = shade(pants, -0.25);
  if (pose === "run") {
    p.rect(L + 1, 17, mid - 1, 19, pants); p.rect(L, 20, L + 1, 21, pants); p.rect(L - 1, 22, L + 1, 22, SHOE);
    p.rect(mid + 1, 17, R - 1, 20, dark); p.rect(mid + 2, 21, R, 21, dark); p.rect(mid + 2, 22, R + 1, 22, SHOE);
    return;
  }
  p.rect(L + 1, 17, mid, 21, pants);
  p.rect(mid + 1, 17, R - 1, 21, dark);
  p.rect(mid, 19, mid, 21, shade(pants, -0.45)); // gap between legs
  p.rect(L, 22, mid, 22, SHOE);
  p.rect(mid + 1, 22, R, 22, SHOE);
}

function drawTorso(p, L, R, color, style, skin) {
  const lite = shade(color, 0.12), dark = shade(color, -0.25);
  p.rect(L, 11, R, 16, color);
  p.rect(L, 11, L, 16, lite);
  p.rect(R, 11, R, 16, dark);
  const mid = Math.floor((L + R) / 2);
  if (style === "jacket") {
    p.rect(mid, 11, mid, 16, shade(color, -0.4));
    p.set(mid - 1, 11, lite); p.set(mid + 1, 11, lite);
  } else if (style === "hoodie") {
    p.rect(L + 1, 10, R - 1, 10, dark);
    p.set(mid - 1, 12, "#e6e2d8"); p.set(mid + 1, 12, "#e6e2d8");
    p.rect(mid - 1, 14, mid + 1, 15, dark);
  } else if (style === "flannel") {
    const line = shade(color, -0.45);
    for (let y = 11; y <= 16; y++) for (let x = L; x <= R; x++) if (y % 3 === 0 || x % 3 === 0) p.set(x, y, line);
  } else if (style === "tank") {
    p.rect(L + 1, 11, R - 1, 11, skin);
    p.set(L + 1, 11, color); p.set(R - 1, 11, color);
  } else {
    p.set(mid, 11, skin); p.set(mid + 1, 11, skin); // t-shirt collar
  }
  p.rect(L, 16, R, 16, "#2a2420"); // belt
  p.set(mid, 16, "#b89a50");
}

function drawArms(p, L, R, sleeve, skin, style, pose = "hang") {
  const short = style === "tshirt" || style === "tank";
  const top = style === "tank" ? skin : sleeve;
  if (pose === "reach") {
    // Both arms stretched toward the facing side (right).
    p.rect(L - 2, 11, L - 1, 13, top);
    p.rect(R + 1, 11, R + 6, 12, top);
    p.rect(R + 1, 13, R + 5, 14, short ? skin : shade(sleeve, -0.2));
    if (short) p.rect(R + 3, 11, R + 6, 12, skin);
    p.set(R + 7, 12, skin); p.set(R + 6, 14, skin);
    p.rect(L - 2, 14, L - 1, 15, skin);
    return;
  }
  for (const [x0, x1, sh] of [[L - 2, L - 1, 0.08], [R + 1, R + 2, -0.2]]) {
    p.rect(x0, 11, x1, short ? 12 : 15, shade(top, sh));
    if (short) p.rect(x0, 13, x1, 15, shade(skin, sh));
    p.rect(x0, 16, x1, 16, shade(skin, sh - 0.05));
  }
}

function drawHead(p, skin, ox = 0, oy = 0) {
  const x0 = 7 + ox, y0 = 3 + oy;
  p.rect(x0, y0, x0 + 6, y0 + 6, skin);
  p.rect(x0 + 6, y0, x0 + 6, y0 + 6, shade(skin, -0.15));
  p.set(x0 - 1, y0 + 3, shade(skin, -0.1)); p.set(x0 + 7, y0 + 3, shade(skin, -0.2)); // ears
  p.rect(x0 + 2, y0 + 7, x0 + 4, y0 + 7, shade(skin, -0.2)); // neck
}

// Eyes look toward the facing side (right): white then pupil.
function drawEyes(p, ox = 0, oy = 0) {
  p.set(8 + ox, 6 + oy, "#f0ece4"); p.set(9 + ox, 6 + oy, "#1a1a1a");
  p.set(11 + ox, 6 + oy, "#f0ece4"); p.set(12 + ox, 6 + oy, "#1a1a1a");
}

function drawHair(p, style, hair) {
  const hi = shade(hair, 0.18), lo = shade(hair, -0.25);
  switch (style) {
    case "buzz": p.rect(7, 3, 13, 3, lo); p.set(7, 4, lo); p.set(13, 4, lo); break;
    case "short": p.rect(7, 2, 13, 3, hair); p.rect(8, 2, 11, 2, hi); p.set(7, 4, hair); p.set(13, 4, lo); p.set(6, 4, hair); break;
    case "long": p.rect(7, 2, 13, 3, hair); p.rect(8, 2, 11, 2, hi); p.rect(6, 3, 6, 11, hair); p.rect(14, 3, 14, 11, lo); p.set(7, 4, hair); p.set(13, 4, lo); break;
    case "ponytail": p.rect(7, 2, 13, 3, hair); p.rect(8, 2, 11, 2, hi); p.set(7, 4, hair); p.rect(14, 3, 15, 4, lo); p.rect(15, 5, 15, 9, lo); break;
    case "mohawk": p.rect(9, 0, 11, 3, hair); p.rect(10, 0, 10, 2, hi); p.set(7, 4, lo); p.set(13, 4, lo); break;
    case "curly":
      p.rect(6, 1, 14, 3, hair);
      for (let x = 6; x <= 14; x += 2) p.set(x, 1, hi);
      p.rect(6, 4, 6, 6, hair); p.rect(14, 4, 14, 6, lo); p.set(7, 4, hair); p.set(13, 4, lo);
      break;
    default: p.set(9, 3, shade(p.get(9, 4) || hair, 0.15)); // bald: highlight
  }
}

function drawFacial(p, facial, hair, skin) {
  if (facial === "beard") { p.rect(7, 8, 13, 9, hair); p.rect(8, 10, 12, 10, shade(hair, -0.2)); p.rect(9, 8, 11, 8, shade(skin, -0.35)); }
  else if (facial === "stache") p.rect(8, 8, 12, 8, hair);
  else if (facial === "stubble") { for (let x = 7; x <= 13; x++) if (x % 2) p.set(x, 9, mix(skin, hair, 0.55)); p.rect(9, 8, 11, 8, shade(skin, -0.3)); }
  else p.rect(9, 8, 11, 8, shade(skin, -0.3)); // mouth
}

function drawAccessory(p, acc, col, L, R) {
  const dark = shade(col, -0.3);
  switch (acc) {
    case "cap": p.rect(7, 1, 13, 3, col); p.rect(8, 1, 11, 1, shade(col, 0.15)); p.rect(11, 4, 16, 4, dark); break;
    case "beanie": p.rect(7, 1, 13, 4, col); p.rect(7, 4, 13, 4, dark); p.set(10, 0, shade(col, 0.2)); break;
    case "bandana": p.rect(7, 7, 13, 9, col); p.rect(9, 10, 11, 10, col); p.set(10, 11, dark); p.rect(7, 7, 13, 7, shade(col, 0.15)); break;
    case "glasses": p.rect(7, 6, 13, 6, "#1d1f24"); p.set(8, 6, "#9fc6d8"); p.set(9, 6, "#c9e2ec"); p.set(11, 6, "#9fc6d8"); p.set(12, 6, "#c9e2ec"); break;
    case "headband": p.rect(7, 4, 13, 4, col); p.set(14, 5, col); p.set(15, 6, dark); break;
    case "backpack":
      p.rect(L - 1, 9, L, 10, "#6b4a2a"); p.rect(R, 9, R + 1, 10, "#5a3d22");
      p.rect(L + 1, 11, L + 1, 15, "#4a3220"); p.rect(R - 1, 11, R - 1, 15, "#4a3220");
      break;
    default: break;
  }
}

// Makeshift armor (crafting.js) reuses the vest / plate shapes in its own colors.
const ARMOR_LOOK = { padding: ["vest", "#8a7f6a"], tirevest: ["vest", "#2a2a2a"], sportspads: ["plate", "#b8b0a0"], scrapvest: ["plate", "#6e5a48"] };

function drawArmor(p, key, L, R) {
  if (!key) return;
  const look = ARMOR_LOOK[key];
  if (look) key = look[0];
  const base = look ? look[1] : key === "plate" ? "#3c4148" : "#4d5440";
  p.rect(L + 1, 11, R - 1, 15, base);
  p.rect(L + 1, 11, L + 1, 15, shade(base, 0.15));
  p.rect(R - 1, 11, R - 1, 15, shade(base, -0.25));
  if (key === "plate") { p.rect(L + 2, 14, L + 3, 15, "#2e3237"); p.rect(R - 3, 14, R - 2, 15, "#2e3237"); }
  else p.rect(L + 2, 12, R - 2, 12, shade(base, -0.2));
}

// Weapon in the right hand (sprites face right; flipped at draw time). Every WEAPONS key has a look but bare hands, a
// zombie's teeth and a spitter's acid (WEAPON_UNDRAWN; tools/rostertest.js checks it). Guns: their art spec's small
// drawing (ui/gunpaint.js paintMini), in its finish and with the parts fitted to it when key is a weapon look
// (ui/gunparts.js weaponLook: "key|finish|slot=look,..."); a gun with none: its look-alike's (GUN_SPRITE, else by what
// it is). Returns the muzzle's grid pixel { mx, my } for a gun (the shot's tracer and flash start there).
export const WEAPON_UNDRAWN = ["fists", "claws", "acid"];
function drawWeapon(p, look, R) {
  const key = look && String(look).split("|")[0];
  if (key && isGunKey(key) && (ownKey(key) || !GUN_SPRITE[key])) { const mz = held(p, look, "held", R); if (mz) return mz; }
  const metal = "#9aa3ab", gun = "#2b2e33", wood = "#7a5230";
  const hx = R + 2, hy = 15;
  switch (key) {
    case "knife": p.rect(hx, hy - 3, hx, hy - 1, metal); p.set(hx, hy - 4, "#d6dde2"); p.rect(hx, hy + 1, hx, hy + 2, wood); break;
    case "machete": p.rect(hx + 1, hy - 7, hx + 1, hy - 1, metal); p.rect(hx + 2, hy - 6, hx + 2, hy - 2, "#c2c9cf"); p.rect(hx + 1, hy, hx + 1, hy + 2, "#3a2a1c"); break;
    case "bat": p.rect(hx + 1, hy - 7, hx + 1, hy + 1, "#a07a48"); p.rect(hx + 2, hy - 6, hx + 2, hy - 3, "#8a6638"); break;
    // Makeshift weapons (crafting.js).
    case "spikedbat": drawWeapon(p, "bat", R); p.set(hx, hy - 6, metal); p.set(hx + 3, hy - 5, metal); p.set(hx, hy - 4, metal); break;
    case "spear": p.rect(hx + 1, hy - 8, hx + 1, hy + 2, "#7a5a3a"); p.rect(hx + 1, hy - 10, hx + 1, hy - 9, "#d6dde2"); break;
    case "pipespear": p.rect(hx + 1, hy - 7, hx + 1, hy + 2, "#6d7378"); p.rect(hx + 1, hy - 9, hx + 1, hy - 8, "#d6dde2"); p.set(hx + 1, hy - 3, "#8a8a8a"); break;
    case "sawmachete": drawWeapon(p, "machete", R); p.set(hx + 2, hy - 5, "#7d858c"); p.set(hx + 2, hy - 3, "#7d858c"); break;
    case "crossbow": p.rect(R - 3, 13, R + 5, 13, wood); p.rect(R + 5, 11, R + 5, 15, metal); p.set(R + 6, 13, "#c2c9cf"); break;
    // Special crafted weapons (craft books and blueprints).
    case "springmachete": drawWeapon(p, "machete", R); p.set(hx + 1, hy - 8, "#c2c9cf"); p.rect(hx + 1, hy, hx + 1, hy + 2, "#5b3a22"); break;
    case "pulleybow": p.rect(hx + 1, hy - 6, hx + 1, hy + 4, wood); p.set(hx + 1, hy - 7, metal); p.set(hx + 1, hy + 5, metal); p.rect(hx, hy - 5, hx, hy + 3, "#d6dde2"); break;
    // The weapons overhaul (sim/data-guns.js): melee weapons (the guns and launchers: their art specs).
    case "compbow": case "xbow": drawWeapon(p, key === "xbow" ? "crossbow" : "pulleybow", R); if (key === "compbow") { p.set(hx + 1, hy - 4, "#1a1c20"); p.set(hx + 1, hy + 2, "#1a1c20"); } break;
    case "combatknife": p.rect(hx, hy - 4, hx, hy - 1, "#5a6066"); p.set(hx, hy - 5, "#c2c9cf"); p.rect(hx - 1, hy, hx + 1, hy, "#1a1c20"); p.rect(hx, hy + 1, hx, hy + 2, "#1a1c20"); break;
    case "hatchet": p.rect(hx + 1, hy - 5, hx + 1, hy + 2, wood); p.rect(hx + 2, hy - 6, hx + 3, hy - 4, metal); break;
    case "tomahawk": p.rect(hx + 1, hy - 6, hx + 1, hy + 2, "#2b2e33"); p.rect(hx + 2, hy - 7, hx + 3, hy - 5, metal); p.set(hx, hy - 6, metal); break;
    case "kukri": p.rect(hx + 1, hy - 5, hx + 1, hy - 1, metal); p.rect(hx + 2, hy - 7, hx + 2, hy - 4, "#c2c9cf"); p.rect(hx + 1, hy, hx + 1, hy + 2, "#3a2a1c"); break;
    case "katana": p.rect(hx + 1, hy - 10, hx + 1, hy - 1, "#d6dde2"); p.rect(hx, hy, hx + 2, hy, "#b89a4a"); p.rect(hx + 1, hy + 1, hx + 1, hy + 3, "#1a1c20"); break;
    case "pickaxe": p.rect(hx + 1, hy - 7, hx + 1, hy + 2, wood); p.rect(hx - 1, hy - 8, hx + 4, hy - 8, "#6d7378"); p.set(hx - 2, hy - 7, "#6d7378"); p.set(hx + 5, hy - 7, "#6d7378"); break;
    case "hammer": p.rect(hx + 1, hy - 4, hx + 1, hy + 2, wood); p.rect(hx, hy - 5, hx + 3, hy - 5, "#55595e"); break;
    case "etool": p.rect(hx + 1, hy - 5, hx + 1, hy + 2, "#4b5340"); p.rect(hx, hy - 8, hx + 2, hy - 6, "#5f6b4a"); break;
    case "golfclub": p.rect(hx + 1, hy - 8, hx + 1, hy + 2, "#c2c9cf"); p.rect(hx + 1, hy - 9, hx + 3, hy - 9, "#55595e"); break;
    case "nailbat": drawWeapon(p, "bat", R); p.set(hx, hy - 6, metal); p.set(hx + 3, hy - 6, metal); p.set(hx, hy - 4, metal); p.set(hx + 3, hy - 4, metal); p.set(hx, hy - 2, metal); break;
    case "prybar": p.rect(hx + 1, hy - 7, hx + 1, hy + 2, "#7d858c"); p.set(hx + 2, hy - 8, "#7d858c"); p.set(hx, hy + 2, "#7d858c"); break;
    case "halligan": p.rect(hx + 1, hy - 8, hx + 1, hy + 2, "#9aa3ab"); p.rect(hx, hy - 9, hx + 3, hy - 9, "#9aa3ab"); p.set(hx + 3, hy - 8, "#9aa3ab"); p.set(hx, hy + 2, "#9aa3ab"); break; // a fork at the foot, an adze and a pick at the head (sim/data-survival.js)
    case "pipewrench": p.rect(hx + 1, hy - 5, hx + 1, hy + 2, "#c8362e"); p.rect(hx, hy - 7, hx + 2, hy - 6, "#55595e"); p.set(hx + 3, hy - 7, "#55595e"); break; // a red handle, the jaws (sim/data-survival.js)
    case "fireaxe": p.rect(hx + 1, hy - 7, hx + 1, hy + 2, "#b08a5a"); p.rect(hx + 2, hy - 8, hx + 3, hy - 5, "#c8362e"); p.set(hx + 4, hy - 7, metal); p.set(hx + 4, hy - 6, metal); break;
    case "sledge": p.rect(hx + 1, hy - 6, hx + 1, hy + 2, wood); p.rect(hx - 1, hy - 9, hx + 3, hy - 7, "#55595e"); break;
    // Tools for building and crafting (sim/data-tools.js).
    case "axe": p.rect(hx + 1, hy - 8, hx + 1, hy + 2, "#b08a5a"); p.rect(hx + 2, hy - 9, hx + 4, hy - 6, "#4a4f57"); p.set(hx + 4, hy - 9, "#d6dde2"); p.set(hx + 4, hy - 6, "#d6dde2"); break; // a long handle, a broad dark head
    case "shovel": p.rect(hx + 1, hy - 5, hx + 1, hy + 2, "#9a7a52"); p.rect(hx, hy - 9, hx + 2, hy - 6, "#8d959c"); p.set(hx + 1, hy - 10, "#8d959c"); break; // an ash handle, a round-point blade
    case "scrapaxe": p.rect(hx + 1, hy - 5, hx + 1, hy + 2, "#4a3324"); p.rect(hx + 2, hy - 6, hx + 3, hy - 4, "#9a5a2e"); p.set(hx + 1, hy - 3, "#c9b07a"); break; // a branch, a rusty blade, the cord
    case "baton": p.rect(hx + 1, hy - 5, hx + 1, hy + 2, "#1a1c20"); p.set(hx + 1, hy - 6, "#3a3d40"); break;
    case "stunbaton": drawWeapon(p, "baton", R); p.set(hx + 1, hy - 6, "#ffd23f"); p.set(hx + 1, hy - 5, "#c9a227"); break; // data-nonlethal.js: the contacts at its tip
    default: if (BLADE_LOOK[key]) drawBlade(p, BLADE_LOOK[key], hx, hy); else if (GUN_SPRITE[key] && GUN_SPRITE[key] !== key) drawWeapon(p, GUN_SPRITE[key], R); break; // knives and swords (sim/data-blades.js); a gun with no spec as its look-alike
  }
}
// A knife or a sword held upright in the hand: the blade above the fist (a sabre's curving back), a guard, the hilt.
function drawBlade(p, L, hx, hy) {
  const x = hx + 1, top = hy - 1 - L.len;
  p.rect(x, top, x, hy - 1, L.blade);
  if (L.curve) { p.set(x + 1, top + 1, L.blade); p.set(x + 1, top + 2, L.blade); }
  if (L.len >= 5) p.set(x, top, "#e8eef2"); // the point catches the light
  if (L.guard) p.rect(x - 1, hy, x + 1, hy, L.guard);
  p.rect(x, L.guard ? hy + 1 : hy, x, hy + (L.hilt || 2), L.handle);
}

// The pixels a weapon adds, painted alone (tools/rostertest.js: every weapon has a look). R: the body's right edge.
export function weaponPixels(key, R = 14) { const p = painter(); drawWeapon(p, key, R); return p.px.filter(Boolean).length; }

// ---------- survivors ----------
export function paintSurvivor(app, weaponKey = null, armorKey = null) {
  const p = painter();
  const [L, R] = BUILD[app.build] || BUILD.average;
  if (app.hairStyle === "long" || app.hairStyle === "ponytail") drawHair(p, app.hairStyle, shade(app.hair, -0.3)); // hair behind the head
  drawLegs(p, L, R, app.pants);
  drawTorso(p, L, R, app.top, app.topStyle, app.skin);
  drawArmor(p, armorKey, L, R);
  drawArms(p, L, R, app.top, app.skin, app.topStyle);
  drawHead(p, app.skin);
  drawEyes(p);
  drawFacial(p, app.facial, app.hair, app.skin);
  drawHair(p, app.hairStyle, app.hair);
  drawAccessory(p, app.accessory, app.accent, L, R);
  p.muzzle = drawWeapon(p, weaponKey, R) || null;
  return p;
}

// ---------- zombies ----------
const ZPAL = {
  rotten: ["#8ea36b", "#7f9a62", "#9aa877", "#869868"],
  ashen: ["#a7a69b", "#8f8e86", "#b5b2a5", "#9c9a8f"],
  pale: ["#9fb0b5", "#8fa3aa", "#b4c2c4", "#a5b8bb"],
  burnt: ["#6b5446", "#5c463a", "#7a6152", "#4e3c32"],
};
const ZCLOTH = ["#4a5566", "#6a4a3a", "#55603f", "#6d6f73", "#7a3b32", "#3d3d42", "#8a7a5a", "#45606b"];
export const ZOMBIE_VARIANTS = ["walker", "runner", "bloated", "brute"];

// A zombie's colours, build and top: the first draws of its seed, shared by the standing sprite (paintZombie, which
// goes on drawing from the same rng) and the one lying dead (downsprites.js), so a body looks like the one that fell.
export function zombieLookOf(variant, seed, look = zlook) {
  const rng = new Rng(seed * 2654435761 + 17);
  const pal = look.palette === "mixed" ? ZPAL[rng.pick(["rotten", "ashen", "pale", "rotten", "ashen"])] : ZPAL[look.palette] || ZPAL.rotten;
  const skin = rng.pick(pal);
  const cloth = desat(rng.pick(ZCLOTH), 0.45);
  const pants = desat(shade(rng.pick(ZCLOTH), -0.3), 0.4);
  const gore = Number(look.gore) || 0;
  const eye = look.eyes === "red" || (variant === "runner" && look.eyes !== "dead") ? "#e2412f" : look.eyes === "glow" ? "#e8e07a" : "#c8c4b0";
  const build = variant === "runner" ? "slim" : variant === "bloated" ? "bloated" : variant === "brute" ? "brute" : rng.pick(["slim", "average", "average", "heavy"]);
  const style = variant === "brute" ? "tank" : rng.pick(["tshirt", "jacket", "flannel", "tshirt", "hoodie"]);
  return { rng, pal, skin, cloth, pants, gore, eye, build, style };
}
export function paintZombie(variant, seed, look = zlook) {
  const { rng, skin, cloth, pants, gore, eye, build, style } = zombieLookOf(variant, seed, look);
  const p = painter();
  const [L, R] = BUILD[build];
  if (variant === "walker" && rng.chance(0.5)) drawHair(p, "long", shade(rng.pick(["#3b2a1e", "#6b6b6b", "#8a6a3a"]), -0.3));
  drawLegs(p, L, R, pants, variant === "runner" ? "run" : "stand");
  if (variant === "bloated") {
    p.rect(L, 11, R, 17, cloth); p.rect(L + 2, 13, R - 2, 17, skin); p.rect(L + 3, 14, R - 3, 16, shade(skin, 0.15));
    p.set(L + 4, 15, "#c9c26a"); p.set(R - 4, 14, "#c9c26a"); p.set(L + 6, 16, "#b4ad5a");
    p.rect(R, 11, R, 17, shade(cloth, -0.3));
  } else drawTorso(p, L, R, variant === "brute" ? skin : cloth, style, skin);
  if (variant === "brute") { p.rect(L, 11, R, 12, shade(skin, -0.12)); p.rect(L + 2, 14, R - 2, 14, shade(skin, -0.2)); p.rect(L, 16, R, 16, pants); }
  // Torn clothes: bites out of the edges and patches of skin.
  const tears = look.clothes === "intact" ? 1 : look.clothes === "rags" ? 9 : 4;
  if (variant !== "brute") for (let i = 0; i < tears; i++) {
    const x = rng.int(L, R), y = rng.int(12, 16);
    if (rng.chance(0.4) && (x === L || x === R || y === 16)) p.clear(x, y); else p.set(x, y, shade(skin, -0.1));
  }
  const pose = variant === "bloated" ? "hang" : variant === "runner" ? (rng.chance(0.5) ? "reach" : "hang") : "reach";
  if (variant === "brute") {
    p.rect(L - 3, 11, L - 1, 16, shade(skin, -0.05)); p.rect(R + 1, 11, R + 3, 16, shade(skin, -0.2));
    p.rect(L - 3, 17, L - 1, 17, shade(skin, -0.25)); p.rect(R + 1, 17, R + 3, 17, shade(skin, -0.3));
  } else drawArms(p, L, R, cloth, skin, style, pose);
  if (pose === "reach" && rng.chance(0.25)) { // lost a forearm
    for (let x = R + 4; x <= R + 7; x++) { p.clear(x, 11); p.clear(x, 12); }
    if (gore > 0) p.set(R + 3, 12, "#7a1c18");
  }
  // Head: small for bloated/brute, tilted for walkers.
  const tilt = variant === "walker" ? rng.pick([-1, 0, 0, 1]) : variant === "runner" ? 1 : 0;
  const oy = variant === "brute" || variant === "bloated" ? 1 : 0;
  drawHead(p, skin, tilt, oy);
  p.set(8 + tilt, 6 + oy, eye); p.set(12 + tilt, 6 + oy, eye);
  p.rect(9 + tilt, 8 + oy, 11 + tilt, 8 + oy, "#3a1412"); // open mouth
  if (gore > 0) p.set(10 + tilt, 9 + oy, "#8a1c18");
  if (variant !== "bloated" && rng.chance(0.4)) p.rect(7 + tilt, 3 + oy, 10 + tilt, 3 + oy, shade(skin, -0.35)); // patchy scalp
  // Wounds.
  const wounds = gore === 0 ? 0 : gore === 1 ? rng.int(2, 3) : rng.int(5, 8);
  for (let i = 0; i < wounds; i++) {
    const x = rng.int(L, R), y = rng.int(4, 20);
    if (!p.get(x, y)) continue;
    p.set(x, y, rng.chance(0.6) ? "#8a1c18" : "#5c1210");
    if (gore > 1 && rng.chance(0.4)) p.set(x, y + 1, "#6a1612");
  }
  if (gore > 1) { p.set(L + 1, 13, "#d8d0b8"); p.set(L + 1, 14, "#d8d0b8"); p.rect(L, 21, L + 1, 21, "#5c1210"); }
  return p;
}

// Which variant a battle zombie shows: by its strength or at random. Strength is the unit's power (1 on the
// road, 2 to 5 by the infection of the ground; combat.js enemyUnit gives hp 15 + 7 x power): weak dead are
// walkers, stronger ones bring runners and bloated ones, the strongest brutes. [walker, runner, bloated, brute] odds.
const VARIANT_ODDS = [[4.25, [0.2, 0.3, 0.15, 0.35]], [3.5, [0.35, 0.35, 0.2, 0.1]], [2.6, [0.7, 0.15, 0.15, 0]], [0, [0.88, 0, 0.12, 0]]];
export function zombieVariant(u, seed, look = zlook) {
  const rng = new Rng(seed * 7919 + 3);
  if (look.variants === "walkers") return "walker";
  if (look.variants === "mixed") return rng.pick(["walker", "walker", "runner", "bloated", "brute"]);
  const power = u.power ?? ((u.maxHp || 22) - 15) / 7;
  if (u.mob >= 4) return rng.pick(["runner", "runner", "runner", "brute", "walker"]); // really fast (ZOMBIE_FAST = 4 in combat.js; ordinary dead move 3)
  const odds = VARIANT_ODDS.find(([min]) => power >= min)[1];
  let roll = rng.next();
  for (let i = 0; i < 4; i++) { roll -= odds[i]; if (roll < 0) return ZOMBIE_VARIANTS[i]; }
  return "walker";
}

// ---------- human enemies ----------
// A hostile person's look by kit and seed (every draw of the seed, in the order the painter made them): shared by the
// standing sprite and the one lying knocked out or dead (downsprites.js).
export function enemyLookOf(kit, seed) {
  const rng = new Rng(seed * 40503 + 11);
  const skin = rng.pick(["#f0cdb5", "#d9a37c", "#c08a5f", "#a06e46", "#7d5233", "#5c3a24"]);
  const hair = rng.pick(["#1d1a17", "#3b2a1e", "#6b4526", "#9a6a3a", "#8a8a8a"]);
  if (kit === "soldiers") {
    const olive = rng.pick(["#4f5a36", "#55603b", "#4a5232"]);
    return { kit, skin, hair, olive, facial: rng.pick(["none", "stubble"]) };
  }
  if (kit === "zealots") {
    const robe = rng.pick(["#c9c2b0", "#b8b0a0", "#d4cdbd"]);
    return { kit, skin, hair, robe, facial: rng.pick(["none", "beard", "stache"]) };
  }
  const jacket = rng.pick(["#3a2a20", "#2a2522", "#4a3526", "#2f3338"]);
  const pants = rng.pick(["#2b3442", "#3a3a3a", "#4f4a3a"]);
  const topStyle = rng.pick(["jacket", "tank", "jacket"]);
  const armStyle = rng.pick(["jacket", "tshirt"]);
  const facial = rng.pick(["none", "beard", "stubble"]);
  const hairStyle = rng.pick(["short", "buzz", "mohawk", "long", "bald"]);
  const acc = rng.pick(["bandana", "bandana", "cap", "headband"]);
  const studs = rng.chance(0.5);
  return { kit: "raiders", skin, hair, jacket, pants, topStyle, armStyle, facial, hairStyle, acc, studs };
}
export function paintEnemyHuman(kit, factionColor, weaponKey, armorKey, seed) {
  const k = enemyLookOf(kit, seed);
  const { skin, hair } = k;
  const p = painter();
  const fc = factionColor || "#a63a32";
  if (kit === "soldiers") {
    const olive = k.olive;
    drawLegs(p, 6, 14, shade(olive, -0.1));
    drawTorso(p, 6, 14, olive, "jacket", skin);
    drawArmor(p, armorKey || "vest", 6, 14);
    drawArms(p, 6, 14, olive, skin, "jacket");
    p.rect(6, 12, 6, 12, fc); p.rect(5, 12, 5, 12, fc); // armband in group color
    drawHead(p, skin); drawEyes(p); drawFacial(p, k.facial, hair, skin);
    p.rect(6, 1, 14, 3, shade(olive, -0.15)); p.rect(6, 4, 6, 5, shade(olive, -0.15)); p.rect(14, 4, 14, 5, shade(olive, -0.3)); p.rect(8, 1, 12, 1, olive); // helmet
  } else if (kit === "zealots") {
    const robe = k.robe;
    p.rect(6, 17, 14, 22, shade(robe, -0.1)); p.rect(14, 17, 14, 22, shade(robe, -0.3)); p.rect(10, 18, 10, 22, shade(robe, -0.25));
    drawTorso(p, 6, 14, robe, "tshirt", robe);
    p.rect(6, 16, 14, 16, fc); // sash in group color
    for (let y = 11; y <= 15; y++) p.set(6 + (y - 11), y, fc);
    drawArms(p, 6, 14, robe, skin, "jacket");
    drawHead(p, skin); drawEyes(p); drawFacial(p, k.facial, hair, skin);
    p.rect(6, 1, 14, 3, shade(robe, -0.15)); p.rect(6, 4, 6, 10, shade(robe, -0.15)); p.rect(14, 4, 14, 10, shade(robe, -0.35)); // hood
    p.set(10, 2, fc);
  } else {
    // Raiders: leather and denim, a bandana or cap in the group's color.
    drawLegs(p, 6, 14, k.pants);
    drawTorso(p, 6, 14, k.jacket, k.topStyle, skin);
    drawArmor(p, armorKey, 6, 14);
    drawArms(p, 6, 14, k.jacket, skin, k.armStyle);
    drawHead(p, skin); drawEyes(p); drawFacial(p, k.facial, hair, skin);
    drawHair(p, k.hairStyle, hair);
    drawAccessory(p, k.acc, fc, 6, 14);
    if (k.studs) { p.set(7, 13, "#b8b0a0"); p.set(13, 12, "#b8b0a0"); } // studs / patches
  }
  p.muzzle = drawWeapon(p, weaponKey, 14) || null;
  return p;
}

// ---------- the armoured dead (sim/deadsoldiers.js) ----------
// A dead soldier: rotting skin (the zombie palette), camo fatigues with a sleeve torn off, a plate carrier with
// pouches, a combat helmet with its strap hanging, boots. A dead riot cop: black uniform, a hard chest shell with
// shoulder pads, arm and shin guards, a black helmet with its visor cracked and pushed up. Reaching like walkers.
export const CAMO = ["#55603b", "#3e4630", "#6b6a4a", "#4a3f2c"];
export function armoredLookOf(kind, seed, look = zlook) {
  const z = zombieLookOf("walker", seed, look);
  return { ...z, kind, build: kind === "riot" ? "heavy" : "average" };
}
export function paintArmoredDead(kind, seed, look = zlook) {
  const z = armoredLookOf(kind, seed, look);
  const { rng, skin, gore, eye } = z;
  const p = painter();
  const [L, R] = BUILD[z.build];
  const mid = Math.floor((L + R) / 2);
  if (kind === "riot") {
    const UNI = "#23262d", SHELL = "#3a3d44", GUARD = "#2e3137";
    drawLegs(p, L, R, UNI);
    p.rect(L, 19, mid - 1, 21, GUARD); p.rect(mid + 1, 19, R - 1, 21, shade(GUARD, -0.2)); // shin guards
    p.rect(L, 20, mid - 1, 20, "#4a4e56");
    drawTorso(p, L, R, UNI, "jacket", skin);
    p.rect(L + 1, 11, R - 1, 15, SHELL); p.rect(L + 1, 11, R - 1, 11, shade(SHELL, 0.2));
    for (const y of [13, 15]) p.rect(L + 2, y, R - 2, y, shade(SHELL, -0.3)); // the shell's segments
    drawArms(p, L, R, UNI, skin, "jacket", "reach");
    p.rect(L - 3, 10, L, 11, SHELL); p.rect(R, 10, R + 2, 11, SHELL); // shoulder pads
    p.rect(R + 2, 13, R + 4, 14, GUARD); // forearm guard
    drawHead(p, skin, 0, 0);
    p.set(8, 6, eye); p.set(12, 6, eye);
    p.rect(9, 8, 11, 8, "#3a1412");
    p.rect(6, 1, 14, 3, "#1c1e22"); p.rect(6, 4, 6, 6, "#1c1e22"); p.rect(14, 4, 14, 6, "#141518"); p.rect(8, 1, 12, 1, "#2c2f35"); // helmet
    p.rect(7, 4, 13, 4, "#9fb4c4"); p.set(9, 4, "#d6e4ee"); p.set(12, 4, "#5f7484"); // the visor, pushed up and cracked
  } else {
    const camo = (x0, y0, x1, y1, base) => {
      p.rect(x0, y0, x1, y1, base);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (((x * 7 + y * 13 + seed) % 5) === 0) p.set(x, y, CAMO[1 + ((x + y + seed) % 3)]);
    };
    const BOOT = "#2a2620", CARRIER = rng.pick(["#6b6a4a", "#5b5a40", "#7a6a48"]);
    drawLegs(p, L, R, CAMO[0]);
    camo(L + 1, 17, R - 1, 21, CAMO[0]);
    p.rect(mid, 19, mid, 21, shade(CAMO[0], -0.45));
    p.rect(L, 21, mid, 22, BOOT); p.rect(mid + 1, 21, R, 22, BOOT);
    drawTorso(p, L, R, CAMO[0], "jacket", skin);
    camo(L, 11, R, 16, CAMO[0]);
    // The plate carrier: its plates, pouches across the front, the straps over the shoulders.
    p.rect(L + 1, 11, R - 1, 15, CARRIER);
    p.rect(L + 1, 11, L + 1, 15, shade(CARRIER, 0.15)); p.rect(R - 1, 11, R - 1, 15, shade(CARRIER, -0.25));
    for (const x of [L + 2, mid, R - 3]) p.rect(x, 14, x + 1, 15, shade(CARRIER, -0.3));
    p.rect(L + 2, 10, L + 2, 11, shade(CARRIER, -0.2)); p.rect(R - 2, 10, R - 2, 11, shade(CARRIER, -0.2));
    p.rect(L, 16, R, 16, "#2a2420");
    drawArms(p, L, R, CAMO[0], skin, "jacket", "reach");
    // A torn sleeve: the reaching forearm bare, rotten and bitten.
    p.rect(R + 3, 11, R + 6, 12, shade(skin, -0.05)); p.set(R + 4, 12, "#7a1c18");
    drawHead(p, skin, 0, 0);
    p.set(8, 6, eye); p.set(12, 6, eye);
    p.rect(9, 8, 11, 8, "#3a1412");
    if (gore > 0) p.set(10, 9, "#8a1c18");
    const HEL = rng.pick(["#4f5a36", "#55603b", "#5b5a40"]);
    p.rect(6, 1, 14, 3, HEL); p.rect(6, 4, 6, 5, HEL); p.rect(14, 4, 14, 5, shade(HEL, -0.3)); p.rect(8, 1, 12, 1, shade(HEL, 0.18)); // helmet
    p.rect(5, 4, 15, 4, shade(HEL, -0.2)); // the rim
    p.set(7, 7, "#2a2620"); p.set(7, 8, "#2a2620"); // the chin strap, hanging loose
  }
  const wounds = gore === 0 ? 0 : gore === 1 ? rng.int(2, 3) : rng.int(4, 6);
  for (let i = 0; i < wounds; i++) {
    const x = rng.int(L, R + 4), y = rng.int(5, 20);
    if (p.get(x, y)) p.set(x, y, rng.chance(0.6) ? "#8a1c18" : "#5c1210");
  }
  return p;
}

// ---------- cache and public API ----------
const cache = new Map();
// The muzzle (grid pixel) of the gun in each cached sprite's hand (isoview.js: where a shot starts).
const MUZZLE = new WeakMap();
export const muzzleOf = (cv) => (cv && MUZZLE.get(cv)) || null;
function cached(key, paint) {
  let cv = cache.get(key);
  if (cv === undefined) {
    if (cache.size > 600) cache.clear();
    const p = paint();
    cv = toCanvas(p);
    if (cv && p.muzzle) MUZZLE.set(cv, p.muzzle);
    cache.set(key, cv);
  }
  return cv;
}

const lookKey = (a) => [a.build, a.skin, a.hairStyle, a.hair, a.facial, a.topStyle, a.top, a.pants, a.accessory, a.accent].join("|");

export function survivorCanvas(app, weaponKey = null, armorKey = null) {
  return cached(`s:${lookKey(app)}:${weaponKey}:${armorKey}`, () => paintSurvivor(app, weaponKey, armorKey));
}
export function zombieCanvas(variant, seed, look = zlook) {
  const s = Math.abs(seed | 0) % 97;
  return cached(`z:${variant}:${s}:${look.palette}:${look.gore}:${look.eyes}:${look.clothes}`, () => paintZombie(variant, s, look));
}
export function armoredCanvas(kind, seed, look = zlook) {
  const s = Math.abs(seed | 0) % 97;
  return cached(`a:${kind}:${s}:${look.palette}:${look.gore}:${look.eyes}`, () => paintArmoredDead(kind, s, look));
}
export function enemyCanvas(kit, color, weaponKey, armorKey, seed) {
  const s = Math.abs(seed | 0) % 61;
  return cached(`e:${kit}:${color}:${weaponKey}:${armorKey}:${s}`, () => paintEnemyHuman(kit, color, weaponKey, armorKey, s));
}

// Data URL for <img> previews in HTML panels. Show with class "sprite" (pixelated scaling).
const urls = new Map();
export function canvasURL(cv) {
  if (!cv) return "";
  let u = urls.get(cv);
  if (!u) {
    // Shrink to 2x for a compact URL; CSS scales it up crisply.
    const small = document.createElement("canvas");
    small.width = GW * 2; small.height = GH * 2;
    const c = small.getContext("2d");
    c.imageSmoothingEnabled = false;
    c.drawImage(cv, 0, 0, small.width, small.height);
    u = small.toDataURL("image/png");
    if (urls.size > 400) urls.clear();
    urls.set(cv, u);
  }
  return u;
}
export function survivorURL(s, seed = 0, withGear = true) {
  const app = ensureAppearance(s, seed), g = s.gear || {};
  return canvasURL(figureCanvas(withGear && g.head ? { ...app, helmet: g.head.key } : app, withGear && g.weapon ? weaponLook(g.weapon) : null, withGear ? spriteArmorKey(s) : null, PANEL_YAW, { pack: withGear && !!g.backpack }));
}
export const appearanceURL = (app, weaponKey = null, armorKey = null) => canvasURL(figureCanvas(app, weaponKey, armorKey, PANEL_YAW));
export const zombieURL = (variant, seed, look = zlook) => canvasURL(figureCanvas(zombieApp(variant, seed, look), null, null, PANEL_YAW));
// style: extra CSS for the image (merged into the one style attribute). The figures' grid sets the shape.
export const spriteImg = (url, size = 3, style = "") => (url ? `<img class="sprite" src="${url}" alt="" style="width:${(FW / FH) * size}rem;height:${size}rem${style ? `;${style}` : ""}">` : "");

// ---------- battle map ----------
const variants = new WeakMap(); // battle unit -> zombie variant (kept off the sim objects)
const faces = new WeakMap();    // battle unit -> last known facing

// Which way a unit looks: the direction of its last move or attack in the battle's effect list.
// Default: your people face right (toward the enemy side), enemies face left.
export function unitFacing(b, t) {
  const fx = b.fx || [];
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    let dx = 0;
    if (f.type === "move" && f.unit === t.id) {
      const pts = [f.from, ...(f.path || [])];
      for (let k = pts.length - 1; k > 0 && !dx; k--) dx = pts[k][0] - pts[k - 1][0];
    } else if ((f.type === "shot" || f.type === "melee") && f.from && f.from[0] === t.x && f.from[1] === t.y && f.to) dx = f.to[0] - f.from[0];
    if (dx) {
      faces.set(t, dx > 0 ? 1 : -1);
      break;
    }
  }
  return faces.get(t) ?? (t.side === "player" ? 1 : -1);
}

// One of the risen (sim/carriers.js): the person as they were and in what they wore (one of yours by their own look),
// with no weapon in hand, gone grey-green, a few wounds.
function rot(p, seed) {
  for (let i = 0; i < p.px.length; i++) { const c = p.px[i]; if (c && c.length === 7) p.px[i] = mix(desat(c, 0.45), "#7f9a62", 0.22); }
  const rng = new Rng(seed * 7 + 3);
  for (let k = 0; k < 4; k++) { const x = rng.int(6, 15), y = rng.int(6, 20); if (p.get(x, y)) p.set(x, y, k % 2 ? "#7a1c18" : "#5c1210"); }
  return p;
}
function turnedCanvas(state, b, t) {
  const T = t.turned;
  const s = T.sid != null ? state.survivors.find((x) => x.id === T.sid) : null;
  if (s) {
    const app = ensureAppearance(s, state.seed);
    const armor = spriteArmorKey(s);
    return cached(`t:s:${lookKey(app)}:${armor}`, () => rot(paintSurvivor({ ...app, skin: mix(app.skin, "#9aa877", 0.6) }, null, armor), s.id));
  }
  const seed = Math.abs((T.from * 131) | 0) % 61;
  const f = b && b.setup && b.setup.enemy && b.setup.enemy.factionId != null ? (state.factions || []).find((x) => x.id === b.setup.enemy.factionId) : null;
  return cached(`t:e:${T.kit}:${f ? f.color : ""}:${T.armorKey}:${seed}`, () => rot(paintEnemyHuman(T.kit || "raiders", f ? f.color : null, null, T.armorKey, seed), seed));
}

// Picks the canvas for a battle unit: its figure on its feet (ui/figures.js, for the panels' dolls), else the flat
// sprite. salt varies looks between battles.
export function unitCanvas(state, b, t, salt = 0) {
  const fig = unitFigure(state, b, t, salt, PANEL_YAW, true);
  if (fig) return fig;
  return unitCanvasFlat(state, b, t, salt);
}
export function unitCanvasFlat(state, b, t, salt = 0) {
  if (t.side === "player" && t.kind !== "zombie") {
    const s = state.survivors.find((x) => x.id === t.sid);
    const app = s ? ensureAppearance(s, state.seed) : ensureAppearance({ id: t.id }, salt);
    return survivorCanvas(app, t.weapon && t.weapon !== "fists" ? weaponLook(unitGun(t)) : null, spriteArmorKey(s));
  }
  if (t.boss) return bossBattleCanvas(t.boss === "hivemind" && t.phase2 ? "hivemind2" : t.boss); // the Wallbreaker and the Broodmother (ui/hivesprites.js); the Hivemind torn open in its second phase
  if (t.turned) return turnedCanvas(state, b, t); // one of the risen (sim/carriers.js)
  const seed = (t.id * 131 + salt) | 0;
  // A hive's special dead (sim/zombietypes.js): runners and brutes are the zombie variants, the rest their own.
  if (t.ztype === "runner" || t.ztype === "brute") return zombieCanvas(t.ztype, seed);
  if (t.ztype === "soldier" || t.ztype === "riot") return armoredCanvas(t.ztype, seed); // the armoured dead (sim/deadsoldiers.js)
  if (t.ztype) return ztypeBattleCanvas(t.ztype);
  if (t.kind === "zombie") {
    const vk = `${seed}:${zlook.variants}`;
    let v = variants.get(t);
    if (!v || v.key !== vk) variants.set(t, (v = { key: vk, variant: zombieVariant(t, seed) }));
    return zombieCanvas(v.variant, seed);
  }
  const f = b.setup && b.setup.enemy && b.setup.enemy.factionId != null ? state.factions.find((x) => x.id === b.setup.enemy.factionId) : null;
  return enemyCanvas(t.kit || "raiders", f ? f.color : null, t.weapon && t.weapon !== "fists" ? weaponLook(unitGun(t)) : t.weapon, t.armorKey, seed);
}

onForgetPictures(() => cache.clear()); // ui/pictures.js: drawn again after a lost GPU context
