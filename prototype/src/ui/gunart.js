// Gun art for the gun builder (ui/gunbuilder.js; docs/weapons-overhaul-plan.md section 9): a big side view of each gun
// in the sprites' style (ui/sprites.js painter / toCanvas: flat colors, a dark outline), 64 × 24 grid pixels drawn 8×
// (512 × 192), muzzle to the right.
//   Every gun has its own drawing from its art spec (ui/gunspecs.js GUN_ART, painted by ui/gunpaint.js), compiled here
//   into PLAT_ART[weapon key]; the platforms' drawings below stay for a gun with a platform and no spec.
//   PLAT_ART[art] = { paint(p, fitted), anchors: { slot: [x, y] }, def: { slot: look } }
//     paint: the gun's core (receiver, barrel, fore-end, grip; fitted: the looks in its slots, e.g. a sight on the
//     AUG's rail in place of its scope-handle); def: the parts it has of its own (its stock, its magazine, a built-in
//     bipod), drawn where nothing is fitted in that slot; anchors: where each slot's part sits (and where the
//     builder's leader line starts).
//   PART_ART[look](p, [x, y], ctx): a part drawn at its slot's anchor. Optics draw up from the anchor, muzzle devices
//     right, magazines, grips and bipods down, stocks left.
// A gun's art: its own spec's, else its platform (data-gunmods.js WEAPON_PLATFORM, LOCAL_PLATFORM), else a look-alike
// by what it is (gunpaint.js fallbackKey, when its name says: a revolver, an over-under...), else a generic rifle or
// pistol.
// A part's look: its GEAR entry's look, else MOD_LOOK by key, else one by its slot.
import { painter, toCanvas, canvasURL } from "./sprites.js";
import { GEAR } from "../sim/data.js";
import { WEAPONS } from "../sim/combat.js";
import * as DGM from "../sim/data-gunmods.js";
import { C, R, H, V, dots, grip, guard, stockShape, STOCKS, MAGS, norm, ownKey, isGunKey as isGun } from "./gunpaint.js";
import { GUN_ART, FALLBACK_LIKE } from "./gunspecs.js";

export const ART_W = 64, ART_H = 24, ART_UP = 8;

// A magazine: n rows from (x, y) down, w wide, sloping forward a pixel every `curve` rows (0: straight).
function mag(p, x, y, n, w, c, curve = 0) { for (let i = 0; i < n; i++) { const s = x + (curve ? Math.floor(i / curve) : 0); H(p, s, s + w - 1, y + i, c); } }

// ---------- the cores ----------
// The AR family (AR-15, AR-10, M249): stock and magazine come from def; o: receiver x0..x1, fore-end end, barrel end.
function arCore(p, o) {
  H(p, o.r0 - 4, o.r0 - 1, 8, C.gun); H(p, o.r0 - 4, o.r0 - 1, 9, C.gun); // the buffer tube
  R(p, o.r0, 6, o.r1, 8, C.gun); H(p, o.r0, o.r1, 5, C.dark); dots(p, o.r0, o.r1, 5, C.hi); // upper receiver, flat-top rail
  R(p, o.r0 + 1, 9, o.r1 - 1, 10, C.gun); H(p, o.r0 + 1, o.r1 - 2, 9, C.hi); // lower
  grip(p, o.r0 + 3, 11, 6, 3, C.gun);
  guard(p, o.r0 + 5, o.r0 + 8, 10);
  R(p, o.r1 + 1, 6, o.h1, 9, o.hgCol || C.hg); dots(p, o.r1 + 2, o.h1 - 1, 7, C.dark, 3); // handguard and its vents
  if (o.post !== false) { R(p, o.h1 + 1, 4, o.h1 + 2, 8, C.gun); p.set(o.h1 + 1, 3, C.gun); } // front sight / gas block
  R(p, o.h1 + 1, 7, o.b1, 8, C.dark);
}
function glockCore(p, o = {}) {
  const x1 = o.x1 || 44, col = o.slide || C.gun;
  R(p, 18, 5, x1, 8, col); dots(p, 19, 24, 6, C.hi); H(p, 18, x1, 5, o.slideTop || C.hi); // slide, rear serrations
  R(p, 20, 9, x1 - 4, 10, o.frame || C.hg); H(p, x1 - 9, x1 - 4, 11, C.dark); // frame, accessory rail
  p.set(x1 - 1, 4, C.gun); p.set(20, 4, C.gun); // sights
  grip(p, 23, 11, o.gripN || 10, 6, o.gripCol || C.hg, 3);
  if (o.panels) R(p, 21, 13, 25, 17, o.panels);
  guard(p, 28, 33, 10);
  H(p, x1 + 1, x1 + 1, 6, C.dark); // the muzzle crown
}
function revolverCore(p) {
  R(p, 19, 6, 31, 11, C.steel); // frame
  R(p, 22, 7, 29, 11, "#6b7178"); dots(p, 22, 29, 9, C.steel); // cylinder, flutes
  R(p, 32, 6, 46, 8, C.steel); H(p, 32, 46, 6, C.metal); H(p, 32, 41, 9, C.steel); // barrel, ejector rod
  p.set(45, 5, C.steel); p.set(18, 5, C.gun); p.set(19, 5, C.gun); // front sight, hammer
  guard(p, 21, 26, 10);
}
// A long gun with a classic action: receiver x0..x1 at rows 7..y1, barrel to b1 (bt: its rows).
function longCore(p, o) {
  R(p, o.r0, 6, o.r1, o.ry1 || 9, o.rcol || C.gun); H(p, o.r0, o.r1, 6, o.rhi || C.hi);
  R(p, o.r1 + 1, 7, o.b1, o.bthick ? 7 + o.bthick - 1 : 7, o.bcol || C.gun);
  if (o.bead !== false) p.set(o.b1, 6, C.metal);
}
// A wooden fore-end under the barrel.
const forend = (p, x0, x1, y0, y1, c = C.wood) => { R(p, x0, y0, x1, y1, c); H(p, x0, x1, y1, C.woodD); };

