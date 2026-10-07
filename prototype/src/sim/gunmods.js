// Gun attachments (sights, muzzle devices, magazines, ...) fitted to a weapon item (item.mods).
// STUB: the attachments branch fills this in. Contract shared by the magazine/reload branch and the attachments branch:
// gunMods(item) -> what the item's fitted attachments add up to, all neutral here.
//   aim: + to hit, close: + to hit within 2.5 tiles, opt: + best range (tiles), fall: + aim lost per tile beyond it,
//   dmg: × damage, cap: + rounds in the magazine, capMult: × magazine size, noise: × shot noise,
//   weight: + kg, value: + trade value.
export const NO_MODS = Object.freeze({ aim: 0, close: 0, opt: 0, fall: 0, dmg: 1, cap: 0, capMult: 1, noise: 1, weight: 0, value: 0 });
export function gunMods(item) { return NO_MODS; }
