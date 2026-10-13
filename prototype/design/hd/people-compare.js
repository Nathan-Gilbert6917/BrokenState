// The before / after sheet: the game's 22 × 26 sprite (blown up 2×) next to the HD 44 × 52 one, six survivors and the
// three hostile kits. Render: node design/hd/render.js people-compare 4
import { comparePairs, paintEnemyHD, fromGame } from "./people.js";
import { paintEnemyHuman } from "../../src/ui/sprites.js";
export const SHEET_TITLE = "current (2×) vs HD";
export const SHEET_COLS = 6;
export const SHEET = [
  ...comparePairs(),
  { label: "current raider", paint: () => fromGame(paintEnemyHuman("raiders", "#a63a32", "machete", null, 11)) }, { label: "HD raider", paint: () => paintEnemyHD("raiders", "#a63a32", "machete", null, 11) },
  { label: "current soldier", paint: () => fromGame(paintEnemyHuman("soldiers", "#2d5fa8", "ar", "vest", 21)) }, { label: "HD soldier", paint: () => paintEnemyHD("soldiers", "#2d5fa8", "ar", "vest", 21) },
  { label: "current zealot", paint: () => fromGame(paintEnemyHuman("zealots", "#a63a32", "knife", null, 31)) }, { label: "HD zealot", paint: () => paintEnemyHD("zealots", "#a63a32", "knife", null, 31) },
];