// ---------- the platforms ----------
export const PLAT_ART = {
  ar15: {
    paint: (p) => arCore(p, { r0: 16, r1: 28, h1: 41, b1: 52 }),
    def: { stock: "stock_ar", mag: "stick30", muzzle: "fh" },
    anchors: { optic: [22, 5], mount: [22, 5], muzzle: [52, 7], mag: [25, 11], stock: [12, 8], under: [35, 9], grip: [33, 9], rail: [35, 7], tactical: [39, 7], bipod: [39, 9], sling: [12, 9] },
  },
  ar10: {
    paint: (p) => arCore(p, { r0: 15, r1: 28, h1: 43, b1: 52 }),
    def: { stock: "stock_ar", mag: "box20", muzzle: "fh" },
    anchors: { optic: [21, 5], mount: [21, 5], muzzle: [52, 7], mag: [24, 11], stock: [11, 8], under: [36, 9], grip: [34, 9], rail: [36, 7], tactical: [41, 7], bipod: [41, 9], sling: [11, 9] },
  },
  m249: {
    paint: (p) => {
      arCore(p, { r0: 15, r1: 31, h1: 41, b1: 51, hgCol: C.olive });
      R(p, 22, 2, 30, 3, C.gun); p.set(22, 4, C.gun); p.set(30, 4, C.gun); // carry handle
      R(p, 32, 4, 34, 5, C.gun); // feed cover hinge
    },
    def: { stock: "stock_skel", mag: "belt", muzzle: "fh", bipod: "bipod" },
    anchors: { optic: [26, 1], mount: [26, 1], muzzle: [51, 7], mag: [27, 11], stock: [11, 8], under: [36, 9], tactical: [38, 7], bipod: [45, 8], sling: [11, 9] },
  },
  ak: {
    paint: (p) => {
      R(p, 13, 6, 28, 9, C.gun); H(p, 13, 28, 6, C.hi); H(p, 14, 27, 5, C.gun); // receiver, dust cover
      H(p, 20, 23, 8, C.metal); p.set(24, 9, C.metal); // the charging handle and the selector
      grip(p, 16, 10, 6, 3, C.wood);
      guard(p, 19, 22, 9);
      forend(p, 29, 38, 7, 9); R(p, 29, 4, 40, 5, C.wood); // lower handguard, upper over the gas tube
      R(p, 41, 3, 42, 8, C.gun); // front sight block
      R(p, 41, 7, 51, 7, C.dark);
    },
    def: { stock: "stock_ak", mag: "ak30", muzzle: "brake_ak" },
    anchors: { optic: [20, 5], mount: [20, 7], muzzle: [51, 7], mag: [24, 10], stock: [12, 7], under: [33, 9], grip: [33, 9], rail: [34, 7], tactical: [36, 7], bipod: [36, 9], sling: [12, 9] },
  },
  mp5: {
    paint: (p) => {
      R(p, 15, 6, 36, 9, C.gun); H(p, 15, 36, 6, C.hi); R(p, 16, 4, 17, 5, C.gun); // receiver, rear drum sight
      grip(p, 19, 10, 6, 3, C.gun);
      guard(p, 21, 24, 9);
      R(p, 37, 6, 44, 10, C.hg); dots(p, 38, 43, 8, C.dark, 2); // the fat handguard
      R(p, 44, 3, 45, 5, C.gun); R(p, 45, 7, 49, 7, C.dark); // front hood, barrel
      R(p, 33, 4, 36, 5, C.gun); // cocking tube
    },
    def: { stock: "stock_mp5", mag: "smg30", muzzle: "lugs" },
    anchors: { optic: [26, 5], mount: [26, 5], muzzle: [49, 7], mag: [27, 10], stock: [14, 7], under: [40, 10], grip: [40, 10], tactical: [41, 7], sling: [14, 9] },
  },
  bolt: {
    paint: (p) => {
      longCore(p, { r0: 19, r1: 32, b1: 52, bthick: 1 });
      H(p, 33, 52, 8, C.gun); // the barrel's lower half (it tapers at the muzzle)
      p.set(27, 9, C.metal); p.set(28, 10, C.metal); p.set(29, 10, C.metal); // bolt handle
      forend(p, 19, 41, 9, 10);
      guard(p, 21, 25, 10, C.gun);
    },
    def: { stock: "stock_wood" },
    anchors: { optic: [26, 6], mount: [26, 6], muzzle: [52, 7], mag: [23, 11], stock: [18, 8], under: [37, 10], bipod: [37, 10], sling: [15, 11] },
  },
  sniper: {
    paint: (p) => {
      longCore(p, { r0: 19, r1: 32, b1: 54, bthick: 2, bcol: C.dark, bead: false });
      p.set(27, 9, C.metal); p.set(28, 10, C.metal); p.set(29, 10, C.metal);
      R(p, 19, 9, 40, 10, C.olive); H(p, 19, 40, 10, C.tanD); // synthetic fore-end
      guard(p, 21, 25, 10, C.gun);
    },
    def: { stock: "stock_sniper", mag: "stick10", muzzle: "crown" },
    anchors: { optic: [26, 6], mount: [26, 6], muzzle: [54, 7], mag: [24, 11], stock: [18, 8], under: [37, 10], bipod: [37, 10], sling: [14, 11] },
  },
  lever: {
    paint: (p) => {
      longCore(p, { r0: 18, r1: 27, b1: 50, bthick: 1, rcol: C.steel, rhi: C.metal, ry1: 10 });
      R(p, 28, 8, 46, 8, C.gun); // the magazine tube
      forend(p, 28, 37, 9, 10);
      for (const [x, y] of [[19, 11], [19, 12], [20, 13], [21, 13], [22, 13], [23, 12], [24, 11], [25, 11]]) p.set(x, y, C.steel); // the lever loop
      p.set(18, 5, C.gun);
    },
    def: { stock: "stock_lever" },
    anchors: { optic: [22, 6], mount: [22, 6], muzzle: [50, 7], mag: [46, 8], stock: [17, 8], under: [33, 10], sling: [14, 11] },
  },
  rimrifle: {
    paint: (p) => {
      longCore(p, { r0: 19, r1: 30, b1: 50, bthick: 1, ry1: 8 });
      forend(p, 19, 38, 9, 10, C.woodL);
      p.set(26, 8, C.metal); p.set(27, 9, C.metal);
      guard(p, 21, 24, 10, C.gun);
    },
    def: { stock: "stock_light", mag: "rotary" },
    anchors: { optic: [24, 6], mount: [24, 6], muzzle: [50, 7], mag: [26, 11], stock: [18, 8], under: [34, 10], bipod: [34, 10], sling: [15, 11] },
  },
  pump: {
    paint: (p) => {
      R(p, 16, 6, 28, 10, C.gun); H(p, 16, 28, 6, C.hi);
      R(p, 29, 6, 52, 7, C.gun); p.set(52, 5, C.metal); // barrel, bead
      R(p, 29, 8, 46, 9, C.dark); // magazine tube
      R(p, 32, 8, 41, 10, C.wood); dots(p, 33, 40, 9, C.woodD, 2); // the pump
      guard(p, 18, 22, 10, C.gun);
    },
    def: { stock: "stock_wood" },
    anchors: { optic: [22, 5], mount: [22, 5], muzzle: [52, 6], mag: [46, 8], stock: [15, 8], under: [44, 10], tactical: [44, 10], sling: [12, 11] },
  },
  semi12: {
    paint: (p) => {
      R(p, 15, 6, 30, 10, C.gun); H(p, 15, 30, 6, C.hi); H(p, 18, 22, 8, C.metal); // receiver, ejection port
      R(p, 31, 6, 52, 7, C.gun); p.set(52, 5, C.metal);
      R(p, 31, 8, 46, 9, C.dark);
      R(p, 31, 8, 41, 10, C.hg);
      grip(p, 16, 11, 5, 3, C.gun);
      guard(p, 19, 23, 10, C.gun);
    },
    def: { stock: "stock_poly" },
    anchors: { optic: [23, 5], mount: [23, 5], muzzle: [52, 6], mag: [46, 8], stock: [14, 8], under: [44, 10], tactical: [44, 10], sling: [11, 11] },
  },
  dbl: {
    paint: (p) => {
      R(p, 18, 6, 26, 10, C.steel); H(p, 18, 26, 6, C.metal); p.set(19, 5, C.gun); // the action, the top lever
      R(p, 27, 6, 52, 7, C.gun); H(p, 27, 52, 8, C.dark); H(p, 27, 52, 5, C.hi); // the barrels, the rib
      forend(p, 27, 36, 9, 10);
      guard(p, 19, 23, 10, C.gun);
      p.set(52, 4, C.metal);
    },
    def: { stock: "stock_wood" },
    anchors: { optic: [24, 5], mount: [24, 5], muzzle: [52, 7], stock: [17, 8], under: [33, 10], sling: [14, 11] },
  },
  sawnoff: {
    paint: (p) => {
      R(p, 22, 6, 30, 10, C.steel); H(p, 22, 30, 6, C.metal); p.set(23, 5, C.gun);
      R(p, 31, 6, 42, 7, C.gun); H(p, 31, 42, 8, C.dark); H(p, 31, 42, 5, C.hi);
      forend(p, 31, 37, 9, 10);
      guard(p, 23, 27, 10, C.gun);
    },
    def: { stock: "stock_sawn" },
    anchors: { optic: [27, 5], mount: [27, 5], muzzle: [42, 7], stock: [21, 8], under: [35, 10], sling: [18, 12] },
  },
  amr: {
    paint: (p) => {
      R(p, 14, 5, 33, 10, C.gun); H(p, 14, 33, 5, C.hi); H(p, 14, 33, 4, C.dark); dots(p, 14, 33, 4, C.hi); // the big receiver, its rail
      grip(p, 18, 11, 6, 3, C.gun);
      guard(p, 20, 24, 10, C.gun);
      R(p, 34, 6, 41, 9, C.hg); // fore-end
      R(p, 42, 7, 52, 8, C.dark); // barrel
      R(p, 9, 13, 10, 16, C.gun); // the rear monopod
    },
    def: { stock: "stock_amr", mag: "box10", muzzle: "brake_big", bipod: "bipod" },
    anchors: { optic: [24, 4], mount: [24, 4], muzzle: [52, 7], mag: [27, 11], stock: [13, 8], under: [38, 9], bipod: [39, 9], sling: [13, 10], tactical: [38, 7] },
  },
  zip: {
    paint: (p) => {
      R(p, 6, 8, 22, 10, C.board); H(p, 6, 22, 8, "#5c4a36"); // a plank for a stock
      R(p, 20, 6, 50, 7, C.pipe); H(p, 20, 50, 6, "#7a7f84"); // the pipe
      R(p, 23, 8, 26, 9, C.pipe); p.set(24, 11, C.metal); p.set(24, 10, C.metal); // the breech, a nail for a trigger
      H(p, 28, 34, 8, "#8a7a5a"); H(p, 40, 44, 8, "#8a7a5a"); // tape
    },
    def: {},
    anchors: { optic: [30, 5], muzzle: [50, 6], stock: [12, 9], sling: [10, 10], under: [37, 8] },
  },
  glock: {
    paint: (p) => glockCore(p),
    def: {},
    anchors: { optic: [33, 4], mount: [33, 4], muzzle: [45, 6], mag: [21, 20], under: [37, 11], tactical: [37, 11], grip: [22, 15] },
  },
  compact: {
    paint: (p) => glockCore(p, { x1: 40, gripN: 8 }),
    def: {},
    anchors: { optic: [31, 4], mount: [31, 4], muzzle: [41, 6], mag: [21, 18], under: [34, 11], tactical: [34, 11], grip: [22, 14] },
  },
  p1911: {
    paint: (p) => { glockCore(p, { slide: C.steel, slideTop: C.metal, frame: C.steel, gripCol: C.steel, panels: C.wood }); p.set(17, 5, C.gun); p.set(17, 6, C.gun); },
    def: {},
    anchors: { optic: [33, 4], mount: [33, 4], muzzle: [45, 6], mag: [21, 20], under: [37, 11], tactical: [37, 11], grip: [22, 15] },
  },
  rimpistol: {
    paint: (p) => {
      R(p, 18, 6, 30, 9, C.gun); H(p, 18, 30, 6, C.hi); // receiver
      R(p, 31, 6, 46, 8, C.gun); H(p, 31, 46, 6, C.hi); p.set(46, 5, C.gun); // the long slim barrel
      grip(p, 21, 10, 10, 5, C.hg, 3); R(p, 19, 12, 22, 16, C.wood);
      guard(p, 25, 29, 9);
    },
    def: {},
    anchors: { optic: [26, 5], mount: [26, 5], muzzle: [46, 7], mag: [19, 19], under: [35, 9], tactical: [35, 9], grip: [20, 14] },
  },
  revolver: {
    paint: (p) => revolverCore(p),
    def: { grip: "grip_wood" },
    anchors: { optic: [38, 5], mount: [38, 5], muzzle: [46, 7], grip: [18, 12], under: [36, 9], tactical: [36, 9] },
  },
  // Guns with no platform of their own (a gun added without art): a plain rifle or pistol.
  generic_rifle: {
    paint: (p) => {
      R(p, 18, 6, 30, 9, C.gun); H(p, 18, 30, 6, C.hi); R(p, 31, 7, 50, 8, C.gun);
      forend(p, 30, 40, 9, 10, C.hg); grip(p, 20, 10, 5, 3, C.gun); guard(p, 22, 26, 9);
    },
    def: { stock: "stock_poly" },
    anchors: { optic: [24, 5], mount: [24, 5], muzzle: [50, 7], mag: [27, 10], stock: [17, 8], under: [36, 10], grip: [36, 10], tactical: [38, 7], bipod: [36, 10], rail: [36, 7], sling: [14, 11] },
  },
  generic_pistol: {
    paint: (p) => glockCore(p, { x1: 42 }),
    def: {},
    anchors: { optic: [31, 4], mount: [31, 4], muzzle: [43, 6], mag: [21, 20], under: [35, 11], tactical: [35, 11], grip: [22, 15] },
  },
};
// The platforms of 2026-10-10 (sim/data-gunmods.js PLATFORM_LIKE): drawn as their look-alike (the battle rifles as the
// AR-10, the bullpup as the AR-15, the single barrel as the double, the .45 SMG as the MP5...).
for (const [plat, like] of Object.entries(DGM.PLATFORM_LIKE || {})) if (!PLAT_ART[plat] && PLAT_ART[like]) PLAT_ART[plat] = PLAT_ART[like];

