// Crashlanding (sim/crashmode.js, sim/crashstart.js; 2026-10-24, the user's request: "Add a new scenario start to the
// Normal Hardcore Custom called Crashlanding ... sole surviving member of a fallen helicoptor ... 3 year after the fall
// of calder ... The map is 500x250 tiles ... the base the survivor needs to get to has to be on the other side diagonal
// to the crashsite ... There is no starting base ... heat will be up due to the loudness of the crash ... military gear,
// a broken military radio ... You do not start with a vehicle"; the base overrun by a hive, its stores the hive's
// prize, the message in the wreckage and the secret mountain bunker; most cars beyond repair, little fuel to siphon).
//   1. a crash world on two seeds: the 300 × 200 grid (CRASH.W × H, the Large preset's; it was 500 × 250 until the user's
//      "reduce map size to 300x200 for crashlanding mode", 2026-10-24), year 4 day 1, one survivor (a soldier) with the exact kit and the
//      broken radio, no vehicle, no base, the party on the crash tile with the wreck known and the tile hot, the unit's
//      base known in the fog as a Guard base (no hive, no group) in the opposite quadrant and far, its marker, the
//      bunker's tile bare and unknown, the hives pre-aged, the era a tier ahead of a plain world's, the loot scaled;
//   2. the chain: the reveal when a team stands on the base (card, harder dead, no victory), the hive born once it leaves
//      (the infested-base sprite flag), the hive's hoard holding the base's stores once, the hive's death leaving the
//      message (a region, not a name) and making the bunker as a secret site with the unit's remnant in it (a military
//      group, unknown until found), the bunker found by a team standing on it: the Reunited card and its three choices
//      (join them: a victory, Keep playing with them in the coalition; take command: the bunker and its people yours,
//      the group dissolved; not yet: an allied group, the choice again on the next arrival);
//   3. the radio repaired in the field with a soldering iron, pliers and the materials: a Military encrypted radio,
//      state.crash.radioFixed and the dead-air line;
//   4. crew edits apply name, skills and traits but never the kit; Pick start on map moves the crash and the base;
//   5. the cars' rule (crashCarDead, crashSiphon) and a save/load round trip keeping state.crash.
// Plain Normal, Custom and Hardcore worlds on a seed are compared to a saved baseline by the lead's script (the test
// cannot hold the old JSON); a crash world ticks a day here.
// Usage: node tools/crashlandingtest.js   (three 300 × 200 worlds)
import { createWorld, tickHour, day } from "../src/sim/world.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { CRASH, CRASH_PEOPLE, CRASH_KIT, isCrashRun, crashSpecials, crashTierBonus } from "../src/sim/crashmode.js";
import { crashHour, crashCarDead, crashSiphon } from "../src/sim/crashstart.js";
import { yearStartDay } from "../src/sim/eras.js";
import { eraTier } from "../src/sim/hivetech.js";
import { tileHeat } from "../src/sim/pois.js";
import { siteKnown } from "../src/sim/discovery.js";
import { fieldCraft, fieldCraftOptions, CRAFTS } from "../src/sim/crafting.js";
import { hiveHoard } from "../src/sim/hivecrawl.js";
import { destroyHive } from "../src/sim/hives.js";
import { newItem, rigPouches } from "../src/sim/inventory.js";
import { startWhyNot } from "../src/sim/startpick.js";
import { MARKER_TYPES, LAYER_OF } from "../src/sim/markers.js";
import { GEAR, LOCATIONS } from "../src/sim/data.js";
import { CRAFT_TOOLS } from "../src/sim/data-tools.js";
import { siteDeadMix } from "../src/sim/deadsoldiers.js";
import { archetypeOf } from "../src/sim/hardcore-start.js";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const t0 = Date.now();
const quadrant = (g, id) => { const [x, y] = g.xy(id); return (x * 2 >= g.width - 1 ? 1 : 0) + (y * 2 >= g.height - 1 ? 2 : 0); };
const keysOn = (s) => [...Object.values(s.gear).filter(Boolean).map((it) => it.key), ...s.pockets.filter(Boolean).map((it) => it.key), ...(rigPouches(s) || []).filter(Boolean).map((it) => it.key)];
const count = (list, k) => list.filter((x) => x === k).length;
const lootSum = (s, skip = -1) => s.tiles.reduce((a, t) => a + (t.id === skip ? 0 : t.loot || 0), 0);

