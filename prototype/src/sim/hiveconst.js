// Shared numbers for the hives and their bosses (hives.js, defences.js, hordes.js and the UI). A leaf module: it
// imports nothing, so it is safe to read at load time whatever order the circular sim imports are evaluated in.
export const HIVE = {
  CLUSTER: 5,         // hives this close count as a cluster for income
  START_RES: 5,       // resources of every hive on the map at the start
  RES_CAP: 80,        // a hive stores no more than this
  BOSS_COST: 40,      // a Wallbreaker
  BOSS_DAY: 200,      // no Wallbreakers before this day
  TERRITORY: 4,       // land a hive holds (sites inside show at least 3 skulls)
  RING: 1,            // red-skull ground around the hive: much tougher dead
  RADIATE: 6,         // infection reaches this far
  SUPPORT: 10,        // hives this close to a build site send hordes to it
  DRAW: 6,            // wandering hordes this close to a build site are drawn to it
  SITE_SCORE: 30,     // construction starts at this combined horde score
  SITE_BIOMASS: 1000, // ... and the hive stands when this many of the dead have gone into it
  SITE_INTAKE: 40,    // ... at most this many a day (a quarter of the gathered mass, at least 25): about 25 days
  SITE_DAYS: [120, 180], // days between new build sites (slow enough that a hive war can be won)
  SITE_MAX: 1,        // build sites at a time
  BORDER_DAYS: [5, 9],
  GUARD_MIN: 40,      // a hive rebuilds its guard below this
  START_ORIGIN: 4,    // hives placed around the outbreak origin at the start on a Normal map (mapgen.js; worldsize.js for the others)
  START_SPOT: 1,      // ... and around each other hot spot (a lone hive: a first target)
  // The share of a defending hive's new roaming hordes it sends to attack a base: ATTACK_START on day 1, up by
  // 1 / ATTACK_RAMP a day, at most ATTACK_MAX (20% at first, 40% on day 30, 65% from about day 70).
  ATTACK_START: 0.2, ATTACK_RAMP: 150, ATTACK_MAX: 0.65,
  LARGE_DAY: 60,      // a defending hive sends out no large roaming / attacking hordes before this day
  ATTACK_RANGE: 45,   // your bases are attacked from at most this far (the groups' from 22)
  PLAYER_PULL: 2.5,   // your bases weigh this much more than the groups' when a hive picks what to attack
  BOSS_GAP: 90,       // days after a hive raises a Wallbreaker before it can raise the next
  BOSS_DEN: true,     // Wallbreakers come only from a hive with a Wallbreaker den (GROWTHS.den); false: the calendar alone (BOSS_DAY)
};
export const BOSS_NAMES = { horde: "Wallbreaker", hive: "Broodmother" };

// ---------- the hive tech tree (hivetech.js) ----------
// A hive grows structures ("growths") on land within TECH.RANGE tiles of itself, bought with its resources and
// taking days to grow. Which ones it may grow is set by its tier: tier t is open once the game is past
// TIER_DAY[t] (stretched by up to JITTER per hive, so the hives do not all evolve on the same day) and the hive
// itself is TIER_AGE[t] days old (a young hive starts at the bottom). The years are the game's 112-day years
// (eras.js). With the defaults: pits and a brood chamber from the start, runners and feeding grounds from year 2
// (the early game), brutes and spitters from year 5–6 (the mid game), screamers, crawlers and the Wallbreaker den
// from year 10–13 (the late game: no Wallbreakers before), the mutation vat (elite dead) from year 14. Every number
// the tree uses is here.
export const TECH = {
  RANGE: 2,             // growths stand within this many tiles of their hive
  MAX: 10,              // growths a hive keeps at most (withered ones not counted; also limited by the free tiles)
  TIER_DAY: [0, 120, 450, 1100, 1500], // game day each tier opens (tiers 0–4): game years 2, 5, 10, 14 (eras.js: 112-day years)
  TIER_AGE: [0, 20, 90, 200, 400],     // ... and the age in days a hive needs for it
  JITTER: 0.35,         // per hive: a tier opens up to 35% later than its day
  GAP: 12,              // days between a hive starting one growth and the next
  SAVE_DAYS: 20,        // a growth a hive cannot afford yet: it sends out no new roaming hordes for up to this many days to save for it
  THREAT_DAYS: 60,      // a hive attacked within this many days builds for defence (brood chamber first)
  HP: 100,              // a growth's flesh: fires burn it down; it regrows REGROW a day
  REGROW: 5,
  DECAY_DAYS: 40,       // the growths of a destroyed hive wither and are gone after this many days
  RUMOUR: 0.4,          // chance a growth finished out of sight, at a hive you know of, reaches you as a rumour
  BORDER_DAY: 900,      // border hordes carry the special dead of the era (at BORDER_SHARE of a hive's mix) from this day (game year 9)
  BORDER_SHARE: 0.5,
  MIX_MAX: 0.45,        // at most this share of a horde is special dead; the rest are ordinary
  // Burning a growth (the Burn the growth mission): its guard, the fires and the Molotovs.
  GUARD_BASE: 6, GUARD_PER: 40, GUARD_MAX: 12, // 6 of the dead + 1 per 40 in the hive's guard, at most 12
  FIRE_FUEL: 4, FIRE_DMG: 60, BOMBS: 2, BOMB_DMG: 100,
  SPIRE_RANGE: 10,      // a screamer spire: its hive attacks bases this much farther away
  SPIRE_CALL: 6,        // ... and calls wandering dead within this many tiles into its guard (SPIRE_ODDS a day each)
  SPIRE_ODDS: 0.3,
  ELITE_HP: 1.3, ELITE_DMG: 1.2, ELITE_WEIGHT: 1.25, // a mutation vat's special dead
};

