// Before / after: the game's current zombie sprite (22 × 26, shown 2×) next to its HD design (dead.js, the round-volume
// redesign in the item style) for six (variant, seed) pairs: two walkers, two runners, a bloated one, a brute.
import { comparePairs } from "./dead.js";
export const SHEET_TITLE = "the dead: current (2x) vs HD";
export const SHEET_COLS = 6;
export const SHEET = comparePairs();