// Which slot's anchor stands in for a slot the art has none for.
const ALIAS = { under: ["grip", "tactical", "bipod"], grip: ["under", "tactical"], tactical: ["under", "rail", "grip"], bipod: ["under", "grip"], rail: ["tactical", "under", "optic"], mount: ["optic"], optic: ["mount"], sling: ["stock"], stock: ["sling"], mag: ["under"], muzzle: [], pgrip: ["mag", "grip", "stock"], receiver: ["mount", "optic", "mag"] }; // (pgrip, receiver: the slots of 2026-10-10, no anchors of their own yet)

// ---------- the parts ----------
// p: the painter, a: [x, y] the anchor, ctx: { art (PLAT_ART entry), key (art key) }.
const scope = (p, [x, y], len, bell, col = C.gun) => {
  R(p, x - len, y - 3, x + len, y - 2, col); // tube
  R(p, x - len - 1, y - 4, x - len + 1, y - 1, col); // eyepiece
  R(p, x + len - 1, y - 3 - bell, x + len + 1, y - 1, col); // objective bell
  p.set(x + len + 1, y - 2, C.glass); p.set(x, y - 4, col); p.set(x, y - 5 + (bell > 1 ? 0 : 1), col); // the lens, the turret
  p.set(x - Math.floor(len / 2), y - 1, C.dark); p.set(x + Math.floor(len / 2), y - 1, C.dark); // rings
};
const can = (p, [x, y], len, col = C.gun) => { R(p, x + 1, y - 1, x + len, y + 2, col); H(p, x + 2, x + len - 1, y - 1, C.hi); };
const stick = (p, [x, y], n, w = 4, curve = 3, col = C.gun) => { mag(p, x, y, n, w, col, curve); H(p, x + (curve ? Math.floor((n - 1) / curve) : 0), x + (curve ? Math.floor((n - 1) / curve) : 0) + w - 1, y + n - 1, C.dark); };
export const PART_ART = {
  // sights (up from the anchor: the top of the receiver or slide)
  irons: (p, [x, y]) => { R(p, x - 1, y - 2, x + 1, y - 1, C.gun); p.clear(x, y - 2); },
  tritium: (p, [x, y]) => { p.set(x - 3, y - 1, C.glow); p.set(x + 3, y - 1, C.glow); p.set(x + 4, y - 1, C.gun); },
  rmr: (p, [x, y]) => { R(p, x - 2, y - 2, x + 1, y - 1, C.gun); p.set(x + 1, y - 2, C.red); },
  reddot: (p, [x, y]) => { H(p, x - 2, x + 2, y - 1, C.dark); R(p, x - 2, y - 3, x + 2, y - 2, C.gun); p.set(x + 2, y - 3, C.red); p.set(x - 2, y - 3, C.glass); },
  holo: (p, [x, y]) => { R(p, x - 3, y - 4, x + 3, y - 1, C.gun); R(p, x - 2, y - 3, x + 1, y - 2, C.glass); p.set(x - 1, y - 3, C.red); },
  acog: (p, [x, y]) => { R(p, x - 4, y - 3, x + 3, y - 1, C.gun); R(p, x + 3, y - 4, x + 4, y - 1, C.gun); p.set(x + 4, y - 3, C.glass); p.set(x - 1, y - 4, C.red); },
  lpvo: (p, a) => scope(p, a, 6, 1),
  scope4: (p, a) => scope(p, a, 5, 1),
  scope9: (p, a) => scope(p, a, 7, 2),
  scope25: (p, a) => { scope(p, a, 8, 2, C.olive); p.set(a[0] + 1, a[1] - 4, C.olive); p.set(a[0], a[1] - 5, C.olive); },
  thermal: (p, [x, y]) => { R(p, x - 5, y - 4, x + 4, y - 1, C.olive); R(p, x + 5, y - 3, x + 6, y - 2, "#a04040"); dots(p, x - 4, x + 3, y - 4, C.oliveL); },
  scrapscope: (p, a) => { scope(p, a, 5, 1, C.pipe); p.set(a[0] - 2, a[1] - 3, C.tan); p.set(a[0] + 2, a[1] - 2, C.tan); },
  mount: (p, [x, y]) => { H(p, x - 4, x + 4, y - 1, C.dark); dots(p, x - 4, x + 4, y - 1, C.hi); },
  // muzzle devices (right from the anchor: the barrel's top row)
  fh: (p, [x, y]) => { R(p, x + 1, y - 1, x + 3, y + 2, C.gun); p.clear(x + 2, y - 1); },
  crown: (p, [x, y]) => R(p, x + 1, y, x + 1, y + 1, C.gun),
  lugs: (p, [x, y]) => { R(p, x + 1, y - 1, x + 2, y + 1, C.gun); },
  brake_ak: (p, [x, y]) => { R(p, x + 1, y - 1, x + 3, y + 1, C.gun); p.set(x + 3, y - 1, null); },
  brake_big: (p, [x, y]) => { R(p, x + 1, y - 2, x + 6, y + 3, C.gun); for (const dx of [2, 4]) R(p, x + dx, y - 2, x + dx, y + 3, C.dark); },
  can_s: (p, a) => can(p, a, 6),
  can_l: (p, a) => can(p, a, 8),
  brake: (p, [x, y]) => { R(p, x + 1, y - 1, x + 3, y + 2, C.gun); p.set(x + 2, y - 1, C.dark); p.set(x + 2, y + 2, C.dark); },
  comp: (p, [x, y]) => { R(p, x + 1, y - 1, x + 2, y + 1, C.gun); p.set(x + 2, y - 1, C.dark); },
  choke: (p, [x, y]) => R(p, x + 1, y, x + 2, y + 1, C.metal),
  oilfilter: (p, [x, y]) => { R(p, x + 1, y, x + 2, y + 1, C.pipe); R(p, x + 3, y - 2, x + 8, y + 3, C.blue); H(p, x + 3, x + 8, y - 2, "#4a7cad"); },
  bottle: (p, [x, y]) => { R(p, x + 1, y, x + 3, y + 1, C.bottle); R(p, x + 4, y - 2, x + 8, y + 3, C.bottle); H(p, x + 1, x + 3, y + 2, C.tan); },
  // magazines (down from the anchor: the bottom of the magazine well; a tube extends to the right along the tube)
  stick10: (p, a) => stick(p, a, 4, 4, 0),
  stick20: (p, a) => stick(p, a, 6, 4, 4),
  stick30: (p, a) => stick(p, a, 8, 4, 3),
  stick40: (p, a) => stick(p, a, 10, 4, 3),
  smg30: (p, a) => stick(p, a, 9, 3, 3),
  ak30: (p, a) => stick(p, a, 8, 4, 2),
  box10: (p, a) => stick(p, a, 4, 5, 0),
  box20: (p, a) => stick(p, a, 6, 5, 0),
  rotary: (p, [x, y]) => R(p, x - 1, y, x + 1, y + 1, C.gun),
  extmag: (p, [x, y]) => { R(p, x - 1, y + 1, x + 4, y + 3, C.gun); H(p, x - 1, x + 4, y + 3, C.dark); },
  drum: (p, [x, y]) => {
    H(p, x, x + 3, y, C.gun);
    for (let dy = -3; dy <= 3; dy++) { const w = Math.round(Math.sqrt(12.25 - dy * dy)); H(p, x + 2 - w, x + 2 + w, y + 4 + dy, C.gun); }
    p.set(x + 2, y + 4, C.hi);
  },
  belt: (p, [x, y]) => { R(p, x - 2, y, x + 5, y + 6, C.olive); H(p, x - 2, x + 5, y + 6, C.tanD); dots(p, x - 3, x - 3, y + 1, "#c8a24a"); },
  tube_ext: (p, [x, y]) => { R(p, x + 1, y, x + 5, y + 1, C.dark); p.set(x + 5, y, C.gun); },
  // stocks (back from the anchor: where the stock meets the receiver)
  stock_ar: (p, [x, y]) => stockShape(p, x - 1, y, 10, y - 1, y + 4, C.gun, { pad: C.dark }),
  stock_fixed: (p, a) => PART_ART.stock_ar(p, a), // the plan's name for the fixed AR stock
  collapsible: (p, [x, y]) => { H(p, x - 8, x, y, C.gun); H(p, x - 8, x, y + 1, C.gun); R(p, x - 11, y - 1, x - 6, y + 3, C.gun); R(p, x - 12, y - 1, x - 12, y + 4, C.dark); p.clear(x - 9, y + 1); },
  precision: (p, [x, y]) => { stockShape(p, x - 1, y, 13, y - 3, y + 5, C.gun, { pad: C.dark }); H(p, x - 9, x - 4, y - 3, C.hi); },
  fold: (p, [x, y]) => { H(p, x - 10, x, y - 1, C.metal); H(p, x - 10, x, y + 2, C.metal); R(p, x - 11, y - 1, x - 11, y + 3, C.metal); },
  pad: (p, a, ctx) => {
    const def = ctx && ctx.art && ctx.art.def && ctx.art.def.stock;
    if (def && PART_ART[def] && def !== "pad") PART_ART[def](p, a, ctx);
    for (let x = 0; x < a[0]; x++) { // the butt: the stock's left end
      let any = false;
      for (let y = a[1] - 4; y <= a[1] + 6; y++) if (p.get(x, y)) { any = true; p.set(x - 1, y, C.dark); }
      if (any) break;
    }
  },
  stock_skel: (p, [x, y]) => { H(p, x - 10, x, y - 1, C.gun); H(p, x - 10, x, y + 2, C.gun); R(p, x - 11, y - 1, x - 10, y + 4, C.gun); },
  stock_ak: (p, [x, y]) => stockShape(p, x, y, 11, y, y + 5, C.wood, { pad: C.woodD, grain: C.woodD }),
  stock_mp5: (p, [x, y]) => { H(p, x - 10, x, y, C.gun); H(p, x - 10, x, y + 3, C.gun); R(p, x - 11, y, x - 10, y + 5, C.gun); },
  stock_wood: (p, [x, y]) => { stockShape(p, x, y, 15, y - 1, y + 5, C.wood, { pad: C.dark, grain: C.woodD }); },
  stock_lever: (p, [x, y]) => stockShape(p, x, y, 14, y, y + 5, C.wood, { pad: C.steel, grain: C.woodD }),
  stock_light: (p, [x, y]) => stockShape(p, x, y, 14, y - 1, y + 4, C.woodL, { pad: C.dark }),
  stock_poly: (p, [x, y]) => stockShape(p, x, y, 13, y - 1, y + 5, C.gun, { pad: C.dark }),
  stock_sniper: (p, [x, y]) => { stockShape(p, x, y, 16, y - 2, y + 5, C.olive, { pad: C.dark }); H(p, x - 10, x - 3, y - 2, C.oliveL); },
  stock_sawn: (p, [x, y]) => { grip(p, x, y, 6, 3, C.wood); },
  stock_amr: (p, [x, y]) => { stockShape(p, x - 1, y, 11, y - 2, y + 4, C.gun, { pad: C.dark }); },
  // under the barrel, grips, on the rail (down from the anchor: the fore-end's bottom row; tactical: on the fore-end)
  vgrip: (p, [x, y]) => R(p, x - 1, y + 1, x + 1, y + 5, C.gun),
  agrip: (p, [x, y]) => { for (let i = 0; i < 3; i++) H(p, x - 2 + i, x + 1 + i, y + 1 + i, C.gun); },
  laser: (p, [x, y]) => { R(p, x - 2, y + 1, x + 2, y + 2, C.gun); p.set(x + 2, y + 1, C.red); },
  light: (p, [x, y]) => { R(p, x - 2, y, x + 2, y + 1, C.gun); R(p, x + 3, y - 1, x + 3, y + 2, C.gun); p.set(x + 3, y, "#f4f0c8"); p.set(x + 3, y + 1, "#f4f0c8"); },
  peq: (p, [x, y]) => { R(p, x - 3, y - 1, x + 2, y + 1, C.tanD); p.set(x + 2, y - 1, C.glass); p.set(x + 2, y + 1, C.red); },
  bipod: (p, [x, y]) => { H(p, x - 1, x + 1, y + 1, C.gun); for (let i = 1; i <= 6; i++) { p.set(x - 1 - Math.floor(i / 2), y + 1 + i, C.gun); p.set(x + 1 + Math.floor(i / 2), y + 1 + i, C.gun); } },
  m203: (p, [x, y]) => { R(p, x - 7, y + 1, x + 5, y + 3, C.olive); H(p, x - 7, x + 5, y + 1, C.oliveL); p.set(x - 5, y + 4, C.gun); },
  rail: (p, [x, y]) => { R(p, x - 6, y - 1, x + 6, y + 1, C.dark); dots(p, x - 6, x + 6, y - 1, C.hi); dots(p, x - 5, x + 5, y + 1, C.hi); },
  sling: (p, [x, y]) => { for (let i = 0; i <= 12; i++) p.set(x - i, y + 2 + Math.round(3 * Math.sin((Math.PI * i) / 12)), C.sling); p.set(x, y + 1, C.metal); },
  revgrip: (p, [x, y]) => { grip(p, x + 1, y - 1, 9, 4, C.dark, 3); },
  grip_wood: (p, [x, y]) => { grip(p, x + 1, y - 1, 9, 4, C.wood, 3); dots(p, x, x + 2, y + 3, C.woodD); },
  // the gun specs' (ui/gunspecs.js): a revolver's rubber grip and a snub's round butt; the FAL's and the M14's flash hiders
  grip_rubber: (p, [x, y]) => { grip(p, x + 1, y - 1, 8, 4, C.rubber, 3); for (let i = 1; i < 7; i += 2) p.set(x + 1 - Math.floor(i / 3), y - 1 + i, C.polyL); },
  grip_snub: (p, [x, y]) => { grip(p, x + 1, y - 1, 6, 4, C.wood, 2); p.clear(x - 1, y + 4); dots(p, x, x + 2, y + 2, C.woodD); },
  fh_long: (p, [x, y]) => { R(p, x + 1, y - 1, x + 5, y + 1, C.gun); for (const dx of [3, 5]) p.clear(x + dx, y - 1); p.set(x + 1, y + 1, C.dark); },
  fh_m14: (p, [x, y]) => { R(p, x + 1, y - 1, x + 4, y + 1, C.gun); p.clear(x + 4, y - 1); p.set(x + 3, y, C.dark); p.set(x + 1, y + 2, C.gun); },
};