section("0. The leaf module");
check(CRASH.W === 300 && CRASH.H === 200 && CRASH.YEAR === 4, "CRASH: 300 × 200, year 4");
check(CRASH_PEOPLE.MIN === 1 && CRASH_PEOPLE.MAX === 1 && CRASH_PEOPLE.DEF === 1, "one survivor");
check(CRASH_KIT.weapon === "m4" && CRASH_KIT.sidearm === "pistol" && CRASH_KIT.pack.includes("milradio_broken"), "the kit's keys");
check(!isCrashRun(null) && !isCrashRun({ mode: "normal" }) && isCrashRun({ mode: "normal", crash: {} }) && !isCrashRun({ mode: "hardcore", crash: {} }), "isCrashRun");
check(crashSpecials({ mode: "normal" }) === 1 && crashSpecials({ mode: "normal", crash: {} }) === CRASH.SPECIALS && crashTierBonus({ mode: "normal", crash: {} }) === CRASH.TIER_BONUS, "crashSpecials / crashTierBonus");
check(GEAR.milradio_broken && GEAR.milradio_broken.radio && !GEAR.milradio_broken.listen && !GEAR.milradio_broken.dur, "the broken radio: radio: true, no listen, no durability");
check(CRAFTS.milradio && CRAFTS.milradio.gear === "milradio" && CRAFTS.milradio.gearIn.milradio_broken === 1 && CRAFTS.milradio.field && CRAFTS.milradio.min === 3 && CRAFTS.milradio.skill === "mechanics", "the repair recipe");
check(CRAFT_TOOLS.milradio.includes("solder") && CRAFT_TOOLS.milradio.includes("pliers"), "the recipe's tools: a soldering iron and pliers");
check(LOCATIONS.bunker_mil && LOCATIONS.bunker_mil.known === "secret" && LOCATIONS.bunker_mil.cat === "special", "the bunker site type is secret");
check(MARKER_TYPES.crashhome && LAYER_OF.crashhome, "the crashhome marker type");
check(archetypeOf(null, "soldier") && archetypeOf(null, "soldier").name === "Guard trooper", "the soldier background");
check(crashCarDead({ mode: "normal", crash: {} }, 0.5) && !crashCarDead({ mode: "normal", crash: {} }, 0.1) && !crashCarDead({ mode: "normal" }, 0.9), "crashCarDead: only in a crash run, above CRASH.CAR_FIX");
check(crashSiphon({ mode: "normal", crash: {} }, 20) === Math.floor(20 * CRASH.SIPHON) && crashSiphon({ mode: "normal" }, 20) === 20, "crashSiphon: × CRASH.SIPHON in a crash run");

