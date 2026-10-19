// AI parity, part two (groupcare.js has the wounded, repairs, hunger, desertion and the type profiles): what the groups
// know, the vehicles they take, trade and fit out, and the bases left empty that they move into. Coarse, once a day per
// group (factions.js factionsDaily), hashed dice only (skills.js hash01) except a card's own choices.
//
// Knowledge (f.knows = { bases: { tile: { kind: "player" | "group", id, def, walls, value, day } }, reach }; value: your
// base's stores as they saw them, for a war for loot, playerwars.js; a bloc's members share all of it, blocs.js). What a
// group knows of your bases is what it has scouted (user, 2026-10-08: "how far away they know your bases: as far as
// they have scouted"), not a fixed radius: reach is how far out from its bases its scouts have been. It starts at
// KNOW.REACH0 (its home ground: your bases there are known from the start; the other groups' bases within KNOW.START,
// they were neighbours before you came); each scouting trip (KNOW.SCOUT a day × its profile's patrol, raid-minded
// types × raid) either pushes the frontier KNOW.STEP tiles further (KNOW.EXPLORE of the trips while it is short of
// KNOW.RANGE: every base in the new ring is found) or looks again at the least known base within reach (one not yet
// seen first: a base you built there since). It also learns by its parties on the road (parties.js aiPartyHour: raids,
// scavengers, convoys and caravans see your bases within KNOW.PASS of their way, and the one they visit), its
// scavenging parties (bases within KNOW.SEE of the site they worked), questioning the people of yours it holds (all
// your bases, every KNOW.QUESTION days), its bloc (blocs.js shareIntel) and the radio (radioGossip: every
// KNOW.RADIO.EVERY days a group hears what a friend of its knows of your bases: a pact or relations KNOW.RADIO.REL+,
// bases within KNOW.RADIO.RANGE, KNOW.RADIO.CHANCE a friend, and one of them on the air where the other is: a radio
// station, ai-locks). Saved with the group. def is what the base was worth when they looked (your base: its defence with
// everyone at a post; a group's: its strength), and stays what it was: a raid sized on old intel can meet new walls.
// Raids only go for bases they know (factions.js launchRaid); a group they think too strong for them (known strength
// over KNOW.AVOID × theirs) they leave alone. A scout at your base: your lookouts (watch.js lookoutsSpot) see them
// KNOW.SPOT of the time (KNOW.SPOT_WATCH with the watch manned) and you get a card: chase them off (they learn nothing),
// capture them (one of theirs gone, their gun in your armory, the scout a prisoner of yours: prisoners.js; goodwill
// falls), kill them (intel.js scoutKilled), feed them false information (intel.js scoutFalse) or let them be. A hidden
// base (hiding.js concealment) is missed by scouts and passing parties now and then, and one nothing confirms may slip
// out of what they know (hiding.js forgetDaily). Scouted (seen or not), a
// group raids you KNOW.SCOUTED × as often for KNOW.SCOUTED_DAYS days and knows your defences.
// Vehicles (f.vehicles, vehicles.js records): a group takes vehicles left on the map within VEH.TAKE_RANGE of its bases
// (yours too: a card; VEH.TAKE a day × its vehicles weight), now and then brings one home from a scavenging trip
// (VEH.FIND, wrecked: condition 25–60, repaired at its workshop: groupcare.js), steals one parked at a base of yours
// with nobody there (VEH.STEAL × steal weight; a card), or from another group (VEH.STEAL_GROUP; found out half the
// time: relations fall), sells a spare to a group that wants one (VEH.SELL; the military never sells), and with a
// workshop fits upgrades by type (VEH.FIT: raiders scrap plating, the military plate and glass, a fortress plate,
// traders mesh), paying vehicles.js upgradeCost from its stock. A machine gun in its arsenal goes on a turret.
// You can sell them a vehicle or buy one of theirs (sellVehicleTo / buyVehicleFrom: vehicles.js vehicleValue × their
// want; no trade-window section yet).
// Abandoned bases (state.abandoned): a group that dies out leaves its bases standing (works and half a share of its
// stores), and an outpost of yours that is lost or left (world.js removeBase) stays with its buildings (rec.buildings:
// the real ones, wear and damage as they stood; rec.works counts them for the groups) and ABANDON.STOCK_YOURS of what
// was left in its stores. The works decay (one level every ABANDON.DECAY days); your buildings rot the same way (one
// a period: ABANDON.ROT wear more, broken at 100, and a broken one hit again falls in). A group expanding counts an
// abandoned base nearby ABANDON.PULL × a site (more for its kind: raiders like walls, communes fields, expansionists
// anything), moves in, takes the works and the stores; yours: a card. First come, first served.
// What is inside (abandonedThreat): nobody holds an empty base, so the dead drift in (ABANDON.DEAD_BASE, + DEAD_WEEK a
// week it stands empty, + DEAD_INF × the ground's infection, at most DEAD_MAX) and, now and then, squatters (a band of
// SQUAT_N people, rolled every SQUAT_EVERY days from SQUAT_FROM days on: SQUAT a period, more for the stores left
// there; they thin the dead to SQUAT_DEAD). The same threat for everyone (AI parity): your Occupy order (occupy.js)
// fights it; a group moving in pays ABANDON.AI_LOSS of its count in people (rounded by the dice), coarse, and the group
// whose base it was (still standing elsewhere) takes it ill: relations ABANDON.FORMER_REL.
import { foodIn, takeFood, addFoodsTo, DAY_VALUE, typeGoods, groupMix } from "./foods.js"; // food paid in days
import { SUPPLIES, GEAR } from "./data.js";
import { wallTier } from "./buildings.js"; // WALL_TIERS: a base's wall by its tier
import { groupStockKey } from "./trade.js"; // a group's one count of parts (part kinds come out of it)
import { day, log, addCard, atBase, supplyValue } from "./world.js";
import { sameBloc, betray } from "./blocs.js"; // AI blocs: theft between members is betrayal
import { hash01 } from "./skills.js";
import { factionVehicles, vehicleValue, upgradesOf, upgradeCost, groupCost, VEHICLE_TYPES, TURRET_KG, TURRET_FIT, VEH_UPGRADES, WRECK, carryCargo, cargoToBase } from "./vehicles.js";
import { workshopFactor, worksAt, groupSkill, groupFreeParts } from "./groupworks.js";
import { weightOf, tickOf, fitPeople } from "./groupcare.js";
import { removeFromArsenal, issueKit, unloadVehicle } from "./arsenal.js"; // unloadVehicle: what is in a vehicle into their stores
import { relation, changeRelation, pactBetween } from "./diplomacy.js"; // changeRelation: also a group moving into another's old base
import { captivesOf } from "./conflicts.js";
import { preparedDefense, strength, recomputeOwnership } from "./factions.js";
import { lookoutsSpot } from "./watch.js";
import { vehicleDeliveriesDaily } from "./vehicletrade.js"; // vehicles bought over the radio arrive
import { HIDE, missesBase, forgetDaily } from "./hiding.js"; // hidden bases: missed by scouts and parties, forgotten
import { scoutFalse, scoutKilled, falseOdds, INTEL } from "./intel.js"; // counter-intel at the walls
import { surrenderPrisoners } from "./prisoners.js"; // a captured scout goes to the cells
import { groupNetwork, netCovers } from "./radio.js"; // ai-locks: radio gossip needs a station on the air

