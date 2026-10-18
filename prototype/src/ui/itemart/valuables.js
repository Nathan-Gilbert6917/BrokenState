// Valuables' icons (ui/itemart.js; the kit and the rules: ui/itemart/kit.js): the trade goods and comforts — liquor,
// smokes, treats, jewellery, gadgets, collectibles, household goods, toiletries and the luxuries (books, cards,
// music, photos). Each a 16 × 16 drawing, lit from the top left; toCanvas adds the outline.
import { C, R, H, V, dots, line, disc, ring, oval, box, text, stamp, shade } from "./kit.js";

// Local colours: glass, wood, plastics and the treats.
const K = {
  amber: "#b8742a", amberL: "#d89a4a", amberD: "#8a5218",
  wineG: "#2f5a34", wineGL: "#4a7f4a", wineGD: "#1f3d24",
  navy: "#2c3e66", navyL: "#41588a", navyD: "#1e2b49",
  clear: "#d6e8ee", clearL: "#f2f8fa", clearD: "#a9c3cc", vodka: "#b5d3e0",
  cedar: "#b5793f", cedarL: "#cf9558", cedarD: "#8a5a2c", cigar: "#6b3f22", cigarL: "#8a5530", cigarD: "#4f2d17",
  choc: "#6a3a1e", chocL: "#8a5530", chocD: "#4a2612", wrap: "#5a2a7a", wrapL: "#7a4a9a", wrapD: "#3e1c55",
  honey: "#e0a020", honeyL: "#f4c84a", honeyD: "#b07a12", coffee: "#a83a2a", coffeeL: "#c8574a", coffeeD: "#7a2a1e",
  gran: "#4a2a14", granL: "#6b4020", velvet: "#7a1f2e", velvetL: "#9a3444", velvetD: "#561520",
  pearl: "#efe6dc", pearlL: "#ffffff", pearlD: "#c9bcb2", gem: "#bfe9f2", gemL: "#ffffff", gemD: "#7fc4d6",
  screen: "#3a7fc8", screenL: "#7fb8e6", screenD: "#24548a", grey: "#b8bcc4", greyL: "#d4d7dc", greyD: "#8a8f99",
  pink: "#e08aa6", pinkL: "#f0b8c8", pinkD: "#b8607e", apple: "#7ab84a", appleL: "#9cd66a", appleD: "#55882f",
  wipe: "#9cc9e6", wipeL: "#c4e0f2", wipeD: "#6f9fc0", tartan: "#b8302a", album: "#2f5a3a", albumD: "#1f3d27",
};

// Recolour a shape's rim: its pixels of colour c with nothing above or to the left turn hi, with nothing below or to the
// right turn lo (a quick top-left light on any blob).
function rim(p, c, hi, lo) {
  const at = (x, y) => p.get(x, y);
  const todo = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (at(x, y) !== c) continue;
    if (hi && (!at(x, y - 1) || !at(x - 1, y))) todo.push([x, y, hi]);
    else if (lo && (!at(x, y + 1) || !at(x + 1, y))) todo.push([x, y, lo]);
  }
  for (const [x, y, k] of todo) p.set(x, y, k);
}
// Clear a box (a hole: toCanvas outlines it dark).
const hole = (p, x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) p.clear(x, y); };
// A lit cylinder seen from the front: body x0..x1, y0..y1, highlight column at x0 + 1, shade at x1.
function cyl(p, x0, y0, x1, y1, c, hi, lo) { R(p, x0, y0, x1, y1, c); V(p, x0 + 1, y0, y1, hi); V(p, x1, y0, y1, lo); V(p, x1 - 1, y0, y1, shade(c, -0.12)); }