const worlds = {};
for (const seed of [7, 11]) {
  section(`1. A crash world, seed ${seed}`);
  const t1 = Date.now();
  const s = createWorld({ seed, factionCount: 7, crash: true });
  worlds[seed] = s;
  console.log(`  created in ${Date.now() - t1} ms`);
  const g = s.grid, C = s.crash;
  check(s.mode === "normal" && isCrashRun(s) && s.worldSize === "large" && g.width === CRASH.W && g.height === CRASH.H, `a normal-mode world on the ${CRASH.W} × ${CRASH.H} grid, the Large preset's (worldSize ${s.worldSize})`);
  check(s.hour === (yearStartDay(4) - 1) * 24 + 6 && day(s) === yearStartDay(4), `year 4, day 1 at 06:00 (hour ${s.hour}, day ${day(s)})`);
  check(s.survivors.length === 1 && s.startPeople === 1 && s.survivors[0].background === "soldier" && s.survivors[0].leader, "one survivor, a soldier, the leader");
  const sv = s.survivors[0], on = keysOn(sv);
  check(sv.gear.weapon?.key === "m4" && sv.gear.sidearm?.key === "pistol" && sv.gear.rig?.key === "chestrig" && sv.gear.armor?.key === "plate" && sv.gear.head?.key === "milhelmet" && sv.gear.tool?.key === "traumakit", `the fixed kit worn (${on.join(", ")})`);
  check(count(on, "mag_stanag_30") === CRASH.STANAG_MAGS && count(on, "mag_glock_15") === CRASH.GLOCK_MAGS && count(on, "tourniquet") === 1 && count(on, "milradio_broken") === 1, "spare magazines, a tourniquet and the broken radio carried");
  check(!sv.gear.backpack && sv.gear.armor.contents?.every((x) => !x || x.key === "ceramicplate") !== false, "no pack; the plate carrier as newItem makes it");
  check(s.vehicles.length === 0 && s.fleet.length === 0 && s.startVehicles === false, "no vehicle");
  check(s.bases.length === 0, "no base");
  check(s.parties.length === 1 && s.parties[0].exile && s.parties[0].homeBaseId == null && s.parties[0].path[0] === C.tile && s.parties[0].phase === "waiting" && s.parties[0].members[0] === sv.id, "the party on the crash tile, waiting for orders, no home base");
  const sup = s.parties[0].supplies;
  check(sup.water === CRASH.WATER && sup.a_556_fmj >= CRASH.RIFLE_ROUNDS && sup.a_556_fmj <= CRASH.RIFLE_ROUNDS + 30 && sup.a_9mm_fmj >= CRASH.PISTOL_ROUNDS && sup.a_9mm_fmj <= CRASH.PISTOL_ROUNDS + 15 && sup.meds === CRASH.MEDS && sup.f_mre > 0, `the party's supplies: water, ${sup.a_556_fmj} + ${sup.a_9mm_fmj} rounds beyond the guns and magazines, meds, MREs`);
  const mags = (rigPouches(sv) || []).filter((it) => it && /^mag_/.test(it.key));
  const loaded = (it) => !!(it && ((it.loaded && it.loaded.n > 0) || (Array.isArray(it.stack) && it.stack.length)));
  check(loaded(sv.gear.weapon) && loaded(sv.gear.sidearm) && mags.length === CRASH.STANAG_MAGS + CRASH.GLOCK_MAGS && mags.every(loaded), `the guns and the ${mags.length} spare magazines loaded (gunload.js item.loaded)`);
  const wt = s.tiles[C.tile];
  check(wt.loc && wt.loc.type === "crash_mil" && wt.loc.crash === 1 && wt.loot === CRASH.WRECK_LOOT && s.crashes.length === 1 && s.crashes[0].found && s.knowledge[C.tile], "the heli wreck on the tile, found and known, rich");
  check(s.crashes[0].expires > s.hour + 6 * 24 && s.crashes[0].expires <= s.hour + 10 * 24, "the wreck burns out in 7–10 days");
  check(tileHeat(s, C.tile) >= CRASH.HEAT, `the crash tile hot (${tileHeat(s, C.tile)})`);
  const ht = s.tiles[C.homeTile], hk = s.knowledge[C.homeTile];
  check(ht.loc && ht.loc.type === "military" && s.militaryIds.includes(C.homeTile) && hk && hk.hive === false && hk.factionBase == null && !ht.hive, "the unit's base: a Guard base known in the fog, no hive, no group");
  check(!s.factions.some((f) => f.bases.includes(C.homeTile)), "no group holds the base");
  const diag = g.distance(0, g.width * g.height - 1), d = g.distance(C.tile, C.homeTile);
  const [cx, cy] = g.xy(C.tile), [hx, hy] = g.xy(C.homeTile);
  check((cx - (g.width - 1) / 2) * (hx - (g.width - 1) / 2) < 0 && (cy - (g.height - 1) / 2) * (hy - (g.height - 1) / 2) < 0, `the base in the opposite quadrant (crash ${cx},${cy}; base ${hx},${hy})`);
  check(d >= CRASH.FAR * diag, `the base ${d} tiles away (at least ${Math.ceil(CRASH.FAR * diag)} of a ${diag} diagonal)`);
  const m = s.markers.find((x) => x.type === "crashhome");
  check(m && m.tile === C.homeTile && /3rd Guard Battalion/.test(m.label), `the marker on the base (${m && m.label})`);
  check(C.nextTile != null && !s.tiles[C.nextTile].loc && !(s.tiles[C.nextTile].pois || []).length && !s.knowledge[C.nextTile] && !siteKnown(s, C.nextTile), "the bunker's tile: nothing on it, nothing known");
  check(C.nextTile != null && g.distance(C.nextTile, C.homeTile) >= CRASH.BUNKER_FAR * diag && quadrant(g, C.nextTile) !== quadrant(g, C.tile) && quadrant(g, C.nextTile) !== quadrant(g, C.homeTile), "the bunker far from the base, in a quadrant of its own");
  check(s.hives.length > 0 && s.hives.every((h) => h.born <= s.hour - CRASH.HIVE_AGE_DAYS * 24), `the ${s.hives.length} hives pre-aged`);
  check(s.factions.length === 7, "7 AI groups");
  check(s.crashNext > s.hour + 7 * 24, "the next crash event scheduled from this day, not day 1");
  check(/Year 4, three years after Calder fell/.test(s.log[s.log.length - 1].text) || s.log.some((l) => /Year 4, three years after Calder fell/.test(l.text)), "the start's log line says year 4");
  check(s.cards.some((c) => c.intro && /helicopter|shot down/.test(c.text)), "the opening card");
  check(s.chronicle && s.chronicle.events[0] && new RegExp(`Day ${yearStartDay(4)}\\.`).test(s.chronicle.events[0].text), `the chronicle's first caption says day ${yearStartDay(4)}`);
}

