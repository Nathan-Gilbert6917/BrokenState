// Item icons, the tools family (ui/itemart.js; the kit and the rules: ui/itemart/kit.js): skill books, blueprint
// manuals, tools, lights, optics, radios, medical kits, throwables and noise-makers, camp gear, defences and ear
// protection. Each drawing is a 16 × 16 grid, light from the top left; toCanvas adds the outline.
import { C, R, H, V, dots, shade, line, disc, ring, oval, box, stamp } from "./kit.js";

// A few colours of this family's own.
const K = {
  glowL: "#fff6c8", glow: "#ffe27a", beam: "#f4e9a0", cool: "#dff4ff", nvg: "#7dff6a", nvgD: "#2f9a3a",
  od: "#4f5a44", odL: "#617056", odD: "#3c4534", fde: "#a48c62", fdeL: "#b9a276", fdeD: "#86714c",
  steel: "#7d858c", metal: "#9aa3ab", gun: "#2b2e33", dark: "#1a1c20", amber: "#a8611e", amberL: "#c9822e",
  bp: "#2d64a8", bpL: "#4a82c4", bpD: "#1d4478", binder: "#283447", binderL: "#3a4a62", teal: "#2f8f8a", tealD: "#22665f",
  hunter: "#e0672a", maroon: "#7a2a2e", navy: "#25365a", rust: "#9a5a2e", slate: "#4a5560", pinkD: "#b05a7a",
  burlap: "#a08a5a", burlapD: "#7a6842", plaid: "#8a3a34", heat: "#e85a3a", therm1: "#3a1f5a", therm2: "#c0408a",
};

// Clear the inside of an oval (a hole, outlined by toCanvas).
function clearOval(p, x0, y0, x1, y1) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 + 0.5, ry = (y1 - y0) / 2 + 0.5;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) p.clear(x, y);
}
// A line two pixels thick (the second one pixel to the right).
const thick = (p, x0, y0, x1, y1, c, c2 = c) => { line(p, x0 + 1, y0, x1 + 1, y1, c2); line(p, x0, y0, x1, y1, c); };

// ---- skill books: a closed hardback, its own cover colour and an emblem for its subject (7 wide, from x 5 y 3)
const EMB = {
  cross: ["..xxx..", "..xxx..", "xxxxxxx", "xxxxxxx", "xxxxxxx", "..xxx..", "..xxx.."],
  scalpel: ["......x", ".....xx", "....xx.", "...xx..", "..h....", ".hh....", "hh....."],
  gear: ["..x.x..", ".xxxxx.", "xxx.xxx", "xx...xx", "xxx.xxx", ".xxxxx.", "..x.x.."],
  leaf: ["....xxx", "..xxxxx", ".xxxxlx", ".xxxlxx", ".xxlxx.", "..lxx..", ".l....."],
  pistol: ["x.....x", "xxxxxxx", "xxxxxxx", "xxx.x..", "xxxxx..", "xxx....", "xxx....", "xx....."],
  star: ["...x...", "..xxx..", "xxxxxxx", ".xxxxx.", "..xxx..", ".xx.xx.", "xx...xx"],
  pine: ["...x...", "..xxx..", ".xxxxx.", "..xxx..", ".xxxxx.", "xxxxxxx", "...t..."],
  speech: [".xxxxx.", "xxxxxxx", "xd.d.dx", "xxxxxxx", ".xxxxx.", ".xx....", ".x....."],
  padlock: ["..sss..", ".s...s.", ".s...s.", "xxxxxxx", "xxx.xxx", "xxx.xxx", "xxxxxxx"],
  chevron: ["...x...", "..xxx..", ".xx.xx.", "xx...xx", "...x...", "..xxx..", ".xx.xx.", "xx...xx"],
  wrench: ["....x.x", "....xxx", "...xxx.", "..xxx..", ".xxx...", "xxx....", "xx....."],
  hammer: ["hhhhhh.", "hhhhhhh", "hh.....", "..w....", "..w....", "..w....", "..w...."],
  anvil: ["..s.s..", "...s...", "xxxxxxx", ".xxxxxx", "...xxx.", "...xxx.", "..xxxxx"],
  hatchet: [".xx....", "xxxx...", "xxxww..", ".x..w..", "....w..", ".....w.", ".....w."],
  cutlery: ["x.x..s.", "x.x.sss", "xxx.sss", ".x...s.", ".x...s.", ".x...s.", ".x...s."],
  toque: ["..x.x..", ".xxxxx.", "xxxxxxx", "xxxxxxx", ".xxxxx.", ".bbbbb.", ".bbbbb."],
  antlers: ["x.....x", "x.x.x.x", "xx...xx", ".x...x.", "..x.x..", "..xxx..", "...x..."],
  jar: [".lllll.", "..xxx..", ".xxxxx.", ".xccxx.", ".xccxx.", ".xxxxx."],
};
function book(cover, emblem, key, title = shade(cover, 0.35)) {
  return (p) => {
    const dk = shade(cover, -0.38), md = shade(cover, -0.18), hi = shade(cover, 0.28);
    V(p, 13, 2, 14, C.paper); H(p, 3, 13, 15, C.paperD); dots(p, 13, 13, 3, C.paperL); p.set(13, 6, C.paperL); p.set(13, 10, C.paperL);
    R(p, 2, 1, 12, 14, cover);
    V(p, 2, 1, 14, dk); V(p, 3, 1, 14, md); H(p, 4, 12, 1, hi); H(p, 4, 12, 14, md); V(p, 12, 2, 13, md);
    stamp(p, 5, 3, EMB[emblem], key);
    H(p, 6, 10, 12, title);
  };
}