export const KNOW = {
  START: 18, WATCH: 12, WATCH_DAYS: 10, RANGE: 30, SCOUT: 0.06, SEE: 3, QUESTION: 7, AVOID: 1.5,
  SPOT: 0.4, SPOT_WATCH: 0.8, SCOUTED: 1.6, SCOUTED_DAYS: 12, FRESH: 3,
  // How far they have scouted (before: every base of yours within 24 tiles known from the start).
  REACH0: 10, STEP: 5, EXPLORE: 0.7, PASS: 3,
  RADIO: { EVERY: 7, REL: 25, RANGE: 30, CHANCE: 0.5 },
};
export const VEH = { TAKE_RANGE: 2, TAKE: 0.08, FIND: 0.05, STEAL: 0.01, STEAL_RANGE: 8, STEAL_GROUP: 0.004, SELL: 0.02, FIT: 0.1, FIT_EVERY: 10, PER: 15 };
export const ABANDON = {
  DECAY: 30, PULL: 3, STOCK: 0.5,
  LIKED: 1.5,       // × the pull of one with the works its type likes (GROUP_PRIORITIES likes)
  STOCK_YOURS: 0.5, // of what was left in a lost outpost's stores (water drains away)
  ROT: 40,          // wear a building of yours left standing takes each DECAY period (broken at 100)
  DEAD_BASE: 2, DEAD_WEEK: 1, DEAD_INF: 6, DEAD_MAX: 12, DEAD_POWER: 2, DEAD_POWER_INF: 3, // the dead inside (power as scavenge.js: 2 + infection × 3)
  SQUAT: 0.2, SQUAT_STOCK: 0.1, SQUAT_STOCK_PER: 100, SQUAT_MAX: 0.5, SQUAT_FROM: 5, SQUAT_EVERY: 10, SQUAT_N: [2, 5], SQUAT_POWER: 3.5, SQUAT_DEAD: 0.5,
  THIN_DAYS: 7,     // those your team killed in a failed attempt stay dead this long (the next ones drift in)
  AI_LOSS: 0.15, FORMER_REL: -10,
  // A group gives up its farthest base (not its main one, not one of yours it holds) when it has fewer than AI_KEEP fit
  // people for each base it holds: the base stands empty with its works and a share of the stores (leaveGroupBase), as
  // your Abandon outpost leaves yours (occupy.js). At most one every AI_KEEP_EVERY days.
  AI_KEEP: 3, AI_KEEP_EVERY: 20,
};
const h = (state, ...k) => hash01(state.seed, "groupworld", ...k);
const dist = (state, a, b) => state.grid.distance(a, b);
const nearOwn = (state, f, tile) => (f.bases.length ? Math.min(...f.bases.map((b) => dist(state, b, tile))) : Infinity);

