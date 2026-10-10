// Every gun's drawing as data (user, 2026-10-10: "unique drawings for each gun in the game and new guns"). ui/gunpaint.js
// paints a spec three ways: the big side view (gun builder, battle HUD: ui/gunart.js), held in battle (ui/sprites.js)
// and dropped by a body (ui/downsprites.js). A gun added later needs only a spec here (tools/gunarttest.js lists the
// guns that have none: they are drawn as a look-alike, FALLBACK_LIKE).
//
// ---------- the spec format ----------
// GUN_ART[weapon key] = {
//   like:  another spec's key to start from (its fields, then these over them; c merged),
//   body:  the body family (gunpaint.js FAM): ar, scar, ak, fal, hk, m14, bolt, brk (break actions), lever, pump,
//          semi, slide (pistols), revolver, rimpistol, ump, vector, p90, bullpup, mg, amr, zip, tube, m32, m203,
//   kind:  pistol | revolver | smg | rifle | shotgun | mg | launcher (the small drawings: pistols and revolvers are
//          drawn in the hand, the rest along the arm; defaults by family),
//   Landmarks, in the big drawing's grid (64 × 24 pixels, muzzle to the right, the bore on row 7):
//   r:     [x0, x1] the receiver;  hg: where the handguard / fore-end ends;  bar: where the barrel ends (the muzzle
//          anchor);  gx: the pistol grip's x;  pistols: x0, x1 (the slide), y0 (its top row);  revolvers: fr (frame),
//          cyl (cylinder) [x0, x1];
//   c:     colours by part (a gunpaint.js C name or "#hex"): body (receiver), low (lower receiver), furn (stock and
//          grip), hg (handguard), bar (barrel), fe (fore-end), pump, slide, frame, grip, panels, cyl;
//   Parts the gun comes with (drawn where nothing is fitted in that slot, so a fitted part replaces them):
//   stock: { t: a gunpaint.js STOCKS kind (ar, a2, tele, crane, scar, wire, mp5, ump, fal, g3, m14, m240, wood,
//          sporter, pgwood, lever, light, poly, sniper, thumb, sawn, amr, m79, folder, brace, none), c: colour, len }
//          or the name of a gun builder look (gunart.js PART_ART, e.g. "stock_ar");
//   mag:   { t: a gunpaint.js MAGS kind (stick, curve, box, clear, drum, beltbox, top, none), n: rows, w: width,
//          curve: rows a pixel forward, col } or a PART_ART look name ("stick30", "belt");
//   muzzle, bipod, grips (a revolver's grip): PART_ART look names;
//   own:   { slot: look } parts drawn only while the gun has no such slot (the hunting rifle's scope);
//   Family options (see each FAM entry in gunpaint.js): ar: hgT (a2, carbine, quad, covers, mlok, slim), fs (fsb,
//          gas, flip), carry, tall, piston, step, rearSight, buffer; ak: fs, ribbed; hk: big; bolt: barRows, taper,
//          bolt (knob, small, tac), fe, floor, rail, bead; brk: n (1, 2), over, slim, fe, hammers, fat, ladder, taper,
//          base; lever: tube, fe, loop (small, big), band, ring, barRows; pump: tube, pump [x0, x1], pumpT (tac),
//          slim, rib, pg, shield, ghost, saddle; semi: tube, fe, pg, rail, ghost; slide: tall, hammer, beaver, panels,
//          rail, fserr, sqGuard, stipple, port, bbl, gripN, gripW; revolver: lug, rib, hammer ("bob"), fluteless;
//          bullpup / mg / tube: v (aug, famas / m249, m240, m2 / at4, rpg); m14: ears, lug;
//   anchors: { slot: [x, y] } to move a slot's anchor (else the family's);
//   extra: (p, s, fitted, h) => {} touches of its own after the body (h: gunpaint.js helpers R, H, V, dots, C);
//   mini:  the small drawings' overrides: accent [[dx, dy, colour]] pixels from the hand, stockT, magT ("none"),
//          deep, top / under features, draw(p, m) to draw it all.
// }
// ART_ALIAS: a key drawn as another (a vehicle turret's gun). SPEC_ALT: other names other branches may give a gun
// (the integration step: when a gun lands under a different key, add the key here or rename the spec).

