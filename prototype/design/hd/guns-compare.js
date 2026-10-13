// The before / after sheet: the game's 64 × 24 drawing (blown up 2×) next to the HD 128 × 48 one, eight guns, bare
// and kitted. Render: node design/hd/render.js guns-compare 3 4
import { paintGunHD } from "./guns.js";
import { currentGun, platformOf } from "./gamegun.js";
import { KIT_LOOKS } from "./guns-kitted.js";
import { PLATFORMS } from "../../src/sim/data-gunmods.js";

const GUNS = ["pistol", "revolver", "smg", "carbine", "ak", "huntrifle", "shotgun", "lmg"];
const slotsFor = (k) => { const pl = PLATFORMS[platformOf(k)]; return pl ? pl.slots : null; };
// The game's painter takes look names only: the kit's { kind } specs are dropped for it.
const gameLooks = (k) => Object.fromEntries(Object.entries(KIT_LOOKS[k] || {}).filter(([, l]) => typeof l === "string"));
export const SHEET_TITLE = "current (2×) vs HD: bare, then kitted";
export const SHEET_COLS = 4;
export const SHEET = [];
for (const k of GUNS) {
  SHEET.push({ label: `current ${k}`, paint: () => currentGun(k, k === "huntrifle" ? { optic: "scope9" } : {}) });
  SHEET.push({ label: `HD ${k}`, paint: () => paintGunHD(k, k === "huntrifle" ? { optic: "scope9" } : {}) });
  SHEET.push({ label: `current ${k} kitted`, paint: () => currentGun(k, gameLooks(k)) });
  SHEET.push({ label: `HD ${k} kitted`, paint: () => paintGunHD(k, KIT_LOOKS[k], slotsFor(k)) });
}
