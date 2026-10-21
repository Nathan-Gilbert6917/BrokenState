// A prototype of the survivor sprite polish (docs/design-doc/sprites/survivor-sprites.md): the weapon held in the
// hands instead of floating beside the body, a 28-wide canvas, the item art's top-left light, helmets and visors on
// the head, straps on the armour, the worn pack. Not wired into the game: tools/spritemock.html lays the before and
// after side by side, tools/spritemockshot.cjs saves the sheets. The body layers are copies of ui/sprites.js's with
// the changes marked "mock:"; paintSurvivor there is the "before".
import { painter, paintSurvivor, WEAPON_UNDRAWN } from "../src/ui/sprites.js";
import { held } from "../src/ui/gunparts.js";
import { ownKey, isGunKey, specOf, norm } from "../src/ui/gunpaint.js";
import { BLADE_LOOK } from "../src/sim/data-blades.js";
import { GUN_SPRITE } from "../src/sim/data-guns.js";
import { shade } from "../src/ui/itemart/kit.js";

export const MW = 28, MH = 26, OX = 3; // mock: 3 columns each side of the 22-wide body; the body's own coordinates stay
const BUILD = { slim: [7, 13], average: [6, 14], heavy: [5, 15] };
const SHOE = "#2a2622";
const rgb = (h) => [1, 3, 5].map((i) => parseInt(String(h).slice(i, i + 2), 16));
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`; };

// A painter whose body coordinates sit OX columns in on the wide canvas (q.p is the real painter for toCanvas).
function bodyPainter() {
  const p = painter(MW, MH);
  const q = {
    p, w: MW, h: MH,
    set: (x, y, c) => p.set(x + OX, y, c),
    get: (x, y) => p.get(x + OX, y),
    rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) q.set(x, y, c); },
    clear: (x, y) => p.clear(x + OX, y),
  };
  return q;
}

// ---------- holds ----------
// Which hold a weapon gets (the brief, "Hold grammar"). Guns by the kind the painter resolves them to; melee by the
// two-handed table; bows upright; crossbows like a long gun.
export const TWO_HANDED = ["bat", "spikedbat", "nailbat", "sledge", "fireaxe", "pickaxe", "spear", "pipespear", "golfclub", "hockeystick", "katana", "broadsword"];
export const BOWS = ["pulleybow", "compbow"], XBOWS = ["crossbow", "xbow"];
export const HOLDS = ["none", "side", "shouldered", "bow", "pistol", "level2", "lowready", "tube"];
function gunKind(key) {
  const sp = specOf(key);
  if (!sp) return null;
  const s = norm(sp.key, null);
  const m = { ...(s.fam && s.fam.mini ? s.fam.mini(s) : {}), ...(s.mini || {}) };
  return { kind: s.kind, shoulder: !!m.shoulder };
}
export function holdOf(look) {
  const key = look && String(look).split("|")[0];
  if (!key || WEAPON_UNDRAWN.includes(key)) return "none";
  if (isGunKey(key)) {
    const g = gunKind(key);
    if (!g) return "side";
    if (g.shoulder) return "tube";
    if (g.kind === "pistol" || g.kind === "revolver") return "pistol";
    if (g.kind === "smg") return "level2";
    return "lowready";
  }
  if (TWO_HANDED.includes(key)) return "shouldered";
  if (BOWS.includes(key)) return "bow";
  if (XBOWS.includes(key)) return "lowready";
  return "side";
}

// The level gun as the game draws it (ui/gunparts.js held: hx = R0 + 1, y = 13; pistols R0 + 2, 14), on a scratch grid.
function paintGunLevel(q, look, R0) {
  const key = String(look).split("|")[0];
  if (isGunKey(key) && (ownKey(key) || !GUN_SPRITE[key])) { const mz = held(q, look, "held", R0); if (mz) return mz; }
  if (GUN_SPRITE[key] && GUN_SPRITE[key] !== key) return paintGunLevel(q, GUN_SPRITE[key], R0);
  return null;
}
// Copies the scratch onto the body painter: the pivot (px, py) lands on (gx, gy), every other pixel through f(dx, dy).
const stair = (d) => Math.floor((d + 1) / 2); // a 2:1 pixel stair
export const LOW = (dx, dy) => [dx, dy + stair(dx)];  // muzzle down, 2:1
export const BACK = (dx, dy) => [dx + dy, dy];        // leaning back over the shoulder, 1:1
export const FLAT = (dx, dy) => [dx, dy];
const OUTLINE = "#0b0c0e";
function blit(src, q, px, py, gx, gy, f = FLAT, keep = null, rim = false) {
  const cells = [];
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const c = src.px[y * src.w + x];
    if (!c) continue;
    const [dx, dy] = f(x - px, y - py);
    if (!keep || keep(gx + dx, gy + dy)) cells.push([gx + dx, gy + dy, c]);
  }
  if (rim) { // mock: a dark rim where the weapon lies over the body (toCanvas outlines only against empty pixels)
    const own = new Set(cells.map(([x, y]) => `${x},${y}`));
    for (const [x, y] of cells) for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) if (!own.has(`${nx},${ny}`) && q.get(nx, ny)) q.set(nx, ny, OUTLINE);
  }
  for (const [x, y, c] of cells) q.set(x, y, c);
}
// The last body column a weapon may reach (one free for the outline); a gun wanted further forward slides back.
const LIMIT = MW - OX - 2;
function fit(gx, src, px) { let maxx = -1; for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) if (src.px[y * src.w + x]) maxx = Math.max(maxx, x); return Math.min(gx, LIMIT - (maxx - px)); }
const movePoint = (mz, px, py, gx, gy, f) => { if (!mz) return null; const [dx, dy] = f(mz.mx - px, mz.my - py); return { mx: gx + dx + OX, my: gy + dy }; };

// ---------- body layers (ui/sprites.js, with the mock's changes) ----------
function drawLegs(p, L, R, pants) {
  const mid = Math.floor((L + R) / 2);
  const dark = shade(pants, -0.25);
  p.rect(L + 1, 17, mid, 21, pants);
  p.rect(mid + 1, 17, R - 1, 21, dark);
  p.rect(L + 1, 17, mid, 17, shade(pants, 0.12)); p.rect(mid + 1, 17, R - 1, 17, shade(dark, 0.12)); // mock: the top light on the thighs
  p.rect(mid, 19, mid, 21, shade(pants, -0.45));
  p.rect(L, 22, mid, 22, SHOE);
  p.rect(mid + 1, 22, R, 22, SHOE);
}
function drawTorso(p, L, R, color, style, skin) {
  const lite = shade(color, 0.12), dark = shade(color, -0.25);
  p.rect(L, 11, R, 16, color);
  p.rect(L, 11, L, 16, lite);
  p.rect(R, 11, R, 16, dark);
  p.rect(L, 11, R - 1, 11, lite); // mock: the top light on the shoulders
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
    p.set(mid, 11, skin); p.set(mid + 1, 11, skin);
  }
  p.rect(L, 16, R, 16, "#2a2420");
  p.set(mid, 16, "#b89a50");
}
function drawHead(p, skin) {
  const x0 = 7, y0 = 3;
  p.rect(x0, y0, x0 + 6, y0 + 6, skin);
  p.rect(x0 + 6, y0, x0 + 6, y0 + 6, shade(skin, -0.15));
  p.rect(x0, y0, x0 + 5, y0, shade(skin, 0.12)); // mock: the top light on the crown (hair covers it on most)
  p.set(x0 - 1, y0 + 3, shade(skin, -0.1)); p.set(x0 + 7, y0 + 3, shade(skin, -0.2));
  p.rect(x0 + 2, y0 + 7, x0 + 4, y0 + 7, shade(skin, -0.2));
}
function drawEyes(p) { p.set(8, 6, "#f0ece4"); p.set(9, 6, "#1a1a1a"); p.set(11, 6, "#f0ece4"); p.set(12, 6, "#1a1a1a"); }
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
    default: p.set(9, 3, shade(p.get(9, 4) || hair, 0.15));
  }
}
function drawFacial(p, facial, hair, skin) {
  if (facial === "beard") { p.rect(7, 8, 13, 9, hair); p.rect(8, 10, 12, 10, shade(hair, -0.2)); p.rect(9, 8, 11, 8, shade(skin, -0.35)); }
  else if (facial === "stache") p.rect(8, 8, 12, 8, hair);
  else if (facial === "stubble") { for (let x = 7; x <= 13; x++) if (x % 2) p.set(x, 9, mix(skin, hair, 0.55)); p.rect(9, 8, 11, 8, shade(skin, -0.3)); }
  else p.rect(9, 8, 11, 8, shade(skin, -0.3));
}
export const HEAD_ACC = ["cap", "beanie", "bandana", "headband"]; // mock: what a helmet replaces (glasses stay, under a visor)
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
const ARMOR_LOOK = { padding: ["vest", "#8a7f6a"], tirevest: ["vest", "#2a2a2a"], sportspads: ["plate", "#b8b0a0"], scrapvest: ["plate", "#6e5a48"] };
function drawArmor(p, key, L, R) {
  if (!key) return;
  const look = ARMOR_LOOK[key];
  if (look) key = look[0];
  const base = look ? look[1] : key === "plate" ? "#3c4148" : "#4d5440";
  p.rect(L + 1, 11, R - 1, 15, base);
  p.rect(L + 1, 11, L + 1, 15, shade(base, 0.15));
  p.rect(R - 1, 11, R - 1, 15, shade(base, -0.25));
  // mock: straps over the shoulders, the top light, a dark hem so the vest reads against a top of the same colour
  p.rect(L + 1, 10, L + 2, 10, shade(base, -0.3)); p.rect(R - 2, 10, R - 1, 10, shade(base, -0.4));
  p.rect(L + 2, 11, R - 2, 11, shade(base, 0.2));
  p.rect(L + 1, 15, R - 1, 15, shade(base, -0.4));
  if (key === "plate") { p.rect(L + 2, 13, L + 3, 14, "#2e3237"); p.rect(R - 3, 13, R - 2, 14, "#2e3237"); }
  else p.rect(L + 2, 12, R - 2, 12, shade(base, -0.2));
}
// mock: the worn pack (inventory.js EQUIP_SLOTS backpack), behind the body, its straps over the shoulders.
function drawPack(p, L, R) {
  const c = "#6b4a2a";
  p.rect(L - 4, 9, L - 2, 17, c); p.rect(L - 4, 9, L - 4, 17, shade(c, 0.15)); p.rect(L - 4, 9, L - 2, 10, shade(c, -0.3));
  p.rect(L - 4, 13, L - 2, 13, shade(c, -0.2)); p.set(L - 3, 11, "#b89a50");
  p.rect(L + 1, 11, L + 1, 15, "#4a3220"); p.rect(R - 1, 11, R - 1, 15, "#4a3220");
}

// ---------- helmets (sim/data-helmets.js HELMET_GEAR, the seven worn on the head) ----------
// Drawn over the hair in place of a cap, beanie, bandana or headband. v: { kind: "ballistic" | "riot" | null, up }.
function visor(p, kind, up, col = kind === "ballistic" ? "#c9e2ec" : "#9fc6d8") {
  if (up) { p.rect(8, 0, 14, 0, col); p.set(14, 1, shade(col, -0.3)); return; } // pushed up on the brow
  p.rect(8, 5, 14, 8, col);
  p.set(8, 5, shade(col, 0.3)); p.set(9, 6, shade(col, 0.3)); // the light across it
  p.rect(14, 5, 14, 8, shade(col, -0.25)); p.rect(8, 8, 14, 8, shade(col, -0.2));
  if (kind === "ballistic") p.rect(8, 5, 14, 5, shade(col, -0.35)); // the thick rim
}
export const HELMETS = {
  hardhat(p, v) { const y = "#e6c23a"; p.rect(7, 1, 13, 3, y); p.rect(8, 1, 11, 1, "#f2d36a"); p.rect(10, 1, 10, 3, "#f2d36a"); p.rect(6, 4, 15, 4, "#b8952a"); p.set(16, 4, "#b8952a"); if (v && v.kind) visor(p, v.kind, v.up); },
  highcut(p, v) { const t = "#b89a62", d = "#8a7244"; p.rect(7, 1, 13, 3, t); p.rect(8, 1, 11, 1, shade(t, 0.15)); p.rect(7, 4, 12, 4, t); p.set(13, 4, d); p.set(7, 3, d); p.rect(13, 2, 13, 3, "#2a2d33"); p.rect(10, 4, 11, 4, "#2a2d33"); if (v && v.kind) visor(p, v.kind, v.up); },
  milhelmet(p) { const o = "#55603b"; p.rect(7, 1, 13, 3, o); p.rect(8, 1, 11, 1, shade(o, 0.15)); p.rect(6, 4, 15, 4, shade(o, -0.2)); for (const [x, y] of [[8, 2], [11, 3], [12, 1]]) p.set(x, y, shade(o, -0.3)); p.rect(14, 5, 14, 7, "#4a3220"); },
  rivethelmet(p) { const s = "#7d858c"; p.rect(7, 1, 13, 4, s); p.rect(8, 1, 11, 1, "#9aa3ab"); for (const x of [7, 9, 11, 13]) p.set(x, 2, "#c9ced3"); p.rect(7, 4, 13, 4, shade(s, -0.2)); p.rect(6, 5, 6, 6, shade(s, -0.2)); },
  footballhelmet(p) { const b = "#3a6fb0"; p.rect(6, 1, 14, 5, b); p.rect(7, 1, 12, 1, "#5f93cf"); p.rect(10, 1, 10, 5, "#eef0f2"); p.rect(6, 6, 6, 8, b); p.rect(13, 6, 14, 8, b); p.set(13, 5, shade(b, -0.3)); for (const x of [9, 11]) p.rect(x, 6, x, 8, "#9aa1a8"); p.rect(8, 7, 14, 7, "#9aa1a8"); },
  bikehelmet(p, v) { const r = "#c8402f"; p.rect(6, 1, 14, 4, r); p.rect(7, 1, 12, 1, "#e2654f"); p.rect(6, 5, 6, 9, r); p.rect(14, 5, 14, 9, shade(r, -0.25)); p.rect(7, 9, 13, 9, shade(r, -0.2)); p.set(14, 1, shade(r, -0.25)); if (v && v.up) p.rect(8, 2, 14, 2, "#383b41"); else { p.rect(8, 5, 14, 6, "#383b41"); p.set(9, 5, "#55595e"); } },
  riothelmet(p, v) { const k = "#202226"; p.rect(6, 1, 14, 4, k); p.rect(7, 1, 12, 1, "#383b41"); p.rect(6, 5, 6, 8, k); p.rect(14, 1, 14, 4, "#121316"); visor(p, "riot", !!(v && v.up)); },
};

// ---------- arms, hands and the weapon in them ----------
// A limb two pixels thick from (x0, y0) to (x1, y1).
function limb(p, x0, y0, x1, y1, c) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, flat = dx >= -dy;
  let err = dx + dy, x = x0, y = y0;
  for (;;) {
    p.set(x, y, c); if (flat) p.set(x, y + 1, c); else p.set(x + 1, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}
function fist(p, x, y, skin) { p.rect(x, y, x + 1, y, shade(skin, -0.05)); p.rect(x, y + 1, x + 1, y + 1, shade(skin, -0.25)); }
// A hanging arm (ui/sprites.js drawArms, one side): x0..x1 its columns.
function hangArm(p, x0, x1, sleeve, skin, style, sh) {
  const short = style === "tshirt" || style === "tank";
  const top = style === "tank" ? skin : sleeve;
  p.rect(x0, 11, x1, short ? 12 : 15, shade(top, sh));
  p.set(x0, 11, shade(top, sh + 0.15)); // mock: the top light
  if (short) p.rect(x0, 13, x1, 15, shade(skin, sh));
  p.rect(x0, 16, x1, 16, shade(skin, sh - 0.05));
}
// The near arm reaching forward at chest height: the upper arm down to row 12, the forearm level to the hand at hx.
function forwardArm(p, R, hx, sleeve, skin, style) {
  const short = style === "tshirt" || style === "tank";
  const top = style === "tank" ? skin : sleeve;
  p.rect(R + 1, 11, R + 2, 12, shade(top, -0.2)); p.set(R + 1, 11, shade(top, -0.05));
  limb(p, R + 2, 13, hx, 13, short ? shade(skin, -0.1) : shade(sleeve, -0.3));
}
// Where each hold puts the hands (body coordinates, facing right; R the body's right edge): the grip hand, the
// support hand, where the weapon's pivot lands and how it is turned.
// Where each hold puts the hands and the weapon (body coordinates, facing right; R the body's right edge; gx the
// weapon's pivot column once fitted on the canvas, from `want`): the grip hand, the support hand and its forearm's
// start, where the pivot lands and how the weapon is turned.
const HAND = {
  pistot: null,
  pistol:    { want: (R) => R + 4, at: (R, mid, gx) => ({ grip: [gx - 1, 14], gun: [gx, 13], f: FLAT, arm: "forward" }) },
  level2:    { want: (R) => R + 3, at: (R, mid, gx) => ({ grip: [gx - 1, 14], gun: [gx, 13], f: FLAT, arm: "forward", support: [gx + 3, 14], from: [mid + 1, 15] }) },
  lowready:  { want: (R) => R + 2, at: (R, mid, gx) => ({ grip: [gx, 14], gun: [gx, 14], f: LOW, arm: "hang", support: [gx + 4, 16], from: [mid, 15] }) },
  tube:      { want: (R) => R + 1, at: (R, mid, gx) => ({ grip: [gx, 13], gun: [gx, 13], f: FLAT, arm: "hang" }) },
  side:      { want: (R) => R + 2, at: (R, mid, gx) => ({ grip: [gx - 1, 15], gun: [gx, 15], f: FLAT, arm: "hang" }) },
  shouldered:{ want: (R) => R + 2, at: (R, mid, gx) => ({ grip: [gx - 1, 15], gun: [gx, 14], f: BACK, arm: "hang", support: [gx - 2, 12], from: [mid, 13] }) },
  bow:       { want: (R) => R + 4, at: (R, mid, gx) => ({ grip: [gx - 1, 14], gun: [gx, 14], f: FLAT, arm: "forward" }) },
};
delete HAND.pistot;

// The melee drawings of ui/sprites.js drawWeapon, with the hand at (hx, hy) (the game: hx = R + 2, hy = 15).
function drawMelee(p, key, hx, hy) {
  const metal = "#9aa3ab", wood = "#7a5230";
  switch (key) {
    case "knife": p.rect(hx, hy - 3, hx, hy - 1, metal); p.set(hx, hy - 4, "#d6dde2"); p.rect(hx, hy + 1, hx, hy + 2, wood); break;
    case "machete": p.rect(hx + 1, hy - 7, hx + 1, hy - 1, metal); p.rect(hx + 2, hy - 6, hx + 2, hy - 2, "#c2c9cf"); p.rect(hx + 1, hy, hx + 1, hy + 2, "#3a2a1c"); break;
    case "bat": p.rect(hx + 1, hy - 7, hx + 1, hy + 1, "#a07a48"); p.rect(hx + 2, hy - 6, hx + 2, hy - 3, "#8a6638"); break;
    case "spikedbat": drawMelee(p, "bat", hx, hy); p.set(hx, hy - 6, metal); p.set(hx + 3, hy - 5, metal); p.set(hx, hy - 4, metal); break;
    case "spear": p.rect(hx + 1, hy - 8, hx + 1, hy + 2, "#7a5a3a"); p.rect(hx + 1, hy - 10, hx + 1, hy - 9, "#d6dde2"); break;
    case "pipespear": p.rect(hx + 1, hy - 7, hx + 1, hy + 2, "#6d7378"); p.rect(hx + 1, hy - 9, hx + 1, hy - 8, "#d6dde2"); p.set(hx + 1, hy - 3, "#8a8a8a"); break;
    case "sawmachete": drawMelee(p, "machete", hx, hy); p.set(hx + 2, hy - 5, "#7d858c"); p.set(hx + 2, hy - 3, "#7d858c"); break;
    case "crossbow": p.rect(hx - 5, hy - 2, hx + 3, hy - 2, wood); p.rect(hx + 3, hy - 4, hx + 3, hy, metal); p.set(hx + 4, hy - 2, "#c2c9cf"); break;
    case "springmachete": drawMelee(p, "machete", hx, hy); p.set(hx + 1, hy - 8, "#c2c9cf"); p.rect(hx + 1, hy, hx + 1, hy + 2, "#5b3a22"); break;
    case "pulleybow": p.rect(hx + 1, hy - 6, hx + 1, hy + 4, wood); p.set(hx + 1, hy - 7, metal); p.set(hx + 1, hy + 5, metal); p.rect(hx, hy - 5, hx, hy + 3, "#d6dde2"); break;
    case "compbow": case "xbow": drawMelee(p, key === "xbow" ? "crossbow" : "pulleybow", hx, hy); if (key === "compbow") { p.set(hx + 1, hy - 4, "#1a1c20"); p.set(hx + 1, hy + 2, "#1a1c20"); } break;
    case "combatknife": p.rect(hx, hy - 4, hx, hy - 1, "#5a6066"); p.set(hx, hy - 5, "#c2c9cf"); p.rect(hx - 1, hy, hx + 1, hy, "#1a1c20"); p.rect(hx, hy + 1, hx, hy + 2, "#1a1c20"); break;
    case "hatchet": p.rect(hx + 1, hy - 5, hx + 1, hy + 2, wood); p.rect(hx + 2, hy - 6, hx + 3, hy - 4, metal); break;
    case "tomahawk": p.rect(hx + 1, hy - 6, hx + 1, hy + 2, "#2b2e33"); p.rect(hx + 2, hy - 7, hx + 3, hy - 5, metal); p.set(hx, hy - 6, metal); break;
    case "kukri": p.rect(hx + 1, hy - 5, hx + 1, hy - 1, metal); p.rect(hx + 2, hy - 7, hx + 2, hy - 4, "#c2c9cf"); p.rect(hx + 1, hy, hx + 1, hy + 2, "#3a2a1c"); break;
    case "katana": p.rect(hx + 1, hy - 10, hx + 1, hy - 1, "#d6dde2"); p.rect(hx, hy, hx + 2, hy, "#b89a4a"); p.rect(hx + 1, hy + 1, hx + 1, hy + 3, "#1a1c20"); break;
    case "pickaxe": p.rect(hx + 1, hy - 7, hx + 1, hy + 2, wood); p.rect(hx - 1, hy - 8, hx + 4, hy - 8, "#6d7378"); p.set(hx - 2, hy - 7, "#6d7378"); p.set(hx + 5, hy - 7, "#6d7378"); break;
    case "hammer": p.rect(hx + 1, hy - 4, hx + 1, hy + 2, wood); p.rect(hx, hy - 5, hx + 3, hy - 5, "#55595e"); break;
    case "etool": p.rect(hx + 1, hy - 5, hx + 1, hy + 2, "#4b5340"); p.rect(hx, hy - 8, hx + 2, hy - 6, "#5f6b4a"); break;
    case "golfclub": p.rect(hx + 1, hy - 8, hx + 1, hy + 2, "#c2c9cf"); p.rect(hx + 1, hy - 9, hx + 3, hy - 9, "#55595e"); break;
    case "hockeystick": p.rect(hx + 1, hy - 8, hx + 1, hy + 2, "#c9a46a"); p.rect(hx + 1, hy + 1, hx + 1, hy + 2, "#2a2c30"); p.rect(hx + 1, hy - 10, hx + 4, hy - 9, "#2a2c30"); p.set(hx + 2, hy - 10, "#e8e4d8"); p.set(hx + 3, hy - 9, "#e8e4d8"); break; // a pale shaft, the taped blade turned out at its end (sim/data-guns.js)
    case "nailbat": drawMelee(p, "bat", hx, hy); p.set(hx, hy - 6, metal); p.set(hx + 3, hy - 6, metal); p.set(hx, hy - 4, metal); p.set(hx + 3, hy - 4, metal); p.set(hx, hy - 2, metal); break;
    case "prybar": p.rect(hx + 1, hy - 7, hx + 1, hy + 2, "#7d858c"); p.set(hx + 2, hy - 8, "#7d858c"); p.set(hx, hy + 2, "#7d858c"); break;
    case "fireaxe": p.rect(hx + 1, hy - 7, hx + 1, hy + 2, "#b08a5a"); p.rect(hx + 2, hy - 8, hx + 3, hy - 5, "#c8362e"); p.set(hx + 4, hy - 7, metal); p.set(hx + 4, hy - 6, metal); break;
    case "sledge": p.rect(hx + 1, hy - 6, hx + 1, hy + 2, wood); p.rect(hx - 1, hy - 9, hx + 3, hy - 7, "#55595e"); break;
    case "baton": p.rect(hx + 1, hy - 5, hx + 1, hy + 2, "#1a1c20"); p.set(hx + 1, hy - 6, "#3a3d40"); break;
    case "stunbaton": drawMelee(p, "baton", hx, hy); p.set(hx + 1, hy - 6, "#ffd23f"); p.set(hx + 1, hy - 5, "#c9a227"); break;
    default: if (BLADE_LOOK[key]) drawBlade(p, BLADE_LOOK[key], hx, hy); else if (GUN_SPRITE[key] && GUN_SPRITE[key] !== key) drawMelee(p, GUN_SPRITE[key], hx, hy); break;
  }
}
function drawBlade(p, L, hx, hy) {
  const x = hx + 1, top = hy - 1 - L.len;
  p.rect(x, top, x, hy - 1, L.blade);
  if (L.curve) { p.set(x + 1, top + 1, L.blade); p.set(x + 1, top + 2, L.blade); }
  if (L.len >= 5) p.set(x, top, "#e8eef2");
  if (L.guard) p.rect(x - 1, hy, x + 1, hy, L.guard);
  p.rect(x, L.guard ? hy + 1 : hy, x, hy + (L.hilt || 2), L.handle);
}
// The melee drawings put the haft at hx + 1 but a knife at hx: the column the hand closes on.
const AT_HX = ["knife", "combatknife"];
const haftCol = (key) => (AT_HX.includes(key) ? 0 : 1);

// ---------- the survivor ----------
// The weapon on a scratch grid, with its pivot: a gun's grip (ui/gunparts.js held: hx = 15, y = 13 at R0 = 14; a
// pistol 16, 14), a melee weapon's haft column at the hand (drawMelee at 14, 15: the haft at 15, a knife at 14).
function scratchWeapon(look, key, hold) {
  const s = painter(40, 30);
  if (hold === "lowready" && XBOWS.includes(key)) { drawMelee(s, key, 15, 15); return { s, px: 15, py: 13, mz: null }; }
  if (hold === "pistol" || hold === "level2" || hold === "lowready" || hold === "tube") {
    const mz = paintGunLevel(s, look, 14);
    return hold === "pistol" ? { s, px: 16, py: 14, mz } : { s, px: 15, py: 13, mz };
  }
  drawMelee(s, key, 14, 15);
  return { s, px: 14 + haftCol(key), py: 15, mz: null };
}
// o: { helmet, visor: "ballistic" | "riot" | null, visorUp, pack }. Returns the 28 × 26 painter (p.muzzle for guns).
export function paintSurvivorMock(app, look = null, armorKey = null, o = {}) {
  const q = bodyPainter();
  const [L, R] = BUILD[app.build] || BUILD.average;
  const mid = Math.floor((L + R) / 2);
  const key = look && String(look).split("|")[0];
  const hold = holdOf(look);
  const W = HAND[hold] ? scratchWeapon(look, key, hold) : null;
  const H = W ? HAND[hold].at(R, mid, fit(HAND[hold].want(R), W.s, W.px)) : null;
  const short = app.topStyle === "tshirt" || app.topStyle === "tank";
  if (app.hairStyle === "long" || app.hairStyle === "ponytail") drawHair(q, app.hairStyle, shade(app.hair, -0.3));
  if (o.pack) drawPack(q, L, R);
  // A weapon on the shoulder: its haft leans back past the head, so the part above the shoulder goes on first.
  if (hold === "shouldered") blit(W.s, q, W.px, W.py, H.gun[0], H.gun[1], BACK, (x, y) => y < 11);
  drawLegs(q, L, R, app.pants);
  drawTorso(q, L, R, app.top, app.topStyle, app.skin);
  drawArmor(q, armorKey, L, R);
  hangArm(q, L - 2, L - 1, app.top, app.skin, app.topStyle, 0.08); // the far arm
  if (H && H.support) limb(q, H.from[0], H.from[1], H.support[0], H.support[1], short ? shade(app.skin, -0.12) : shade(app.top, -0.35)); // its forearm, out to the support hand
  if (!H || H.arm === "hang") hangArm(q, R + 1, R + 2, app.top, app.skin, app.topStyle, -0.2);
  else forwardArm(q, R, H.grip[0], app.top, app.skin, app.topStyle);
  drawHead(q, app.skin); drawEyes(q); drawFacial(q, app.facial, app.hair, app.skin); drawHair(q, app.hairStyle, app.hair);
  const helmet = o.helmet && HELMETS[o.helmet] ? o.helmet : null;
  drawAccessory(q, helmet && HEAD_ACC.includes(app.accessory) ? "none" : app.accessory, app.accent, L, R);
  if (helmet) HELMETS[helmet](q, { kind: o.visor || null, up: !!o.visorUp });
  // The weapon in the hands, rimmed where it lies over the body; then the hands close on it.
  let mz = null;
  if (H) {
    blit(W.s, q, W.px, W.py, H.gun[0], H.gun[1], H.f, hold === "shouldered" ? (x, y) => y >= 11 : null, true);
    mz = movePoint(W.mz, W.px, W.py, H.gun[0], H.gun[1], H.f);
    fist(q, H.grip[0], H.grip[1], app.skin);
    if (H.support) fist(q, H.support[0], H.support[1], app.skin);
  }
  q.p.muzzle = mz;
  return q.p;
}

// The game's own drawing (ui/sprites.js), for the "before" column.
export const paintSurvivorBefore = (app, look = null, armorKey = null) => paintSurvivor(app, look, armorKey);