// A part's look by its key (GEAR look first; the attachments of today, gunmods.js ATTACH, and of the plan's table).
export const MOD_LOOK = {
  reddot: "reddot", holo: "holo", scope4x: "scope4", laser: "laser", foregrip: "vgrip", bipod: "bipod", pistolcan: "can_s",
  riflecan: "can_l", suppressor: "oilfilter", brake: "brake", comp: "comp", choke: "choke", extmag: "extmag", drum: "drum", tubeext: "tube_ext",
  tritium: "tritium", rmr: "rmr", acog: "acog", lpvo: "lpvo", tacscope: "scope25", thermalscope: "thermal", scrapscope: "scrapscope",
  scopemount: "mount", sidemount: "mount", quadrail: "rail", mlok: "rail", can22: "can_s", can9: "can_s", can556: "can_l", can308: "can_l",
  can12: "can_l", bottlecan: "bottle", solventcan: "can_l", flashhider: "fh", recoilpad: "pad", collapsible: "collapsible", precision: "precision",
  foldstock: "fold", vertgrip: "vgrip", anglegrip: "agrip", revgrip: "revgrip", weaponlight: "light", peq: "peq", sling: "sling", m203: "m203",
  huntscope: "scope9", scope9x: "scope9",
};
const SLOT_LOOK = { optic: "reddot", mount: "mount", muzzle: "can_s", mag: "stick30", stock: "collapsible", grip: "vgrip", under: "vgrip", tactical: "light", bipod: "bipod", rail: "rail", sling: "sling", pgrip: "revgrip", receiver: "mount" };
export function lookOf(part, slot) {
  const key = typeof part === "string" ? part : part && part.key;
  const g = key && GEAR[key];
  if (g && g.look && PART_ART[g.look]) return g.look;
  if (MOD_LOOK[key]) return MOD_LOOK[key];
  if (/^mag/.test(String(key))) { const n = Number((/(\d+)/.exec(key) || [])[1]); if (n) return n >= 50 ? "drum" : n > 30 ? "stick40" : n > 20 ? "stick30" : n > 10 ? "stick20" : "stick10"; } // magazine items (section 15)
  return SLOT_LOOK[slot] || "reddot";
}

