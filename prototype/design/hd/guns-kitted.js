// The kitted sheet: the representative guns fully fitted (an optic, a muzzle device, a grip / light / laser, a
// magazine, a stock where the gun takes one) in two or three of the finishes the game gives them
// (sim/data-finish.js GUN_FINISH). Render: node design/hd/render.js guns-kitted 3 3
import { paintGunHD, REP } from "./guns.js";
import { GUN_FINISH } from "../../src/sim/data-finish.js";
import { PLATFORMS } from "../../src/sim/data-gunmods.js";
import { platformOf } from "./gamegun.js";

// A full kit per gun kind: the looks by slot (ui/gunparts.js looks / MOD_LOOK names).
const KITS = {
  pistol: { optic: "rmr", muzzle: "can_s", tactical: "light", mag: "extmag" },
  pistol22: { optic: "rmr", muzzle: "can_s", mag: "stick10" },
  compact9: { optic: "rmr", muzzle: "comp", tactical: "laser", mag: "extmag" },
  pistol45: { optic: "rmr", muzzle: "can_s", tactical: "laser", mag: "extmag" },
  revolver: { mount: "mount", optic: "reddot", tactical: "laser", grip: "grip_rubber", muzzle: "comp" },
  snub357: { mount: "mount", optic: "rmr", grip: "grip_wood" },
  smg: { mount: "mount", optic: "holo", muzzle: "can_s", stock: "collapsible", tactical: "light", mag: "drum", sling: "sling" },
  ump45: { optic: "reddot", muzzle: "can_l", stock: "fold", grip: "vgrip", tactical: "laser", mag: "stick30", sling: "sling" },
  carbine: { optic: "acog", muzzle: "can_l", stock: "collapsible", rail: "rail", under: "vgrip", tactical: "peq", mag: "stick40", sling: "sling", bipod: "bipod" },
  dmr: { optic: "lpvo", muzzle: "brake", stock: "precision", rail: "rail", bipod: "bipod", mag: "box20", sling: "sling" },
  ak: { mount: "mount", optic: "reddot", muzzle: "brake", stock: "fold", rail: "rail", grip: "agrip", mag: "drum", sling: "sling" },
  leverrifle: { mount: "mount", optic: "scope4", muzzle: "comp", stock: "stock_lever", cuff: { kind: "cuff", round: "brass", n: 5 }, sling: "sling" },
  huntrifle: { optic: "scope9", muzzle: "can_l", stock: "stock_wood", bipod: "bipod", mag: "box10", sling: "sling" },
  sniper: { optic: "scope25", muzzle: "brake", stock: "precision", bipod: "bipod", mag: "stick10", sling: "sling" },
  amr: { optic: "thermal", mag: "box10", sling: "sling" },
  shotgun: { mount: "mount", optic: "holo", muzzle: "choke", mag: "tube_ext", stock: "stock_poly", tactical: "light", receiver: { kind: "saddle", n: 4 }, cuff: { kind: "cuff", n: 4 }, sling: "sling" },
  dbshotgun: { mount: "mount", optic: "reddot", muzzle: "choke", stock: "stock_wood", cuff: { kind: "cuff", n: 4 }, sling: "sling" },
  sawnoff: { mount: "mount", optic: "rmr", muzzle: "choke", stock: "stock_sawn", sling: "sling" },
  semishotgun: { optic: "reddot", muzzle: "choke", mag: "tube_ext", stock: "stock_poly", tactical: "light", receiver: { kind: "saddle", n: 4 }, cuff: { kind: "cuff", n: 4 }, sling: "sling" },
  lmg: { optic: "holo", muzzle: "fh", mag: "belt", tactical: "peq" },
  aug: { optic: "lpvo", muzzle: "can_l", mag: "stick30", rail: "rail", tactical: "light", sling: "sling" },
  pipegun: { sling: "sling" },
  m4: { optic: "reddot", magnifier: { kind: "magnifier" }, muzzle: "fh", stock: "collapsible", rail: "rail", under: "m203", tactical: "peq", mag: "stick30", sling: "sling" },
  fal: { optic: "scope4", muzzle: "fh_long", stock: "stock_poly", rail: "rail", bipod: "bipod", mag: "box20", sling: "sling" },
};
const slotsFor = (k) => { const pl = PLATFORMS[platformOf(k)]; return pl ? [...pl.slots, ...(k === "carbine" || k === "m4" ? ["magnifier"] : [])] : null; };
export const KIT_LOOKS = KITS;
export const SHEET_TITLE = "HD guns, fully kitted, in the game's finishes";
export const SHEET_COLS = 6;
export const SHEET = [];
for (const k of REP) {
  const fins = (GUN_FINISH[k] || [[null, 1]]).map(([f]) => f).slice(0, 3);
  while (fins.length < 3) fins.push(fins[fins.length - 1]);
  for (const f of fins) SHEET.push({ label: `${k}${f ? ` · ${f}` : ""}`, paint: () => paintGunHD(k, KITS[k] || {}, slotsFor(k), f) });
}
