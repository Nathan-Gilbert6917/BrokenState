// Conquest: taking other groups' bases, losing your own to them, and taking them back.
//
// Assault their base (parties.js mission "assault", on any group's base; the planner and the card warn hard when
// the group is not hostile):
// - The defenders: the people at that base (the group's people shared over its bases, the main base counting
//   double), 60% of them fighting (3–16), each as tough as a rescue's guards (2.6 + arms × 1.6). Behind walls they
//   count more: × (1 + 0.05 a wall point): a fortress or military base 7 points, a group's main base 4, any other
//   1. A base they took from you is held by its garrison (a share of the raid that took it, growing back to that
//   share) behind the walls they have patched up: baseWalls of the base as it stands, broken walls counting for
//   nothing, so it is easiest to take back right after it fell.
// - The fight: a tactical battle on the "baseAssault" map (their wall line with a gate and breaches, barricades
//   behind it, the defenders at the wall); headless and on the autopilot the statistical resolver with the walls
//   as a multiplier on their strength (combat.js autoResolveCombat reads enemy.fortified). Attacking costs 30
//   goodwill with them at once and ends any pact; a coalition member you attack leaves the coalition.
// - Win: the base is yours, an outpost on its tile (a group's base: their palisade, battered, two sections behind
//   strong walls, and their bunkhouse; one of yours they held: its buildings as they stand, damage and all, and
//   what is left of its stock). Its stores: half of that base's share of the group's stock. It holds land like your
//   hub (alliance.js controlRadius "stronghold"). The team leaves one person (the weakest fighter, if the team has
//   3+; everyone if you have no hub) as the first staff and waits for orders. Of the defenders who live, 40% get away to their
//   group's other bases (none if it was the last); of those who give up a quarter ask to join you (a recruit card,
//   at most 3) and a fifth are taken prisoner (at most 3, at the new outpost); the rest scatter. Your people they
//   held there walk free. Their main base (bases[0], not their last): the leaders fall with it, half of the people
//   left scatter. A group that loses its last base (or is down to 3, factions.js GROUP_BREAK
//   people) is broken: factions.js collapseFaction (its parties go, its land is nobody's, refugees may come).
// - Fallout: groups with a pact with the victim lose 8 goodwill toward you (15 when you finish it off), its
//   friends (relations 28+) 4 (8); its enemies (−42 or worse) gain 2 (4). Infamy: +2 a base taken from a hostile
//   raider-type group (nothing more for finishing it), +15 from anyone else (+10). It fades by 0.1 a day. Above 20,
//   peaceful groups you know (not coalition members) lose (infamy − 20) / 200 goodwill a day, and they want
//   goodwill 50 + infamy / 2 (at most 90) before they join the coalition (alliance.js inviteProblem).
// - Lose: the team falls back; the defenders lose 60% of those you killed; a beaten team may lose one to capture.
//
// Losing your bases (factions.js resolveRaidOnPlayer):
// - A raid that overruns a base of yours (or breaks into an outpost, a third as likely) may keep it: keepChance
//   (factions.js) by the group's type, how far it is from their bases, how rich the base is and how many bases
//   they already hold (never beyond maxBases). Then the base is theirs: on their bases list, their land, half its
//   stock carried off into their stores; the raid damage stays on its buildings. They leave a garrison: 60% of
//   the raid's head count (at least 2). Raiders from outside the state (visitors.js) never keep a base: they are
//   passing through.
// - Your people there walk to your nearest other base as a team, carrying what they can (water, food, 15 scrap,
//   ammo, meds first; one vehicle if one is parked there, the others are left on the tile, marked). Retreat (the
//   raid warning card) does the same before the raid arrives; the raiders then take the empty base without a fight.
//   Pulling out of the battle at the walls (the evac strip on the side away from the attack, deploy.js) is the same
//   retreat (conflicts.js raidDefense).
// - The hub: if it falls and you hold another base, the nearest one becomes the hub (its type changes; the
//   buildings stay where they are). With no other base the survivors take to the road as one team (exiles): they
//   can found a new base (Establish base: a staging camp built up into the hub, staging.js) or retake the old one
//   (Assault their base; a staging camp still standing is then struck, its stores left as a cache); the run
//   ends only when nobody is left.
// - The occupier patches the base up: each broken building has a 5% chance a day to be repaired (wear back to
//   40) and the wear on the rest falls by 1 a day; the garrison grows back by 0.2 a day toward its full size.
//   The tile panel shows who holds it, since when, what is broken and the garrison; the Goals panel lists your
//   lost bases to retake.
// - If the group holding it is broken and nobody takes the tile, the ruins come back to you, empty.
// - Razing (factions.js baseFate / razeChance, aggressive gangs): razePlayerBase burns a base of yours to the ground
//   instead: everything goes, its people walk to your nearest base, the tile is a ruin (tile.ruin: a little loot, an
//   outpost there needs 5 scrap). The hub razed is the hub lost.
import { sumRecs } from "./rounds.js"; // rounds by calibre
import { packRounds } from "./ammo.js";
import { teamKit, assaultCut, kitText, spendGrenades } from "./siege.js";
import { FACTION_TYPES, SUPPLIES, SUPPLY_KEYS } from "./data.js";
import { log, addCard, day, hub, atBase, factionById, newId, combatPower, baseById, checkGameOver, alive, supplyValue, snapshot, armedFactor } from "./world.js";
import { attitude, changeGoodwill, isAggressiveType, collapseFaction, recomputeOwnership, clearStaleAlerts, groupBroken, GROUP_BREAK } from "./factions.js";
import {
  partyMembers, partyTile, tileLabel, awaitOrders, wipeIfEmpty, outpostName, removeParty, startReturn, orderMove, carryCapacity, planPath,
} from "./parties.js";
import { startCombat, registerCombatHandler, registerBattleLayout, registerBattleSize, winOdds } from "./combat.js";
import { groupTurret, TURRET_ODDS, seizeGroupVehicles, upgradeText } from "./vehicles.js"; // a military group's Humvee (M2 turret) defends its home base
import { unitPower, arsenalShareTo, addToArsenal, arsenalWorthy } from "./arsenal.js"; // group arsenals: the defenders' kit; their stores of it
import { fortAssault, fortSize, assaultBase } from "./fort.js"; // their walled base on one fort map
import { assaultDims, CONTACT } from "./battlesize.js";
import { captivesOf, takeCaptive } from "./conflicts.js";
import { makeCandidate, offerRecruits } from "./recruits.js";
import { surrenderPrisoners, prisonersOf } from "./prisoners.js";
import { addBuilding, baseWalls, assignStations } from "./buildings.js";
import { pactsOf, relation } from "./diplomacy.js";
import { isMember, allianceMembers, ensureAlliance, assaultAllies } from "./alliance.js";
import { fixtures, fixtureName } from "./breakdowns.js";
import { markAbandonedVehicle } from "./markers.js";
import { thirstAhead } from "./weather.js";
import { keyWord } from "./water.js"; // "un-purified water" in texts
import { noteBaseLoss } from "./causes.js"; // "Why?": the chain of causes of a lost base
import { groupWalls, groupsBuild } from "./groupworks.js"; // barestart: the walls a group has built at its base
import { blocAssaultHelp } from "./blocs.js"; // AI blocs: members' fighters at an ally's walls
import { askBaseName } from "./basenames.js"; // name a base you take
import { pwarBaseTaken } from "./playerwars.js"; // wars with you: a base taken counts