// ---------- which art a weapon gets ----------
// Section 5's platform table (the economy agent's data-gunmods.js WEAPON_PLATFORM takes over once it is filled).
export const LOCAL_PLATFORM = {
  pistol: "glock", compact9: "glock", pistol45: "p1911", pistol22: "rimpistol", revolver: "revolver", smg: "mp5", carbine: "ar15", ar: "ar15",
  dmr: "ar10", lmg: "m249", ak: "ak", huntrifle: "bolt", sniper: "bolt", leverrifle: "lever", rifle22: "rimrifle", shotgun: "pump",
  semishotgun: "semi12", dbshotgun: "dbl", sawnoff: "dbl", amr: "amr", pipegun: "zip",
};
// A weapon's own drawing where its platform's would not do (section 22: the sniper's long barrel).
const WEAPON_ART = { sniper: "sniper", sawnoff: "sawnoff", compact9: "compact" };
// The parts a weapon has of its own where its platform has no slot for them (the hunting rifle's scope is in its stats).
const WEAPON_DEF = { huntrifle: { optic: "scope9" }, sniper: { optic: "scope25", bipod: "bipod" } };
export const isGunKey = isGun; // a gun (not a bow, a blade or acid)
const smallGun = (k) => !!(GEAR[k] && GEAR[k].small) || ["9mm", "45acp", "357", "22lr"].includes(WEAPONS[k] && WEAPONS[k].cal) && !((WEAPONS[k].cap || 0) > 20);
export function platformOf(k) {
  return (DGM.WEAPON_PLATFORM && DGM.WEAPON_PLATFORM[k]) || LOCAL_PLATFORM[k] || (smallGun(k) ? "generic_pistol" : "generic_rifle");
}
export function artKeyOf(k) {
  if (WEAPONS[k] && ownKey(k)) return ensureArt(k);
  const own = (WEAPONS[k] && WEAPONS[k].look) || (GEAR[k] && GEAR[k].look);
  if (own && PLAT_ART[own]) return own;
  if (WEAPON_ART[k]) return WEAPON_ART[k];
  const pl = platformOf(k);
  if (PLAT_ART[pl] && !/^generic_/.test(pl)) return pl;
  const like = WEAPONS[k] && likeByWords(k); // no platform: a look-alike when its name or description says what it is
  if (like) return ensureArt(like);
  return smallGun(k) ? "generic_pistol" : "generic_rifle";
}
function likeByWords(k) {
  const g = GEAR[k] || {}, text = `${WEAPONS[k].name || ""} ${g.name || ""} ${g.desc || ""}`.toLowerCase();
  const hit = FALLBACK_LIKE.words.find(([re]) => re.test(text));
  return hit && GUN_ART[hit[1]] ? hit[1] : null;
}

