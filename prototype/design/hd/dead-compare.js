// Before / after: the game's current zombie sprite (22 × 26, scaled 2×) next to its HD design (dead.js) for six
// (variant, seed) pairs.
import { comparePairs } from "./dead.js";
export const SHEET_TITLE = "the dead: current (2x) vs HD";
export const SHEET_COLS = 6;
export const SHEET = comparePairs();