// The growths. tier: the tier it needs; cost / days: resources and days to grow; max: per hive; unlocks: the kind of
// dead it lets the hive breed (ZTYPES); income: + resources a day; incomeMult: × the hive's income; guard / out:
// + its guard's minimum and + hordes out at once; boss: Wallbreakers need one (HIVE.BOSS_DEN); elite: the special
// dead are elite; spire: the screamer spire. danger: how much the autopilot wants it gone (hivetech.js).
export const GROWTHS = {
  pit:      { name: "Biomass pit",     tier: 0, cost: 12, days: 10, max: 2, income: 1, danger: 1,
              desc: "A pit of rotting flesh the hive feeds on: +1 resource a day." },
  brood:    { name: "Brood chamber",   tier: 0, cost: 20, days: 15, max: 1, guard: 40, out: 1, outTier: 2, danger: 2,
              desc: "Swollen sacs where the dead are kept: the hive's guard is 40 bigger, and once the hive has evolved to tier 2 one more of its hordes can be out." },
  feeding:  { name: "Feeding grounds", tier: 1, cost: 25, days: 20, max: 1, incomeMult: 1.5, danger: 1.5,
              desc: "A field of bones and offal: the hive's income is half again as much." },
  warren:   { name: "Runner warren",   tier: 1, cost: 25, days: 20, max: 1, unlocks: "runner", danger: 2.5,
              desc: "Tunnels the fast dead nest in: the hive's hordes bring runners." },
  brutepit: { name: "Brute pit",       tier: 2, cost: 35, days: 30, max: 1, unlocks: "brute", danger: 3.5,
              desc: "A pit where the dead are fed until they swell: the hive's hordes bring brutes that batter walls." },
  sac:      { name: "Spitter sac",     tier: 2, cost: 35, days: 30, max: 1, unlocks: "spitter", danger: 3,
              desc: "Bloated bladders of acid: the hive's hordes bring spitters that hit you behind cover." },
  spire:    { name: "Screamer spire",  tier: 3, cost: 40, days: 40, max: 1, unlocks: "screamer", spire: true, danger: 3.5,
              desc: "A shrieking tower of fused bodies: the hive's hordes bring screamers, it attacks bases from farther away and calls wandering dead in." },
  burrow:   { name: "Crawler burrow",  tier: 3, cost: 40, days: 40, max: 1, unlocks: "crawler", danger: 4,
              desc: "Holes the legless dead crawl out of: the hive's hordes bring crawlers that slip past walls." },
  den:      { name: "Wallbreaker den", tier: 3, cost: 50, days: 45, max: 1, boss: true, danger: 5,
              desc: "A cave of bone where Wallbreakers are grown: the hive can raise Wallbreakers." },
  vat:      { name: "Mutation vat",    tier: 4, cost: 60, days: 60, max: 1, elite: true, danger: 4.5,
              desc: "A boiling vat of flesh: the hive's special dead are elite (tougher and harder hitting)." },
  // The Shepherd (SHEPHERD below): the late game's answer to decoys and fire. Tier 3 opens around game year 10
  // (TIER_DAY[3] = day 1100); a hive weighs it like its other late spawners.
  fold:     { name: "Shepherd's fold", tier: 3, cost: 45, days: 45, max: 1, unlocks: "shepherd", danger: 4.5,
              desc: "A ring of standing bodies around one that watches: the hive's hordes are led by Shepherds that are not fooled by decoys or fire." },
};

