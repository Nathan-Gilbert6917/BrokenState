// The before / after sheet: the game's 22 × 26 sprite (blown up 2×) next to the HD 44 × 52 one (people.js, the
// second design in the item style): six seeded survivors with gear, then a raider, a soldier and a zealot.
// Render: node design/hd/render.js people-compare 4
import { comparePairs, paintEnemyHD, fromGame } from "./people.js";
import { paintEnemyHuman } from "../../src/ui/sprites.js";
export const SHEET_TITLE = "people: current (2×) vs HD";
export const SHEET_COLS = 6;
const enemy = (kit, col, w, a, seed) => [
  { label: `current ${kit.slice(0, -1)}`, paint: () => fromGame(paintEnemyHuman(kit, col, w, a, seed)) },
  { label: `HD ${kit.slice(0, -1)}`, paint: () => paintEnemyHD(kit, col, w, a, seed) },
];
export const SHEET = [
  ...comparePairs(),
  ...enemy("raiders", "#a63a32", "machete", null, 11),
  ...enemy("soldiers", "#2d5fa8", "ar", "vest", 21),
  ...enemy("zealots", "#a63a32", "knife", null, 31),
];