section("2. Plain world on the same seed: the era, the loot");
{
  const s = worlds[7];
  const t1 = Date.now();
  const plain = createWorld({ seed: 7, factionCount: 7, size: "custom", customW: CRASH.W, customH: CRASH.H });
  console.log(`  plain ${CRASH.W} × ${CRASH.H} created in ${Date.now() - t1} ms`);
  check(eraTier(s) > eraTier(plain), `eraTier ${eraTier(s)} in the crash run, ${eraTier(plain)} in the plain one`);
  const ratio = lootSum(s, s.crash.tile) / lootSum(plain);
  check(ratio > CRASH.LOOT * 0.9 && ratio < CRASH.LOOT * 1.15, `the tiles' loot about × ${CRASH.LOOT} of a plain world's (${ratio.toFixed(3)})`);
  check(plain.hour === 6 && !isCrashRun(plain) && plain.bases.length === 1, "the plain custom world is as it was");
}

section("3. The chain: the reveal, the hive, the hoard, the message, the bunker");
{
  const s = worlds[7], C = s.crash, p = s.parties[0], g = s.grid;
  crashHour(s);
  check(!C.revealed && !C.hiveBorn, "nothing happens while the team is at the wreck");
  p.path = [C.homeTile]; p.idx = 0; // the team arrives at the base
  crashHour(s);
  check(!!C.revealed, "standing on the base reveals it");
  check(s.cards.some((c) => c.crashReveal && /hive/.test(c.text)), "the reveal card");
  check(!s.victory && !s.gameOver, "no victory");
  const mix = siteDeadMix(s, C.homeTile);
  check(mix && mix.soldier >= 0.6, `harder dead: dead soldiers at ${mix && mix.soldier}`);
  check(s.tiles[C.homeTile].infection >= CRASH.HOME_INFECTION && tileHeat(s, C.homeTile) >= CRASH.HOME_HEAT && s.tiles[C.homeTile].loot >= CRASH.HOME_LOOT, "the base's tile: infection and heat up, supplies left to scavenge");
  check(/silent/.test(s.markers.find((x) => x.type === "crashhome").label), "the marker relabelled");
  crashHour(s);
  check(!C.hiveBorn && !s.tiles[C.homeTile].hive, "no hive while the team stands there");
  p.path = [g.neighbors(C.homeTile)[0]]; p.idx = 0; // the team leaves
  crashHour(s);
  const hive = s.hives.find((h) => h.tile === C.homeTile);
  check(!!C.hiveBorn && hive && hive.crashBase && s.tiles[C.homeTile].hive && s.tiles[C.homeTile].hiveBase && s.tiles[C.homeTile].loc && s.tiles[C.homeTile].loc.look === "hivebase", "the hive born once the team left; the tile flagged for the infested sprite");
  check(/overrun/.test(s.markers.find((x) => x.type === "crashhome").label), "the marker says overrun");
  check(!s.tiles[C.nextTile].loc && !s.knowledge[C.nextTile], "the bunker still does not exist");
  // The hoard (hivecrawl.js hiveHoard: the team's crawl reads it when the Hivemind dies).
  const h = hiveHoard(s, hive);
  const rounds = Object.entries(h.supplies).filter(([k]) => /^a_/.test(k)).reduce((a, [, q]) => a + q, 0);
  check(rounds >= CRASH.HAUL.rounds && h.supplies.meds >= CRASH.HAUL.meds && h.supplies.fuel >= CRASH.HAUL.fuel && h.supplies.f_mre > 0 && h.supplies.electronics >= CRASH.HAUL.electronics, `the hoard holds the base's stores (${rounds} rounds, ${h.supplies.meds} meds, ${h.supplies.fuel} fuel)`);
  check(h.gear.length >= CRASH.HAUL.guns + CRASH.HAUL.armour && h.gear.some((it) => ["m4", "ar", "carbine", "dmr", "lmg"].includes(it.key)) && h.gear.some((it) => it.key === "plate" || it.key === "milhelmet"), `military guns and armour in it (${h.gear.length} items)`);
  check(!!C.hiveLooted, "paid once: hiveLooted set");
  const h2 = hiveHoard(s, hive);
  check(h2.gear.length < h.gear.length && (Object.entries(h2.supplies).filter(([k]) => /^a_/.test(k)).reduce((a, [, q]) => a + q, 0)) < rounds, "a second hoard is an ordinary hive's");
  check(s.log.some((l) => /stores of .* are the prize/.test(l.text)), "the haul's log line");
  destroyHive(s, hive, "by your team");
  check(!s.hives.includes(hive) && !s.tiles[C.homeTile].hive && !s.tiles[C.homeTile].hiveBase && C.stage === "trail", "the hive destroyed: stage trail");
  const trailCard = s.cards.find((c) => c.crashTrail);
  check(trailCard && /mountains|high country/.test(trailCard.text) && !trailCard.text.includes(C.nextName) && !/\d+ tiles/.test(trailCard.text), "the message names a region, not the site, no distance");
  check(C.trail && /falling back/.test(C.trail) && s.markers.find((x) => x.type === "crashhome").info.trail === C.trail && /fell back to/.test(s.markers.find((x) => x.type === "crashhome").label), "the words kept on the marker");
  const nt = s.tiles[C.nextTile];
  check(nt.loc && nt.loc.type === "bunker_mil" && nt.loc.name === C.nextName && nt.loot === CRASH.BUNKER_LOOT && (nt.pois || []).length > 0, "the bunker made on its tile with its points of interest");
  check(!siteKnown(s, C.nextTile) && !s.knowledge[C.nextTile] && !s.markers.some((x) => x.tile === C.nextTile), "the bunker is secret: not known, no marker");
  check(!s.victory && !s.gameOver, "still no victory");
  // The unit's remnant at the bunker (the user, 2026-10-24: "Make the bunker hold the unit's remnant so you can join them
  // and you can decide to end the run or take over controlling that base").
  const rem = s.factions.find((f) => f.crashRemnant);
  check(rem && rem.id === C.remnantFid && rem.alive && rem.type === "military" && rem.bases[0] === C.nextTile, "the remnant: a military group at the bunker");
  check(rem && !rem.known && !s.knowledge[C.nextTile] && !s.markers.some((x) => x.tile === C.nextTile), "unknown until found: no knowledge, no marker");
  check(rem && rem.people && rem.people.length >= 6 && rem.people.length <= 10 && rem.pop === rem.people.length && rem.arsenal && rem.arsenal.items.length >= rem.people.length, `${rem && rem.people.length} people, their kit in the group's arsenal (${rem && rem.arsenal && rem.arsenal.items.length} items)`);
  check(rem && rem.stock.ammo >= CRASH.CACHE.rounds && rem.stock.meds >= CRASH.CACHE.meds && rem.stock.fuel >= CRASH.CACHE.fuel, "the cache as its stock");
  check(rem && rem.hcNoExpand && rem.hcNoGrow && rem.goodwill === 0, "sealed off: no expansion, no growth, neutral");
  // A fresh copy for the "Take command" branch (save.js refuses a pending card: the cards are answered first).
  const cardsBefore = s.cards; s.cards = [];
  const cmd = loadFromString(saveToString(s));
  s.cards = cardsBefore;
  const survivorsBefore = s.survivors.length;
  p.path = [C.nextTile]; p.idx = 0;
  crashHour(s);
  check(C.stage === "found" && !!C.found, "a team on the bunker's tile finds it");
  let card = s.cards.find((c) => c.crashReunited);
  check(card && card.title === "Reunited" && card.choices.length === 3 && /Join them/.test(card.choices[0].label) && /Take command/.test(card.choices[1].label) && /Not yet/.test(card.choices[2].label), "the Reunited card with its three choices");
  check(rem.known && rem.goodwill >= 70 && s.knowledge[C.nextTile] && s.markers.some((x) => x.tile === C.nextTile && /remnant/.test(x.label)), "the remnant known and allied, the bunker marked");
  check(siteKnown(s, C.nextTile), "the bunker a known, raidable site");
  // 3. Not yet: still allied, the choice comes again on the next arrival.
  const notYet = card.choices[2].resolve(s);
  s.cards = s.cards.filter((c) => c !== card);
  check(/ally/.test(notYet) && C.stage === "found" && rem.alive && rem.known && rem.goodwill >= 70 && !s.victory, "Not yet: an allied known group, no victory");
  crashHour(s);
  check(!s.cards.some((c) => c.crashReunited), "no second card while the team stays");
  p.path = [g.neighbors(C.nextTile)[0]]; p.idx = 0; crashHour(s);
  p.path = [C.nextTile]; p.idx = 0; crashHour(s);
  card = s.cards.find((c) => c.crashReunited);
  check(!!card, "the choice is offered again on the next arrival");
  // 1. Join them: the run ends as a victory; Keep playing goes on with the remnant in the coalition.
  const joined = card.choices[0].resolve(s);
  s.cards = s.cards.filter((c) => c !== card);
  check(/made it back/.test(joined) && s.victory && s.gameOver && s.victoryReason === "reunited" && C.stage === "joined", "Join them: the victory set (reason reunited)");
  check(s.alliance && s.alliance.members.includes(rem.id) && rem.alive && rem.known, "the remnant in the coalition");
  check(s.log.some((l) => /^You made it back\./.test(l.text)), "the victory's log line");
  s.victoryKept = true; s.gameOver = false; // main.js keepplaying
  tickHour(s);
  check(!s.gameOver && s.survivors[0].alive && rem.alive, "Keep playing: the game goes on");
  // 2. Take command (on the fresh copy): the bunker is your base, their people yours, the group gone.
  {
    const C2 = cmd.crash, p2 = cmd.parties[0], rem2 = cmd.factions.find((f) => f.crashRemnant), n0 = cmd.survivors.length, popWas = rem2.pop;
    check(rem2 && !rem2.known && cmd.bases.length === 0, "the copy: the remnant unknown, no base of yours");
    p2.path = [C2.nextTile]; p2.idx = 0;
    crashHour(cmd);
    const card2 = cmd.cards.find((c) => c.crashReunited);
    check(!!card2, "the copy's Reunited card");
    const text2 = card2.choices[1].resolve(cmd);
    const base = cmd.bases.find((b) => b.tile === C2.nextTile);
    check(!!base && base.type === "hub" && /yours/.test(text2), `Take command: the bunker is your base (${base && base.type})`);
    check(C2.stage === "command" && C2.remnantJoined === popWas, "stage command, the people counted");
    const joinedPeople = cmd.survivors.slice(n0);
    check(cmd.survivors.length === n0 + popWas && joinedPeople.every((x) => x.alive && x.location.kind === "base" && x.location.baseId === base.id) && joinedPeople.filter((x) => x.gear && x.gear.weapon).length >= Math.min(popWas, 4), `${popWas} people joined your survivors at the base, ${joinedPeople.filter((x) => x.gear && x.gear.weapon).length} of them armed from the arsenal`);
    check(base.armory.length > 0 || joinedPeople.some((x) => x.gear.weapon), "the arsenal's kit: on the people or in the bunker's armory");
    check(!rem2.alive && !cmd.factions.some((f) => f.alive && f.bases.includes(C2.nextTile)), "the remnant dissolved");
    check(base.stock.ammo >= CRASH.CACHE.rounds * 0.95 && base.stock.meds >= CRASH.CACHE.meds && base.stock.fuel >= CRASH.CACHE.fuel, `the stores whole (${base.stock.ammo} rounds, ${base.stock.meds} meds)`);
    check(!cmd.parties.includes(p2) && cmd.survivors[0].location.kind === "base" && cmd.survivors[0].location.baseId === base.id, "the team moved in");
    check(!cmd.victory && !cmd.gameOver, "no victory for taking command");
    check(cmd.cards.some((c) => c.crashCommand), "the confirming card");
    cmd.cards = [];
    tickHour(cmd);
    check(!cmd.gameOver, "an hour passes at the bunker");
  }
}

