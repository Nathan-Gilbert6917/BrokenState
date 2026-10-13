// The parts sheet: every look of ui/gunart.js PART_ART / ui/gunparts.js MOD_LOOK and every data-driven kind, each on
// its own 48 × 32 cell beside a grey stub of what it fits to. Render: node design/hd/render.js gun-parts 4 10
import { PART_HD, KINDS_HD, partIcon } from "./gunparts-hd.js";
import { PART_SPEC } from "../../src/ui/gunspecs.js";
import { partSpecOf } from "../../src/ui/gunparts.js";

export const SHEET_TITLE = "HD gun parts (48 × 32 cells): the hand-drawn looks, then the kinds and the catalogue's specs";
export const SHEET_COLS = 10;
const LOOKS = ["reddot", "holo", "rmr", "acog", "lpvo", "scope4", "scope9", "scope25", "thermal", "scrapscope", "irons", "tritium", "mount",
  "can_s", "can_l", "oilfilter", "bottle", "brake", "comp", "choke", "fh", "fh_long", "fh_m14", "crown", "lugs", "brake_ak", "brake_big",
  "vgrip", "agrip", "laser", "light", "peq", "bipod", "m203", "rail", "sling",
  "stock_ar", "collapsible", "precision", "fold", "pad", "stock_skel", "stock_ak", "stock_mp5", "stock_wood", "stock_lever", "stock_light", "stock_poly", "stock_sniper", "stock_sawn", "stock_amr",
  "stick10", "stick20", "stick30", "stick40", "smg30", "ak30", "box10", "box20", "rotary", "extmag", "drum", "belt", "tube_ext",
  "revgrip", "grip_wood", "grip_rubber", "grip_snub"];
// The kinds with their defaults, and the stock / magazine kinds not among the looks.
const KIND_CELLS = [
  ["dot kind", { kind: "dot" }], ["holo kind", { kind: "holo" }], ["mini kind", { kind: "mini" }], ["prism kind", { kind: "prism" }], ["scope kind", { kind: "scope" }], ["magnifier", { kind: "magnifier" }],
  ["can kind", { kind: "can" }], ["brake kind", { kind: "brake" }], ["comp kind", { kind: "comp" }], ["choke kind", { kind: "choke" }], ["fh kind", { kind: "fh" }],
  ["stop", { kind: "stop" }], ["combo", { kind: "combo" }], ["launcher", { kind: "launcher" }], ["saddle", { kind: "saddle" }], ["cuff", { kind: "cuff" }], ["cuff rifle", { kind: "cuff", round: "brass", n: 5 }],
  ["stock crane", { kind: "stock", t: "crane" }], ["stock scar", { kind: "stock", t: "scar", col: "fde" }], ["stock ump", { kind: "stock", t: "ump" }], ["stock fal", { kind: "stock", t: "fal", col: "poly" }], ["stock g3", { kind: "stock", t: "g3", col: "od" }],
  ["stock m14", { kind: "stock", t: "m14", col: "wood" }], ["stock sporter", { kind: "stock", t: "sporter", col: "walnut" }], ["stock pgwood", { kind: "stock", t: "pgwood", col: "walnut" }], ["stock thumb", { kind: "stock", t: "thumb", col: "#6d5f52" }], ["stock a2", { kind: "stock", t: "a2" }], ["stock brace", { kind: "stock", t: "brace" }], ["stock m240", { kind: "stock", t: "m240" }],
  ["mag clear", { kind: "mag", t: "clear" }], ["mag box 7", { kind: "mag", t: "box", n: 7, w: 5, curve: 6, col: "fde" }], ["mag steel", { kind: "mag", t: "stick", n: 8, w: 4, curve: 4, col: "steel" }], ["mag top (P90)", { kind: "mag", t: "top", len: 10 }],
];
// The catalogue's specs (ui/gunspecs.js PART_SPEC: the parts of sim/data-gunmods.js), as the game resolves them.
const SPEC_CELLS = Object.keys(PART_SPEC).map((k) => [k, partSpecOf(k)]).filter(([, o]) => o && KINDS_HD[o.kind]);
export const SHEET = [
  ...LOOKS.map((l) => ({ label: l, paint: () => partIcon(l) })),
  ...KIND_CELLS.map(([label, spec]) => ({ label, paint: () => partIcon(spec) })),
  ...SPEC_CELLS.map(([label, spec]) => ({ label, paint: () => partIcon(spec) })),
];
export const missingLooks = () => LOOKS.filter((l) => !PART_HD[l]);
