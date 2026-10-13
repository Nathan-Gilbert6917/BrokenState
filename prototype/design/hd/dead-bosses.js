// The bosses of the hives in HD (88 × 104): a sheet of their own so the 44 × 52 sheet (dead.js) keeps its cell size.
import { paintBossHD, BOSS_KINDS } from "./dead.js";
export const SHEET_TITLE = "the bosses: HD designs (88 x 104)";
export const SHEET_COLS = 4;
export const SHEET = BOSS_KINDS.map((k) => ({ label: k, paint: () => paintBossHD(k) }));