// The Shepherd: a smarter dead thing that keeps behind its pack (KEEP tiles from your people), steps around fire,
// and herds the dead within AURA tiles: they ignore decoys and fire, go for the living, the breaches and the gate a
// ram is battering, and keep together. Kill it and the aura ends. On the State Map a horde led by one turns for a
// decoy (a fire, decoys from the armory) only DECOY_CUT as often, and the warning card says so.
export const SHEPHERD = { AURA: 4, KEEP: 6, DECOY_CUT: 0.3, YEAR: 10 };
// What the dead follow (decoys.js): noise (bottles, noise makers, firecrackers, an alarm clock, a radio, gunfire),
// light (a flare, fire, floodlights) and heat (hand warmers, a heat pack, a flare, fire). The ordinary dead follow
// noise and light; each special kind has its own (ZTYPES senses); Wallbreakers and Broodmothers follow nothing.
export const SENSES = { ordinary: ["noise", "light"], boss: [] };

// The special dead (zombietypes.js on the battle map; hives.js, hordes.js, defences.js on the State Map).
// Battle: hp and dmg × an ordinary zombie's of the same power, aim + its melee aim, mob tiles per action, armor ×
// the damage it takes. Map: share = its part of a horde from a hive that breeds it; wall = how hard each one presses
// the walls (× against the hold limit); weight = its worth in a fight resolved by the numbers and in a horde's
// strength. special / counter: shown in the game (tile panel, Help).
// senses: what decoys and fire pull it toward (decoys.js; SENSES.ordinary for the rest). burn: × the fire's damage.
export const ZTYPES = {
  runner:   { name: "Runner",   short: "R", hp: 0.85, dmg: 1.0, aim: 5, mob: 6, armor: 1, share: 0.15, wall: 0.9, weight: 1.15, speed: 1.25, senses: ["noise"],
              special: "Very fast: crosses the battle map in a turn; hordes with many of them move a quarter faster. Follows noise.",
              counter: "Walls and overwatch: behind walls they are just more of the dead. A noise decoy pulls them off." },
  brute:    { name: "Brute",    short: "B", hp: 2.4, dmg: 1.5, aim: 5, mob: 2.5, armor: 0.75, share: 0.08, wall: 2.5, weight: 2.2, smash: 0.6, smashEvery: 12, senses: ["noise"], burn: 0.6,
              special: "Huge and slow, shrugs off a quarter of every hit and smashes barricades and walls in its way; every dozen in a horde smashes a defence like a Wallbreaker. Follows noise; fire hurts it less.",
              counter: "Armor against its blows, heavy guns at range, spike pits and trenches." },
  spitter:  { name: "Spitter",  short: "S", hp: 0.9, dmg: 1.0, aim: 0, mob: 3, armor: 1, share: 0.08, wall: 1.4, weight: 1.5, spitAim: 50, priority: 1.6, keep: 4, cooldown: 2, pierce: 1, senses: ["noise", "light"],
              special: "Spits acid up to 6 tiles away every other turn; cover counts one step less against it.",
              counter: "Smoke, shooting it first from range, rushing it." },
  screamer: { name: "Screamer", short: "Sc", hp: 0.8, dmg: 0.6, aim: 0, mob: 3, armor: 1, share: 0.03, wall: 1.2, weight: 2.0, priority: 2.5, keep: 5, every: 2, calls: [1, 2], callMax: 6, pull: 3, pullOdds: 0.3, senses: [],
              special: "Hangs back and shrieks every other turn, calling more of the dead in from the edge (up to 6 a battle); on the map its horde pulls wandering dead in. Ignores decoys.",
              counter: "Kill it first: the calling stops when it dies." },
  crawler:  { name: "Crawler",  short: "C", hp: 0.8, dmg: 1.2, aim: 10, mob: 3, armor: 1, share: 0.06, wall: 0.5, weight: 1.3, reveal: 2.5, ambush: 1.6, slip: 0.6, senses: ["heat"],
              special: "Low in the grass: unseen until it is within 2 tiles, in light or has struck, and its first bite hits hard. At the walls some slip past and attack inside. Follows heat.",
              counter: "Watchtowers and floodlights (they see them coming), flares, keeping your people together. Hand warmers and heat packs pull them out of hiding." },
  shepherd: { name: "Shepherd", short: "Sh", hp: 1.6, dmg: 0.8, aim: 0, mob: 3, armor: 0.85, share: 0.02, wall: 1.6, weight: 2.6, priority: 3, keep: SHEPHERD.KEEP, senses: [], aura: SHEPHERD.AURA,
              special: `Stays behind its pack and steps around fire. The dead within ${SHEPHERD.AURA} tiles of it ignore decoys and fire, go for the living and the breaches, and keep together.`,
              counter: "Kill it first, at range: the aura ends with it. Until then decoys and fire are wasted on its pack." },
};
