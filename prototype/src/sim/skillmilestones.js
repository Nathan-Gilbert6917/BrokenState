// @ts-check
// The perk milestones (skills.js: a perk at each), in a module with no imports so a module in an import cycle with
// skills.js can read them while it loads (achievements.js MASTER_LEVEL, an achievement's text; issue #45: loottest and
// gunmodtest crashed on "Cannot access 'MILESTONES' before initialization").
export const MILESTONES = [5, 10, 15];