section("4. The radio repaired in the field");
{
  const s = worlds[11], p = s.parties[0], sv = s.survivors[0];
  sv.skills.mechanics = 5;
  let opt = fieldCraftOptions(s, p).find((o) => o.key === "milradio");
  check(opt && !opt.ok && /Needs/.test(opt.reason), `not yet: ${opt && opt.reason}`);
  p.supplies.electronics = 2; p.supplies.parts = 1; p.supplies.scrap = 2;
  p.cargo.gear.push(newItem("solderiron"), newItem("toolkit"));
  opt = fieldCraftOptions(s, p).find((o) => o.key === "milradio");
  check(opt && opt.ok, `with a soldering iron, pliers and the materials: ${opt && (opt.ok ? "ok" : opt.reason)}`);
  const text = fieldCraft(s, p, "milradio");
  const on = keysOn(sv).concat(p.cargo.gear.map((it) => it.key));
  check(on.includes("milradio") && !on.includes("milradio_broken"), `the broken set becomes a Military encrypted radio (${text})`);
  check(!!s.crash.radioFixed && !!s.crash.deadAir && s.log.some((l) => /dead air/.test(l.text)), "radioFixed set; the unit's frequency is dead air (one log line)");
  check(p.supplies.electronics === 0 && p.supplies.parts === 0 && p.supplies.scrap === 0, "the materials used");
}