// ---------- the gun specs' drawings (ui/gunspecs.js, ui/gunpaint.js) ----------
// compileArt(spec key): a PLAT_ART entry from a spec: its family's paint (then the spec's extra), its anchors (the
// spec's over them) and its own parts as looks (a stock or magazine given as { t, ... } becomes a PART_ART look of its
// own, "own_<key>_stock" / "own_<key>_mag", so a fitted stock or magazine replaces it like any other).
export function compileArt(key) {
  const s = norm(key);
  const def = {};
  if (s.stock) {
    if (typeof s.stock === "string") def.stock = s.stock;
    else { const st = s.stock, S = STOCKS[st.t] || STOCKS.ar, c = st.c || s.cn.furn; def.stock = `own_${key}_stock`; PART_ART[def.stock] = (p, a) => S.draw(p, a, c); }
  }
  if (s.mag) {
    if (typeof s.mag === "string") def.mag = s.mag;
    else { const mg = s.mag, M = MAGS[mg.t] || MAGS.stick; def.mag = `own_${key}_mag`; PART_ART[def.mag] = (p, a) => M.draw(p, a, mg); }
  }
  if (s.muzzle) def.muzzle = s.muzzle;
  if (s.bipod) def.bipod = s.bipod;
  if (s.grips) def.grip = s.grips;
  const anchors = { ...s.fam.anchors(s), ...(s.anchors || {}) };
  const paint = (p, fitted = {}) => { s.fam.paint(p, s, fitted); if (s.extra) s.extra(p, s, fitted, { R, H, V, dots, grip, guard, stockShape, C }); };
  return { paint, anchors, def, own: s.own || {}, spec: key };
}
// A gun's compiled drawing, made once and kept in PLAT_ART under the gun's key (a turret's under its own key too).
function ensureArt(k) {
  const o = ownKey(k) || k;
  if (!PLAT_ART[k] || PLAT_ART[k].spec !== o) PLAT_ART[k] = compileArt(o);
  return k;
}
for (const k of Object.keys(WEAPONS)) if (isGun(k) && ownKey(k)) ensureArt(k);
export const artOf = (k) => PLAT_ART[artKeyOf(k)];