// ---- blueprint manuals: blue paper in a ring binder, white lines, a coloured index tab and an emblem
const BPE = {
  scalpel: ["......x", ".....xx", "....xx.", "...xx..", "..x....", ".xx....", "xx....."],
  hosp: ["xxxxxxx", "x.....x", "x.x.x.x", "x.xxx.x", "x.x.x.x", "x.....x", "xxxxxxx"],
  gear: ["..x.x..", ".xxxxx.", "xxx.xxx", "xx...xx", "xxx.xxx", ".xxxxx.", "..x.x.."],
  bolt: ["...xxx.", "..xxx..", ".xxx...", "xxxxxx.", "...xx..", "..xx...", ".x....."],
  plug: ["..x.x..", "..x.x..", ".xxxxx.", ".xxxxx.", "..xxx..", "...x...", "...x..."],
  fort: ["x.x.x.x", "xxxxxxx", "xxxxxxx", "xx...xx", "xx...xx", "xx...xx"],
  drop: ["...x...", "..xxx..", ".xxxxx.", "xxxxxxx", "xxxxxxx", ".xxxxx.", "..xxx.."],
  flake: ["x..x..x", ".x.x.x.", "..xxx..", "xxxxxxx", "..xxx..", ".x.x.x.", "x..x..x"],
  jar: ["xxxxxxx", ".x...x.", "x.....x", "x.xxx.x", "x.....x", "x.....x", ".xxxxx."],
  mast: [".x...x.", "x..x..x", "x.xxx.x", ".x.x.x.", "...x...", "..x.x..", ".x...x."],
  xbow: [".xxxxx.", "x..x..x", ".x.x.x.", "..xxx..", "...x...", "..xx...", "...x..."],
  vest: ["xxxxxxx", "x.x.x.x", "x.....x", "x.x.x.x", ".x...x.", "..x.x..", "...x..."],
  bow: [".x.....", ".xx....", "xx..xx.", "xxxxxxx", "xx..xx.", ".xx....", ".x....."],
  medic: [".xxxxx.", "xxxrxxx", "xxrrrxx", "xrrrrrx", "xxrrrxx", "xxxrxxx", ".xxxxx."],
};
function manual(tab, emblem, key = { x: C.white }) {
  return (p) => {
    R(p, 1, 1, 14, 15, K.binder); H(p, 1, 13, 1, K.binderL); V(p, 1, 2, 14, K.binderL);
    R(p, 4, 2, 13, 14, K.bp); H(p, 4, 13, 2, K.bpL); H(p, 4, 13, 14, K.bpD); V(p, 13, 3, 14, K.bpD);
    for (let y = 5; y <= 12; y += 3) dots(p, 5, 12, y, K.bpL, 1);
    for (let x = 6; x <= 12; x += 3) for (let y = 3; y <= 13; y++) p.set(x, y, K.bpL);
    for (let y = 3; y <= 13; y += 3) { H(p, 2, 4, y, C.silver); p.set(4, y, C.silverD); }
    R(p, 15, 3, 15, 6, tab); p.set(14, 3, tab);
    R(p, 5, 4, 11, 10, K.bp);
    stamp(p, 5, 4, BPE[emblem], key);
    H(p, 6, 11, 13, C.white);
  };
}