// ---------- knowledge ----------
export function knowsOf(state, f) {
  if (f.knows) { if (f.knows.reach == null) f.knows.reach = KNOW.REACH0; return f.knows; } // an older save: its intel stays, the frontier starts here
  f.knows = { bases: {}, reach: KNOW.REACH0 };
  const d0 = day(state);
  for (const b of state.bases) if (nearOwn(state, f, b.tile) <= KNOW.REACH0) learnBase(state, f, b.tile, d0); // your bases: only on their home ground
  for (const o of state.factions) if (o !== f && o.alive) for (const t of o.bases) if (nearOwn(state, f, t) <= KNOW.START) learnBase(state, f, t, d0);
  return f.knows;
}
export const reachOf = (state, f) => knowsOf(state, f).reach;
// What they now know of the base on this tile (true values, as of today).
export function learnBase(state, f, tile, d = day(state)) {
  const K = f.knows || (f.knows = { bases: {} });
  const pb = state.bases.find((b) => b.tile === tile);
  if (pb) {
    K.bases[tile] = { kind: "player", id: pb.id, def: Math.round(defOf(state, pb)), walls: wallTier(pb), value: Math.round(supplyValue(pb.stock)), day: d }; // value: the stores they saw (playerwars.js: a war for loot)
    return K.bases[tile];
  }
  const o = state.factions.find((x) => x.alive && x !== f && x.bases.includes(tile));
  if (o) { K.bases[tile] = { kind: "group", id: o.id, def: Math.round(groupStrengthOf(o)), day: d }; return K.bases[tile]; }
  delete K.bases[tile];
  return null;
}
const defOf = (state, base) => preparedDefense(state, base);
const groupStrengthOf = (o) => strength(o);
export const knownBase = (state, f, tile) => { const k = knowsOf(state, f).bases[tile]; return k || null; };
// A raid's view of your base: what they know (old intel stays old), or null when they do not know it.
export function intelDef(state, f, base) {
  const k = knownBase(state, f, base.tile);
  if (!k || k.kind !== "player") return null;
  if (f.scoutedYou != null && day(state) - f.scoutedYou <= KNOW.FRESH) return learnBase(state, f, base.tile).def; // they just looked
  return k.def;
}
// Do they think a group too strong to take on?
export function fearsGroup(state, f, o) {
  const ks = o.bases.map((t) => knownBase(state, f, t)).filter(Boolean);
  if (!ks.length) return false;
  return Math.max(...ks.map((k) => k.def)) > KNOW.AVOID * groupStrengthOf(f);
}
// Scouting: one base a day KNOW.SCOUT × profile of the time, the least known within KNOW.RANGE.
export function scoutDaily(state, f, d = day(state)) {
  const K = knowsOf(state, f);
  // Their patrols keep an eye on what is close (WATCH tiles): looked at again every WATCH_DAYS days.
  if ((tickOf(f) + Math.floor(h(state, f.name, "watchph") * KNOW.WATCH_DAYS)) % KNOW.WATCH_DAYS === 0) {
    const w = Math.min(KNOW.WATCH, K.reach ?? KNOW.REACH0); // never past where they have been
    for (const b of state.bases) if (nearOwn(state, f, b.tile) <= w && !missesBase(state, f, b.tile, HIDE.SCOUT, "watch", d)) learnBase(state, f, b.tile, d); // hiding.js: a hidden base may be missed
    for (const o of state.factions) if (o !== f && o.alive) for (const t of o.bases) if (nearOwn(state, f, t) <= w && !missesBase(state, f, t, HIDE.SCOUT, "watch", d)) learnBase(state, f, t, d);
  }
  // Your people they hold talk.
  if (d % KNOW.QUESTION === 0 && captivesOf(state, f.id).length) for (const b of state.bases) learnBase(state, f, b.tile, d);
  const odds = KNOW.SCOUT * Math.max(weightOf(f, "patrol"), weightOf(f, "raid"));
  if (h(state, f.name, tickOf(f), "scout") >= odds) return null;
  const all = () => [...state.bases.map((b) => b.tile), ...state.factions.filter((o) => o.alive && o !== f).flatMap((o) => o.bases)];
  const reach = K.reach ?? KNOW.REACH0;
  const cands = all().filter((t) => nearOwn(state, f, t) <= reach)
    .map((t) => [t, K.bases[t] ? d - K.bases[t].day : 999, h(state, f.name, tickOf(f), "pick", t)])
    .filter(([t, age]) => age !== 999 || !missesBase(state, f, t, HIDE.SCOUT, "look", d)) // hiding.js: one never seen that the scout misses today is as if it were not there
    .sort((a, b) => b[1] - a[1] || a[2] - b[2]);
  // Further out: the frontier moves, and every base in the new ring is found (a base of yours there: the scout at
  // your walls, scoutYou, for the nearest; the others on the way). A base within reach they have never seen comes first.
  if (reach < KNOW.RANGE && !(cands.length && cands[0][1] === 999) && (!cands.length || h(state, f.name, tickOf(f), "explore") < KNOW.EXPLORE)) {
    K.reach = Math.min(KNOW.RANGE, reach + KNOW.STEP);
    const ring = all().filter((t) => { const r = nearOwn(state, f, t); return r > reach && r <= K.reach; }).sort((a, b) => nearOwn(state, f, a) - nearOwn(state, f, b) || a - b);
    let seen = null;
    for (const t of ring) {
      if (missesBase(state, f, t, HIDE.SCOUT, "ring", d)) continue; // hiding.js: walked past it
      const pb = state.bases.find((b) => b.tile === t);
      if (pb && !seen) seen = scoutYou(state, f, pb, d);
      else learnBase(state, f, t, d);
    }
    return { tile: ring[0] ?? null, reach: K.reach, found: ring.length };
  }
  if (!cands.length) return null;
  const tile = cands[0][0];
  if (missesBase(state, f, tile, HIDE.SCOUT, "look", d)) return { tile, missed: true }; // hiding.js: they looked and did not find it
  const pb = state.bases.find((b) => b.tile === tile);
  if (pb) return scoutYou(state, f, pb, d);
  learnBase(state, f, tile, d);
  return { tile };
}
// One of their parties on the road (parties.js aiPartyHour, each tile it enters): your bases within KNOW.PASS of it,
// when they did not know them or have not seen them for KNOW.FRESH days.
export function partySaw(state, f, tile) {
  if (!f || !f.alive || f.outsider || !f.bases) return 0;
  let n = 0;
  for (const b of state.bases) {
    if (dist(state, b.tile, tile) > KNOW.PASS) continue;
    const k = knowsOf(state, f).bases[b.tile];
    if (k && day(state) - k.day < KNOW.FRESH) continue;
    if (missesBase(state, f, b.tile, HIDE.PASS, "pass")) continue; // hiding.js: one look a day, and a hidden base may be missed
    learnBase(state, f, b.tile);
    n++;
  }
  return n;
}
// Does a's network (its stations: radio.js groupNetwork) cover one of b's bases?
const onTheAir = (state, a, b) => { const net = groupNetwork(state, a); return !!net && b.bases.some((t) => netCovers(state, net, t)); };
// Over the radio: friends tell each other what they know of your bases (see the header): one of them must be on the
// air where the other is (ai-locks: a radio station, as yours). Returns how many they learned.
export function radioGossip(state, f, d = day(state)) {
  const R = KNOW.RADIO;
  if ((d + Math.floor(h(state, f.name, "gossipph") * R.EVERY)) % R.EVERY !== 0) return 0;
  const K = knowsOf(state, f).bases;
  let n = 0;
  for (const o of state.factions) {
    if (o === f || !o.alive || o.outsider || !o.bases.length || !o.knows) continue;
    if (!pactBetween(state, f, o) && relation(state, f, o) < R.REL) continue;
    if (Math.min(...o.bases.map((t) => nearOwn(state, f, t))) > R.RANGE) continue;
    if (!onTheAir(state, o, f) && !onTheAir(state, f, o)) continue; // ai-locks: one of them broadcasts to the other (a station, radio.js groupNetwork)
    if (h(state, f.name, o.name, d, "gossip") >= R.CHANCE) continue;
    for (const [t, k] of Object.entries(o.knows.bases)) {
      if (k.kind !== "player" || !state.bases.some((b) => b.tile === Number(t))) continue;
      if (!K[t] || K[t].day < k.day) { K[t] = { ...k }; n++; }
    }
  }
  if (n) f.heardOfYou = (f.heardOfYou || 0) + n;
  return n;
}
// A scout at your walls.
export function scoutYou(state, f, base, d = day(state), force = null) {
  const watched = atBase(state, base.id).some((s) => s.role === "guard" || s.station === "watch");
  const spot = force != null ? force : h(state, f.name, tickOf(f), "spot") < (watched ? KNOW.SPOT_WATCH : KNOW.SPOT) && lookoutsSpotSafe(state, base);
  if (!spot) { learnBase(state, f, base.tile, d); f.scoutedYou = d; return { tile: base.tile, seen: false }; }
  const name = f.known ? f.name : "another group";
  addCard(state, {
    title: "A stranger watching the walls",
    text: `Your lookouts at ${base.name} spot someone in the treeline, watching the walls and counting heads. ${f.known ? `By the look of them, one of ${f.name}.` : "Nobody you know."} If they get home, ${name} will know what ${base.name} has.`,
    choices: [
      { label: "Chase them off", hint: "They learn nothing", ai: () => 1, resolve: (st) => { f.knowsChased = (f.knowsChased || 0) + 1; return `The watcher ran for the trees. ${name[0].toUpperCase() + name.slice(1)} learned nothing this time.`; } },
      { label: "Capture them", hint: "One of theirs gone, their gun is yours, and they go to the cells (question them: what their group knows of you); relations with them fall", disabled: (st) => !atBase(st, base.id).length, ai: (st) => (atBase(st, base.id).length >= 3 ? 2 : -1), resolve: (st) => captureScout(st, f, base) },
      { label: "Kill them", hint: `They learn nothing and one of theirs is gone; ${Math.round(INTEL.SCOUT.KILL_FOUND * 100)}% they find the body (goodwill falls)`, disabled: (st) => !atBase(st, base.id).length, ai: () => -1, resolve: (st) => { const t = scoutKilled(st, f, base); const g = f.alive ? takeScoutGun(st, f, base) : null; return `${t}${g ? ` Their ${g} is yours.` : ""}`; } },
      { label: "Feed them false information", hint: `Let them see what you want seen: they go home thinking ${base.name} far stronger and poorer than it is (${Math.round(falseOdds(state, base) * 100)}% they swallow it, by the best Speech here; else they learn the truth)`, disabled: (st) => !atBase(st, base.id).length, ai: () => -1, resolve: (st) => scoutFalse(st, f, base) },
      { label: "Let them watch", hint: `${name[0].toUpperCase() + name.slice(1)} learn your defences and are more likely to raid`, resolve: (st) => { learnBase(st, f, base.tile); f.scoutedYou = day(st); return "You let them watch."; } },
    ],
  });
  return { tile: base.tile, seen: true };
}
const lookoutsSpotSafe = (state, base) => lookoutsSpot(state, base, base.tile, 1, true);
// Their scout's gun into the base's armory (out of their arsenal). Returns its name or null.
function takeScoutGun(state, f, base) {
  const lo = issueKit(state, f, f.pop + 1, "field")[0];
  if (lo && lo.weapon && removeFromArsenal(f, lo.weapon, "captured")) { base.armory.push(lo.weapon); return lo.weapon.name; }
  return null;
}
function captureScout(state, f, base) {
  if (!f.alive) return "They were gone.";
  f.pop = Math.max(0, f.pop - 1);
  const gun = takeScoutGun(state, f, base);
  f.goodwill = Math.max(-100, f.goodwill - 4);
  f.scoutsCaught = (f.scoutsCaught || 0) + 1;
  // prisoners.js: to the cells here if there is room, else a card (hold elsewhere, release, ...). Questioned, they
  // tell what their group knows of your bases (intel.js knowsLine).
  const held = surrenderPrisoners(state, f, base, 1)[0];
  if (held) held.scout = true;
  return `Your people caught the watcher${f.known ? `, one of ${f.name}` : ""}${gun ? `, and took their ${gun}` : ""}. Question them to learn what their group knows of you.`;
}

