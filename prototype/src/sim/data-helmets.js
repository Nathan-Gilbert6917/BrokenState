// @ts-check
// Helmets, face shields, helmet mounts and ear protection (docs/weapons-overhaul-plan.md section 18; wave 2, agent E2).
// Plain data that imports nothing; data.js merges HELMET_GEAR into GEAR. The rules are in helmets.js (what fits where,
// the face cover) and hearing.js (bangs, deafening, what your people hear).
//
// Armour pieces carry their armour class and material here (armour.js armourSpec reads GEAR ac / mat; dur is the
// section 17 dmax). blunt: a hard hat stops blows and bites, never a bullet. face: what a fitted visor covers
// (helmets.js). ears: the cut (bang points off a listener's exposure), the HEAR change (tiles of hearing), electronic
// (it clips loud sounds and lets quiet ones through), link (a team headset: hearing.js linkAim).
/** @type {Record<string, any>} */
export const HELMET_GEAR = {
  hardhat:     { name: "Hard hat",                   slot: "head", skill: null, power: 0.35, req: 0, value: 6,   noise: 0, weight: 0.4,  dur: 15, ac: 1, mat: "hard", blunt: true, cat: "armor",
                 desc: "A builder's hard hat: blows and bites skid off the crown (AC 1), a bullet goes straight through. Takes ear muffs, a helmet light, a riot visor, and night vision on a hobbyist's mount." },
  highcut:     { name: "High-cut ballistic helmet",  slot: "head", skill: null, power: 1.4,  req: 0, value: 110, noise: 0, weight: 1.2,  dur: 45, ac: 4, mat: "hard", cat: "armor",
                 desc: "A modern high-cut helmet: AC 4 over the crown, cut away over the ears for a headset. Rails and a shroud take a ballistic or riot visor, night vision, a light and ear protection or a team headset." },
  ballvisor:   { name: "Ballistic visor",            slot: "pack", skill: null, power: 0, req: 0, value: 60, noise: 0, weight: 1.0, dur: 25, ac: 3, mat: "ceramic", face: "ballistic", cat: "armor",
                 noRepair: "A cracked ballistic visor cannot be mended: it has to be replaced.",
                 desc: "A thick polycarbonate face shield for the high-cut helmet: AC 3 over the face, bites and blows ×0.3. Down it costs 2 aim and a tile of sight (3 more aim fogged up in the cold or the rain); it cracks like ceramic (−4 aim until it is raised or taken off) and cannot be repaired." },
  riotvisor:   { name: "Riot visor",                 slot: "pack", skill: null, power: 0, req: 0, value: 10, noise: 0, weight: 0.5, dur: 20, ac: 1, mat: "hard", face: "riot", cat: "armor",
                 desc: "A clip-on riot face shield for a hard hat or a high-cut helmet: bites and blows to the face ×0.4; a bullet barely notices it (AC 1). Fogs up in the cold or the rain (−3 aim while down)." },
  nvgmount:    { name: "Helmet NVG mount",           slot: "pack", skill: null, power: 0, req: 0, value: 15, noise: 0, weight: 0.25, small: true, cat: "armor",
                 desc: "A hobbyist's bracket that bolts a night vision mount to a hard hat. The combat and high-cut helmets have a shroud built in." },
  helmetlight: { name: "Helmet light",               slot: "pack", skill: null, power: 0, req: 0, value: 10, noise: 0, weight: 0.1, small: true, cat: "tools",
                 desc: "A light on the side of a helmet: hands free, it lights the way like a flashlight (9 tiles at night; seen 3 tiles further). Fits a hard hat, a riot helmet, a combat or a high-cut helmet." },
  earplugs:    { name: "Foam earplugs",              slot: "ears", plugs: true, skill: null, power: 0, req: 0, value: 1, noise: 0, weight: 0.01, small: true, dur: 6, cat: "medical",
                 ears: { cut: 3, hear: -3 },
                 desc: "A strip of foam earplugs: worn in the Ear pro slot, a pair goes in at the start of a fight (6 fights); in a pocket or the pack they do nothing. Work under any helmet. Gunfire is far less likely to deafen, but you hear less (−3 tiles)." },
  earmuffs:    { name: "Shooting ear muffs",         slot: "ears", skill: null, power: 0, req: 0, value: 8, noise: 0, weight: 0.3, cat: "tools",
                 ears: { cut: 4, hear: -3 },
                 desc: "Passive range muffs: worn in the Ear pro slot (not under a full-shell helmet). Gunfire is far less likely to deafen (a flashbang less), but you hear less (−3 tiles)." },
  eardef:      { name: "Electronic ear defenders",   slot: "ears", skill: null, power: 0, req: 0, value: 30, noise: 0, weight: 0.35, dur: 30, recharge: true, cat: "electronics",
                 ears: { cut: 4, hear: 2, elec: true },
                 desc: "Electronic shooting muffs: they clip the bang and turn up footsteps (+2 tiles of hearing). Worn in the Ear pro slot (not under a full-shell helmet). 30 fights on a set of batteries (a battery swap at a bench)." },
  commset:     { name: "Military headset",           slot: "ears", skill: null, power: 0, req: 0, value: 70, noise: 0, weight: 0.4, dur: 30, recharge: true, cat: "electronics",
                 ears: { cut: 4, hear: 3, elec: true, link: true },
                 desc: "A military comms headset, worn in the Ear pro slot (not under a full-shell helmet): hearing protection that turns up quiet sounds (+3 tiles), and a team link: two or more of your people wearing one call out targets (+5 aim at a target another linked teammate sees) and cover each other's retreat (+5). 30 fights on a set of batteries." },
};