const AR_BASE = { body: "ar", kind: "rifle" };
/** @type {Record<string, any>} */
export const GUN_ART = {
  // ---------- pistols ----------
  pistol:   { body: "slide", sqGuard: true, stipple: true, c: { slide: "gun", frame: "hg", grip: "hg" } }, // a Glock
  compact9: { like: "pistol", x1: 40, gripN: 8, mini: { accent: [[0, 3, "dark"]] } }, // a Glock 26: short slide, short grip
  usp45:    { body: "slide", x0: 18, x1: 46, gripN: 11, hammer: true, fserr: true, c: { slide: "gun", frame: "poly", grip: "poly" }, miniRail: true, finishes: { twotone: { c: { slide: "steel" } } } }, // the USP: a hammer, front serrations, its rail
  pistol45: { body: "slide", x0: 18, x1: 44, hammer: true, beaver: true, rail: false, c: { slide: "steel", frame: "steel", grip: "steel", panels: "wood" }, panels: true }, // the 1911
  magnum:   { body: "slide", x0: 17, x1: 46, y0: 5, tall: true, hammer: true, rail: false, gripN: 11, gripW: 7, c: { slide: "nickel", frame: "grey", grip: "rubber" } }, // the Desert Eagle: a tall slab of a slide
  pistol22: { body: "rimpistol", x0: 18, x1: 30, bar: 46, c: { slide: "gun", bar: "gun", grip: "hg", panels: "wood" } },
  revolver: { body: "revolver", fr: [19, 31], cyl: [22, 29], bar: 46, lug: true, grips: "grip_wood", c: { frame: "steel", bar: "steel", grip: "wood" } }, // a 686: stainless, full lug
  snub357:  { body: "revolver", fr: [20, 31], cyl: [22, 29], bar: 36, hammer: "bob", grips: "grip_rubber", c: { frame: "nickel", bar: "nickel", grip: "rubber", cyl: "nickelD" } }, // a J-frame: two-inch, shrouded hammer

  // ---------- submachine guns ----------
  smg:   { body: "hk" }, // the MP5
  ump45: { body: "ump" },

  // ---------- rifles: AR family ----------
  ar:      { ...AR_BASE, r: [18, 30], hg: 45, bar: 55, hgT: "a2", fs: "fsb", carry: true, stock: { t: "a2" }, mag: { t: "stick" }, c: { hg: "gun" } }, // an M16A2: carry handle, A2 stock and ribbed handguard
  carbine: { ...AR_BASE, r: [17, 29], hg: 39, bar: 51, hgT: "carbine", fs: "fsb", rearSight: true, stock: { t: "tele" }, mag: { t: "stick" } }, // a police AR carbine: flat-top, carbine handguard
  m4:      { ...AR_BASE, r: [17, 29], hg: 40, bar: 49, hgT: "quad", fs: "fsb", step: true, rearSight: true, stock: { t: "tele" }, mag: { t: "stick", col: "fde" } }, // the M4: quad rail, FSB, tan PMAG
  hk416:   { ...AR_BASE, r: [17, 29], hg: 44, bar: 50, hgT: "covers", fs: "flip", piston: true, stock: { t: "crane" }, mag: { t: "stick", n: 8, w: 4, curve: 4, col: "steel" }, c: { hg: "od" } }, // the HK416: long rail with covers, piston block, steel mag
  dmr:     { ...AR_BASE, r: [15, 28], hg: 44, bar: 54, hgT: "slim", fs: "gas", tall: true, stock: { t: "ar" }, mag: { t: "box", n: 6, w: 5 } }, // an AR-10 marksman rifle
  scarl:   { body: "scar" },
  scarh:   { body: "scar", r: [16, 30], hg: 44, bar: 54, tall: true, mag: { t: "box", n: 7, w: 5, col: "fde" }, c: { low: "gun", furn: "gun" } }, // the SCAR-H: black lower, deep 7.62 magazine

  // ---------- rifles: the rest ----------
  ak:      { body: "ak" },
  fal:     { body: "fal", stock: { t: "fal", c: "wood" }, c: { furn: "wood", hg: "wood" } }, // an old FAL in wood
  m1a:     { body: "m14" },
  aug:     { body: "bullpup", v: "aug" },
  huntrifle: { body: "bolt", own: { optic: "scope9" } },
  sniper:  { body: "bolt", r: [19, 32], bar: 54, barRows: 2, taper: false, bead: false, fe: 40, bolt: "tac", stock: { t: "sniper", c: "olive" }, mag: { t: "box", n: 4, w: 4 }, muzzle: "crown", own: { optic: "scope25", bipod: "bipod" }, c: { bar: "dark", fe: "olive" } },
  rifle22: { body: "bolt", r: [19, 30], bar: 50, barRows: 1, fe: 38, bolt: "small", ry1: 8, stock: { t: "light", c: "woodL" }, mag: "rotary", c: { fe: "woodL", furn: "woodL" } },
  leverrifle: { body: "lever", r: [18, 27], bar: 50, tube: 46, fe: 37, c: { body: "steel" } }, // a .30-30
  lever357: { body: "lever", r: [18, 26], bar: 45, tube: 43, fe: 32, loop: "big", band: true, ring: true, stock: { t: "lever", c: "walnut" }, c: { body: "case", fe: "walnut", furn: "walnut" } }, // a Marlin 1894-style carbine: case-coloured, big loop, saddle ring
  amr:     { body: "amr" },

  // ---------- shotguns ----------
  shotgun: { body: "pump" }, // an 870
  pump20:  { body: "pump", r: [17, 27], bar: 50, tube: 44, pump: [31, 39], slim: true, rib: true, stock: { t: "wood", c: "woodL" }, c: { body: "blued", pump: "woodL", furn: "woodL" } }, // a 20 gauge: slim, vent rib, light wood
  tacpump: { body: "pump", r: [16, 28], bar: 52, tube: 51, pump: [32, 42], pumpT: "tac", shield: true, ghost: true, saddle: true, stock: { t: "poly", c: "poly" }, c: { body: "gun", pump: "poly", furn: "poly" } }, // a 590: heat shield, ghost ring, shells on the side
  semishotgun: { body: "semi", rail: true, ghost: true },
  dbshotgun: { body: "brk", r: [18, 26], bar: 52, fe: 36 }, // a side-by-side
  sawnoff: { body: "brk", r: [22, 30], bar: 42, fe: 37, hammers: true, stock: { t: "sawn" } },
  ou12:    { body: "brk", over: true, r: [18, 26], bar: 52, fe: 34, stock: { t: "pgwood", c: "walnut" }, c: { body: "#b3b9be", bar: "blued", fe: "walnut", furn: "walnut" } }, // an over-under: silver action, stacked barrels
  ou20:    { body: "brk", over: true, slim: true, r: [19, 26], bar: 49, fe: 33, stock: { t: "pgwood", c: "woodL" }, c: { body: "case", bar: "blued", fe: "woodL", furn: "woodL" } },
  single12: { body: "brk", n: 1, r: [19, 25], bar: 51, fe: 31, stock: { t: "wood", c: "wood" }, c: { body: "steel", bar: "gun" } }, // an H&R single: one barrel, the hammer, the hinge
  singlerifle: { body: "brk", kind: "rifle", n: 1, r: [19, 25], bar: 54, fe: 34, taper: true, base: true, bead: false, stock: { t: "sporter", c: "walnut" }, c: { body: "case", bar: "blued", fe: "walnut", furn: "walnut" } },
  pipegun: { body: "zip" },

  // ---------- machine guns ----------
  lmg:  { body: "mg", v: "m249", stock: { t: "wire" }, mag: "belt" }, // the M249
  m240: { body: "mg", v: "m240", r: [14, 32], hg: 46, bar: 55, gx: 17, stock: { t: "m240" }, mag: { t: "beltbox" }, muzzle: "fh_long", bipod: "bipod" },
  m2hb: { body: "mg", v: "m2", r: [14, 30], bar: 58, stock: null, mag: { t: "beltbox", col: "od" }, muzzle: null, bipod: null, c: { hg: "gun" } },

  // ---------- launchers ----------
  m79:  { body: "brk", kind: "launcher", r: [16, 24], bar: 44, fe: 36, fat: true, ladder: true, stock: { t: "m79", c: "wood" }, c: { body: "od", bar: "od", fe: "wood" } },
  m32:  { body: "m32" },
  m203: { body: "m203" },
  at4:  { body: "tube", v: "at4" },
  rpg:  { body: "tube", v: "rpg", r: [4, 56], c: { body: "#4b5340" } },

  // ---------- pre-written for guns other branches are adding (skipped while no such gun exists) ----------
  // ar-platform (landed 2026-10-10 under these keys): AR-15 variants, an AR pistol, 300 BLK carbine and SBR, an AR DMR, a .223 varmint rifle, a Mini-14,
  // single-shots in 5.56 / .223 / 300 BLK, .38 snub and service revolvers.
  ar15rifle: { ...AR_BASE, r: [17, 29], hg: 43, bar: 51, hgT: "mlok", fs: "flip", stock: { t: "tele", c: "fde" }, mag: { t: "stick", col: "fde" }, c: { furn: "fde" } }, // a civilian AR: M-LOK, tan furniture
  ar223:   { ...AR_BASE, r: [17, 29], hg: 44, bar: 54, hgT: "slim", fs: "gas", stock: "stock_ar", mag: { t: "stick", n: 6, w: 4, curve: 4 }, c: { hg: "grey" } }, // a .223 sporting AR: fixed stock, long free-float, a 20-round magazine
  arpistol: { ...AR_BASE, r: [19, 31], hg: 41, bar: 44, hgT: "mlok", fs: "gas", stock: { t: "brace" }, mag: { t: "stick" } },
  ar300:   { ...AR_BASE, r: [17, 29], hg: 42, bar: 48, hgT: "slim", fs: "flip", stock: { t: "crane", c: "od" }, mag: { t: "stick", col: "od" }, muzzle: "brake", c: { hg: "od" } }, // a 300 BLK carbine
  sbr300:  { ...AR_BASE, r: [19, 31], hg: 40, bar: 43, hgT: "quad", fs: "flip", stock: { t: "tele" }, mag: { t: "stick", n: 6, curve: 3 }, muzzle: "brake" }, // a 300 BLK SBR
  ardmr:   { ...AR_BASE, r: [16, 28], hg: 47, bar: 56, hgT: "slim", fs: "gas", stock: "precision", mag: { t: "stick", n: 6, curve: 4 }, muzzle: "brake", c: { hg: "fde" } }, // a .223 AR DMR: long free-float, precision stock
  varmint223: { body: "bolt", r: [19, 32], bar: 56, barRows: 2, taper: false, bead: false, fe: 41, floor: true, stock: { t: "thumb", c: "#6d5f52" }, c: { bar: "steel", fe: "#6d5f52" } }, // a .223 varmint rifle: stainless bull barrel, laminate thumbhole
  ranch223: { body: "m14", r: [20, 31], hg: 42, bar: 50, gx: 22, lug: false, stock: { t: "m14", c: "wood" }, mag: { t: "stick", n: 6, w: 4, curve: 4 }, muzzle: "crown", c: { body: "blued", hg: "wood" } }, // a Mini-14 ranch rifle
  single556: { body: "brk", kind: "rifle", n: 1, r: [19, 25], bar: 53, fe: 33, taper: true, base: true, bead: false, stock: { t: "wood", c: "woodL" }, c: { body: "blued", bar: "gun", fe: "woodL", furn: "woodL" } }, // blued, light wood
  single223: { body: "brk", kind: "rifle", n: 1, r: [19, 25], bar: 52, fe: 33, taper: true, base: true, bead: false, stock: { t: "poly", c: "poly" }, c: { body: "nickel", bar: "steel", fe: "poly", furn: "poly" } },
  single300: { body: "brk", kind: "rifle", n: 1, r: [19, 25], bar: 46, fe: 32, base: true, bead: false, stock: { t: "poly", c: "od" }, c: { body: "gun", bar: "gun", fe: "od", furn: "od" } },
  snub38:  { body: "revolver", fr: [20, 31], cyl: [22, 29], bar: 35, grips: "grip_snub", c: { frame: "blued", bar: "blued", grip: "wood", cyl: "gun" } },
  service38: { body: "revolver", fr: [19, 31], cyl: [22, 29], bar: 43, grips: "grip_wood", c: { frame: "blued", bar: "blued", grip: "walnut", cyl: "gun" } },
  // calibres-more: the P90, a 5.7 pistol, the Vector .45, the G3, the FAMAS, a .44 revolver, a .44 lever-action, a
  // .44 single-shot.
  p90:     { body: "p90" },
  pistol57: { body: "slide", x0: 18, x1: 45, y0: 5, gripN: 11, c: { slide: "gun", frame: "fde", grip: "fde" }, miniRail: true },
  vector:  { body: "vector" },
  g3:      { body: "hk", kind: "rifle", big: true, r: [14, 34], hg: 45, bar: 53, gx: 18, stock: { t: "g3" }, mag: { t: "box", n: 7, w: 4, curve: 5 }, muzzle: "fh", c: { hg: "od" } },
  famas:   { body: "bullpup", v: "famas", r: [8, 37], bar: 50, gx: 31, mag: { t: "stick", n: 7, w: 4, curve: 0 }, c: { body: "gun", furn: "gun" } },
  revolver44: { body: "revolver", fr: [18, 31], cyl: [21, 29], bar: 52, lug: true, rib: true, grips: "grip_wood", c: { frame: "blued", bar: "blued", grip: "walnut", cyl: "gun" } }, // a Model 29
  lever44: { body: "lever", r: [18, 26], bar: 47, tube: 44, fe: 34, band: true, stock: { t: "lever", c: "walnut" }, c: { body: "blued", fe: "walnut", furn: "walnut" } },
  single44: { body: "brk", kind: "rifle", n: 1, r: [19, 25], bar: 49, fe: 32, stock: { t: "wood", c: "walnut" }, c: { body: "blued", bar: "blued", fe: "walnut", furn: "walnut" } },
};