section("5. Crew edits and Pick start on map");
{
  const s = worlds[11];
  const t1 = Date.now();
  const corner = (t) => t.x > s.grid.width * 0.8 && t.y > s.grid.height * 0.9; // the south-east corner of the map (x > 400, y > 180 when it was 500 × 250)
  const open = s.tiles.find((t) => t.terrain === "plains" && !t.loc && !t.hive && corner(t) && !startWhyNot(s, t.id)) || s.tiles.find((t) => t.terrain !== "water" && t.terrain !== "mountain" && !t.loc && !t.hive && corner(t));
  const crew = [{ name: "Dana Cole", skills: { farming: 9 }, traits: ["brave"], gear: { weapon: { key: "knife" }, armor: null }, startGear: { weapon: "huntrifle" } }];
  const s2 = createWorld({ seed: 11, factionCount: 7, crash: true, crew, start: { tile: open.id } });
  console.log(`  picked-start world created in ${Date.now() - t1} ms`);
  const sv = s2.survivors[0];
  check(sv.name === "Dana Cole" && sv.skills.farming === 9 && sv.traits.includes("brave"), "the crew edit's name, skills and traits apply");
  check(sv.gear.weapon.key === "m4" && sv.gear.armor.key === "plate" && !sv.startGear && keysOn(sv).includes("milradio_broken"), "the kit is fixed: gear and startGear picks ignored");
  check(s2.crash.tile === open.id && s2.crash.tile !== s.crash.tile, `Pick start on map moves the crash (${open.id})`);
  check(s2.crash.homeTile !== s.crash.homeTile && s2.grid.distance(s2.crash.homeTile, s2.crash.tile) > s2.grid.distance(0, s2.grid.width * s2.grid.height - 1) * 0.5, "and the base across the map from it");
  check(s2.markers.find((x) => x.type === "crashhome").tile === s2.crash.homeTile, "the marker follows");
  check(!startWhyNot(s2, s2.tiles.find((t) => t.terrain === "plains" && !t.hive && !t.loc).id), "Pick start: any open land (the Hardcore rule)");
}

section("6. Save and load, and a day");
{
  const s = worlds[11];
  const t1 = Date.now();
  s.cards = []; // the game answers the cards before a save (save.js refuses a card's choices)
  const back = loadFromString(saveToString(s));
  console.log(`  round trip in ${Date.now() - t1} ms`);
  check(isCrashRun(back) && back.mode === "normal" && JSON.stringify(back.crash) === JSON.stringify(s.crash), "state.crash survives a save and load");
  check(back.tiles[back.crash.homeTile].loc.type === "military" && back.grid.width === CRASH.W && back.hour === s.hour, "the base's site, the grid and the hour too");
  check(back.markers.some((m) => m.type === "crashhome") && back.survivors[0].background === "soldier", "the marker and the background too");
  const t2 = Date.now();
  for (let h = 0; h < 24; h++) tickHour(s);
  console.log(`  a day ticked in ${Date.now() - t2} ms`);
  check(!s.gameOver && s.survivors[0].alive, "a day passes without a crash");
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