// ---------- vehicles ----------
export const vehicleWant = (f) => Math.max(0, Math.round((f.pop / VEH.PER) * weightOf(f, "vehicles")));
const live = (f) => factionVehicles(f).filter((v) => v.condition > 0);
function record(f, v, extra = {}) {
  f.vehSeq = (f.vehSeq || 0) + 1;
  const rec = { id: `f${f.id}-g${f.vehSeq}${extra.salt || ""}`, type: v.type, name: v.name, fuel: Math.round(v.fuel || 0), condition: Math.round(v.condition ?? 60), owner: f.id };
  if (v.upgrades) rec.upgrades = JSON.parse(JSON.stringify(v.upgrades));
  carryCargo(v, rec); // vehicles.js: what is in it goes with it
  factionVehicles(f).push(rec);
  return rec;
}
// One of yours (or one left on the map) into a group's motor pool, with what was left in it (parties.js leaveVehicle:
// a team's cargo it could not carry on foot): driven home and unloaded into their stores (arsenal.js unloadVehicle).
export function takeVehicle(state, f, v, why = "took") {
  const i = state.vehicles.indexOf(v);
  if (i < 0) return null;
  state.vehicles.splice(i, 1);
  for (let j = state.markers.length - 1; j >= 0; j--) if (state.markers[j].key === `vehicle:${v.id}`) state.markers.splice(j, 1);
  const rec = record(f, v);
  unloadVehicle(state, f, rec, "taken from you");
  f.vehiclesTaken = (f.vehiclesTaken || 0) + 1;
  return rec;
}
function vehicleDaily(state, f, d) {
  const W = weightOf(f, "vehicles"), S = weightOf(f, "steal");
  // Left on the map near them.
  for (const v of [...state.vehicles]) {
    if (v.loc.kind !== "abandoned" || v.type === "bike" || nearOwn(state, f, v.loc.tile) > VEH.TAKE_RANGE) continue;
    if (h(state, f.name, tickOf(f), "take", v.loc.tile, v.type) >= VEH.TAKE * W) continue;
    takeVehicle(state, f, v);
    if (f.known || state.live.has(v.loc.tile)) log(state, `${f.known ? f.name : "Another group"} took the ${v.name} that stood at ${tileName(state, v.loc.tile)}.`, "danger");
    return;
  }
  // Parked at a base of yours with nobody there.
  if (h(state, f.name, tickOf(f), "steal") < VEH.STEAL * S) {
    const v = state.vehicles.find((x) => x.loc.kind === "base" && x.type !== "bike" && (() => { const b = state.bases.find((bb) => bb.id === x.loc.baseId); return b && b.type !== "hub" && !atBase(state, b.id).length && nearOwn(state, f, b.tile) <= VEH.STEAL_RANGE && !!knownBase(state, f, b.tile); })()); // only at a base they know
    if (v) { stealYours(state, f, v); return; }
  }
  // From another group.
  if (h(state, f.name, tickOf(f), "gsteal") < VEH.STEAL_GROUP * S) {
    const o = state.factions.filter((x) => x.alive && x !== f && !x.outsider && live(x).length && nearOwn(state, f, x.bases[0] ?? -1) <= 12 && x.pop < 25).sort((a, b) => a.pop - b.pop || a.id - b.id)[0];
    if (o) stealFromGroup(state, f, o, d);
  }
  // Sell a spare.
  if (live(f).length > vehicleWant(f) + 1 && weightOf(f, "sellsCars", 1) > 0 && h(state, f.name, tickOf(f), "sell") < VEH.SELL) { // GROUP_PRIORITIES sellsCars
    const buyer = state.factions.filter((x) => x.alive && x !== f && !x.outsider && live(x).length < vehicleWant(x) && relation(state, f, x) > -15).sort((a, b) => weightOf(b, "vehicles") - weightOf(a, "vehicles") || a.id - b.id)[0];
    if (buyer) sellBetween(state, f, buyer);
  }
  // Fit an upgrade.
  if ((d + Math.floor(h(state, f.name, "fitph") * VEH.FIT_EVERY)) % VEH.FIT_EVERY === 0 && workshopFactor(state, f) >= 1) fitUpgrade(state, f);
}
const tileName = (state, t) => (state.tiles[t] && state.tiles[t].loc ? state.tiles[t].loc.name : "the road");
export function stealYours(state, f, v) {
  const b = state.bases.find((x) => x.id === v.loc.baseId);
  const rec = takeVehicle(state, f, v);
  f.knows && (f.stoleFromYou = (f.stoleFromYou || 0) + 1);
  addCard(state, { title: `The ${v.name} is gone`, text: `Nobody was at ${b ? b.name : "the outpost"} to stop it: ${f.known ? f.name : "someone"} drove off with the ${v.name}. It is in their motor pool now; take their base and it is yours again.`, choices: [{ label: "OK", resolve: () => "" }] });
  return rec;
}
export function stealFromGroup(state, f, o, d = day(state)) {
  const v = live(o).sort((a, b) => (upgradesOf(a).turret ? 1 : 0) - (upgradesOf(b).turret ? 1 : 0) || a.condition - b.condition)[0];
  if (!v) return null;
  factionVehicles(o).splice(factionVehicles(o).indexOf(v), 1);
  v.owner = f.id;
  factionVehicles(f).push(v);
  unloadVehicle(state, f, v, "stolen", true); // anything in it is the thieves' too (a transfer between groups)
  f.vehiclesStolen = (f.vehiclesStolen || 0) + 1;
  if (h(state, f.name, o.name, tickOf(f), "found") < 0.5) {
    changeRelation(state, f, o, -15);
    if (sameBloc(state, f, o)) betray(state, f, o, `it stole their ${v.name}`); // blocs.js: a thief in the bloc is out
    if ((f.known && o.known) || false) log(state, `${o.name} say ${f.name} stole their ${v.name}.`, "info");
  }
  return v;
}
// What a vehicle is worth to a group: vehicleValue × their want (more when they have fewer than they want).
export const vehiclePrice = (f, v, buying = true) => Math.round(vehicleValue(v) * (live(f).length < vehicleWant(f) ? 1.2 : 0.7) * (buying ? 1 : 1.3));
function payGoods(from, to, value) {
  const paid = {};
  let owed = value;
  for (const k of ["scrap", "fuel", "ammo", "parts", "food", "meds"]) {
    if (owed <= 0) break;
    const unit = k === "food" ? DAY_VALUE : (SUPPLIES[k] && SUPPLIES[k].value) || 1; // food: days of it (foods.js)
    const have = Math.max(0, Math.floor((k === "food" ? foodIn(from) : from[k] || 0) - (k === "food" ? 20 : 0)));
    const q = Math.min(have, Math.ceil(owed / unit));
    if (q <= 0) continue;
    if (k === "food") addFoodsTo(to, takeFood(from, q).items);
    else { from[k] -= q; to[k] = (to[k] || 0) + q; }
    paid[k] = q;
    owed -= q * unit;
  }
  return { paid, short: Math.max(0, owed) };
}
export function sellBetween(state, f, buyer) {
  const v = live(f).filter((x) => !upgradesOf(x).turret).sort((a, b) => vehicleValue(a) - vehicleValue(b))[0];
  if (!v) return null;
  const price = vehiclePrice(buyer, v);
  const worth = ["scrap", "fuel", "ammo", "parts", "food", "meds"].reduce((a, k) => a + Math.max(0, (k === "food" ? foodIn(buyer.stock) : buyer.stock[k] || 0) - (k === "food" ? 20 : 0)) * (k === "food" ? DAY_VALUE : (SUPPLIES[k] && SUPPLIES[k].value) || 1), 0);
  if (worth < price) return null;
  payGoods(buyer.stock, f.stock, price);
  unloadVehicle(state, f, v, "kept", true); // what is in it stays with the seller (as yours does: vehicletrade.js sellVehicle)
  factionVehicles(f).splice(factionVehicles(f).indexOf(v), 1);
  v.owner = buyer.id;
  factionVehicles(buyer).push(v);
  f.vehiclesSold = (f.vehiclesSold || 0) + 1;
  return { v, price };
}
// You sell them one of yours (at a base): the cargo stays at the base, they pay in goods into its stock.
export function sellVehicleTo(state, f, v, base) {
  if (!v || !base || v.type === "bike") return null;
  const price = vehiclePrice(f, v);
  const { paid, short } = payGoods(f.stock, base.stock, price);
  cargoToBase(base, v); // vehicles.js: its supplies into the stores, its items into the armory (none of it sold)
  takeVehicle(state, f, v);
  return { price, paid, short };
}
// You buy one of theirs: paid from the base's stock, it is parked there.
export function buyVehicleFrom(state, f, rec, base, createVehicle) {
  const i = factionVehicles(f).indexOf(rec);
  if (i < 0 || !base) return null;
  const price = vehiclePrice(f, rec, false);
  const worth = ["scrap", "fuel", "ammo", "parts", "food", "meds"].reduce((a, k) => a + Math.max(0, k === "food" ? foodIn(base.stock) : base.stock[k] || 0) * (k === "food" ? DAY_VALUE : (SUPPLIES[k] && SUPPLIES[k].value) || 1), 0);
  if (worth < price) return { refused: `They want goods worth ${price}.` };
  payGoods(base.stock, f.stock, price);
  unloadVehicle(state, f, rec, "kept", true); // what is in it stays with them (as yours does when you sell)
  factionVehicles(f).splice(i, 1);
  const v = createVehicle(state, VEHICLE_TYPES[rec.type] ? rec.type : "truck", { kind: "base", baseId: base.id }, { fuel: rec.fuel, condition: rec.condition, name: rec.name });
  if (rec.upgrades) v.upgrades = JSON.parse(JSON.stringify(rec.upgrades));
  return { v, price };
}
// A scavenging party brings a wreck home now and then (aiscav.js): by the site, wanted, repaired at their workshop.
// ai-locks (2026-10-11): restored as you restore one (vehicles.js WRECK: 2 car parts, machine parts for any short at
// two for one, the free ones before their machines' earmark, and 6 fuel), else it stays where it lies.
export function scavVehicle(state, f, site) {
  if (live(f).length >= vehicleWant(f) || h(state, f.name, state.hour, "vfind") >= VEH.FIND * weightOf(f, "vehicles")) return null;
  const t = state.tiles[site];
  const mil = t && t.loc && ["military", "airport", "police"].includes(t.loc.type);
  const types = mil ? ["miltruck", "hummer", "truck"] : ["truck", "sedan", "van", "suv"];
  const type = types[Math.floor(h(state, f.name, state.hour, "vtype") * types.length) % types.length];
  if (!VEHICLE_TYPES[type]) return null;
  const { cost, ok } = groupCost(f, { carparts: WRECK.parts, fuel: WRECK.fuel }, groupStockKey);
  if (!ok || !freePartsOk(f, cost)) return null;
  for (const [k, q] of Object.entries(cost)) f.stock[k] -= q;
  return record(f, { id: state.hour, type, name: VEHICLE_TYPES[type].name, fuel: 2, condition: 25 + Math.round(35 * h(state, f.name, state.hour, "vcond")) }, { salt: "s" });
}
// The machine parts of a cost come from the parts above their machines' earmark (groupworks.js groupFreeParts).
const freePartsOk = (f, cost) => !(cost.parts > 0) || groupFreeParts(f) >= cost.parts - 1e-9;
// Fit one upgrade by type (GROUP_PRIORITIES fits: raiders scrap plating; the military plate, then glass; a fortress
// plate; traders and communes mesh; × fitting, communes seldom bother), paid from the stock; an LMG from the arsenal
// on a turret (vehicles.js TURRET_FIT: the same rule and cost as yours; the M2 only ever comes mounted on a military
// vehicle). ai-locks (2026-10-11): only at your Mechanics for the job (groupworks.js groupSkill: the fortress's 5 plates
// nothing, raiders and communes fit no turret), at a workshop (their "bench", your workbench: the garage jobs' shop),
// the machine parts from those above their machines' earmark.
export function fitUpgrade(state, f) {
  const cars = live(f).filter((v) => v.type !== "bike");
  if (!cars.length || h(state, f.name, tickOf(f), "fit") >= VEH.FIT * 10 * weightOf(f, "vehicles") * weightOf(f, "fitting", 1)) return null;
  // An LMG from the arsenal on a turret (it leaves the fighters' pool; lost with the vehicle), paid like yours.
  const mg = f.arsenal && f.arsenal.items.find((it) => it.key === TURRET_FIT.item && TURRET_KG[it.key]);
  const bare = cars.find((v) => !upgradesOf(v).turret);
  if (mg && bare && groupSkill(f, "mechanics") >= TURRET_FIT.mech) { // ai-locks: your turret's Mechanics 6
    const { cost, ok } = groupCost(f, upgradeCost("turret"), groupStockKey, { scrap: 5 }); // vehicles.js: car parts first, 2 machine parts for each short
    if (ok && freePartsOk(f, cost)) {
      for (const [k, q] of Object.entries(cost)) f.stock[k] -= q;
      removeFromArsenal(f, mg, "turret");
      bare.upgrades = { ...upgradesOf(bare), turret: { gun: TURRET_FIT.gun, item: mg } };
      return { v: bare, key: "turret" };
    }
  }
  for (const key of weightOf(f, "fits", null) || []) {
    const v = cars.find((x) => { const u = upgradesOf(x); return key === "plating" ? u.plating < 1 && !u.scrapPlate : key === "scrapPlate" ? !u.plating && !u.scrapPlate : !u[key] && !(key === "mesh" && u.glass) && !(key === "glass" && u.mesh); });
    if (!v) continue;
    if (groupSkill(f, "mechanics") < (VEH_UPGRADES[key].mech || 0)) continue; // ai-locks: your Mechanics for the job (glass 5, plate 6, scrap plating 3, mesh 2)
    // (trade.js groupStockKey: their car parts first, 2 machine parts for each one short: vehicles.js groupCost)
    const { cost, ok } = groupCost(f, upgradeCost(key), groupStockKey, { scrap: 5 });
    if (!ok || !freePartsOk(f, cost)) continue;
    for (const [k, q] of Object.entries(cost)) f.stock[k] -= q;
    const u = upgradesOf(v);
    u[key] = (u[key] || 0) + 1;
    v.upgrades = u;
    f.vehicleUpgrades = (f.vehicleUpgrades || 0) + 1;
    return { v, key };
  }
  return null;
}