// ---------- finishes (sim/data-finish.js GUN_FINISH: which a gun comes in; item.finish) ----------
// How a finish repaints a spec's colours (its first finish is the spec as drawn): furn, the furniture's new colour
// (FURN_SLOTS, a polymer-coloured body too, the stock and magazine), metal (METAL_SLOTS when bare metal), action (the
// receiver alone). A spec may add its own: finishes: { name: { c: {...}, stock: {...}, mag: {...} } }.
export const FINISH_LOOK = {
  black: { furn: "poly", metal: "gun" }, fde: { furn: "fde" }, od: { furn: "od" }, wood: { furn: "wood" }, plum: { furn: "plum" },
  laminate: { furn: "#6d5f52" }, stainless: { metal: "steel" }, blued: { metal: "blued" }, nickel: { metal: "nickel" },
  silver: { metal: "#b3b9be" }, case: { action: "case" }, twotone: {},
};

// Keys drawn as another gun (the same gun, mounted).
export const ART_ALIAS = { turret_m2: "m2hb", turret_lmg: "lmg" };
// Other names a branch may give the pre-written guns (one spec each until the gun lands under its own key).
export const SPEC_ALT = {
  ar15: "ar15rifle", civar: "ar15rifle", sporterar: "ar15rifle", arp: "arpistol", ar15pistol: "arpistol",
  blk300: "ar300", ar300blk: "ar300", carbine300: "ar300", blkcarbine: "ar300", blksbr: "sbr300", sbr: "sbr300",
  ar10dmr: "ardmr", dmr223: "ardmr", spr: "ardmr", varmint: "varmint223", bolt223: "varmint223", mini14: "ranch223", ranchrifle: "ranch223",
  singlerifle223: "single223", single300blk: "single300", snub38spl: "snub38", rev38: "service38", revolver38: "service38", police38: "service38",
  fn57: "pistol57", fiveseven: "pistol57", p57: "pistol57", vector45: "vector", kriss: "vector", g3a3: "g3", hkg3: "g3",
  magnum44: "revolver44", rev44: "revolver44", m29: "revolver44", leverrifle44: "lever44", lever44mag: "lever44", single44mag: "single44",
};