export const CONQUEST = {
  FIGHT_SHARE: 0.6, MIN_DEF: 3, MAX_DEF: 16, HOME_WEIGHT: 2,
  WALLS: { typed: 7, home: 4, open: 1 }, WALLED_TYPES: ["fortress", "military"], WALL_FACTOR: 0.05, TRAP_HP: 30, GATE_HP: [60, 10], WALL_HP: [40, 8],
  STOCK_SHARE: 0.5, FLEE: 0.4, JOIN: 0.25, JOIN_MAX: 3, PRISON: 0.2, PRISON_MAX: 3, ATTACK_GW: -30, MEMBER_GW: -5,
  FALLOUT: { pact: -8, pactDefeat: -15, friend: -4, friendDefeat: -8, enemy: 2, enemyDefeat: 4, friendRel: 28, enemyRel: -42 },
  INFAMY: { hostile: 2, other: 15, defeatHostile: 0, defeatOther: 10, fade: 0.1, max: 100, wary: 20, drift: 1 / 200, inviteDiv: 2, inviteMax: 90 },
  MAIN_SCATTER: 0.5, GARRISON: 0.6, RUIN_SCRAP: 10, GARRISON_MIN: 2, GARRISON_GROW: 0.2, REPAIR: 0.05, REPAIR_WEAR: 40, WEAR_FALL: 1, BREAKIN_KEEP: 0.35,
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const first = (s) => s.name.split(" ")[0];
const names = (list) => list.map(first).join(", ");
const KIND_OF = { raider: "raiders", expansionist: "fighters", zealot: "zealots", military: "soldiers", fortress: "soldiers", traders: "guards", commune: "militia" };

export function ensureConquest(state) {
  if (!state.conquest) state.conquest = { infamy: 0, occupied: [], history: [], stats: { assaults: 0, won: 0, lost: 0, taken: 0, defeated: 0, retaken: 0, basesLost: 0, hubsLost: 0, retreats: 0, exiles: 0 } };
  return state.conquest;
}
export const infamy = (state) => (state.conquest ? state.conquest.infamy : 0);
// The goodwill a peaceful group wants before it joins the coalition (alliance.js inviteProblem).
export const inviteGoodwill = (state, f, base) => (f && !isAggressiveType(f) ? Math.min(CONQUEST.INFAMY.inviteMax, base + Math.floor(infamy(state) / CONQUEST.INFAMY.inviteDiv)) : base);
export const occupiedAt = (state, tile) => (state.conquest ? state.conquest.occupied.find((o) => o.tile === tile) : null) || null;
// Your bases other groups hold now (Goals panel, autopilot).
export const lostBases = (state) => (state.conquest ? state.conquest.occupied.filter((o) => { const f = factionById(state, o.factionId); return f && f.alive && f.bases.includes(o.tile); }) : []);
const history = (state, text) => { const C = ensureConquest(state); C.history.unshift({ day: day(state), text }); C.history.length = Math.min(C.history.length, 30); };

// ---------- the defenders ----------
// People at one of a group's bases: its people shared over its bases, the main base counting double.
export function peopleAt(state, f, tile) {
  const i = f.bases.indexOf(tile);
  if (i < 0) return 0;
  const w = f.bases.length - 1 + CONQUEST.HOME_WEIGHT;
  return Math.max(1, Math.round((f.pop * (i === 0 ? CONQUEST.HOME_WEIGHT : 1)) / w));
}
// The walls at a group's base: what they have built there (groupworks.js, barestart: a group's base starts bare), up to
// their goal (CONQUEST.WALLS by type and base; an old save's groups, and the hardcore military, have it all).
export function nativeWalls(f, tile, state = null) {
  const goal = CONQUEST.WALLED_TYPES.includes(f.type) ? CONQUEST.WALLS.typed : f.bases[0] === tile ? CONQUEST.WALLS.home : CONQUEST.WALLS.open;
  return state ? Math.min(goal, groupWalls(state, f, tile)) : goal;
}
// What an assault on this base faces: { kind, count, power, fortified, walls, people, occupied }.
const ALLY_SHARE = 0.4; // coalition fighters keep at most 40% of the defenders off your squad (at least MIN_DEF left)
// p: the team going in: its siege kit (ladders, the ram, grenades: siege.js assaultCut) takes part of the walls away.
export function assaultForce(state, f, tile, p = null) {
  const def = FACTION_TYPES[f.type];
  const occ = occupiedAt(state, tile);
  let count, people, walls;
  if (occ && occ.factionId === f.id) {
    people = Math.max(1, Math.round(occ.garrison));
    count = clamp(people, 2, 14);
    walls = baseWalls(occ.base);
  } else {
    people = peopleAt(state, f, tile);
    count = clamp(Math.round(people * CONQUEST.FIGHT_SHARE), CONQUEST.MIN_DEF, Math.max(CONQUEST.MIN_DEF, Math.min(CONQUEST.MAX_DEF, people)));
    walls = nativeWalls(f, tile, state);
  }
  // The coalition's fighters (alliance.js assaultAllies): members near the base each keep some defenders busy.
  const allies = assaultAllies(state, f, tile);
  const kit = p && state.parties.includes(p) ? teamKit(state, partyMembers(state, p), (p.cargo && p.cargo.gear) || []) : null;
  const held = Math.min(allies.fighters, Math.floor(count * ALLY_SHARE), Math.max(0, count - CONQUEST.MIN_DEF));
  count -= held;
  // blocs.js: their bloc's fighters from bases nearby man the walls with them (a base they took from you: its garrison).
  const bloc = occ && occ.factionId === f.id ? { fighters: 0, names: [] } : blocAssaultHelp(state, f, tile);
  count += bloc.fighters;
  return {
    kind: KIND_OF[f.type], count, power: Math.round(unitPower(f, 2.6) * 10) / 10, factionId: f.id, name: `${f.name} defenders`, arsTask: "home", // arsenal.js: by their kit, all of it at home
    fortified: Math.round((1 + CONQUEST.WALL_FACTOR * walls * (1 - (walls >= 1 ? assaultCut(kit) : 0))) * 100) / 100, walls, people, occupied: !!(occ && occ.factionId === f.id),
    siegeKit: kit && (kit.ladders || kit.ram || kit.grenades) ? kit : null,
    allies: held ? { held, names: allies.names } : null,
    bloc: bloc.fighters ? bloc : null,
    ...(tile === f.bases[0] && !(occ && occ.factionId === f.id) && groupTurret(f) ? { turret: groupTurret(f) } : {}),
  };
}
// The odds the card shows (the same sum the statistical resolver uses: combat.js autoResolveCombat).
export function assaultOdds(power, force, ammoOk = true, people = 0) {
  const mine = power * (ammoOk ? 1 : 0.6);
  const theirs = force.count * force.power * force.fortified + (force.turret ? TURRET_ODDS[force.turret] || 0 : 0); // combat.js byNumbersOdds: their turret
  return winOdds(mine / Math.max(0.1, theirs), { kind: force.kind, count: force.count, people }); // combat.js: calibrated on the battle map
}
const carriedOf = (p, k) => Math.max(0, Math.floor(p.supplies[k] || 0)) + Math.max(0, Math.floor((p.cargo && p.cargo.supplies[k]) || 0));
const carriedAmmo = (p) => sumRecs(p.supplies, p.cargo && p.cargo.supplies); // rounds by key: each gun judged by its own calibre (world.js armedFactor)
// "2 ladders, a battering ram and 3 grenades" (the assault card).
function kitWords(k) {
  const parts = [];
  if (k.ladders) parts.push(k.ladders > 1 ? `${k.ladders} ladders` : "a ladder");
  if (k.ram) parts.push("a battering ram");
  if (k.grenades) parts.push(k.grenades > 1 ? `${k.grenades} grenades` : "a grenade");
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "";
}
export function teamAssaultOdds(state, p, force) {
  const m = partyMembers(state, p);
  // Short of ammo the guns count 60%, short of arrows the bows (world.js armedFactor; with no bow: the old ammo check).
  return assaultOdds(m.reduce((a, s) => a + combatPower(s), 0) * armedFactor(m, carriedAmmo(p), carriedOf(p, "arrows")), force, true, m.length);
}

// Why attacking this group is a bad idea (the planner and the card): "" for a hostile group.
export function assaultWarning(state, f) {
  if (!f) return "";
  const bits = [];
  const att = attitude(f);
  if (isMember(state, f)) bits.push(`${f.name} is in your coalition: they leave it, and every member thinks less of you`);
  if (f.pact) bits.push(`you have a ${f.pact === "trade" ? "trade" : "non-aggression"} pact with them: it ends`);
  if (att !== "Hostile") bits.push(`they are ${att.toLowerCase()} toward you: goodwill falls by ${-CONQUEST.ATTACK_GW} and peaceful groups will remember (infamy +${CONQUEST.INFAMY.other} a base taken)`);
  const partners = pactsOf(state, f).filter((o) => o.known);
  if (partners.length) bits.push(`their pact partners (${partners.map((o) => o.name).join(", ")}) will hold it against you`);
  return bits.length ? `Warning: ${bits.join("; ")}.` : "";
}

// ---------- the mission ----------
export function assaultArrive(state, p) {
  const f = state.factions.find((x) => x.alive && x.bases.includes(p.dest));
  if (!f) { awaitOrders(state, p, `Nobody holds ${tileLabel(state, p.dest)} any more.`, { failed: true }); return ""; }
  f.known = true;
  p.phase = "engaged";
  addCard(state, assaultCard(state, p, f));
  return "";
}

function assaultCard(state, p, f) {
  const tile = partyTile(p);
  const force = assaultForce(state, f, tile, p);
  const odds = teamAssaultOdds(state, p, force);
  const occ = occupiedAt(state, tile);
  const warn = assaultWarning(state, f);
  const wallText = force.walls <= 1 ? "hardly any walls" : force.walls <= 4 ? "a low wall" : "strong walls";
  const last = f.bases.length === 1;
  return {
    title: `Assault: ${tileLabel(state, tile)}`, partyId: p.id, where: tileLabel(state, tile), assault: { factionId: f.id, tile },
    text: `${occ ? `${f.name} hold ${occ.name}, the base they took from you on day ${occ.day}` : `${f.name} (${attitude(f).toLowerCase()}) hold this base`}: about ${force.people} people, ${force.count} of them on ${wallText} (defence ×${force.fortified}). ` +
      `${force.siegeKit && force.walls >= 1 ? `Your team brings ${kitWords(force.siegeKit)}: their walls count ${Math.round(assaultCut(force.siegeKit) * 100)}% less. ` : ""}${force.allies ? `Coalition fighters (${force.allies.names.join(", ")}) keep ${force.allies.held} of the defenders busy. ` : ""}${last ? `It is their last base: take it and ${f.name} is finished.` : `They hold ${f.bases.length} bases.`}${occ ? ` ${occupiedText(state, occ)}` : ""}${warn ? ` ${warn}` : ""}`,
    choices: [
      { label: "Storm the base (tactical battle)", fight: { odds, enemy: force, ambush: null }, hint: `About ${Math.round(odds * 100)}% to win against ${force.count} defenders behind ${wallText}. Win and the base is yours: an outpost with its land and part of its stores. You can fall back from the left edge`,
        resolve: (st) => startAssault(st, p, f) },
      { label: "Back off", hint: "No fight", resolve: (st) => { awaitOrders(st, p, `The team pulled back from ${tileLabel(st, tile)}.`); return "The team pulls back."; } },
    ],
  };
}

export function startAssault(state, p, f) {
  if (!state.parties.includes(p)) return "";
  const tile = partyTile(p);
  if (!f.alive || !f.bases.includes(tile)) { awaitOrders(state, p, `Nobody holds ${tileLabel(state, tile)} any more.`, { failed: true }); return ""; }
  const C = ensureConquest(state);
  C.stats.assaults++;
  const force = assaultForce(state, f, tile, p);
  // Attacking them is an act of war: goodwill, the pact, the coalition.
  if (isMember(state, f)) {
    const A = ensureAlliance(state);
    A.members = A.members.filter((id) => id !== f.id);
    A.history.unshift({ day: day(state), text: `${f.name} left: you attacked them.` });
    log(state, `${f.name} left ${A.name}: you attacked them.`, "danger");
    for (const m of allianceMembers(state)) changeGoodwill(state, m, CONQUEST.MEMBER_GW, `you attacked ${f.name}`);
  }
  if (f.pact) { f.pact = null; log(state, `Your pact with ${f.name} is over: you attacked them.`, "danger"); }
  changeGoodwill(state, f, CONQUEST.ATTACK_GW, "you attacked their base");
  p.phase = "engaged";
  startCombat(state, {
    tile, partyId: p.id, enemy: { ...force }, ambush: null, canRetreat: true, handler: "baseAssault", layout: "baseAssault",
    context: { partyId: p.id, factionId: f.id, tile, people: force.people },
  });
  return "";
}

registerCombatHandler("baseAssault", (state, result, setup) => {
  const c = setup.context;
  const C = ensureConquest(state);
  const p = state.parties.find((x) => x.id === c.partyId);
  // Fought by the numbers: the grenades the team brought were thrown (on the map each one goes when it is thrown).
  if (p && !result.tactical && setup.enemy.siegeKit && setup.enemy.siegeKit.grenades) spendGrenades(state, partyMembers(state, p), p.cargo);
  const f = factionById(state, c.factionId);
  if (p && state.parties.includes(p) && !partyMembers(state, p).length) {
    wipeIfEmpty(state, p);
    log(state, `The assault team died at ${tileLabel(state, c.tile)}.`, "death");
    if (f && result.enemiesKilled) f.pop = Math.max(0, f.pop - Math.ceil(result.enemiesKilled * 0.6));
    if (f && f.alive && groupBroken(f)) collapseFaction(state, f);
    return;
  }
  if (result.outcome === "victory" && f && f.alive && f.bases.includes(c.tile)) {
    C.stats.won++;
    const text = captureBase(state, f, c.tile, p, { people: c.people, taken: (result.prisoners || []).length });
    if (p && state.parties.includes(p)) awaitOrders(state, p, text);
    return;
  }
  C.stats.lost++;
  if (f) f.pop = Math.max(0, f.pop - Math.ceil((result.enemiesKilled || 0) * 0.6));
  let text = result.outcome === "retreat" ? "You pulled back from the walls." : result.outcome === "victory" ? "The defenders are beaten, but the base is no longer theirs to take." : "The assault failed.";
  if (p && state.parties.includes(p) && f && result.outcome === "defeat") {
    const m = partyMembers(state, p);
    if (m.length > 1 && state.rng.chance(0.3)) { const s = state.rng.pick(m); takeCaptive(state, s, f, p); text += ` ${s.name} was caught.`; }
  }
  if (result.outcome !== "victory") log(state, `${text} (${tileLabel(state, c.tile)}${f ? `, ${f.name}` : ""})`, "danger");
  if (f && f.alive && groupBroken(f)) collapseFaction(state, f);
  if (p && state.parties.includes(p) && !wipeIfEmpty(state, p)) awaitOrders(state, p, text);
});

// Their base's map: Medium for a small group up to Extra-large for a big one (battlesize.js SIZES.ASSAULT, by the people
// living there).
// Their walled base on land: the fort map (fort.js), sized for the stand-in base built for it; a bridge barricade or a
// base without walls keeps the wall-line map below.
const fortAssaultable = (state, setup) => !!(setup.enemy && setup.enemy.walls >= 1) && !(state.tiles[typeof setup.tile === "object" ? setup.tile.id : setup.tile] || {}).bridge && !(setup.context && setup.context.strip);
registerBattleSize("baseAssault", (state, setup) => (fortAssaultable(state, setup) ? fortSize(assaultBase(state, setup), {}) : assaultDims(setup.enemy)));
// Their wall line: column 10 of the old 18-wide map, scaled, but never further from your people than the usual
// distance between the sides (battlesize.js CONTACT): on a big map the base's grounds go on behind it.
const assaultWallX = (ctx) => Math.min(Math.round((10 * ctx.W) / 18), CONTACT.PLAYER_X + CONTACT.HUMANS[0]);
// Their wall line on the battle map: a palisade with the gate and breaches (more breaches the weaker the walls),
// barricades behind it, the defenders at the wall and further back.
registerBattleLayout("baseAssault", (b, ctx) => {
  const e = b.setup.enemy || {};
  const walls = e.walls || 0;
  if (fortAssaultable(ctx.state, b.setup)) return fortAssault(b, ctx, b.setup.context || {}); // fort.js: both phases
  const X = assaultWallX(ctx), mid = Math.floor(ctx.H / 2);
  if (ctx.phase === "map") {
    // Their base on a bridge (combat.js layRoad): the wall across the deck only, the river either side, and tank traps on
    // the deck in front of it so no vehicle gets near (combat.js CELL.tanktrap; battered down from next to them).
    const bridge = !!(ctx.state.tiles[b.tileId] && ctx.state.tiles[b.tileId].bridge);
    const onDeck = (y) => !bridge || (!!ctx.cellAt(X, y).deck && ctx.cellAt(X, y).k !== "rail");
    if (walls >= 1) {
      const nBreach = walls <= 2 ? 3 : walls <= 5 ? 2 : 1;
      const rows = ctx.rng.shuffle([...Array(ctx.H).keys()].filter((y) => y >= 1 && y <= ctx.H - 2 && (y <= mid - 3 || y >= mid + 2) && onDeck(y)));
      const breaches = [];
      for (const y of rows) { if (breaches.length >= nBreach) break; if (!breaches.some((o) => Math.abs(o - y) < 3)) breaches.push(y); }
      if (bridge) for (let y = 0; y < ctx.H; y++) {
        if (!onDeck(y)) continue;
        const x = X - 2 - (y % 2);
        if (ctx.free(x, y)) { ctx.put(x, y, "tanktrap"); const cell = ctx.cellAt(x, y); cell.hp = cell.mhp = CONQUEST.TRAP_HP; }
      }
      for (let y = 0; y < ctx.H; y++) {
        if (!onDeck(y)) continue;
        const k = y === mid - 1 || y === mid ? "gate" : breaches.includes(y) ? "breach" : "palisade";
        ctx.put(X, y, k);
        // Their gate is barred and their wall sections have hit points (CONQUEST.GATE_HP / WALL_HP + per wall point):
        // a ram, grenades and ladders (siege.js) or the breaches.
        const cell = ctx.cellAt(X, y);
        if (k === "gate") { cell.bar = true; cell.hp = cell.mhp = CONQUEST.GATE_HP[0] + CONQUEST.GATE_HP[1] * walls; }
        if (k === "palisade") cell.hp = cell.mhp = CONQUEST.WALL_HP[0] + CONQUEST.WALL_HP[1] * walls;
        if (k !== "palisade") { ctx.put(X - 1, y, "open"); ctx.put(X + 1, y, "open"); }
      }
      b.holders = "enemy"; // their walls: your people batter them, theirs walk through their own gate
    }
    for (let i = 0; i < 2 + Math.min(6, walls); i++) {
      for (let t = 0; t < 8; t++) { const x = ctx.rng.int(X + 2, X + 5), y = ctx.rng.int(1, ctx.H - 2); if (ctx.free(x, y)) { ctx.put(x, y, i % 2 ? "sandbag" : "barricade"); break; } }
    }
    return;
  }
  // Units: half the defenders at the wall (right behind it), the rest where the battle put them (behind it too).
  if (walls < 1) return;
  const foes = b.units.filter((u) => u.side === "enemy");
  let k = 0;
  for (const u of foes) {
    if (k++ % 2) { behindWall(ctx, u, X); continue; }
    for (let t = 0; t < ctx.H; t++) {
      const y = (u.y + t) % ctx.H;
      if (ctx.standable(X + 1, y)) { u.x = X + 1; u.y = y; break; }
    }
  }
});
// A defender the battle put in front of their own wall goes back behind it (X + 2 to X + 7, the nearest free cell).
function behindWall(ctx, u, X) {
  if (u.x > X) return;
  let best = null;
  for (let y = 0; y < ctx.H; y++) for (let x = X + 2; x <= Math.min(ctx.W - 1, X + 7); x++) {
    if (!ctx.standable(x, y)) continue;
    const d = Math.abs(y - u.y) + Math.abs(x - (X + 3)) * 0.5;
    if (!best || d < best.d) best = { x, y, d };
  }
  if (best) { u.x = best.x; u.y = best.y; }
}

// ---------- taking a base ----------
const emptyStock = () => ({ food: 0, water: 0, rawwater: 0, fuel: 0, meds: 0, ammo: 0, parts: 0, scrap: 0, preserved: 0, jars: 0 });
function newOutpost(state, tile) {
  return { id: newId(), tile, type: "outpost", name: outpostName(state, tile), stock: emptyStock(), radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
}
// The base is yours. p: the team that took it (or null: a test, a ruin handed back). Returns a line for the card.
export function captureBase(state, f, tile, p, info = {}) {
  const C = ensureConquest(state);
  const g = state.grid;
  const people = info.people ?? peopleAt(state, f, tile);
  const occ = occupiedAt(state, tile);
  const wasMain = f.bases[0] === tile && !occ && f.bases.length > 1; // their main base (not their last)
  const home = f.bases[0] === tile && !occ; // their home: their motor pool is there (vehicles.js f.vehicles)
  const w = f.bases.length - 1 + CONQUEST.HOME_WEIGHT;
  const share = (f.bases[0] === tile ? CONQUEST.HOME_WEIGHT : 1) / Math.max(1, w);
  const noHub = !hub(state);
  let base;
  if (occ) {
    base = occ.base;
    C.occupied.splice(C.occupied.indexOf(occ), 1);
    base.retaken = day(state);
    base.repairs = [];
  } else {
    base = newOutpost(state, tile);
    base.captured = { from: f.id, name: f.name, day: day(state) };
    // What they built there: their palisade (battered: two sections behind strong walls, one behind any, none where they
    // had put up none yet) and their quarters (a bunkhouse, 6 beds, where they had built some: groupworks.js).
    const nw = nativeWalls(f, tile, state);
    for (let i = 0; i < (nw > 1 ? 2 : nw > 0 ? 1 : 0); i++) { const wb = addBuilding(base, "walls"); wb.wear = 70; }
    if (!groupsBuild(state, f) || ((f.works && f.works[tile] && f.works[tile].beds) || 0) > 0) addBuilding(base, "bunkhouse").wear = 30;
  }
  base.type = noHub ? "hub" : "outpost";
  base.alert = false;
  // Their stores at this base: half of it is yours, the rest is spoiled, burned or carried off.
  const got = [];
  for (const k of Object.keys(f.stock)) {
    const here = Math.max(0, (f.stock[k] || 0) * share);
    f.stock[k] = Math.max(0, (f.stock[k] || 0) - here);
    if (!SUPPLIES[k]) continue;
    const q = Math.floor(here * CONQUEST.STOCK_SHARE);
    if (q > 0) { base.stock[k] = (base.stock[k] || 0) + q; got.push(`${q} ${keyWord(k)}`); }
  }
  // Their spare weapons and armour kept there (arsenal.js): the same share as the stores.
  const kit = arsenalShareTo(state, f, share * CONQUEST.STOCK_SHARE, base.armory);
  if (kit.length) got.push(kit.length === 1 ? kit[0].name : `${kit.length} pieces of their kit`);
  f.bases = f.bases.filter((t) => t !== tile);
  state.bases.push(base);
  askBaseName(state, base);
  const seized = home && f.vehicles && f.vehicles.length ? seizeGroupVehicles(state, f, base) : []; // vehicles.js: their Army truck and Humvee are yours
  // Who holds it: one or two of the team (the weakest fighters), everyone when you have no other base.
  const team = p && state.parties.includes(p) ? partyMembers(state, p) : [];
  const stay = noHub ? team : [...team].sort((a, b) => combatPower(a) - combatPower(b) || a.id - b.id).slice(0, state.autopilot ? 0 : team.length >= 3 ? 1 : 0); // the autopilot keeps its squad together: a captured base is land, held by whoever joins there
  for (const s of stay) {
    s.location = { kind: "base", baseId: base.id };
    s.role = "guard";
    p.members = p.members.filter((id) => id !== s.id);
  }
  if (p && state.parties.includes(p) && !partyMembers(state, p).length) {
    // The whole team moved in: what it carried and the vehicle too, and prisoners go to the cells here.
    for (const pr of prisonersOf(state)) if (pr.at && pr.at.kind === "party" && pr.at.partyId === p.id) pr.at = { kind: "base", baseId: base.id };
    for (const pool of [p.supplies, p.cargo.supplies]) for (const [k, q] of Object.entries(pool)) if (SUPPLIES[k] && q >= 1) base.stock[k] = (base.stock[k] || 0) + Math.floor(q);
    base.armory.push(...p.cargo.gear);
    const v = p.vehicleId ? state.vehicles.find((x) => x.id === p.vehicleId) : null;
    if (v) v.loc = { kind: "base", baseId: base.id };
    removeParty(state, p);
  }
  // Their people at this base.
  const bits0 = [];
  const killed = Math.min(people, Math.max(0, Math.round(people * 0.35)));
  const fled = f.bases.length ? Math.floor((people - killed) * CONQUEST.FLEE) : 0;
  const gaveUp = Math.max(0, people - killed - fled - (info.taken || 0));
  const join = Math.min(CONQUEST.JOIN_MAX, Math.round(gaveUp * CONQUEST.JOIN));
  const jailed = Math.min(CONQUEST.PRISON_MAX, Math.round(gaveUp * CONQUEST.PRISON));
  f.pop = Math.max(0, f.pop - Math.max(0, people - fled - (info.taken || 0)));
  if (jailed) surrenderPrisoners(state, f, base, jailed); // prisoners.js: what the jails here and at your other bases hold; a card for the rest
  // Your people they held here (all of them, if this was their last base).
  const freed = captivesOf(state, f.id).filter((s) => s.location.tile === tile || !f.bases.length);
  for (const s of freed) { s.location = { kind: "base", baseId: base.id }; s.role = "rest"; s.mood = Math.min(100, s.mood + 15); }
  if (freed.length) { state.stats.conflicts && (state.stats.conflicts.rescued += freed.length); }
  assignStations(state, base);
  recomputeOwnership(state);
  state.knowledge[tile] = snapshot(state, tile); // you were there: the map shows it as yours
  C.stats.taken++;
  if (occ) C.stats.retaken++;
  state.stats.basesTaken = (state.stats.basesTaken || 0) + 1;
  // Their main base: the leaders fall with it. Half of those left scatter, and a group down to GROUP_BREAK (3) people
  // breaks up.
  if (wasMain && f.bases.length) {
    const gone = Math.floor(f.pop * CONQUEST.MAIN_SCATTER);
    f.pop -= gone;
    if (gone) bits0.push(`Their leaders fell with it: ${gone} of ${f.name} scattered.`);
  }
  const defeated = !f.bases.length || groupBroken(f);
  if (!info.ceded) fallout(state, f, defeated); // a base handed over in a peace (playerwars.js) is no conquest
  pwarBaseTaken(state, f, tile); // playerwars.js: it counts for a war with them
  const where = occ ? `${base.name} is yours again` : `${f.name}'s base at ${tileLabel(state, tile)} is yours`;
  const bits = [`${where}${base.type === "hub" ? " (your new hub)" : ""}.`];
  if (got.length) bits.push(`Their stores there: ${got.slice(0, 5).join(", ")}.`);
  if (seized.length) bits.push(`Their motor pool is yours: ${seized.map((v) => `the ${v.name}${upgradeText(v) ? ` (${upgradeText(v).replace(/^./, (c) => c.toLowerCase())})` : ""}`).join(" and ")}.`);
  if (stay.length && p) bits.push(`${names(stay)} ${stay.length === 1 ? "stays" : "stay"} to hold it.`);
  if (freed.length) bits.push(`${names(freed)} ${freed.length === 1 ? "is" : "are"} free.`);
  if (jailed) bits.push(`${jailed} of them ${jailed === 1 ? "is" : "are"} held prisoner there.`);
  if (fled) bits.push(`${fled} got away to their other base${f.bases.length === 1 ? "" : "s"}.`);
  bits.push(...bits0);
  history(state, occ ? `You took ${base.name} back from ${f.name}.` : `You took ${tileLabel(state, tile)} from ${f.name}.`);
  log(state, `${info.ceded ? `${f.name} handed over ${occ ? base.name : `their base at ${tileLabel(state, tile)}`}.` : occ ? `Your team took ${base.name} back from ${f.name}.` : `Your team took ${f.name}'s base at ${tileLabel(state, tile)}.`} ${bits.slice(1).join(" ")}`, "good");
  if (join) {
    const list = Array.from({ length: join }, () => makeCandidate(state, { quality: 0.8, minHealth: 40 }));
    offerRecruits(state, list, { source: "conquest", baseId: base.id, title: `${f.name} fighters lay down their arms`, intro: `Some of ${f.name}'s people at ${tileLabel(state, tile)} ask to join you rather than run.` });
  }
  if (defeated && f.alive) {
    C.stats.defeated++;
    f.brokenByYou = day(state); // tools: a group you conquered, not one the wars or the dead broke
    history(state, `${f.name} is finished.`);
    collapseFaction(state, f);
    log(state, `${f.name} is no more: you took ${f.bases.length ? "the heart out of it" : "its last base"}.`, "good");
  }
  checkGameOver(state);
  return bits.join(" ");
}

// Goodwill and infamy after you take a base from f (defeated: it was their end).
function fallout(state, f, defeated) {
  const C = ensureConquest(state);
  const F = CONQUEST.FALLOUT, I = CONQUEST.INFAMY;
  const bandits = isAggressiveType(f) && attitude(f) === "Hostile";
  C.infamy = Math.min(I.max, C.infamy + (bandits ? I.hostile : I.other) + (defeated ? (bandits ? I.defeatHostile : I.defeatOther) : 0));
  const partners = new Set(pactsOf(state, f).map((o) => o.id));
  for (const o of state.factions) {
    if (!o.alive || o === f) continue;
    const r = relation(state, o, f);
    if (partners.has(o.id)) changeGoodwill(state, o, defeated ? F.pactDefeat : F.pact, `you ${defeated ? "destroyed" : "attacked"} ${f.name}, their pact partner`);
    else if (r >= F.friendRel) changeGoodwill(state, o, defeated ? F.friendDefeat : F.friend, `you ${defeated ? "destroyed" : "attacked"} their friends ${f.name}`);
    else if (r <= F.enemyRel) changeGoodwill(state, o, defeated ? F.enemyDefeat : F.enemy, `you struck at ${f.name}, their enemy`);
  }
}

// ---------- losing a base ----------
// What a team leaving a base takes: water and food for 4 days, 15 scrap (a new base), ammo, meds, then more food.
function packFor(state, members, base, v) {
  const n = members.length;
  let room = carryCapacity(state, members, v);
  const out = {};
  const take = (k, q) => {
    if (k === "ammo") { // ammo.js: the rounds that fit their guns, as far as the room goes
      const got = packRounds(base.stock, members, Math.min(Math.floor(q), Math.floor(room / 0.03)));
      for (const [kk, qq] of Object.entries(got)) { out[kk] = (out[kk] || 0) + qq; room -= qq * (SUPPLIES[kk] ? SUPPLIES[kk].weight : 0.02); }
      return;
    }
    const w = SUPPLIES[k].weight;
    const have = Math.floor(base.stock[k] || 0);
    const qty = Math.max(0, Math.min(have, Math.floor(q), Math.floor(room / w)));
    if (!qty) return;
    base.stock[k] = have - qty;
    out[k] = (out[k] || 0) + qty;
    room -= qty * w;
  };
  const wantW = Math.ceil(n * 4 * thirstAhead(state, 4)); // more in summer and a heat wave (weather.js)
  take("water", wantW); take("rawwater", wantW - (out.water || 0)); // purified first (water.js)
  take("food", n * 4); take("scrap", 15); take("ammo", n * 15); take("meds", n * 2); take("preserved", n * 4);
  take("food", n * 6); take("fuel", v ? 20 : 0); take("parts", 3); take("ammo", 200); take("meds", 10); take("scrap", 40);
  return out;
}
function makeTeam(state, members, tile, home, supplies, v) {
  const sup = {};
  for (const k of SUPPLY_KEYS) sup[k] = Math.max(0, Math.floor(supplies[k] || 0));
  const p = {
    id: newId(), owner: "player", kind: "expedition", mission: "move", teamMission: "retreat", dest: tile, homeBaseId: home ? home.id : null,
    members: members.map((s) => s.id), stance: "normal", vehicle: !!v, vehicleId: v ? v.id : null, supplies: sup, cargo: { supplies: {}, gear: [] },
    path: [tile], idx: 0, progress: 0, phase: "waiting", seen: new Map(), spotted: new Map(), sightNow: [], radioLive: false,
    departed: state.hour, plannedHours: 0, eventsSeen: 0, orders: [], orderStart: state.hour,
    planPath: [tile], planStart: state.hour, planVehicle: !!v, planFuel: v ? v.fuel : 0, etaOut: 0, etaBack: null,
  };
  if (v) v.loc = { kind: "party", partyId: p.id };
  for (const s of members) { s.location = { kind: "party", partyId: p.id }; s.station = null; s.inBed = false; }
  state.parties.push(p);
  return p;
}
// The nearest other base of yours (by tiles), or null.
export function nearestOtherBase(state, base) {
  const g = state.grid;
  return state.bases.filter((b) => b !== base).sort((a, b) => g.distance(a.tile, base.tile) - g.distance(b.tile, base.tile) || a.id - b.id)[0] || null;
}
// A tile to fall back to with nowhere to go: 3 tiles out, away from the group's other bases, reachable on foot.
function fallbackTile(state, base, f) {
  const g = state.grid;
  let best = null;
  for (const id of g.within(base.tile, 4)) {
    const t = state.tiles[id];
    if (g.distance(id, base.tile) < 2 || t.terrain === "water" || t.terrain === "mountain" || (t.owner != null && t.owner !== "player")) continue; // not on their land
    if (state.factions.some((o) => o.alive && o.bases.includes(id))) continue;
    const away = f && f.bases.length ? Math.min(...f.bases.filter((b) => b !== base.tile).map((b) => g.distance(b, id)).concat([99])) : 0;
    const sc = away - (t.loc ? 0 : 0.5) + (t.loc && t.loc.type === "farm" ? 1 : 0);
    if ((!best || sc > best.sc) && planPath(state, base.tile, id, false)) best = { id, sc };
  }
  return best ? best.id : base.tile;
}
// The people at a base leave it as a team: to your nearest other base, or onto the road when there is none.
// Returns the team (or null when nobody was there).
export function evacuate(state, base, f = null, why = "") {
  const people = atBase(state, base.id);
  if (!people.length) return null;
  const to = nearestOtherBase(state, base);
  const parked = state.vehicles.filter((v) => v.loc.kind === "base" && v.loc.baseId === base.id);
  const v = parked.filter((x) => x.condition > 0).sort((a, b) => b.condition - a.condition || a.id - b.id)[0] || null;
  const sup = packFor(state, people, base, v);
  const p = makeTeam(state, people, base.tile, to, sup, v);
  if (to) {
    startReturn(state, p);
    log(state, `${names(people)} left ${base.name}${why ? ` (${why})` : ""} for ${to.name}${v ? ` in the ${v.name}` : " on foot"}, carrying ${Object.entries(sup).filter(([, q]) => q > 0).map(([k, q]) => `${q} ${keyWord(k)}`).join(", ") || "nothing"}.`, "danger");
  } else {
    p.exile = true;
    ensureConquest(state).stats.exiles++;
    const tile = fallbackTile(state, base, f);
    if (tile !== base.tile) orderMove(state, p, tile);
    else awaitOrders(state, p, "There is no base left to go to.");
    log(state, `${names(people)} took to the road from ${base.name}${why ? ` (${why})` : ""}: you have no base left. Found a new one (Establish base: a staging camp you build up into your hub) or take ${base.name} back.`, "death"); // staging.js
  }
  return p;
}

// A group takes one of your bases: it leaves your list and goes on theirs, with its buildings and what they did not
// carry off. opts: { garrison, retreated, outcome }.
export function occupyPlayerBase(state, base, f, opts = {}) {
  const C = ensureConquest(state);
  const i = state.bases.indexOf(base);
  if (i < 0 || !f) return null;
  f.known = true; // they took it: you know who they are
  const wasHub = base.type === "hub";
  noteBaseLoss(state, base, opts.retreated ? "retreat" : "taken", f); // causes.js: why it was lost (before the people leave)
  if (!opts.retreated) evacuate(state, base, f, opts.ceded ? `handed over to ${f.name} in the peace` : `${f.name} took it`);
  // Anyone left there (nobody, normally) is gone with it; prisoners of that group walk free; others are left to
  // prisoners.js (a base that is gone).
  for (const s of atBase(state, base.id)) s.location = { kind: "captive", factionId: f.id, tile: base.tile, since: state.hour };
  for (const pr of [...prisonersOf(state)]) if (pr.at && pr.at.kind === "base" && pr.at.baseId === base.id && pr.factionId === f.id) { state.prisoners.splice(state.prisoners.indexOf(pr), 1); f.pop += 1; }
  // Vehicles left behind, supply runs paused, teams based there go to the hub.
  for (const v of state.vehicles) {
    if (v.loc.kind !== "base" || v.loc.baseId !== base.id) continue;
    v.loc = { kind: "abandoned", tile: base.tile, since: state.hour };
    markAbandonedVehicle(state, v, `left at ${base.name}`);
  }
  for (const job of state.supplyRuns || []) if ((job.originId === base.id || job.destId === base.id) && job.status !== "done" && job.status !== "disbanded") { job.paused = true; job.lastResult = `Day ${day(state)}: ${base.name} was taken by ${f.name}`; }
  state.bases.splice(i, 1);
  // What they carry off: half of what is left, and the fighting gear in the armory (arsenal.js: they will use it).
  const took = [];
  const arms = (base.armory || []).filter(arsenalWorthy);
  for (const it of arms) if (addToArsenal(state, f, it, "stolen")) base.armory.splice(base.armory.indexOf(it), 1);
  if (arms.length) took.push(arms.length === 1 ? arms[0].name : `${arms.length} pieces of gear from the armory`);
  for (const k of Object.keys(base.stock)) {
    const q = Math.floor((base.stock[k] || 0) / 2);
    if (q <= 0) continue;
    base.stock[k] -= q;
    if (k !== "water" && k !== "rawwater") f.stock[k] = (f.stock[k] || 0) + q;
    took.push(`${q} ${keyWord(k)}`);
  }
  base.alert = false;
  base.repairs = [];
  base.construction = [];
  base.type = "outpost";
  f.bases.push(base.tile);
  const garrison = Math.max(CONQUEST.GARRISON_MIN, Math.round((opts.garrison || 3) * CONQUEST.GARRISON));
  C.occupied.push({ tile: base.tile, base, name: base.name, factionId: f.id, day: day(state), garrison, garrisonMax: garrison, wasHub, how: opts.retreated ? "retreat" : opts.outcome || "overrun" });
  C.stats.basesLost++;
  if (wasHub) C.stats.hubsLost++;
  history(state, `${f.name} took ${base.name}.`);
  // The hub: the nearest base takes over (or nobody has a base any more: the exiles).
  let newHub = null;
  if (wasHub) newHub = promoteHub(state, base.tile);
  for (const p of state.parties) if (p.owner === "player" && p.homeBaseId === base.id) p.homeBaseId = hub(state) ? hub(state).id : null;
  // No base left: cards about a base (newcomers at the gate, the council, radio offers, war calls) point at nothing.
  if (!state.bases.length) for (let j = state.cards.length - 1; j >= 0; j--) if (state.cards[j].partyId == null) state.cards.splice(j, 1);
  recomputeOwnership(state);
  state.knowledge[base.tile] = snapshot(state, base.tile); // the last look your people had: theirs now
  clearStaleAlerts(state);
  const broken = fixtures(base).filter((fx) => fx.broken).map((fx) => fixtureName(fx).toLowerCase());
  const text = `${f.name} ${opts.ceded ? "were handed" : opts.retreated ? "moved into" : "took"} ${base.name}${took.length ? ` and carried off ${took.slice(0, 4).join(", ")}` : ""}. They hold it with about ${garrison} people${broken.length ? `; ${broken.slice(0, 3).join(", ")} ${broken.length === 1 ? "is" : "are"} broken` : ""}.` +
    `${newHub ? ` ${newHub.name} is your hub now.` : wasHub && !hub(state) ? " You have no base left." : ""} Send an Assault their base team to take it back: the sooner, the weaker its walls.`;
  log(state, text, opts.ceded ? "danger" : "death");
  if (!opts.ceded) addCard(state, { title: `${base.name} has fallen`, text, lostBase: base.tile, choices: [{ label: "OK", resolve: () => "" }] }); // ceded in a peace (playerwars.js): no card
  return C.occupied[C.occupied.length - 1];
}
// The hub is gone: the nearest base becomes the hub. Returns it (null: no base left).
export function promoteHub(state, nearTile) {
  if (hub(state)) return hub(state);
  if (!state.bases.length) return null;
  const g = state.grid;
  const b = [...state.bases].sort((x, y) => g.distance(x.tile, nearTile) - g.distance(y.tile, nearTile) || x.id - y.id)[0];
  b.type = "hub";
  assignStations(state, b);
  log(state, `${b.name} is your hub now.`, "info");
  return b;
}

// A group burns a base of yours to the ground (factions.js baseFate "raze"): the people there walk to your nearest
// base (or take to the road), every building goes, the stock is carried off or burned, parked vehicles burn, and the
// tile is a ruin: a little to scavenge, and a new outpost there needs only 5 scrap (10 salvaged from the ruins).
// The hub razed: the nearest base becomes the hub, as when it is taken.
export function razePlayerBase(state, base, f) {
  const C = ensureConquest(state);
  const i = state.bases.indexOf(base);
  if (i < 0) return false;
  const wasHub = base.type === "hub";
  noteBaseLoss(state, base, "razed", f); // causes.js: why it was lost (before the people leave)
  evacuate(state, base, f, f ? `${f.name} burned it` : "it burned");
  for (const s of atBase(state, base.id)) s.location = { kind: "captive", factionId: f ? f.id : null, tile: base.tile, since: state.hour };
  for (const pr of [...prisonersOf(state)]) if (pr.at && pr.at.kind === "base" && pr.at.baseId === base.id && f && pr.factionId === f.id) { state.prisoners.splice(state.prisoners.indexOf(pr), 1); f.pop += 1; }
  const burned = state.vehicles.filter((v) => v.loc.kind === "base" && v.loc.baseId === base.id);
  for (const v of burned) state.vehicles.splice(state.vehicles.indexOf(v), 1);
  for (const job of state.supplyRuns || []) if ((job.originId === base.id || job.destId === base.id) && job.status !== "done" && job.status !== "disbanded") { job.paused = true; job.lastResult = `Day ${day(state)}: ${base.name} was burned down`; }
  if (f) for (const k of Object.keys(base.stock)) if (k !== "water" && k !== "rawwater" && SUPPLIES[k]) f.stock[k] = (f.stock[k] || 0) + Math.floor((base.stock[k] || 0) * 0.6);
  const nBuild = base.buildings.length;
  state.bases.splice(i, 1);
  const t = state.tiles[base.tile];
  t.ruin = { name: base.name, day: day(state), by: f ? f.name : "raiders", from: "you", yours: true };
  t.loot = Math.max(t.loot || 0, 0.25);
  state.stats.razedYours = (state.stats.razedYours || 0) + 1;
  C.stats.razed = (C.stats.razed || 0) + 1;
  if (wasHub) C.stats.hubsLost++;
  history(state, `${f ? f.name : "Raiders"} burned ${base.name} down.`);
  let newHub = null;
  if (wasHub) newHub = promoteHub(state, base.tile);
  for (const p of state.parties) if (p.owner === "player" && p.homeBaseId === base.id) p.homeBaseId = hub(state) ? hub(state).id : null;
  if (!state.bases.length) for (let j = state.cards.length - 1; j >= 0; j--) if (state.cards[j].partyId == null) state.cards.splice(j, 1);
  recomputeOwnership(state);
  clearStaleAlerts(state);
  state.knowledge[base.tile] = snapshot(state, base.tile);
  const text = `${f ? f.name : "Raiders"} burned ${base.name} to the ground: ${nBuild ? `all ${nBuild} building${nBuild === 1 ? "" : "s"}` : "everything"} and its stores${burned.length ? `, and the ${burned.map((v) => v.name).join(" and ")}` : ""}. Only ruins are left: a new outpost there needs just 5 scrap (the rest is salvage).` +
    `${newHub ? ` ${newHub.name} is your hub now.` : wasHub && !hub(state) ? " You have no base left." : ""}`;
  log(state, text, "death");
  addCard(state, { title: `${base.name} burned`, text, lostBase: base.tile, choices: [{ label: "OK", resolve: () => "" }] });
  return true;
}

// Retreat from a base before a raid gets there (the raid warning card): everyone leaves, the raid takes it.
export function retreatFrom(state, base, raid) {
  if (!state.bases.includes(base)) return "That base is gone.";
  const p = evacuate(state, base, raid ? factionById(state, raid.owner) : null, "falling back before the raid");
  base.abandoned = raid ? raid.id : true;
  base.alert = false;
  ensureConquest(state).stats.retreats++;
  return p ? `${base.name} is abandoned: its people are on the road.` : `Nobody was at ${base.name}.`;
}

// ---------- daily ----------
export function conquestDaily(state) {
  const C = ensureConquest(state);
  const I = CONQUEST.INFAMY;
  C.infamy = Math.max(0, C.infamy - I.fade);
  if (C.infamy > I.wary) {
    const drop = (C.infamy - I.wary) * I.drift;
    for (const f of state.factions) if (f.alive && f.known && !isAggressiveType(f) && !isMember(state, f) && attitude(f) !== "Hostile") changeGoodwill(state, f, -drop, "they fear what you do to other groups");
  }
  // Bases taken from you: the holders patch them up; a base whose holders are gone comes back to you as ruins.
  for (const o of [...C.occupied]) {
    const holder = state.factions.find((f) => f.alive && f.bases.includes(o.tile));
    if (!holder) {
      C.occupied.splice(C.occupied.indexOf(o), 1);
      if (state.bases.some((b) => b.tile === o.tile)) continue;
      o.base.type = hub(state) ? "outpost" : "hub";
      o.base.alert = false;
      state.bases.push(o.base);
      recomputeOwnership(state);
      log(state, `${o.name} stands empty: its holders are gone. It is yours again (nobody is there yet).`, "good");
      history(state, `${o.name} came back to you empty.`);
      continue;
    }
    if (holder.id !== o.factionId) { o.factionId = holder.id; o.garrison = Math.max(CONQUEST.GARRISON_MIN, o.garrison * 0.6); }
    o.garrison = Math.min(o.garrisonMax, o.garrison + CONQUEST.GARRISON_GROW);
    for (const fx of fixtures(o.base)) {
      if (fx.broken) { if (state.rng.chance(CONQUEST.REPAIR)) { fx.broken = null; fx.wear = CONQUEST.REPAIR_WEAR; } }
      else if (fx.wear > 0) fx.wear = Math.max(0, fx.wear - CONQUEST.WEAR_FALL);
    }
  }
  // Base abandoned before a raid that never came: nothing to do; the flag clears once that raid is gone.
  for (const b of state.bases) if (b.abandoned != null && !state.parties.some((q) => q.id === b.abandoned)) delete b.abandoned;
}

// For the tile panel: who holds a base of yours, since when, broken buildings, garrison.
export function occupiedText(state, o) {
  const f = factionById(state, o.factionId);
  const broken = fixtures(o.base).filter((fx) => fx.broken).map((fx) => fixtureName(fx).toLowerCase());
  const walls = baseWalls(o.base);
  return `Taken from you on day ${o.day}${f ? ` by ${f.name}` : ""}. ${broken.length ? `Still broken: ${broken.slice(0, 4).join(", ")}${broken.length > 4 ? "…" : ""}; repairs under way.` : "Repaired."} Walls ${walls}, garrison about ${Math.round(o.garrison)}.`;
}
// For the autopilot and the Goals panel: the strength of the squad that could storm it.
export const squadValue = (list) => list.reduce((a, s) => a + combatPower(s), 0);
export { supplyValue };