// ---------- abandoned bases ----------
export const abandonedList = (state) => state.abandoned || (state.abandoned = []);
export const abandonedAt = (state, tile) => (state.abandoned || []).find((a) => a.tile === tile) || null;
// Your buildings as a group's works (the keys are buildings.js BUILDINGS: this table used some names no building has,
// "farm", "raincatcher", "bench", so a lost outpost's fields, catchers and benches were never counted).
// ai-locks (2026-10-11): a machine shop is a workshop and their machine shop, a reloading bench a workshop and their
// reloading bench; a radio station, a garage and a reinforced gate are those works of theirs (groupworks.js LOCKS).
const PLAYER_WORKS = { walls: "walls", farm_plot: "farms", greenhouse: "farms", animal_pen: "pens", well: "water", rain_catcher: "water", cistern: "water", bunkhouse: "beds", barracks: "beds", craftbench: "bench", workbench: "bench", toolbench: "bench", machine_shop: ["bench", "shop"], ammo_bench: "bench", reload_bench: ["bench", "reload"], storehouse: "store", cellar: "store", radio: "radio", garage: "garage", gate: "gate" };
// A lost outpost's buildings as works (standing ones only).
function worksOfBuildings(list) {
  const works = {};
  for (const b of list || []) { if (b.broken) continue; for (const k of [].concat(PLAYER_WORKS[b.type] || [])) works[k] = (works[k] || 0) + (b.type === "walls" && b.tier ? Math.max(1, b.tier - 1) : 1); } // a wall by its tier (buildings.js WALL_TIERS)
  return works;
}
// A group's base its people left (it died out): the works stay, and some of the stores.
// left: the stores at that base (groupbases.js: its own, the group's other bases keep theirs); without it, `share` of
// the group's (an old caller).
export function leaveGroupBase(state, f, tile, share, left = null) {
  if (abandonedAt(state, tile) || state.bases.some((b) => b.tile === tile) || state.factions.some((o) => o.alive && o.bases.includes(tile))) return null;
  const stock = {};
  if (left) { for (const [k, q] of Object.entries(left)) if (q > 0 && SUPPLIES[k]) stock[k] = Math.floor(q * ABANDON.STOCK); }
  else for (const [k, q] of Object.entries(f.stock || {})) if (q > 0 && SUPPLIES[k]) stock[k] = Math.floor(q * share * ABANDON.STOCK);
  const rec = { tile, from: f.id, fromName: f.name, works: { ...((f.works && f.works[tile]) || {}) }, stock, day: day(state) };
  abandonedList(state).push(rec);
  return rec;
}
// An outpost of yours that was lost or left (world.js removeBase): its buildings as works.
// rec.buildings: the buildings themselves (wear, damage, a barrel's tier), for your Occupy order (occupy.js); rec.stock:
// ABANDON.STOCK_YOURS of what its stores still held (no water: the tanks drain).
export function leavePlayerBase(state, base) {
  if (!base || base.type === "hub" || abandonedAt(state, base.tile)) return null;
  const buildings = JSON.parse(JSON.stringify(base.buildings || []));
  const stock = {};
  for (const [k, q] of Object.entries(base.stock || {})) if (SUPPLIES[k] && k !== "water" && k !== "rawwater" && q >= 1) { const left = Math.floor(q * ABANDON.STOCK_YOURS); if (left > 0) stock[k] = left; }
  const rec = { tile: base.tile, from: "player", fromName: base.name, works: worksOfBuildings(buildings), buildings, stock, day: day(state) };
  abandonedList(state).push(rec);
  return rec;
}
// What is inside an abandoned base now (see the header): { dead, deadPower, squat, squatPower, kind, count, power,
// name } (count 0: nobody, nothing). The same on the same day whatever asks (hashed dice), so the planner's preview is
// what the team meets.
export function abandonedThreat(state, tile, d = day(state)) {
  const rec = abandonedAt(state, tile);
  if (!rec) return null;
  const t = state.tiles[tile];
  const inf = Math.max(0, Math.min(1, t.infection || 0));
  const age = Math.max(0, d - rec.day);
  let dead = Math.min(ABANDON.DEAD_MAX, ABANDON.DEAD_BASE + Math.floor((age / 7) * ABANDON.DEAD_WEEK) + Math.round(inf * ABANDON.DEAD_INF));
  const value = supplyValue(rec.stock || {});
  const odds = Math.min(ABANDON.SQUAT_MAX, ABANDON.SQUAT + ABANDON.SQUAT_STOCK * (value / ABANDON.SQUAT_STOCK_PER));
  const win = Math.floor(age / ABANDON.SQUAT_EVERY);
  const [lo, hi] = ABANDON.SQUAT_N;
  let squat = age >= ABANDON.SQUAT_FROM && h(state, "squat", tile, rec.day, win) < odds ? lo + Math.floor(h(state, "squatN", tile, rec.day, win) * (hi - lo + 1)) : 0;
  if (squat) dead = Math.round(dead * ABANDON.SQUAT_DEAD); // they keep the dead down
  // Killed in a failed attempt lately: the dead first, then the squatters.
  if (rec.thinned && d - rec.thinned.day < ABANDON.THIN_DAYS) {
    let n = rec.thinned.n;
    const dz = Math.min(dead, n); dead -= dz; n -= dz;
    squat = Math.max(0, squat - n);
  }
  const deadPower = ABANDON.DEAD_POWER + inf * ABANDON.DEAD_POWER_INF;
  const count = dead + squat;
  const power = count ? (dead * deadPower + squat * ABANDON.SQUAT_POWER) / count : 0;
  const kind = squat && dead ? "mixed" : squat ? "raiders" : "zombies";
  const name = squat && dead ? "squatters and the dead" : squat ? "squatters" : "the dead";
  return { dead, deadPower: Math.round(deadPower * 10) / 10, squat, squatPower: ABANDON.SQUAT_POWER, kind, count, power: Math.round(power * 10) / 10, name };
}
// How much more a group wants this abandoned base than an empty site.
export function abandonedPull(f, rec) {
  const w = rec.works || {};
  const likes = weightOf(f, "likes", null); // GROUP_PRIORITIES: raiders walls, a commune fields, a fortress two walls
  const fit = likes && Object.entries(likes).every(([k, n]) => (w[k] || 0) >= n) ? ABANDON.LIKED : 1;
  return ABANDON.PULL * weightOf(f, "expand") * fit;
}
// A group moves in (factions.js expansion): it clears what is inside first (abandonedThreat: ABANDON.AI_LOSS of its count
// in people, by the dice), then has the works and the stores. The group whose base it was, if it still stands, takes it
// ill (relations ABANDON.FORMER_REL), as it does when you move in (occupy.js).
export function occupyAbandoned(state, f, tile) {
  const rec = abandonedAt(state, tile);
  if (!rec) return null;
  const threat = abandonedThreat(state, tile);
  state.abandoned.splice(state.abandoned.indexOf(rec), 1);
  if (threat && threat.count) {
    const want = threat.count * ABANDON.AI_LOSS;
    const lost = Math.min(Math.max(0, f.pop - 3), Math.floor(want) + (h(state, f.name, tile, day(state), "clearloss") < want % 1 ? 1 : 0));
    f.pop -= lost;
    f.clearedLoss = (f.clearedLoss || 0) + lost;
  }
  const w = worksAt(f, tile);
  for (const [k, q] of Object.entries(rec.works || {})) w[k] = Math.max(w[k] || 0, q);
  for (const [k, q] of Object.entries(typeGoods(null, rec.stock || {}, groupMix(f)))) f.stock[k] = (f.stock[k] || 0) + q; // foods.js: an old record's days of food as items
  f.basesOccupied = (f.basesOccupied || 0) + 1;
  const former = typeof rec.from === "number" ? state.factions.find((o) => o.id === rec.from && o.alive && o !== f) : null;
  if (former) changeRelation(state, f, former, ABANDON.FORMER_REL);
  if (rec.from === "player") addCard(state, { title: `Someone moved into ${rec.fromName}`, text: `${f.known ? f.name : "Another group"} has moved into ${rec.fromName}, the outpost you lost: they use what you built there. It is theirs now; you can take it back like any of their bases.`, choices: [{ label: "OK", resolve: () => "" }] });
  return rec;
}
// One period's rot on a lost outpost's own buildings: one of them (by the dice) takes ABANDON.ROT wear, breaks at 100,
// and one already broken falls in. The works follow.
function rotBuildings(state, rec, d) {
  const list = rec.buildings;
  if (!list.length) return;
  const b = list[Math.floor(h(state, rec.tile, d, "rot") * list.length) % list.length];
  if (b.broken) list.splice(list.indexOf(b), 1);
  else {
    b.wear = Math.min(100, (b.wear || 0) + ABANDON.ROT);
    if (b.wear >= 100) b.broken = { day: d, cause: "left to rot" };
  }
  rec.works = worksOfBuildings(list);
}
function decayAbandoned(state, d) {
  for (const rec of [...(state.abandoned || [])]) {
    if ((d - rec.day) % ABANDON.DECAY || d === rec.day) continue;
    const keys = Object.keys(rec.works).filter((k) => rec.works[k] > 0);
    if (rec.buildings) rotBuildings(state, rec, d);
    else if (keys.length) { const k = keys[Math.floor(h(state, rec.tile, d, "decay") * keys.length)]; rec.works[k] -= 1; }
    // Taken by someone else or empty with nothing left: off the list.
    if (state.bases.some((b) => b.tile === rec.tile) || state.factions.some((o) => o.alive && o.bases.includes(rec.tile)) || (!Object.values(rec.works).some((q) => q > 0) && !Object.values(rec.stock).some((q) => q > 0) && !(rec.buildings && rec.buildings.length))) state.abandoned.splice(state.abandoned.indexOf(rec), 1);
  }
}