// The look-alike a gun with no spec is drawn as: by words in its name and description first, then its category and
// calibre (gunpaint.js fallbackKey).
export const FALLBACK_LIKE = {
  words: [
    [/over-under|over\/under/, "ou12"], [/single-shot|single shot/, "single12"], [/snub/, "snub357"], [/revolver/, "revolver"],
    [/bullpup/, "aug"], [/submachine|\bsmg\b/, "smg"], [/belt-fed|machine gun/, "m240"], [/lever/, "leverrifle"], [/pump/, "shotgun"],
    [/double-barrel|side-by-side/, "dbshotgun"], [/sniper/, "sniper"], [/bolt-action|bolt action/, "huntrifle"], [/kalashnikov|\bak-/, "ak"],
    [/battle rifle/, "fal"], [/\bar-15|\bar15|\bar-pattern|\bm4\b/, "carbine"], [/launcher/, "m79"],
  ],
  pistol: "pistol", shotgun: "shotgun", smg: "smg", rifle: "carbine", mg: "lmg", longgun: "huntrifle", launcher: "m79",
};

// ---------- parts (ui/gunparts.js) ----------
// A part's drawing when its words do not say enough (gunparts.js guessPart reads its slot, key and name: "budget red
// dot", "9mm suppressor", "light / laser combo"...): PART_SPEC[part key] = { kind, ...options }. Kinds (gunparts.js
// PART_KINDS) and their options: sights dot (len, col, lens), holo (len, col), mini (len, col), prism (len, col),
// scope (len, bell, col, lens), magnifier, thermal, irons, mount (len); muzzle can (len, rows, bands, col), brake
// (len), comp (len), choke (len), fh (len); under and on the rails vgrip (len, col), agrip, stop, laser (col, beam),
// light (len, col), combo, bipod (len), launcher (len, col), rail (len), saddle (n shells), sling; stock (t: a
// gunpaint.js STOCKS kind, col); mag (t: a MAGS kind, n, w, curve, col); grips (col, n). Colours: gunpaint.js C names
// or "#hex". Each also has its small drawing on the gun held in battle.
/** @type {Record<string, any>} */
export const PART_SPEC = {
  // the parts catalogue of 2026-10-10 (sim/data-gunmods.js PART_INFO): where the words guess wrong, and the budget
  // Chinese clones in a cheap grey
  aimpoint: { kind: "dot", len: 3 }, holosun: { kind: "dot", len: 2 }, holopistol: { kind: "mini" },
  cheapdot: { kind: "dot", col: "grey" }, cheapholo: { kind: "holo", col: "grey" }, cheaprmr: { kind: "mini", col: "grey" },
  holomag: { kind: "holo", len: 4 }, cheapmag: { kind: "holo", len: 3, col: "grey" }, // a holo sight with its 3× magnifier: one part, drawn as the sight
  cheapscope: { kind: "scope", len: 6, bell: 1, col: "grey" }, cheapacog: { kind: "prism", col: "grey" }, cheaplpvo: { kind: "scope", len: 6, bell: 1, col: "grey" },
  cheapmount: { kind: "mount", len: 3 },
  mlokpro: { kind: "rail", len: 8 }, cheaprail: { kind: "rail", len: 6 },
  can9pro: { kind: "can", len: 6, rows: 4 }, can556pro: { kind: "can", len: 8, rows: 4 }, can308pro: { kind: "can", len: 9, rows: 4 }, can22pro: { kind: "can", len: 5, rows: 3 },
  cheapcan: { kind: "can", len: 7, rows: 4, bands: true, col: "blue" }, // a fuel filter
  brakepro: { kind: "brake", len: 4 }, cheapbrake: { kind: "brake", len: 3, col: "grey" }, flashpro: { kind: "fh", len: 3 }, cheapcomp: { kind: "comp", col: "grey" },
  turkeychoke: { kind: "choke", len: 3 }, icchoke: { kind: "choke", len: 1 },
  ctrstock: { kind: "stock", t: "tele" }, fixedstock: { kind: "stock", t: "a2" }, cheapstock: { kind: "stock", t: "tele", col: "grey" }, pistolbrace: { kind: "stock", t: "brace" },
  vgrippro: { kind: "vgrip", len: 4 }, handstop: { kind: "stop" }, cheapgrip: { kind: "vgrip", col: "grey" },
  pgrip: { kind: "grips", col: "poly", n: 7 }, cheappgrip: { kind: "grips", col: "grey", n: 7 }, cheaprevgrip: { kind: "grips", col: "rubber" }, // the pistol-grip slot
  chandle: { kind: "mount", len: 1 }, cheapchandle: { kind: "mount", len: 1 }, // a charging handle at the receiver's back
  sidesaddle: { kind: "saddle", n: 4 }, cheapsaddle: { kind: "saddle", n: 3 }, // shells on the receiver's side
  surefire: { kind: "light", len: 3 }, pistollight: { kind: "light", len: 2 }, cheaplight: { kind: "light", len: 2, col: "grey" },
  lightlaser: { kind: "combo" }, cheappeq: { kind: "combo", col: "grey" },
  lasergrip: { kind: "laser", col: "rubber" }, cheaplaser: { kind: "laser", col: "grey" }, // (laser grips: the laser at the frame)
  harris: { kind: "bipod", len: 7 }, cheapbipod: { kind: "bipod", len: 5, col: "grey" },
  slingpro: { kind: "sling", col: "olive" },
};