// The anchor of a slot on a weapon's art ([x, y] grid pixels). fitted: the slots with a part in them (a mount lifts the
// optic a pixel).
export const anchorOf = (k, slot, fitted = {}) => artAnchor(artOf(k), slot, fitted);
function artAnchor(art, slot, fitted = {}) {
  let a = art.anchors[slot];
  if (!a) for (const s of ALIAS[slot] || []) if (art.anchors[s]) { a = art.anchors[s]; break; }
  if (!a) a = [32, 9];
  if (slot === "optic" && fitted.mount) a = [a[0], a[1] - 1];
  return a;
}

// Paints a weapon (WEAPONS key) with the parts in looks ({ slot: look }); slots: the slots it takes (its own parts
// in WEAPON_DEF are drawn only where it has no such slot). Parts are drawn back to front: stock, magazine, under the
// barrel, muzzle, mounts, then sights.
const ORDER = ["sling", "stock", "grip", "pgrip", "mag", "under", "bipod", "rail", "receiver", "tactical", "muzzle", "mount", "optic"];
export function paintGun(k, looks = {}, slots = null) {
  const ak = artKeyOf(k);
  return paintArt(ak, looks, WEAPON_DEF[k] || (PLAT_ART[ak] && PLAT_ART[ak].own) || {}, slots);
}
// The same by art key (PLAT_ART), with a weapon's own parts (own) where it has no such slot.
export function paintArt(artKey, looks = {}, own = {}, slots = null) {
  const art = PLAT_ART[artKey] || PLAT_ART.generic_rifle;
  const p = painter(ART_W, ART_H);
  const ctx = { art, key: artKey };
  const draw = (slot, look) => { if (PART_ART[look]) PART_ART[look](p, artAnchor(art, slot, looks), ctx); };
  // Parts behind the gun first (a stock, a sling), then the gun, then the rest over it.
  const all = { ...art.def };
  for (const [s, l] of Object.entries(own)) if (!slots || !slots.includes(s)) all[s] = l;
  for (const [s, l] of Object.entries(looks)) if (l) all[s] = l;
  for (const s of ["sling", "stock"]) if (all[s]) draw(s, all[s]);
  art.paint(p, looks);
  for (const s of ORDER) if (s !== "sling" && s !== "stock" && all[s]) draw(s, all[s]);
  for (const [s, l] of Object.entries(all)) if (!ORDER.includes(s)) draw(s, l);
  return p;
}