// A group spread too thin gives up its farthest base (ABANDON.AI_KEEP): it stands empty for whoever comes.
export function groupAbandonDaily(state, f, d = day(state)) {
  if (!f.alive || f.outsider || f.bases.length < 2 || fitPeople(f) >= f.bases.length * ABANDON.AI_KEEP) return null;
  if (d - (f.leftBaseDay ?? -999) < ABANDON.AI_KEEP_EVERY) return null;
  const held = new Set(((state.conquest && state.conquest.occupied) || []).map((o) => o.tile)); // yours they hold: conquest.js
  const main = f.bases[0];
  const tile = f.bases.slice(1).filter((t) => !held.has(t)).sort((a, b) => dist(state, b, main) - dist(state, a, main) || a - b)[0];
  if (tile == null) return null;
  f.bases = f.bases.filter((t) => t !== tile);
  f.leftBaseDay = d;
  const rec = leaveGroupBase(state, f, tile, 1 / (f.bases.length + 1));
  recomputeOwnership(state);
  state.stats.groupsLeftBases = (state.stats.groupsLeftBases || 0) + 1;
  if (f.known && state.live.has(tile)) log(state, `${f.name} gave up ${tileName(state, tile)}: too few of them to hold it. It stands empty.`, "info");
  return rec;
}
// One group's day (factions.js factionsDaily).
export function groupWorldDaily(state, f) {
  const d = day(state);
  knowsOf(state, f);
  scoutDaily(state, f, d);
  radioGossip(state, f, d);
  forgetDaily(state, f, d); // hiding.js: a hidden base nothing confirms slips out of what they know
  vehicleDaily(state, f, d);
  groupAbandonDaily(state, f, d);
}
export function groupWorldWorld(state) { decayAbandoned(state, day(state)); vehicleDeliveriesDaily(state); }
// A scavenging party's look around the site (aiscav.js): the bases within KNOW.SEE.
export function scavSaw(state, f, site) {
  knowsOf(state, f);
  for (const b of state.bases) if (dist(state, b.tile, site) <= KNOW.SEE) learnBase(state, f, b.tile);
  for (const o of state.factions) if (o !== f && o.alive) for (const t of o.bases) if (dist(state, t, site) <= KNOW.SEE) learnBase(state, f, t);
}