export const GEAR_ART = {
  // ---------- liquor ----------
  // Bourbon: a wide square bottle in amber, red wax dripping off the cap, a cream label.
  whiskey: (p) => {
    R(p, 6, 2, 9, 4, K.amber); V(p, 7, 2, 4, K.amberL);
    R(p, 5, 0, 10, 1, C.red); H(p, 5, 9, 0, C.redL); p.set(5, 2, C.red); p.set(10, 2, C.redD); p.set(9, 2, C.redD);
    H(p, 4, 11, 5, K.amber); box(p, 3, 6, 12, 15, K.amber, K.amberL, K.amberD); V(p, 4, 7, 13, K.amberL);
    box(p, 5, 8, 10, 13, C.paper, C.paperL, C.paperD); H(p, 6, 9, 10, C.brownD); H(p, 6, 9, 11, C.redD);
  },
  // Single malt: the presentation tube, a gold lid and base, "18" in gold over a tartan band.
  scotch: (p) => {
    cyl(p, 3, 3, 12, 14, K.navy, K.navyL, K.navyD);
    R(p, 3, 1, 12, 2, C.gold); H(p, 4, 11, 1, C.goldL); V(p, 12, 1, 2, C.goldD);
    H(p, 3, 12, 15, C.goldD); H(p, 4, 11, 15, C.gold);
    text(p, 5, 4, "18", C.gold);
    R(p, 3, 10, 12, 13, K.tartan); for (let x = 3; x <= 12; x += 3) V(p, x, 10, 13, C.greenD); H(p, 3, 12, 11, C.greenD); H(p, 3, 12, 13, C.yellowD);
  },
  // Red wine: a slim dark-green bottle, round shoulders, a long neck under red foil, a white label.
  wine: (p) => {
    R(p, 7, 0, 8, 4, C.red); p.set(7, 0, C.redL); V(p, 8, 0, 4, C.redD);
    R(p, 7, 5, 8, 6, K.wineG); H(p, 6, 9, 7, K.wineG); R(p, 5, 8, 10, 15, K.wineG);
    rim(p, K.wineG, K.wineGL, K.wineGD); V(p, 6, 9, 14, K.wineGL);
    box(p, 5, 10, 10, 13, C.white, null, C.whiteD); H(p, 7, 8, 11, C.redD); H(p, 6, 9, 12, C.ink);
  },
  // Cheap vodka: a clear plastic bottle half drunk, the red cap off beside it.
  vodka: (p) => {
    R(p, 5, 1, 7, 3, K.clear); p.set(6, 1, C.ink);
    H(p, 4, 8, 4, K.clear); R(p, 3, 5, 9, 15, K.clear);
    R(p, 3, 9, 9, 15, K.vodka); rim(p, K.clear, K.clearL, K.clearD); rim(p, K.vodka, K.clearL, K.clearD);
    box(p, 3, 9, 9, 12, C.red, C.redL, C.redD); text(p, 5, 9, "V", C.white); p.set(6, 9, C.red);
    R(p, 11, 13, 14, 15, C.red); H(p, 11, 13, 13, C.redL); V(p, 14, 13, 15, C.redD);
  },

  // ---------- smokes ----------
  // A carton: a long white box of three packs, the red roof print on each.
  cigarettes: (p) => {
    H(p, 2, 15, 3, C.whiteD); H(p, 1, 15, 4, C.paperL);
    box(p, 0, 5, 15, 13, C.white, C.paperL, C.whiteD);
    for (const a of [1, 6, 11]) { R(p, a, 6, a + 3, 7, C.red); p.set(a, 8, C.red); p.set(a + 3, 8, C.red); H(p, a + 1, a + 2, 6, C.redL); H(p, a + 1, a + 2, 11, C.ink); }
    V(p, 5, 5, 12, C.whiteD); V(p, 10, 5, 12, C.whiteD);
  },
  // An opened pack: the lid flipped back, a few cigarettes left, gaps where the rest were.
  smokes: (p) => {
    R(p, 4, 3, 11, 5, C.redD);
    R(p, 5, 1, 6, 7, C.white); R(p, 5, 1, 6, 2, C.orange); p.set(5, 1, "#efaa5a");
    R(p, 9, 2, 10, 7, C.white); R(p, 9, 2, 10, 3, C.orange); p.set(9, 2, "#efaa5a");
    box(p, 4, 6, 11, 15, C.white, C.paperL, C.whiteD); R(p, 4, 6, 11, 9, C.red); H(p, 4, 11, 6, C.redL); V(p, 11, 6, 9, C.redD);
    p.set(7, 9, C.white); p.set(8, 9, C.white); H(p, 6, 9, 12, C.gold); H(p, 6, 9, 13, C.ink);
  },
  // A cedar box of cigars, the lid propped open with its paper label, gold bands on the cigars.
  cigars: (p) => {
    box(p, 1, 0, 14, 4, K.cedarL, shade(K.cedarL, 0.2), K.cedar); box(p, 4, 1, 11, 3, C.paper, C.paperL, C.paperD); p.set(7, 2, C.red); p.set(8, 2, C.gold);
    R(p, 1, 5, 14, 11, K.cedarD);
    for (const y of [5, 7, 9]) { H(p, 2, 13, y, K.cigarL); H(p, 2, 13, y + 1, K.cigar); p.set(13, y + 1, K.cigarD); R(p, 9, y, 10, y + 1, C.gold); p.set(10, y + 1, C.red); }
    box(p, 1, 11, 14, 15, K.cedar, K.cedarL, K.cedarD); H(p, 3, 12, 13, K.cedarD);
  },
  // A pouch of rolling tobacco: a soft blue pouch, the shag spilling out, a packet of papers in front.
  tobacco: (p) => {
    for (let x = 2; x <= 11; x++) p.set(x, 3 + (x % 3 === 0 ? 0 : 1), x % 2 ? C.brownL : C.brown);
    R(p, 2, 4, 11, 4, C.brown); p.set(4, 2, C.brownL); p.set(9, 2, C.brown);
    R(p, 1, 5, 12, 14, C.denim); rim(p, C.denim, C.blueL, C.blueD);
    R(p, 2, 5, 11, 8, C.blueD); H(p, 2, 11, 5, C.blue); H(p, 4, 9, 9, C.blueD);
    p.set(6, 11, C.yellow); p.set(7, 11, C.yellow);
    box(p, 9, 10, 14, 15, C.white, C.paperL, C.whiteD); H(p, 9, 14, 12, C.orange); R(p, 10, 8, 13, 9, C.paperL);
  },

  // ---------- treats ----------
  // A tin of ground coffee: a red tin, a silver lid, a coffee bean on the front.
  coffee: (p) => {
    R(p, 4, 1, 11, 2, C.silver); H(p, 5, 10, 1, C.white); H(p, 3, 12, 3, C.silverD); H(p, 3, 12, 2, C.silver); p.set(3, 2, C.white);
    cyl(p, 3, 4, 12, 14, K.coffee, K.coffeeL, K.coffeeD); H(p, 3, 12, 15, C.silverD);
    oval(p, 5, 6, 10, 12, C.brownD); line(p, 9, 7, 6, 11, K.chocD); p.set(6, 7, C.brownL); p.set(6, 8, C.brownL);
    H(p, 3, 12, 13, C.gold);
  },
  // Instant coffee: a glass jar of dark granules, a brown lid, a cream label with a cup.
  instcoffee: (p) => {
    box(p, 4, 0, 11, 2, C.brown, C.brownL, C.brownD); H(p, 5, 10, 3, K.clearD);
    R(p, 3, 4, 12, 15, K.gran); rim(p, K.gran, K.granL, C.ink);
    dots(p, 4, 11, 5, K.granL, 3); dots(p, 5, 11, 14, K.granL, 3); p.set(4, 4, K.clearL); V(p, 4, 5, 14, K.granL);
    box(p, 3, 7, 12, 12, C.yellow, C.goldL, C.yellowD);
    R(p, 5, 9, 8, 11, C.brownD); H(p, 5, 8, 9, C.brown); p.set(9, 10, C.brownD); H(p, 6, 7, 8, C.white);
    H(p, 10, 11, 9, C.red); H(p, 10, 11, 11, C.red);
  },

  // A box of tea: a green box, a cup and saucer on the front, a sachet's tag on its string out the top.
  tea: (p) => {
    H(p, 3, 14, 4, C.greenL); H(p, 2, 13, 5, C.greenL);
    box(p, 2, 6, 13, 15, C.green, C.greenL, C.greenD); R(p, 14, 4, 14, 14, C.greenD);
    R(p, 5, 9, 9, 11, C.white); V(p, 5, 9, 11, C.paperL); V(p, 9, 9, 11, C.whiteD); p.set(10, 10, C.white); H(p, 4, 10, 12, C.whiteD); H(p, 6, 8, 9, C.brown);
    line(p, 9, 4, 11, 2, C.paperD); box(p, 11, 0, 14, 2, C.yellow, null, C.yellowD);
  },
  // A bag of hard candy: a clear bag tied at the top, full of coloured sweets.
  candy: (p) => {
    R(p, 6, 0, 9, 2, K.clear); p.set(5, 0, K.clear); p.set(10, 0, K.clear); H(p, 6, 9, 3, C.red);
    H(p, 5, 10, 4, K.clear); H(p, 4, 11, 5, K.clear); R(p, 3, 6, 12, 15, K.clear); rim(p, K.clear, K.clearL, K.clearD);
    const sweets = [[5, 6, C.red], [8, 6, C.yellow], [10, 8, C.green], [4, 9, C.blue], [7, 9, C.orange], [10, 11, C.red], [5, 12, C.yellow], [8, 12, C.purple], [3, 13, C.green]];
    for (const [x, y, c] of sweets) { R(p, x, y, x + 1, y + 1, c); p.set(x, y, shade(c, 0.4)); }
  },
  // A jar of honey: amber honey, a gingham cloth tied over the lid, a farm label with a bee.
  honey: (p) => {
    for (let x = 2; x <= 13; x++) for (let y = 1; y <= 4; y++) if (y > 1 || (x > 2 && x < 13)) p.set(x, y, (x >> 1) % 2 === (y >> 1) % 2 ? C.red : C.white);
    H(p, 4, 11, 5, C.rope); p.set(12, 6, C.rope);
    R(p, 3, 6, 12, 15, K.honey); rim(p, K.honey, K.honeyL, K.honeyD); V(p, 4, 7, 13, K.honeyL);
    box(p, 5, 8, 10, 12, C.paper, C.paperL, C.paperD); H(p, 7, 8, 10, C.yellow); p.set(7, 9, C.ink); p.set(8, 10, C.ink); p.set(7, 11, C.ink); p.set(6, 9, C.white);
  },
  // A slab of milk chocolate half out of its purple wrapper and foil.
  chocolate: (p) => {
    R(p, 1, 1, 14, 7, K.choc);
    for (const x of [5, 10]) V(p, x, 1, 7, K.chocD);
    H(p, 1, 14, 4, K.chocD);
    for (const x of [1, 6, 11]) for (const y of [1, 5]) { H(p, x, x + 2, y, K.chocL); p.set(x, y + 1, K.chocL); }
    for (let x = 1; x <= 14; x++) p.set(x, 8 - (x % 2), C.silver);
    for (let x = 1; x <= 14; x++) p.set(x, 8, C.silverD);
    box(p, 1, 9, 14, 14, K.wrap, K.wrapL, K.wrapD); H(p, 3, 12, 11, C.gold); H(p, 4, 11, 12, C.goldD);
  },

  // ---------- jewellery ----------
  // A plain gold band, seen at a slant.
  goldring: (p) => {
    oval(p, 2, 3, 13, 13, C.gold); oval(p, 5, 6, 10, 10, "#000001");
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (p.get(x, y) === "#000001") p.clear(x, y);
    rim(p, C.gold, C.goldL, C.goldD);
    for (let y = 3; y <= 13; y++) for (let x = 2; x <= 13; x++) if (p.get(x, y) === C.gold && x + y < 12) p.set(x, y, C.goldL);
    for (let y = 3; y <= 13; y++) for (let x = 2; x <= 13; x++) if (p.get(x, y) === C.gold && x + y > 19) p.set(x, y, C.goldD);
  },
  // A diamond engagement ring: a thin gold band and a big faceted stone in claws.
  diamond: (p) => {
    ring(p, 8, 10, 5, C.gold); rim(p, C.gold, C.goldL, C.goldD);
    stamp(p, 4, 0, [
      ".aaaaaa.",
      "abbcbbcd",
      "abbbcccd",
      ".dbbcdd.",
      "..dcdd..",
      "...dd...",
    ], { a: K.gemL, b: K.gem, c: C.white, d: K.gemD });
    p.set(5, 6, C.goldL); p.set(10, 6, C.goldD); p.set(6, 5, C.gold); p.set(9, 5, C.gold);
  },
  // A thick gold chain draped in a loop, a clasp at the top.
  goldchain: (p) => {
    for (let x = 1; x <= 14; x++) {
      const u = (x - 7.5) / 7, y = Math.round(2 + 10 * Math.sqrt(1 - u * u));
      const a = x % 2 ? C.goldL : C.gold, b = x % 2 ? C.gold : C.goldD;
      R(p, x, y, x, y + 1, a); p.set(x, y + 2, b); if (x % 2) p.set(x, y + 1, C.goldD);
    }
    for (const x of [1, 14]) R(p, x, 0, x, 2, C.gold);
    R(p, 0, 0, 2, 1, C.goldL); p.set(2, 1, C.goldD); R(p, 13, 0, 15, 1, C.gold); p.set(15, 1, C.goldD);
    R(p, 7, 14, 8, 15, C.goldL); p.set(8, 15, C.goldD);
  },

  // A string of pearls in a loop, a gold clasp.
  pearls: (p) => {
    for (let i = 0; i < 12; i++) {
      const t = (i / 12) * Math.PI * 2, x = Math.round(7 + 6 * Math.sin(t)), y = Math.round(7 + 6 * Math.cos(t));
      if (i === 6) continue;
      R(p, x, y, x + 1, y + 1, K.pearl); p.set(x, y, K.pearlL); p.set(x + 1, y + 1, K.pearlD);
    }
    R(p, 7, 0, 8, 2, C.gold); p.set(7, 0, C.goldL); p.set(8, 2, C.goldD);
  },
  // A Swiss wristwatch: a steel case, a white dial with hands, a leather strap.
  watch: (p) => {
    box(p, 5, 0, 10, 3, C.brown, C.brownL, C.brownD); box(p, 5, 13, 10, 15, C.brown, C.brownL, C.brownD); H(p, 6, 9, 14, C.brownD);
    disc(p, 8, 8, 5, C.silver); rim(p, C.silver, C.white, C.silverD); p.set(14, 8, C.silverD); p.set(14, 7, C.silver);
    disc(p, 8, 8, 3, C.white); p.set(8, 5, C.gold); p.set(11, 8, C.gold); p.set(8, 11, C.gold); p.set(5, 8, C.gold);
    V(p, 8, 6, 8, C.ink); H(p, 8, 10, 8, C.ink); p.set(9, 10, C.red);
  },
  // Silver cutlery in its velvet case: a fork, a knife and a spoon.
  silverware: (p) => {
    box(p, 0, 1, 15, 15, K.velvetL, shade(K.velvetL, 0.2), K.velvetD); R(p, 1, 2, 14, 14, K.velvet);
    // fork
    for (const x of [2, 4, 6]) V(p, x, 3, 5, C.silver); R(p, 2, 6, 6, 7, C.silver); H(p, 2, 6, 6, C.white); R(p, 4, 8, 4, 13, C.silver); p.set(3, 8, C.silverD); V(p, 5, 8, 13, C.silverD);
    // knife
    R(p, 8, 3, 9, 9, C.silver); V(p, 8, 3, 9, C.white); p.set(9, 3, C.velvet); R(p, 8, 10, 9, 13, C.silverD); V(p, 8, 10, 13, C.silver);
    // spoon
    oval(p, 11, 3, 13, 7, C.silver); p.set(11, 4, C.white); p.set(12, 3, C.white); p.set(13, 7, C.silverD); V(p, 12, 8, 13, C.silver); V(p, 13, 9, 13, C.silverD);
  },

  // ---------- gadgets ----------
  // A smartphone: a tall black slab, a blue screen with a glare.
  phone: (p) => {
    R(p, 4, 0, 11, 15, C.black); p.clear(4, 0); p.clear(11, 0); p.clear(4, 15); p.clear(11, 15);
    V(p, 4, 1, 14, C.blackL); H(p, 5, 10, 0, C.blackL);
    R(p, 5, 2, 10, 12, K.screen); V(p, 10, 2, 12, K.screenD); H(p, 5, 10, 12, K.screenD);
    line(p, 6, 6, 9, 3, K.screenL); line(p, 6, 8, 9, 5, K.screenL); H(p, 7, 8, 1, C.ink); H(p, 7, 8, 14, C.blackL);
  },
  // A handheld game console: a grey body held sideways, a screen, a d-pad and red buttons.
  console: (p) => {
    R(p, 0, 4, 15, 12, K.grey); p.clear(0, 4); p.clear(15, 4); p.clear(0, 12); p.clear(15, 12); rim(p, K.grey, K.greyL, K.greyD);
    box(p, 4, 5, 11, 10, C.ink, null, null); R(p, 5, 6, 10, 9, "#7fa04a"); H(p, 5, 10, 6, "#a8c86a"); p.set(7, 8, "#3f5a24"); p.set(8, 8, "#3f5a24");
    H(p, 1, 3, 8, C.ink); V(p, 2, 7, 9, C.ink);
    p.set(13, 7, C.red); p.set(12, 9, C.red); p.set(14, 9, C.redD); H(p, 6, 9, 11, K.greyD);
  },
  // A digital camera: a black body, a big lens, a red shutter button.
  camera: (p) => {
    R(p, 3, 2, 7, 3, C.black); H(p, 3, 7, 2, C.blackL); R(p, 11, 2, 12, 3, C.red); p.set(11, 2, C.redL);
    box(p, 1, 4, 14, 13, C.black, C.blackL, C.rubber); R(p, 2, 5, 3, 12, C.blackL);
    disc(p, 8, 9, 4, C.silver); rim(p, C.silver, C.white, C.silverD); disc(p, 8, 9, 2, "#1a2840"); p.set(7, 8, K.screenL); p.set(8, 8, K.screen);
    R(p, 12, 5, 13, 6, C.white);
  },
  // A laptop, open: a dark frame round a blue screen, a silver keyboard deck.
  laptop: (p) => {
    R(p, 2, 1, 13, 9, C.blackL); H(p, 2, 13, 1, "#4a4e56");
    R(p, 3, 2, 12, 8, K.screen); V(p, 12, 2, 8, K.screenD); line(p, 4, 6, 7, 3, K.screenL); line(p, 5, 7, 8, 4, K.screenL);
    H(p, 2, 13, 10, C.silver); H(p, 1, 14, 11, C.silver); H(p, 1, 14, 12, C.silver); H(p, 0, 15, 13, C.silver); H(p, 0, 15, 14, C.silverD);
    dots(p, 2, 13, 11, C.silverD); dots(p, 3, 12, 12, C.silverD); H(p, 6, 9, 13, C.whiteD); H(p, 2, 13, 10, C.white);
  },

  // ---------- collectibles ----------
  // A paper roll of silver bullion rounds, a couple loose in front.
  coins: (p) => {
    R(p, 1, 2, 11, 9, C.card); H(p, 1, 11, 3, shade(C.card, 0.25)); H(p, 1, 11, 9, C.cardD); H(p, 1, 11, 8, C.cardD); dots(p, 2, 10, 6, C.cardD, 4);
    oval(p, 10, 2, 14, 9, C.silver); oval(p, 11, 3, 13, 8, C.silverD); p.set(11, 4, C.white);
    for (const [cx, cy] of [[4, 12], [10, 13]]) { disc(p, cx, cy, 2, C.silver); p.set(cx - 1, cy - 1, C.white); p.set(cx + 1, cy + 1, C.silverD); p.set(cx + 2, cy, C.silverD); p.set(cx, cy, C.silverD); }
  },
  // A binder of trading cards: a blue spine with rings, a sleeved page of nine cards.
  tcards: (p) => {
    R(p, 0, 0, 2, 15, C.blue); V(p, 0, 0, 15, C.blueL); V(p, 2, 0, 15, C.blueD);
    box(p, 3, 0, 15, 15, K.clearL, null, K.clearD);
    for (const y of [3, 8, 13]) H(p, 1, 3, y, C.silver);
    const cols = [C.red, C.blue, C.green, C.yellow, C.purple, C.orange, C.cyan, C.red, C.green];
    for (let i = 0; i < 9; i++) {
      const x = 4 + (i % 3) * 4, y = 1 + Math.floor(i / 3) * 5, c = cols[i];
      R(p, x, y, x + 2, y + 3, c); p.set(x, y, shade(c, 0.4)); p.set(x + 1, y + 1, C.white); H(p, x, x + 2, y + 3, shade(c, -0.35));
    }
  },
  // Vinyl records: an LP sliding out of its sleeve, grooves and a red label.
  vinyl: (p) => {
    box(p, 0, 0, 9, 11, C.orange, shade(C.orange, 0.3), C.orangeD); disc(p, 4, 5, 2, C.yellow); p.set(3, 4, C.white); H(p, 1, 8, 9, C.orangeD);
    disc(p, 10, 9, 5, C.black); ring(p, 10, 9, 4, C.blackL); ring(p, 10, 9, 3, C.black);
    disc(p, 10, 9, 1, C.red); p.set(10, 9, C.ink); p.set(9, 8, C.redL);
    line(p, 7, 5, 6, 7, "#5a5e66");
  },
  // A stamp album, a big perforated stamp on its cover.
  stamps: (p) => {
    box(p, 0, 0, 12, 13, K.album, shade(K.album, 0.25), K.albumD); R(p, 1, 1, 11, 1, C.gold); V(p, 1, 1, 12, C.gold);
    R(p, 4, 4, 15, 15, C.white);
    for (let x = 4; x <= 15; x += 2) { p.clear(x, 4); p.clear(x, 15); }
    for (let y = 4; y <= 15; y += 2) { p.clear(4, y); p.clear(15, y); }
    R(p, 6, 6, 13, 13, C.water); R(p, 6, 11, 13, 13, C.green); disc(p, 11, 8, 1, C.yellow); H(p, 6, 13, 10, C.greenL);
    text(p, 6, 6, "5", C.red);
  },

  // ---------- household ----------
  // AA batteries in a blister pack: an orange card with its hang hole, four cells under the bubble.
  batteries: (p) => {
    box(p, 1, 0, 14, 15, C.orange, shade(C.orange, 0.3), C.orangeD); hole(p, 7, 1, 8, 1);
    R(p, 2, 3, 13, 14, K.clear); H(p, 2, 13, 3, K.clearL); H(p, 2, 13, 14, K.clearD);
    for (const x of [3, 6, 9, 12]) {
      p.set(x, 4, C.silver);
      R(p, x - 1 + 1, 5, x, 13, C.black);
      R(p, x - 1 + 1, 5, x, 7, C.copper); p.set(x, 5, C.gold);
      if (x < 12) R(p, x + 1, 5, x + 1, 13, C.rubber);
    }
  },
  // Five disposable lighters on a card, each a different colour.
  lighters: (p) => {
    box(p, 0, 6, 15, 15, C.white, C.paperL, C.whiteD); H(p, 2, 13, 14, C.blue);
    const cols = [C.red, C.yellow, C.green, C.blue, C.purple];
    cols.forEach((c, i) => {
      const x = 1 + i * 3;
      R(p, x, 1, x + 1, 3, C.silver); p.set(x, 1, C.white); p.set(x + 1, 0, C.ink);
      R(p, x, 4, x + 1, 12, c); V(p, x, 4, 12, shade(c, 0.3));
    });
  },
  // A sealed four-pack of toilet paper: two rolls on two, the cores showing on top.
  toiletpaper: (p) => {
    // two stacks of two white rolls, the cardboard cores showing on top
    for (const x0 of [1, 8]) {
      R(p, x0, 2, x0 + 6, 15, C.white); V(p, x0, 2, 15, C.paperL); V(p, x0 + 6, 2, 15, C.whiteD); V(p, x0 + 5, 3, 15, "#dde0e4");
      H(p, x0, x0 + 6, 9, C.whiteD); H(p, x0 + 1, x0 + 5, 10, C.paperL);
      dots(p, x0 + 1, x0 + 5, 5, K.wipeL, 2); dots(p, x0 + 2, x0 + 5, 7, K.wipeL, 2); dots(p, x0 + 1, x0 + 5, 12, K.wipeL, 2); dots(p, x0 + 2, x0 + 5, 14, K.wipeL, 2);
      oval(p, x0, 0, x0 + 6, 3, C.paperL); R(p, x0 + 2, 1, x0 + 4, 2, C.card); p.clear(x0 + 3, 1); p.set(x0 + 4, 2, C.cardD);
    }
  },


  // A church candle, lit and dripping, and two tea lights.
  candles: (p) => {
    p.set(5, 0, C.fireL); R(p, 4, 1, 6, 2, C.fire); p.set(5, 1, C.fireL); p.set(5, 3, C.ink);
    box(p, 2, 4, 8, 15, C.paperL, C.white, C.paperD); V(p, 3, 4, 6, C.white); p.set(7, 5, C.paperD); p.set(7, 6, C.paperD);
    for (const x of [10, 13]) { p.set(x + 1, 8, C.fireL); p.set(x + 1, 9, C.fire); R(p, x, 10, x + 2, 10, C.paperL); R(p, x, 11, x + 2, 13, C.silver); V(p, x, 11, 13, C.white); V(p, x + 2, 11, 13, C.silverD); }
    p.set(12, 11, C.silverD); p.set(12, 10, C.paperL);
  },

  // ---------- toiletries ----------
  // Soap: a big pink bar, a wrapped hotel bar on top, a few bubbles.
  soap: (p) => {
    R(p, 1, 9, 13, 10, K.pinkL); box(p, 1, 11, 13, 14, K.pink, null, K.pinkD); V(p, 1, 9, 14, K.pinkL);
    box(p, 4, 5, 11, 8, C.white, C.paperL, C.whiteD); H(p, 4, 11, 6, C.blue); p.set(7, 7, C.gold);
    disc(p, 13, 3, 1, K.wipeL); p.set(12, 2, C.white); disc(p, 2, 5, 1, K.wipeL); p.set(1, 4, C.white); p.set(9, 1, K.wipeL); p.set(14, 7, K.wipeL);
  },
  // Razor blades: a double-edged blade, its slot cut through, rising out of its blue dispenser.
  razors: (p) => {
    box(p, 1, 1, 14, 9, C.silver, C.white, C.silverD);
    hole(p, 4, 5, 11, 5); hole(p, 7, 4, 8, 6); hole(p, 3, 4, 3, 6); hole(p, 12, 4, 12, 6);
    box(p, 2, 10, 13, 15, C.blue, C.blueL, C.blueD); H(p, 4, 11, 12, C.blueD); p.set(7, 14, C.white);
  },
  // A stick of deodorant: a blue stick, a white cap cracked down one side.
  deodorant: (p) => {
    R(p, 4, 1, 11, 6, C.white); p.clear(4, 1); p.clear(11, 1); rim(p, C.white, C.paperL, C.whiteD);
    line(p, 9, 1, 8, 4, C.silverD); p.set(9, 5, C.silverD);
    R(p, 4, 7, 11, 15, C.blue); p.clear(4, 15); p.clear(11, 15); rim(p, C.blue, C.blueL, C.blueD);
    H(p, 4, 11, 7, C.blueD); line(p, 5, 12, 10, 9, C.white); line(p, 5, 13, 10, 10, C.cyan);
  },
  // A toothbrush over a squeezed-flat tube of toothpaste.
  toothpaste: (p) => {
    H(p, 0, 9, 5, C.blueL); H(p, 0, 10, 6, C.blue); H(p, 1, 10, 7, C.blueD); R(p, 10, 4, 14, 6, C.blue); H(p, 10, 14, 7, C.blueD);
    R(p, 10, 1, 14, 3, C.white); dots(p, 10, 14, 1, C.water); V(p, 14, 1, 3, C.whiteD);
    R(p, 0, 10, 1, 14, C.whiteD); R(p, 2, 11, 11, 14, C.white); H(p, 2, 11, 11, C.paperL); H(p, 2, 11, 14, C.whiteD);
    H(p, 4, 9, 12, C.red); H(p, 4, 9, 13, C.blue); R(p, 12, 11, 12, 14, C.whiteD); R(p, 13, 12, 15, 13, C.red); p.set(13, 12, C.redL);
  },
  // Shampoo: a fat apple-green bottle, a white flip cap, an apple on the label.
  shampoo: (p) => {
    R(p, 6, 0, 9, 3, C.white); H(p, 6, 9, 0, C.paperL); V(p, 9, 0, 3, C.whiteD); p.set(10, 1, C.white);
    H(p, 4, 11, 4, K.apple); R(p, 3, 5, 12, 15, K.apple); p.clear(3, 15); p.clear(12, 15); rim(p, K.apple, K.appleL, K.appleD); V(p, 4, 6, 13, K.appleL);
    disc(p, 8, 10, 2, C.red); p.set(7, 9, C.redL); p.set(9, 11, C.redD); p.set(8, 7, C.brownD); p.set(9, 7, C.leaf);
  },
  // Wet wipes: a soft pale-blue pack, its resealable flap open, a wipe pulled up.
  wetwipes: (p) => {
    R(p, 0, 5, 15, 14, K.wipe); p.clear(0, 5); p.clear(15, 5); p.clear(0, 14); p.clear(15, 14); rim(p, K.wipe, K.wipeL, K.wipeD);
    oval(p, 4, 6, 11, 10, C.white); oval(p, 5, 7, 10, 9, C.paperL);
    stamp(p, 5, 1, ["..aa..", ".abba.", "abbbba", ".abbb.", "..bb.."], { a: C.white, b: C.paperL });
    H(p, 3, 12, 12, C.blue); H(p, 5, 10, 13, K.wipeD);
  },
  // Cherry lip balm: a small stick, a red cap, a cherry on the white tube.
  lipbalm: (p) => {
    R(p, 5, 1, 10, 6, C.red); p.clear(5, 1); p.clear(10, 1); rim(p, C.red, C.redL, C.redD); V(p, 6, 2, 5, C.redL);
    H(p, 5, 10, 7, C.whiteD);
    R(p, 5, 8, 10, 15, C.white); rim(p, C.white, C.paperL, C.whiteD);
    R(p, 6, 12, 7, 13, C.red); R(p, 8, 12, 9, 13, C.redD); p.set(6, 12, C.redL); line(p, 7, 11, 8, 9, C.leafD); p.set(9, 9, C.leaf);
  },
  // A makeup bag: a pink zipped pouch, a lipstick and a mascara wand poking out.
  makeup: (p) => {
    R(p, 3, 0, 4, 2, C.red); p.set(3, 0, C.redL); R(p, 3, 3, 4, 5, C.gold); V(p, 4, 3, 5, C.goldD);
    R(p, 10, 0, 10, 2, C.ink); R(p, 9, 3, 11, 5, C.black); p.set(9, 3, C.blackL);
    R(p, 1, 6, 14, 15, K.pink); p.clear(1, 15); p.clear(14, 15); rim(p, K.pink, K.pinkL, K.pinkD);
    dots(p, 1, 14, 6, C.gold); p.set(13, 7, C.silver); p.set(13, 8, C.silver);
    disc(p, 6, 11, 2, C.goldL); disc(p, 6, 11, 1, C.gold); p.set(5, 10, C.white);
  },
  // Perfume: a faceted pink bottle, a gold collar, a squeeze bulb with its tassel.
  perfume: (p) => {
    R(p, 6, 3, 9, 5, C.gold); H(p, 6, 9, 3, C.goldL); V(p, 9, 3, 5, C.goldD);
    line(p, 9, 3, 12, 2, C.gold); disc(p, 13, 2, 1, K.pink); p.set(13, 1, K.pinkL); p.set(14, 4, C.gold); p.set(14, 5, C.goldL);
    R(p, 3, 6, 12, 15, K.pinkL); p.clear(3, 6); p.clear(12, 6);
    R(p, 5, 8, 10, 13, K.pink); V(p, 4, 7, 14, C.white); H(p, 3, 12, 15, K.pinkD); V(p, 12, 7, 15, K.pinkD); line(p, 6, 9, 7, 8, K.pinkL);
  },

  // ---------- luxuries ----------
  // A stack of comics: a yellow cover with a red "POW", two more under it.
  comic: (p) => {
    H(p, 2, 15, 15, C.blue); H(p, 1, 14, 14, C.paperL); H(p, 1, 14, 13, C.green);
    box(p, 1, 0, 14, 12, C.yellow, C.goldL, C.yellowD); R(p, 1, 0, 14, 2, C.red); H(p, 2, 13, 1, C.white);
    stamp(p, 2, 4, [".a..a..a.a..", "aaaaaaaaaaaa", ".aaaaaaaaaa.", "aaaaaaaaaaaa", ".a.a..a..a.."], { a: C.white });
    text(p, 2, 5, "POW", C.red); p.set(14, 6, C.yellowD);
  },
  // A paperback thriller: a black cover, a red title, the pages' edge, a dog-eared corner.
  novel: (p) => {
    R(p, 12, 1, 13, 15, C.paper); V(p, 13, 1, 15, C.paperD);
    box(p, 2, 0, 11, 14, C.black, C.blackL, C.rubber); V(p, 3, 0, 14, C.blackL);
    R(p, 4, 2, 10, 4, C.red); H(p, 4, 10, 2, C.redL); H(p, 5, 9, 6, C.white); H(p, 6, 8, 8, C.silverD);
    disc(p, 7, 11, 1, C.redD);
    p.clear(11, 0); p.clear(10, 0); p.clear(11, 1); p.set(10, 1, C.paperD); p.set(11, 2, C.paperD); p.set(10, 2, C.paper);
  },
  // A stack of glossy magazines, fanned: a masthead and a face on each.
  magazines: (p) => {
    box(p, 0, 0, 9, 10, C.blue, C.blueL, C.blueD); H(p, 1, 8, 1, C.white);
    box(p, 3, 2, 12, 12, C.green, C.greenL, C.greenD); H(p, 4, 11, 3, C.yellow);
    box(p, 6, 4, 15, 15, C.pink, shade(C.pink, 0.3), shade(C.pink, -0.3)); R(p, 7, 5, 14, 6, C.red); H(p, 8, 13, 5, C.white);
    disc(p, 11, 10, 2, C.skin); R(p, 9, 8, 13, 8, C.yellow); p.set(10, 8, C.yellowD); R(p, 9, 13, 13, 14, C.white); p.set(10, 10, C.ink); p.set(12, 10, C.ink);
  },
  // A crossword book: a cover with the grid, a pencil across it.
  puzzlebook: (p) => {
    box(p, 1, 0, 13, 15, C.blue, C.blueL, C.blueD); H(p, 3, 11, 1, C.white);
    R(p, 3, 3, 11, 13, C.white);
    for (let y = 3; y <= 13; y += 2) for (let x = 3; x <= 11; x += 2) if ((x * 7 + y * 3) % 5 === 0) R(p, x, y, x + 1, y + 1, C.ink);
    for (let x = 3; x <= 11; x++) for (let y = 3; y <= 13; y++) if (p.get(x, y) === C.white && (x % 2 === 0 || y % 2 === 0)) p.set(x, y, C.whiteD);
    line(p, 8, 15, 15, 8, C.yellow); line(p, 9, 15, 15, 9, C.yellowD); p.set(15, 8, C.pink); p.set(7, 15, C.ink);
  },
  // A deck of playing cards: a red-backed card behind the ace of spades.
  cards: (p) => {
    box(p, 6, 2, 15, 15, C.red, C.redL, C.redD); for (let y = 4; y <= 13; y += 2) dots(p, 8 + (y % 4 ? 1 : 0), 13, y, C.redD);
    box(p, 1, 0, 10, 13, C.white, C.paperL, C.whiteD);
    text(p, 2, 1, "A", C.ink);
    stamp(p, 4, 5, ["..a..", ".aaa.", "aaaaa", "aaaaa", "..a..", ".aaa."], { a: C.ink });
  },
  // A blues harp: steel cover plates, the holes along the comb.
  harmonica: (p) => {
    box(p, 0, 3, 15, 6, C.silver, C.white, C.silverD); H(p, 3, 12, 5, C.whiteD); dots(p, 2, 13, 4, C.silverD, 3);
    R(p, 0, 7, 15, 9, C.brownL); H(p, 0, 15, 7, "#b88a5a"); for (let x = 1; x <= 14; x += 2) R(p, x, 8, x, 9, C.ink);
    box(p, 0, 10, 15, 12, C.silver, null, C.silverD); H(p, 0, 15, 10, C.silverD);
  },

  // An acoustic guitar, on a slant: the body, its sound hole, the neck and the headstock.
  guitar: (p) => {
    line(p, 8, 7, 13, 2, C.brownD); line(p, 9, 7, 14, 2, C.brownD); line(p, 8, 6, 13, 1, C.brown);
    R(p, 13, 0, 15, 1, C.brown); p.set(15, 2, C.brownD); p.set(13, 0, C.silver); p.set(15, 0, C.silver);
    disc(p, 5, 11, 4, C.orange); disc(p, 9, 7, 3, C.orange); rim(p, C.orange, "#efaa5a", C.orangeD);
    disc(p, 7, 9, 1, C.ink); line(p, 3, 13, 5, 11, C.brownD); line(p, 8, 8, 12, 4, C.paperL);
  },
  // Family photos: snapshots in white borders, a lake and a family on the front one.
  photos: (p) => {
    box(p, 5, 0, 15, 9, C.paperL, C.white, C.paperD); R(p, 6, 1, 14, 6, C.pink); R(p, 6, 4, 14, 6, C.gold);
    box(p, 0, 4, 11, 15, C.white, C.paperL, C.whiteD);
    R(p, 1, 5, 10, 12, C.water); H(p, 1, 10, 5, C.blueL); R(p, 1, 10, 10, 12, C.green); H(p, 1, 10, 9, C.waterD);
    disc(p, 8, 7, 1, C.yellow); for (const x of [3, 5]) { p.set(x, 9, C.skin); V(p, x, 10, 11, x === 3 ? C.red : C.blue); }
  },
};
export const SUPPLY_ART = {};