// The parts on an item as looks ({ slot: look }): any slot of item.mods, nested ones included.
export function looksOf(item) {
  const out = {};
  if (item && item.mods) for (const [slot, m] of Object.entries(item.mods)) if (m && m.key) out[slot] = lookOf(m, slot);
  return out;
}

// The canvas of a weapon item as fitted (cached by art and looks), and its data URL for an <img>.
const cache = new Map();
export function gunCanvas(item, slots = null) {
  const looks = looksOf(item);
  const key = `${item.key}|${slots ? slots.join(",") : "-"}|${Object.entries(looks).sort().map(([s, l]) => `${s}:${l}`).join(",")}`;
  let cv = cache.get(key);
  if (cv === undefined) {
    if (cache.size > 200) cache.clear();
    cv = toCanvas(paintGun(item.key, looks, slots), ART_UP);
    cache.set(key, cv);
  }
  return cv;
}
// A data URL (the sprites' canvasURL shrinks to the 22 × 26 sprite size: this one keeps the gun's own size).
const urls = new Map();
export function gunURL(item, slots = null) {
  const cv = gunCanvas(item, slots);
  if (!cv) return "";
  let u = urls.get(cv);
  if (!u) {
    u = typeof cv.toDataURL === "function" ? cv.toDataURL("image/png") : canvasURL(cv);
    if (urls.size > 200) urls.clear();
    urls.set(cv, u);
  }
  return u;
}