export const GEAR_ART = {
  // ---- skill books
  medbook: book(C.white, "cross", { x: C.red }, C.red),
  surgerybook: book(C.red, "scalpel", { x: C.white, h: C.silverD }),
  enginebook: book(C.cloth, "gear", { x: C.yellow }),
  gardenbook: book(C.paper, "leaf", { x: C.green, l: C.greenD }, C.green),
  gunbook: book(C.blue, "pistol", { x: C.blackL }),
  armymanual: book(K.od, "star", { x: C.yellow }),
  survivalbook: book(C.brown, "pine", { x: C.greenL, t: C.brownD }),
  talkbook: book(C.purple, "speech", { x: C.white, d: C.purple }),
  lockbook: book(C.black, "padlock", { x: C.gold, s: C.silver }),
  leadbook: book(K.navy, "chevron", { x: C.gold }),
  scavbook: book(K.rust, "wrench", { x: C.silver }),
  diybook: book(C.yellow, "hammer", { h: C.blackL, w: C.brown }, C.brownL),
  forgebook: book(K.maroon, "anvil", { x: C.silver, s: C.fire }),
  bushcraftbook: book(C.greenD, "hatchet", { x: C.silver, w: C.card }),
  cookbook: book(C.pink, "cutlery", { x: C.white, s: C.white }),
  chefbook: book(K.slate, "toque", { x: C.white, b: C.whiteD }),
  gamebook: book(K.hunter, "antlers", { x: C.brownD }),
  prepbook: book(C.khaki, "jar", { x: C.water, l: C.gold, c: C.orange }),

  // ---- blueprint manuals
  bp_fieldsurgery: manual(C.red, "scalpel"),
  bp_hospitalops: manual(C.white, "hosp"),
  bp_machinist: manual(C.silverD, "gear"),
  bp_genschem: manual(C.yellow, "bolt", { x: C.yellow }),
  bp_indpower: manual(C.orange, "plug"),
  bp_armyeng: manual(K.odL, "fort"),
  bp_watertreat: manual(C.cyan, "drop"),
  bp_refrig: manual(K.cool, "flake"),
  bp_canning: manual(C.green, "jar"),
  bp_radioeng: manual(C.purple, "mast"),
  bp_weaponplans: manual(C.brownL, "xbow"),
  bp_armorsmith: manual(K.steel, "vest"),
  bp_bowyer: manual(C.leaf, "bow"),
  bp_combatmedic: manual(K.od, "medic", { x: C.white, r: C.red }),

  // ---- lights
  flashlight: (p) => {
    R(p, 0, 6, 10, 10, C.blackL); H(p, 1, 10, 6, "#55595f"); H(p, 0, 10, 10, C.black); V(p, 0, 6, 10, C.black);
    R(p, 5, 5, 6, 5, C.red);
    box(p, 10, 4, 13, 12, C.blackL, "#55595f", C.black);
    R(p, 14, 4, 15, 12, C.silver); R(p, 15, 5, 15, 11, K.glow); p.set(15, 6, K.glowL); p.set(15, 7, K.glowL);
  },
  tacflash: (p) => {
    R(p, 0, 7, 10, 9, K.gun); H(p, 0, 10, 7, "#454a52"); dots(p, 2, 8, 8, K.dark); H(p, 0, 10, 9, K.dark);
    R(p, 0, 6, 1, 10, K.dark); p.set(0, 7, C.silverD);
    R(p, 11, 5, 14, 11, K.gun); H(p, 11, 14, 5, "#454a52"); H(p, 11, 14, 11, K.dark);
    V(p, 15, 6, 10, K.cool); p.set(15, 5, K.metal); p.set(15, 11, K.metal); p.set(15, 8, K.metal);
  },
  windlight: (p) => {
    R(p, 0, 6, 10, 10, C.yellow); H(p, 0, 10, 6, C.goldL); H(p, 0, 10, 10, C.yellowD); V(p, 0, 7, 9, C.yellowD);
    box(p, 10, 4, 13, 12, C.yellow, C.goldL, C.yellowD); R(p, 14, 4, 15, 12, C.blackL); V(p, 15, 5, 11, K.glow); p.set(15, 6, K.glowL);
    disc(p, 5, 8, 2, C.blackL); p.set(5, 8, C.silver);
    line(p, 5, 9, 3, 13, C.black); R(p, 1, 13, 3, 15, C.red); p.set(1, 13, C.redL);
    dots(p, 7, 9, 8, C.yellowD);
  },
  torch: (p) => {
    thick(p, 3, 15, 8, 8, C.brown, C.brownD);
    R(p, 7, 6, 10, 9, C.ropeD); H(p, 7, 10, 7, C.rope);
    stamp(p, 5, 0, ["...x....", "..xx..x.", ".xxyx.xx", ".xyyyxx.", "xxyyyyx.", ".xxyyxx."], { x: C.fire, y: C.fireL });
  },
  lantern: (p) => {
    stamp(p, 4, 0, ["..xxxx..", ".x....x."], { x: C.silverD });
    R(p, 4, 2, 11, 3, C.greenD); H(p, 5, 10, 2, C.green);
    R(p, 5, 4, 10, 11, K.glow); R(p, 6, 5, 8, 9, K.glowL); p.set(7, 7, C.fire);
    V(p, 5, 4, 11, C.greenD); V(p, 10, 4, 11, C.greenD); V(p, 7, 4, 4, C.greenD);
    R(p, 3, 12, 12, 14, C.green); H(p, 3, 12, 12, C.greenL); H(p, 3, 12, 14, C.greenD); R(p, 7, 13, 8, 13, C.silver);
  },
  spotlight: (p) => {
    R(p, 0, 5, 7, 11, C.blackL); H(p, 0, 7, 5, "#55595f"); H(p, 0, 7, 11, C.black);
    stamp(p, 1, 1, ["xxxxx", "x...x", "x...x"], { x: C.black });
    R(p, 2, 12, 4, 15, C.black); p.set(5, 12, C.red);
    disc(p, 10, 8, 5, C.silver); disc(p, 10, 8, 4, K.glow); disc(p, 10, 8, 2, K.glowL); p.set(8, 6, C.white);
    p.set(14, 9, C.silverD); p.set(13, 11, C.silverD); p.set(11, 12, C.silverD);
  },
  headlamp: (p) => {
    oval(p, 0, 1, 15, 12, C.orange); clearOval(p, 2, 3, 13, 10);
    for (let x = 1; x < 15; x += 3) { p.set(x, 1, C.orangeD); p.set(x, 12, C.orangeD); }
    box(p, 4, 8, 11, 14, C.blackL, "#55595f", C.black);
    disc(p, 7, 11, 2, K.glow); p.set(6, 10, K.glowL); p.set(7, 10, K.glowL); p.set(10, 9, C.red);
  },
  helmetlight: (p) => {
    oval(p, 1, 2, 13, 18, K.od); for (let y = 12; y < 16; y++) for (let x = 0; x < 16; x++) p.clear(x, y);
    H(p, 4, 9, 3, K.odL); V(p, 2, 5, 9, K.odL); H(p, 0, 14, 11, K.odD); H(p, 1, 13, 10, K.odD);
    R(p, 5, 7, 12, 9, C.black); H(p, 5, 12, 7, C.blackL); R(p, 13, 6, 14, 10, C.blackL); V(p, 15, 6, 10, K.glow); p.set(15, 7, K.glowL);
    R(p, 7, 10, 9, 11, K.gun);
  },

  // ---- optics
  binoculars: (p) => {
    R(p, 1, 2, 5, 8, C.blackL); R(p, 10, 2, 14, 8, C.blackL); H(p, 1, 5, 2, "#55595f"); H(p, 10, 14, 2, "#55595f");
    R(p, 5, 4, 10, 7, C.black); R(p, 7, 3, 8, 5, K.gun);
    disc(p, 4, 11, 3, C.blackL); disc(p, 11, 11, 3, C.blackL);
    disc(p, 4, 11, 2, C.blueD); disc(p, 11, 11, 2, C.blueD); p.set(3, 10, C.blueL); p.set(10, 10, C.blueL); p.set(4, 10, C.blue); p.set(11, 10, C.blue);
  },
  monocular: (p) => {
    R(p, 0, 6, 2, 10, C.black); R(p, 3, 5, 12, 11, K.od); H(p, 3, 12, 5, K.odL); H(p, 3, 12, 11, K.odD);
    dots(p, 5, 11, 8, K.odD); R(p, 13, 4, 14, 12, C.blackL); V(p, 15, 5, 11, C.blueD); V(p, 15, 6, 7, C.blueL);
    stamp(p, 4, 12, ["x....x", ".x..x.", "..xx.."], { x: C.red });
  },
  spotscope: (p) => {
    R(p, 3, 4, 11, 8, K.od); H(p, 3, 11, 4, K.odL); H(p, 3, 11, 8, K.odD);
    R(p, 12, 2, 14, 10, K.odD); V(p, 15, 3, 9, C.blueD); V(p, 15, 4, 5, C.blueL);
    thick(p, 1, 1, 3, 3, C.black); R(p, 0, 0, 2, 1, C.blackL);
    R(p, 7, 9, 8, 10, C.black); line(p, 7, 11, 3, 15, C.silverD); V(p, 8, 11, 15, C.silver); line(p, 9, 11, 13, 15, C.silverD);
  },
  telescope: (p) => {
    for (let i = 0; i < 4; i++) line(p, 1, 9 + i, 13, 2 + i, i === 0 ? C.white : i === 3 ? C.whiteD : C.white);
    line(p, 1, 9, 1, 12, C.black); R(p, 0, 9, 1, 12, C.black); line(p, 13, 2, 13, 5, C.black); R(p, 13, 1, 15, 5, C.black);
    line(p, 4, 6, 7, 4, C.silverD);
    R(p, 7, 8, 8, 9, C.black); line(p, 7, 10, 3, 15, C.brownL); V(p, 8, 10, 15, C.brown); line(p, 9, 10, 13, 15, C.brownL);
  },
  thermal: (p) => {
    box(p, 1, 3, 14, 12, K.gun, "#454a52", K.dark);
    R(p, 3, 5, 10, 10, K.therm1);
    stamp(p, 4, 5, ["..yy..", "..yy..", ".ryyr.", "rryyrr", ".ryyr.", ".r..r."], { y: C.fireL, r: K.therm2 });
    R(p, 12, 5, 12, 6, C.red); p.set(12, 8, K.metal); p.set(12, 9, K.metal);
    R(p, 5, 13, 10, 15, C.black); R(p, 4, 1, 7, 2, C.black);
  },
  nvg: (p) => {
    R(p, 6, 0, 9, 3, C.black); H(p, 6, 9, 0, C.blackL);
    box(p, 2, 3, 13, 7, K.od, K.odL, K.odD);
    disc(p, 4, 10, 3, K.odD); disc(p, 11, 10, 3, K.odD);
    disc(p, 4, 10, 2, K.nvgD); disc(p, 11, 10, 2, K.nvgD); disc(p, 4, 10, 1, K.nvg); disc(p, 11, 10, 1, K.nvg);
    p.set(3, 9, C.white); p.set(10, 9, C.white);
  },

  // ---- radios
  milradio: (p) => {
    V(p, 12, 0, 4, C.black); R(p, 11, 3, 13, 4, C.blackL);
    R(p, 3, 3, 4, 4, C.black); R(p, 7, 3, 8, 4, C.black);
    box(p, 1, 5, 14, 15, K.od, K.odL, K.odD);
    R(p, 3, 7, 8, 9, K.nvgD); H(p, 4, 7, 8, K.nvg);
    for (let y = 11; y <= 13; y += 2) dots(p, 3, 8, y, C.black);
    R(p, 10, 7, 12, 9, C.black); p.set(11, 8, C.silver); R(p, 10, 11, 12, 13, K.odD);
  },
  handradio: (p) => {
    stamp(p, 3, 1, ["xxxxxxx", "x.....x"], { x: C.black });
    V(p, 2, 0, 4, C.silver);
    box(p, 1, 3, 12, 13, C.orange, C.yellow, C.orangeD);
    R(p, 3, 5, 10, 6, C.paperL); p.set(6, 5, C.red); p.set(6, 6, C.red);
    for (let y = 8; y <= 11; y++) dots(p, 3 + (y % 2), 10, y, C.orangeD);
    V(p, 13, 6, 9, C.black); H(p, 13, 15, 9, C.black); R(p, 14, 10, 15, 13, C.blackL);
  },
  pocketradio: (p) => {
    line(p, 10, 3, 14, 0, C.silver);
    box(p, 3, 3, 11, 15, C.red, C.redL, C.redD);
    R(p, 4, 4, 10, 6, C.paperL); H(p, 5, 9, 5, C.ink); p.set(8, 4, C.red);
    disc(p, 7, 11, 3, C.silverD); for (let y = 9; y <= 13; y += 2) dots(p, 5, 9, y, C.ink); p.set(6, 9, C.silver);
    R(p, 12, 7, 12, 9, C.gold);
  },

  // ---- medical
  surgkit: (p) => {
    box(p, 0, 2, 15, 14, K.teal, shade(K.teal, 0.25), K.tealD);
    R(p, 0, 10, 15, 14, K.tealD); H(p, 0, 15, 10, shade(K.teal, -0.15)); for (const x of [4, 8, 11]) V(p, x, 11, 14, shade(K.teal, -0.5));
    // scalpel, forceps, scissors
    V(p, 2, 3, 6, C.white); V(p, 2, 7, 12, C.silverD); p.set(2, 2, C.white);
    line(p, 5, 3, 6, 12, C.silver); line(p, 7, 3, 6, 12, C.silverD); p.set(6, 12, C.silver);
    line(p, 9, 2, 12, 8, C.silver); line(p, 13, 2, 10, 8, C.white);
    ring(p, 9, 11, 1, C.silver); ring(p, 13, 11, 1, C.silver); p.set(10, 9, C.silver); p.set(12, 9, C.silver);
  },
  bandagekit: (p) => {
    box(p, 0, 0, 3, 15, C.woodL, shade(C.woodL, 0.2), C.wood); H(p, 0, 3, 4, C.paper); H(p, 0, 3, 11, C.paper);
    R(p, 8, 10, 11, 15, C.white); V(p, 11, 10, 15, C.whiteD); dots(p, 8, 11, 13, C.paperD, 3);
    disc(p, 9, 7, 5, C.white); ring(p, 9, 7, 5, C.whiteD); ring(p, 9, 7, 3, C.paperD); disc(p, 9, 7, 1, C.blackL);
    p.set(6, 4, C.paperL); p.set(7, 3, C.paperL); p.set(5, 5, C.paperL);
    R(p, 13, 0, 14, 2, C.red); R(p, 12, 1, 15, 1, C.red);
  },
  traumakit: (p) => {
    box(p, 1, 3, 14, 14, K.fde, K.fdeL, K.fdeD);
    for (let x = 2; x <= 13; x++) p.set(x, 5, x % 2 ? C.black : C.blackL); R(p, 13, 4, 14, 6, C.silver);
    R(p, 6, 7, 10, 12, C.red); R(p, 7, 8, 9, 11, C.white); H(p, 6, 10, 9, C.white); R(p, 7, 9, 9, 10, C.white);
    R(p, 7, 7, 9, 12, C.red); R(p, 6, 8, 10, 11, C.red); R(p, 8, 7, 8, 12, C.white); H(p, 6, 10, 9, C.white); H(p, 6, 10, 10, C.white);
    V(p, 3, 7, 13, K.fdeD); V(p, 12, 7, 13, K.fdeD); R(p, 5, 1, 10, 2, K.fdeD);
  },
  tourniquet: (p) => {
    oval(p, 0, 4, 15, 13, C.black); clearOval(p, 2, 6, 13, 11);
    H(p, 3, 12, 4, C.blackL); for (let x = 1; x <= 14; x += 3) p.set(x, 12, K.gun);
    box(p, 12, 6, 15, 11, C.silverD, C.silver, K.steel);
    R(p, 3, 1, 12, 2, K.gun); H(p, 3, 12, 1, "#454a52"); R(p, 1, 0, 2, 3, C.red); R(p, 13, 0, 14, 3, C.red);
    R(p, 6, 3, 9, 5, K.gun);
    R(p, 5, 12, 9, 15, C.red); H(p, 5, 9, 12, C.redL); H(p, 6, 8, 14, C.white);
  },
  dewormer: (p) => {
    box(p, 1, 1, 14, 14, C.silver, C.white, C.silverD);
    R(p, 2, 2, 13, 4, C.green); H(p, 3, 11, 3, C.greenL);
    for (const y of [6, 10]) for (const x of [3, 7, 11]) { R(p, x, y, x + 1, y + 2, C.white); p.set(x + 1, y + 2, C.whiteD); p.set(x, y, C.paperL); }
  },
  puritabs: (p) => {
    R(p, 3, 1, 8, 3, C.blue); H(p, 3, 8, 1, C.blueL);
    box(p, 3, 4, 8, 15, K.amber, K.amberL, shade(K.amber, -0.3));
    R(p, 4, 7, 7, 11, C.paperL); H(p, 4, 7, 9, C.red);
    for (const [x, y] of [[10, 10], [12, 12], [10, 13]]) { R(p, x, y, x + 2, y + 1, C.white); p.set(x + 2, y + 1, C.whiteD); }
  },
  earplugs: (p) => {
    stamp(p, 1, 0, ["..yy....", ".yyyy...", ".yyyy...", "yyyyy...", "yyyyd...", ".yydd...", "..bb...."], { y: C.yellow, d: C.yellowD, b: C.blue });
    stamp(p, 9, 5, ["..yy..", ".yyyy.", ".yyyy.", "yyyyy.", "yyyyd.", ".yydd.", "..bb.."], { y: C.orange, d: C.orangeD, b: C.blue });
    line(p, 3, 7, 4, 13, C.blue); line(p, 4, 13, 9, 14, C.blue); line(p, 9, 14, 11, 12, C.blue);
  },
  earmuffs: (p) => {
    oval(p, 2, 0, 13, 12, C.black); clearOval(p, 4, 2, 11, 14);
    H(p, 4, 11, 0, C.blackL);
    box(p, 0, 7, 4, 14, C.red, C.redL, C.redD); box(p, 11, 7, 15, 14, C.red, C.redL, C.redD);
    V(p, 4, 8, 13, C.black); V(p, 11, 8, 13, C.black);
  },
  eardef: (p) => {
    oval(p, 2, 0, 13, 12, K.gun); clearOval(p, 4, 2, 11, 14);
    box(p, 0, 6, 4, 14, C.blackL, "#55595f", C.black); box(p, 11, 6, 15, 14, C.blackL, "#55595f", C.black);
    p.set(2, 8, K.nvg); R(p, 12, 9, 13, 10, C.silver); R(p, 1, 11, 2, 12, K.metal);
  },
  commset: (p) => {
    oval(p, 2, 0, 13, 12, K.odD); clearOval(p, 4, 2, 11, 14);
    box(p, 0, 6, 4, 13, K.od, K.odL, K.odD); box(p, 11, 6, 15, 13, K.od, K.odL, K.odD);
    line(p, 2, 13, 5, 15, C.black); H(p, 5, 9, 15, C.black); R(p, 9, 14, 10, 15, C.blackL);
    p.set(13, 8, C.red); V(p, 13, 14, 15, C.black);
  },

  // ---- tools
  crowbar: (p) => {
    thick(p, 2, 14, 11, 5, C.red, C.redD);
    stamp(p, 10, 1, ["..rr.", ".r..r", "rr..r", "r....", "....."], { r: C.red });
    H(p, 0, 3, 14, C.redD); p.set(0, 13, C.red);
    line(p, 1, 1, 6, 6, C.silver); line(p, 3, 0, 8, 5, C.silverD); p.set(1, 0, C.silver); p.set(0, 1, C.silver);
  },
  ladder: (p) => {
    R(p, 3, 0, 4, 15, C.brownL); V(p, 4, 0, 15, C.brown); R(p, 11, 0, 12, 15, C.brownL); V(p, 12, 0, 15, C.brown);
    for (let y = 2; y <= 14; y += 3) { H(p, 5, 10, y, C.bread); p.set(5, y, C.rope); p.set(10, y, C.rope); p.set(3, y, C.ropeD); p.set(12, y, C.ropeD); }
  },
  ram: (p) => {
    R(p, 0, 5, 11, 10, C.brown); H(p, 0, 11, 5, C.brownL); H(p, 0, 11, 10, C.brownD); H(p, 2, 9, 8, C.brownD);
    oval(p, 0, 5, 1, 10, C.bread); p.set(0, 7, C.breadD);
    box(p, 11, 4, 15, 11, C.silver, C.white, C.silverD); V(p, 12, 5, 10, C.silverD);
    for (const x of [2, 7]) stamp(p, x, 10, ["r..r", "r..r", ".rr."], { r: C.rope });
  },
  cuffs: (p) => {
    ring(p, 4, 10, 4, C.silver); ring(p, 11, 10, 4, C.silver);
    for (let y = 7; y <= 13; y++) { p.set(1, y, C.silverD); p.set(8, y, C.silverD); }
    R(p, 3, 5, 5, 6, C.silverD); R(p, 10, 5, 12, 6, C.silverD);
    stamp(p, 5, 1, ["xx..xx", "x.xx.x", "xx..xx"], { x: C.silverD });
  },
  waterfilter: (p) => {
    stamp(p, 3, 0, [".xxxxxxxx.", "x........x"], { x: C.silverD });
    R(p, 2, 2, 13, 12, C.silver); H(p, 2, 13, 2, C.white);
    R(p, 3, 3, 12, 4, C.water); H(p, 3, 12, 3, C.blueL);
    R(p, 3, 5, 12, 7, C.paperD); dots(p, 4, 12, 6, C.card);
    R(p, 3, 8, 12, 10, C.black); dots(p, 3, 12, 9, C.blackL);
    R(p, 3, 11, 12, 11, C.smoke); V(p, 13, 3, 12, C.silverD);
    R(p, 7, 13, 8, 13, C.silverD); p.set(7, 15, C.water); p.set(8, 14, C.waterD);
  },
  fishrod: (p) => {
    R(p, 9, 11, 14, 15, C.green); H(p, 9, 14, 11, C.greenL); H(p, 10, 13, 13, C.greenD);
    line(p, 1, 13, 14, 0, C.blackL); thick(p, 0, 15, 3, 12, C.card, C.cardD);
    disc(p, 5, 12, 1, C.silver); p.set(5, 12, C.silverD);
    V(p, 14, 1, 7, C.whiteD); p.set(14, 8, C.red); p.set(14, 9, C.white);
  },
  makeshiftrod: (p) => {
    line(p, 1, 15, 5, 9, C.brown); line(p, 5, 9, 6, 7, C.brownL); line(p, 6, 7, 11, 1, C.brown); line(p, 2, 15, 6, 9, C.brownD);
    stamp(p, 3, 7, ["ll", ".l"], { l: C.leaf }); p.set(8, 3, C.leaf); p.set(9, 4, C.leafD);
    V(p, 11, 1, 11, C.whiteD);
    stamp(p, 10, 11, [".ss", "s.s", "s..", ".s."], { s: C.silver });
  },
  fishnet: (p) => {
    for (let y = 4; y <= 15; y++) for (let x = 1; x <= 14; x++) if ((x + y) % 3 === 0 || (x - y + 30) % 3 === 0) p.set(x, y, (y > 9 ? C.ropeD : C.rope));
    H(p, 0, 15, 3, C.ropeD);
    for (const x of [1, 6, 11]) { R(p, x, 1, x + 3, 3, C.orange); H(p, x, x + 3, 1, C.yellow); }
  },
  snarewire: (p) => {
    ring(p, 6, 7, 6, C.gold); ring(p, 6, 7, 4, C.goldD);
    for (const [x, y] of [[3, 2], [9, 12], [1, 9]]) p.set(x, y, C.goldL);
    line(p, 11, 11, 13, 13, C.gold); ring(p, 13, 13, 2, C.gold); p.set(12, 12, C.goldD);
  },
  canner: (p) => {
    disc(p, 7, 2, 2, C.white); p.set(7, 2, C.red); p.set(8, 1, C.red); p.set(7, 4, C.black);
    oval(p, 2, 4, 13, 7, C.silverD); H(p, 4, 11, 4, C.silver);
    box(p, 2, 7, 13, 14, C.silver, C.white, C.silverD); H(p, 3, 12, 7, K.metal);
    R(p, 0, 7, 1, 9, C.black); R(p, 14, 7, 15, 9, C.black);
    R(p, 3, 6, 4, 8, C.blackL); R(p, 11, 6, 12, 8, C.blackL); p.set(11, 4, C.red);
  },
  powerdrill: (p) => {
    box(p, 3, 2, 11, 7, C.yellow, C.goldL, C.yellowD); R(p, 3, 4, 5, 6, C.blackL);
    R(p, 12, 3, 13, 6, C.black); H(p, 14, 15, 5, C.silver); p.set(14, 4, C.silverD);
    R(p, 6, 8, 9, 12, C.blackL); V(p, 9, 8, 12, C.black); p.set(10, 8, C.red);
    box(p, 3, 12, 11, 15, C.black, C.blackL, C.black); H(p, 4, 10, 13, C.yellowD);
  },
  anglegrinder: (p) => {
    R(p, 0, 7, 8, 11, K.teal); H(p, 0, 8, 7, shade(K.teal, 0.25)); H(p, 0, 8, 11, K.tealD); dots(p, 2, 6, 9, K.tealD);
    R(p, 8, 5, 10, 12, K.gun); V(p, 8, 5, 12, "#454a52");
    disc(p, 12, 11, 4, C.smoke); ring(p, 12, 11, 4, C.silverD); disc(p, 12, 11, 1, K.dark);
    stamp(p, 9, 4, ["..oooo.", ".o....o", "o......"], { o: C.orange });
    R(p, 3, 3, 4, 6, C.black);
  },
  repairkit: (p) => {
    stamp(p, 2, 0, [".s..r..x...", ".s..r..x.x.", "sss.r..xxx.", ".s.....x..."], { s: C.silver, r: C.red, x: C.silverD });
    box(p, 0, 4, 15, 13, C.khaki, shade(C.khaki, 0.25), C.khakiD);
    for (const x of [4, 8, 12]) V(p, x, 5, 12, C.khakiD);
    R(p, 0, 8, 15, 9, C.brownD); R(p, 13, 7, 15, 10, C.brown); p.set(14, 8, C.gold);
  },
  taser: (p) => {
    box(p, 0, 3, 11, 8, C.yellow, C.goldL, C.yellowD); R(p, 0, 3, 3, 8, C.blackL); dots(p, 0, 0, 4, C.silver); p.set(0, 7, C.silver);
    stamp(p, 6, 9, ["xxxx", ".xxxx", "..xxx", "..xxx", "...xx"], { x: C.blackL });
    stamp(p, 4, 9, ["x.", "x.", ".x"], { x: C.black }); p.set(12, 5, C.red); R(p, 8, 4, 10, 4, C.black);
  },
  tasercart: (p) => {
    for (const [x, y] of [[1, 2], [8, 5]]) {
      box(p, x, y, x + 6, y + 9, C.yellow, C.goldL, C.yellowD); R(p, x + 1, y + 1, x + 5, y + 3, C.blackL);
      p.set(x + 2, y + 2, C.silver); p.set(x + 4, y + 2, C.silver); H(p, x + 1, x + 5, y + 7, C.black);
    }
  },
  pepper: (p) => {
    R(p, 5, 1, 10, 3, C.black); H(p, 5, 10, 1, C.blackL); R(p, 3, 2, 4, 3, C.blackL);
    box(p, 5, 4, 10, 15, C.orange, C.yellow, C.orangeD);
    R(p, 6, 7, 9, 11, C.black); H(p, 6, 9, 9, C.red); R(p, 11, 5, 12, 12, K.gun);
  },

  // ---- throwables and noise-makers
  bottle: (p) => {
    R(p, 7, 0, 8, 1, C.silver); R(p, 7, 2, 8, 5, K.amber); p.set(7, 2, K.amberL);
    oval(p, 5, 4, 10, 8, K.amber); R(p, 5, 7, 10, 15, K.amber); V(p, 6, 6, 14, K.amberL); p.set(6, 5, C.white); V(p, 10, 7, 15, C.glassB); H(p, 5, 10, 15, C.glassB);
    R(p, 6, 9, 9, 12, C.paper); H(p, 6, 9, 12, C.paperD);
  },
  molotov: (p) => {
    stamp(p, 4, 0, ["..x.x..", ".xyxxx.", ".xyyx..", "..xyx.."], { x: C.fire, y: C.fireL });
    R(p, 6, 4, 9, 7, C.paper); p.set(5, 6, C.paperD); V(p, 5, 7, 9, C.paperD);
    oval(p, 4, 6, 11, 10, C.bottle); R(p, 4, 9, 11, 15, "#3d7a4a"); R(p, 5, 10, 10, 14, C.orange); H(p, 5, 10, 10, C.yellow);
    V(p, 5, 8, 14, "#5f9a6a"); V(p, 11, 9, 15, "#2a5a34"); H(p, 4, 11, 15, "#2a5a34");
  },
  noisemaker: (p) => {
    stamp(p, 0, 4, ["...gg...", "..gggg..", ".gggggg.", ".gggggg.", "gggggggg", "gggggggg", "gggggggg", "dddddddd"], { g: C.gold, d: C.goldD });
    V(p, 2, 6, 10, C.goldL);
    disc(p, 11, 9, 4, C.white); ring(p, 11, 9, 4, C.whiteD); disc(p, 11, 9, 1, C.red); line(p, 11, 9, 11, 6, C.red); p.set(11, 4, C.red);
    R(p, 6, 8, 8, 10, C.silverD); H(p, 6, 8, 8, C.silver);
    R(p, 3, 12, 4, 13, C.goldD); p.set(3, 14, C.brownD);
  },
  firecracker: (p) => {
    stamp(p, 6, 0, ["y.y", ".o.", "y.y"], { y: C.fireL, o: C.fire });
    V(p, 7, 2, 15, C.brownD);
    for (let i = 0; i < 6; i++) {
      const y = 3 + i * 2, l = i % 2 === 0;
      const x0 = l ? 2 : 8, x1 = l ? 6 : 12;
      H(p, x0, x1, y, C.red); H(p, x0, x1, y + 1, C.redD); p.set(l ? x0 : x1, y, C.gold); p.set(l ? x0 : x1, y + 1, C.goldD);
    }
  },
  pipebomb: (p) => {
    R(p, 3, 7, 12, 12, K.steel); H(p, 3, 12, 7, K.metal); H(p, 3, 12, 12, C.pipe);
    box(p, 1, 6, 3, 13, K.gun, "#454a52", K.dark); box(p, 12, 6, 14, 13, K.gun, "#454a52", K.dark);
    R(p, 5, 9, 10, 10, C.silverD);
    line(p, 7, 6, 7, 4, C.rope); line(p, 7, 4, 10, 2, C.rope); p.set(11, 1, C.fireL); p.set(12, 0, C.fire); p.set(12, 2, C.fire); p.set(10, 0, C.fire);
  },
  flare: (p) => {
    stamp(p, 3, 0, ["..p.p..", ".pwwp.p", "..pwp..", ".p.r.p."], { p: C.pink, w: C.white, r: C.red });
    R(p, 5, 4, 10, 4, C.silverD);
    box(p, 5, 5, 10, 15, C.red, C.redL, C.redD); R(p, 5, 9, 10, 11, C.paperL); H(p, 6, 9, 10, C.ink);
  },
  smokegren: (p) => {
    stamp(p, 0, 0, [".ss.ss", "sssssss", ".ssss."], { s: C.smoke }); p.set(2, 0, C.white);
    R(p, 5, 3, 9, 4, K.metal);
    box(p, 4, 5, 10, 15, K.od, K.odL, K.odD); R(p, 4, 6, 10, 7, C.purple); R(p, 5, 10, 9, 12, K.odD); H(p, 5, 9, 11, C.white);
    V(p, 11, 4, 11, C.silver); ring(p, 13, 3, 2, C.silver);
  },
  flashbang: (p) => {
    R(p, 5, 2, 9, 3, K.metal);
    box(p, 4, 4, 10, 15, K.gun, "#454a52", K.dark);
    for (const y of [6, 9, 12]) { R(p, 5, y, 6, y + 1, C.silver); R(p, 8, y, 9, y + 1, C.silver); }
    V(p, 11, 3, 11, C.silver); ring(p, 13, 2, 2, C.silver);
  },
  frag: (p) => {
    disc(p, 7, 10, 5, K.od); disc(p, 6, 9, 3, K.odL); disc(p, 7, 10, 3, K.od); p.set(4, 7, K.odL); p.set(5, 6, K.odL);
    for (let x = 4; x <= 11; x++) p.set(x, 14, K.odD); V(p, 12, 9, 12, K.odD);
    R(p, 6, 3, 8, 5, K.metal); H(p, 6, 8, 3, C.silver);
    stamp(p, 9, 3, ["xx..", "..x.", "..x.", "..x.", "..x."], { x: C.silver });
    ring(p, 4, 2, 2, C.silver);
  },
  alarmclock: (p) => {
    disc(p, 3, 3, 2, C.gold); disc(p, 12, 3, 2, C.gold); p.set(2, 2, C.goldL); p.set(11, 2, C.goldL); V(p, 7, 0, 3, C.goldD); H(p, 6, 9, 0, C.gold);
    disc(p, 8, 9, 5, C.gold); disc(p, 8, 9, 4, C.white); p.set(5, 5, C.goldL); p.set(4, 7, C.goldL);
    V(p, 8, 6, 9, C.ink); H(p, 8, 10, 9, C.ink); p.set(8, 5, C.ink); p.set(12, 9, C.ink); p.set(4, 9, C.ink); p.set(8, 13, C.ink);
    p.set(4, 14, C.goldD); p.set(4, 15, C.goldD); p.set(12, 14, C.goldD); p.set(12, 15, C.goldD);
  },
  handwarmer: (p) => {
    box(p, 0, 2, 7, 13, C.white, C.paperL, C.whiteD); R(p, 1, 4, 6, 8, C.orange); H(p, 2, 5, 6, C.yellow); dots(p, 1, 6, 2, C.whiteD); dots(p, 1, 6, 13, C.whiteD);
    box(p, 8, 4, 15, 15, C.white, C.paperL, C.whiteD); R(p, 9, 6, 14, 10, C.orange); H(p, 10, 13, 8, C.yellow); dots(p, 9, 14, 4, C.whiteD); dots(p, 9, 14, 15, C.whiteD);
    stamp(p, 2, 10, ["x.x", ".x."], { x: C.red });
  },
  heatpack: (p) => {
    box(p, 1, 2, 14, 14, C.white, C.paperL, C.whiteD);
    R(p, 1, 2, 14, 4, C.blue); H(p, 1, 14, 2, C.blueL); dots(p, 2, 13, 4, C.blueD);
    stamp(p, 5, 6, ["..x...", ".xx.x.", ".xyxx.", "xxyyxx", "xyyyyx", ".xyyx."], { x: C.red, y: C.orange });
    dots(p, 1, 14, 14, C.whiteD);
  },

  // ---- camp gear
  gamecall: (p) => {
    stamp(p, 2, 1, ["..rrrr..", ".r....r.", "r......r"], { r: C.rope });
    R(p, 0, 7, 2, 9, C.black); R(p, 3, 6, 8, 10, C.brown); H(p, 3, 8, 6, C.brownL); H(p, 3, 8, 10, C.brownD); p.set(2, 4, C.rope); p.set(9, 4, C.rope);
    for (let x = 9; x <= 11; x++) R(p, x, 7, x, 9, x % 2 ? K.gun : C.blackL);
    stamp(p, 12, 3, ["...x", "..xx", ".xxx", "xxxx", "xxxx", "xxxx", ".xxx", "..xx", "...x"], { x: C.blackL }); V(p, 15, 4, 10, K.gun);
  },
  camonet: (p) => {
    for (let y = 1; y <= 14; y++) for (let x = 0; x <= 15; x++) if ((x + y) % 2 === 0) p.set(x, y, K.od);
    stamp(p, 1, 2, ["ll...bb..ll", ".lll.bbb.lll", "..l...b...l.", "", "bb..ll..kk..", ".bb.lll.kkk.", "..b..l...k..", "", ".kk...bb..ll", "kkk..bbb.lll", ".k....b...l."], { l: C.leaf, b: C.brownL, k: C.khaki });
    H(p, 0, 15, 0, C.rope); p.set(0, 1, C.ropeD); p.set(15, 1, C.ropeD);
  },
  ghillie: (p) => {
    oval(p, 4, 0, 11, 5, K.burlap);
    R(p, 2, 4, 13, 10, K.burlap);
    for (let x = 1; x <= 14; x++) { const len = 11 + ((x * 7) % 5); V(p, x, 5, len, x % 3 === 0 ? K.burlapD : x % 3 === 1 ? C.khaki : C.cardD); }
    H(p, 5, 10, 1, C.khaki); p.set(6, 3, K.burlapD); p.set(9, 3, K.burlapD);
  },
  woodghillie: (p) => {
    oval(p, 5, 0, 10, 5, C.leaf);
    R(p, 3, 5, 12, 10, C.leaf); R(p, 1, 6, 2, 11, C.leafD); R(p, 13, 6, 14, 11, C.leafD);
    R(p, 4, 11, 7, 15, C.greenD); R(p, 8, 11, 11, 15, C.greenD);
    for (const [x, y] of [[6, 1], [4, 6], [10, 7], [7, 9], [5, 13], [10, 12], [2, 8], [13, 9], [9, 3]]) p.set(x, y, C.greenL);
    for (const [x, y] of [[8, 2], [6, 7], [11, 9], [4, 9], [9, 14], [6, 11], [12, 6]]) p.set(x, y, C.brownL);
    R(p, 6, 3, 9, 4, K.dark);
  },
  scentmask: (p) => {
    R(p, 4, 1, 11, 3, K.gun); H(p, 4, 11, 1, "#454a52");
    box(p, 3, 4, 12, 15, "#b8c4c0", C.white, "#8a9692");
    R(p, 4, 6, 11, 14, C.meat); R(p, 4, 6, 11, 7, "#6a5a3a"); R(p, 6, 9, 9, 12, C.brownD); p.set(5, 10, C.redD); p.set(10, 12, C.redD); V(p, 4, 6, 13, "#d0dcd8");
  },
  ragboots: (p) => {
    R(p, 3, 1, 8, 10, C.cloth); R(p, 3, 10, 14, 13, C.cloth); oval(p, 10, 9, 15, 13, C.cloth);
    for (let y = 2; y <= 12; y += 3) H(p, 3, 8, y, K.plaid);
    line(p, 9, 10, 13, 13, K.plaid); V(p, 3, 1, 12, shade(C.cloth, 0.2));
    H(p, 2, 15, 14, C.black); H(p, 3, 14, 15, C.blackL);
    p.set(5, 5, C.rope); p.set(6, 5, C.rope); p.set(5, 8, C.rope); p.set(6, 8, C.rope);
  },
  cookpot: (p) => {
    stamp(p, 2, 0, ["...xxxxxx...", ".xx......xx.", "x..........x", "x..........x"], { x: C.silverD });
    R(p, 1, 4, 14, 5, C.silver); H(p, 1, 14, 4, C.white);
    box(p, 2, 6, 13, 12, K.gun, "#454a52", K.dark); p.set(9, 9, K.dark); p.set(10, 8, K.dark);
    H(p, 0, 15, 13, K.metal); dots(p, 1, 14, 14, K.steel); V(p, 1, 13, 15, K.steel); V(p, 14, 13, 15, K.steel);
  },
  stove: (p) => {
    stamp(p, 5, 0, ["..y..", ".yxy.", "yxxxy"], { y: C.fireL, x: C.fire });
    H(p, 2, 13, 3, C.silver); p.set(2, 2, C.silver); p.set(13, 2, C.silver);
    box(p, 3, 4, 12, 14, C.silver, C.white, C.silverD);
    for (const x of [5, 8, 11]) { p.set(x, 6, K.dark); p.set(x - 1, 7, K.dark); p.set(x, 7, K.dark); }
    R(p, 5, 10, 10, 13, K.dark); R(p, 6, 11, 9, 12, C.fire);
    line(p, 0, 15, 6, 12, C.brown); line(p, 2, 15, 8, 12, C.brownL);
  },

  // ---- defences
  barbedwire: (p) => {
    ring(p, 7, 8, 6, K.steel); ring(p, 7, 8, 4, K.metal); disc(p, 7, 8, 2, C.brown); p.set(6, 7, C.brownL);
    for (const [x, y] of [[7, 0], [14, 8], [7, 15], [0, 8], [2, 2], [12, 2], [2, 13], [12, 13]]) p.set(x, y, C.silver);
    for (const [x, y] of [[3, 8], [11, 8], [7, 4], [7, 12]]) p.set(x, y, C.white);
  },
  beartrap: (p) => {
    R(p, 0, 7, 15, 9, K.gun); H(p, 0, 15, 7, "#454a52"); R(p, 0, 6, 1, 10, K.steel); R(p, 14, 6, 15, 10, K.steel);
    ring(p, 8, 8, 6, C.rust); ring(p, 8, 8, 5, K.gun);
    for (let a = 0; a < 14; a++) { const t = (a / 14) * Math.PI * 2; p.set(Math.round(8 + Math.cos(t) * 4), Math.round(8 + Math.sin(t) * 4), C.silver); }
    for (let y = 5; y <= 11; y++) for (let x = 5; x <= 11; x++) if ((x - 8) ** 2 + (y - 8) ** 2 <= 6) p.clear(x, y);
    disc(p, 8, 8, 1, K.metal); p.set(7, 7, C.silver);
    line(p, 8, 14, 10, 15, C.silverD); p.set(12, 15, C.silverD); p.set(13, 14, C.silverD);
  },
  tripwire: (p) => {
    V(p, 0, 1, 15, C.brown); V(p, 15, 1, 15, C.brown); H(p, 1, 14, 2, C.whiteD); p.set(0, 1, C.brownL); p.set(15, 1, C.brownL);
    for (const [x, y] of [[2, 6], [9, 8]]) {
      V(p, x + 2, 3, y - 1, C.whiteD);
      box(p, x, y, x + 4, y + 6, C.silver, C.white, C.silverD); H(p, x, x + 4, y + 2, C.red); H(p, x, x + 4, y + 3, C.red);
    }
  },
  sandbags: (p) => {
    const bag = (x0, y0, x1, y1) => { oval(p, x0, y0, x1, y1, C.khaki); H(p, x0 + 2, x1 - 2, y0, shade(C.khaki, 0.25)); H(p, x0 + 1, x1 - 1, y1, C.khakiD); p.set(x1 - 1, y1 - 1, C.khakiD); dots(p, x0 + 2, x1 - 2, y0 + 2, C.khakiD, 3); };
    bag(0, 9, 7, 15); bag(8, 9, 15, 15); bag(3, 3, 12, 9);
    p.set(3, 6, C.rope); p.set(12, 6, C.rope);
  },
};

export const SUPPLY_ART = {};
