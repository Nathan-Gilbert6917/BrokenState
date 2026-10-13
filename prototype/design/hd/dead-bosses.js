// The bosses of the hives in HD on their own 88 × 104 grid (twice a figure's, feet on row 101), so the 44 × 52 sheet
// (dead.js) keeps its cell size: the Wallbreaker, the Broodmother and the Hivemind in both phases, as round shaded
// volumes like the rest of the dead.
import { paintBossHD, BOSS_KINDS } from "./dead.js";
export const SHEET_TITLE = "the bosses: HD designs (88 x 104)";
export const SHEET_COLS = 4;
export const SHEET = BOSS_KINDS.map((k) => ({ label: k, paint: () => paintBossHD(k) }));
