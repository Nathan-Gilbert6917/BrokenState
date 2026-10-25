// @ts-check
// Recover the convoy (the user's request 2026-10-25: "Recover the convoy. You can task a team or request an allied group
// to recover the convoy. Requesting an allied group will cost something, and they will create a team, go to the tile,
// get the vehicles and supplies, and move the team with the recovered equipment to your nearest base, or to a designated
// base or location given in the request. The request is sent by envoy if no radio communications are established. When
// you send a team, it's a move-to-tile raid: try to get as much as you can before leaving back to the base of origin").
// Your vehicles left abandoned on a tile (parties.js wipeParty / leaveVehicle, walkers.js shedSurplusVehicles) are
// "the convoy" there: convoyAt.
//
// Your own team (mission "convoy", parties.js MISSIONS / orderOptions, the tile card's Recover convoy):
// - It travels by the normal rules. On arrival (convoyRecoverArrive) the vehicles still there join the team (up to
//   MAX_VEHICLES with its own) with their cargo still inside, and the team goes in: a raid on the tile's street map
//   (scavenge.js raidEnemies: the tile's dead, any group there), the vehicles parked by the entry edge (combat.js
//   createRaid, placeRaidConvoy: no spot is kept where they were left). By the numbers (the autopilot, a headless run)
//   the same raid is resolved by combat.js autoResolveCombat.
// - Out again (convoyAfter, the combat handler "convoyRecover"): every vehicle with someone at the wheel goes (walkers.js
//   shedSurplusVehicles: the drivers rule, the worst left first); the cargo in the ones that go comes into the team's
//   load as far as it has room (parties.js takeVehicleCargo), the rest is set down on the tile (carry.js leaveOnGround),
//   still marked; a vehicle nobody drives stays with its cargo inside, marked. Then the team heads for its base of
//   origin (parties.js startReturn).
// - Gone before the team got there (taken by a group: groupworld.js takeVehicle; a group strips bikes but leaves them):
//   the card says who took them when the team can tell (noteTaken: the taker's name if you know the group), and the
//   team turns for home.
//
// An allied group (envoys.js kind "recover", the Diplomacy window's Envoys tab):
// - Offered to a group you stand well with (recoverOffered: standing RECOVER.MIN_STANDING or more, or a coalition member).
// - The fee (recoverFee): RECOVER.FEE value (base + per tile from their base to the convoy and on to the destination +
//   a share of the cargo's and the vehicles' worth) in the goods they need most that your base has. Paid on agreement,
//   carried by your envoy as aid is (with a radio link the answer is at once and the envoy takes the goods). They refuse
//   when standing is low or they are at war near the convoy (recoverAnswer), else by the dice of envoys.js aiAnswer.
// - Their party (sendRecovery, an AI party of kind "recovery"): a driver for each vehicle and RECOVER.GUARDS guards. It
//   walks to the tile (parties.js aiPartyHour), fights the tile's dead by the numbers (groupfight.js fightSides, as their
//   parties meet a horde), drives the vehicles (loc "towed") with their cargo to the destination: at a base of yours
//   they join it (the cargo into its stores, as a team unloads: storage limits as today); at a tile they are parked
//   there as your abandoned vehicles, cargo inside, marked. Then it goes home.
// - Failure: the vehicles gone before it gets there, half the fee back (RECOVER.REFUND, by their caravan) and word to
//   you (envoys.js cardFromGroup: by radio, else by their envoy); the dead too many, the party turns back (no refund);
//   the party lost on the way (an ambush, a horde: parties.js removeParty → recoveryLost) leaves the vehicles abandoned
//   where it happened. Every step goes in the diary (log).
// AI parity (docs/adr/0001-ai-parity.md): a group's own vehicles never stand abandoned on the map (motor-pool records,
// docs/features/travel.md "A lost team's vehicles keep what was in them"), so there is nothing of theirs to go back for;
// see docs/features/travel.md "Recover the convoy".
/** @import { State, Party, Faction, Vehicle } from "./types" */
import { log, addCard, hub, baseById, factionById, day, isNight } from "./world.js";
import { partyMembers, partyTile, tileLabel, awaitOrders, startReturn, weighTeam, wipeParty, leaveVehicle, takeVehicleCargo, spawnAiParty, planPath, removeParty, teamName } from "./parties.js";
import { partyVehicles, setPartyVehicles, vehicleLabel, isBike, MAX_VEHICLES } from "./vehicles.js";
import { vehicleValue } from "./vehicles.js";
import { shedSurplusVehicles } from "./walkers.js";
import { leaveOnGround } from "./carry.js";
import { markAbandonedVehicle, spot } from "./markers.js";
import { raidEnemies } from "./scavenge.js";
import { startCombat, registerCombatHandler } from "./combat.js";
import { fightersOf, fightSides, applySide } from "./groupfight.js";
import { zombieToughness } from "./hives.js";
import { supValue, SUPPLIES, GEAR } from "./data.js";
import { foodIn } from "./foods.js";
import { need } from "./trade.js";
import { canRadioGroup } from "./radio.js";
import { warsOf, enemyIn } from "./diplomacy.js";
import { standing } from "./coalition.js";
import { isMember } from "./alliance.js";
import { sendCaravan } from "./caravans.js";
import { cardFromGroup } from "./envoys.js";
import { tickHour } from "./world.js";

// Every number of the recovery in one place.
export const RECOVER = {
  // The group's fee in value (supValue units): BASE + PER_TILE × (their base → the convoy + the convoy → the
  // destination) + CARGO × what the cargo is worth + VEHICLE × what the vehicles are worth (vehicletrade.js vehicleValue).
  FEE: { BASE: 20, PER_TILE: 4, CARGO: 0.15, VEHICLE: 0.05 },
  FEE_GOODS: ["fuel", "meds", "food", "scrap", "parts"], // what they ask for, the one they need most first
  REFUND: 0.5,        // of the fee, back when the vehicles were gone before their party got there
  MIN_STANDING: 15,   // standing (coalition.js) a group needs with you to be asked at all (a coalition member always)
  WAR_RANGE: 8,       // a war of theirs with a base this near the convoy: they will not send a party there
  GUARDS: 2,          // guards on top of a driver for each vehicle
  ODDS: 10,           // added to standing for the dice (a paid job), as envoys.js aiAnswer's favours
  DEAD_PER: 14,       // the tile's dead their party meets: infection × this (as their parties meet a horde)
  TAKEN_KEEP: 30,     // vehicles taken from the map remembered (noteTaken)
};

// ---------- the convoy on a tile ----------
// Your vehicles standing abandoned on a tile (not a found car that needs repair: foundcars.js; not a burnt-out wreck).
/** @param {State} state @param {number} tile @returns {Vehicle[]} */
export const convoyAt = (state, tile) => state.vehicles.filter((v) => v.loc.kind === "abandoned" && v.loc.tile === tile && !(v.found && v.found.repair) && !v.destroyed);
// Is there one of your vehicles marked on the map there (what the hub knows)?
export const convoyKnownAt = (state, tile) => state.markers.some((m) => m.type === "vehicle" && m.tile === tile && !m.remove);
// Why a team cannot be sent to recover a convoy there (parties.js missionProblem), from what is known.
export const convoyProblem = (state, tile) => (convoyKnownAt(state, tile) || convoyAt(state, tile).length ? "" : "No vehicle of yours is known to stand there.");
// What a vehicle's cargo is worth (supplies by value, gear by its value and quality).
export function cargoValue(v) {
  const c = v && v.cargo;
  if (!c) return 0;
  return Object.entries(c.supplies || {}).reduce((a, [k, q]) => a + (q > 0 ? q * supValue(k) : 0), 0) + (c.gear || []).reduce((a, g) => a + (GEAR[g.key]?.value || 0) * (g.quality || 1), 0);
}

// A group took or stripped one of your vehicles on the map (groupworld.js vehicleDaily): remembered, so a team sent
// for it later can say who (convoyRecoverArrive) and the Why panel can name them (causes.js). Recording only.
/** @param {State} state @param {Faction} f @param {Vehicle} v @param {"took" | "stripped"} how */
export function noteTaken(state, f, v, how) {
  const list = (state.vehiclesTaken = state.vehiclesTaken || []);
  list.unshift({ vid: v.id, name: vehicleLabel(v), tile: v.loc.tile, fid: f.id, group: f.name, how, hour: state.hour, since: v.loc.since ?? null });
  if (list.length > RECOVER.TAKEN_KEEP) list.length = RECOVER.TAKEN_KEEP;
}
const takenAt = (state, tile) => (state.vehiclesTaken || []).filter((r) => r.tile === tile && r.how === "took");
const list = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const cargoWords = (c) => [...Object.entries((c && c.supplies) || {}).filter(([, q]) => q >= 1).map(([k, q]) => `${Math.floor(q)} ${(SUPPLIES[k] ? SUPPLIES[k].name : k).toLowerCase()}`), ...((c && c.gear) || []).map((g) => g.name)];
// The vehicle markers on a tile, taken off the map (by the team: its report brings it home).
function unmark(state, p, tile, vs = null) {
  for (const m of [...state.markers, ...(p && p.spotted ? p.spotted.values() : [])]) {
    if (m.type !== "vehicle" || m.tile !== tile || m.remove) continue;
    if (vs && !vs.some((v) => m.key === `vehicle:${v.id}`)) continue;
    if (p) spot(p, { key: m.key, type: "vehicle", tile, hour: state.hour, label: m.label, remove: true });
    const i = state.markers.indexOf(m);
    if (i >= 0) state.markers.splice(i, 1);
  }
}

// ---------- your own team ----------
// The team at the tile (parties.js arrive, mission "convoy").
/** @param {State} state @param {Party} p */
export function convoyRecoverArrive(state, p) {
  const tile = partyTile(p);
  const vs = convoyAt(state, tile);
  if (!vs.length) return convoyGone(state, p, tile);
  const have = partyVehicles(state, p);
  // Cars first, the most worth first; bikes last (a team keeps one stack of them).
  const order = [...vs].sort((a, b) => +isBike(a) - +isBike(b) || vehicleValue(b) + cargoValue(b) - vehicleValue(a) - cargoValue(a) || a.id - b.id);
  const join = order.slice(0, Math.max(0, MAX_VEHICLES - have.length));
  if (!join.length) { awaitOrders(state, p, `The team already has ${MAX_VEHICLES} vehicles: there is nobody free to drive the ones here.`, { failed: true }); return ""; }
  setPartyVehicles(state, p, [...have, ...join]); // their cargo stays inside until the team is out again (convoyAfter)
  unmark(state, p, tile, join);
  weighTeam(state, p);
  p.phase = "engaged";
  /** @type {any[]} */
  const groups = raidEnemies(state, tile);
  const foes = groups.filter((g) => !g.side);
  const total = foes.reduce((a, g) => a + g.count, 0);
  log(state, `${teamName(state, p)} reached the convoy at ${tileLabel(state, tile)}: ${list(join.map((v) => `the ${vehicleLabel(v)}`))}${order.length > join.length ? ` (${order.length - join.length} more there than the team can take)` : ""}. It goes in to get them out.`, "info");
  startCombat(state, {
    mode: "raid", tile, partyId: p.id, canRetreat: true, ambush: null, handler: "convoyRecover",
    enemy: { kind: foes.length > 1 ? "mixed" : foes[0]?.kind || "zombies", count: total, power: 3, name: foes.map((g) => g.name).join(" and ") || "nobody", groups },
    raid: { heat0: isNight(state) ? 0 : 5, poi: null, kind: null, place: null, building: "street" }, // the street map (buildingmaps.js raidBuilding), the vehicles by the entry edge
    context: { factionIds: foes.filter((g) => g.factionId && !g.parley).map((g) => g.factionId), recover: join.map((v) => v.id), tile },
  });
  return "";
}
// Nothing of the convoy left there: who took it if the team can tell, and home.
function convoyGone(state, p, tile) {
  const took = takenAt(state, tile);
  const known = took.map((r) => ({ r, f: factionById(state, r.fid) })).filter((x) => x.f && x.f.known);
  const who = known.length ? `${list([...new Set(known.map((x) => x.f.name))])} took ${list(known.map((x) => `the ${x.r.name}`))}: the tracks lead toward their land.` : took.length ? "Someone drove them off: the tracks are all the team can tell." : "Nothing is there any more.";
  unmark(state, p, tile);
  const text = `The convoy at ${tileLabel(state, tile)} is gone. ${who} The team turns for home.`;
  log(state, text, "danger");
  p.convoyFailed = { tile, why: known.length ? `taken by ${list([...new Set(known.map((x) => x.f.name))])}` : "gone before the team got there", fid: known.length ? known[0].f.id : null };
  addCard(state, { title: "The convoy is gone", text, partyId: p.id, choices: [{ label: "Understood", ai: () => 1, resolve: () => "" }] });
  startReturn(state, p);
  return "";
}
// Out of the raid (combat.js finishCombat → the handler).
function convoyAfter(state, result, setup) {
  const c = setup.context || {};
  const p = state.parties.find((x) => x.id === setup.partyId);
  const tile = c.tile ?? setup.tile;
  if (!p || !state.parties.includes(p)) return;
  if (!partyMembers(state, p).length) { wipeParty(state, p); return; } // the vehicles stay there with what was in them (and the team's)
  const r = result.raid || { hours: 1 };
  const ours = () => partyVehicles(state, p).filter((v) => (c.recover || []).includes(v.id));
  if (r.calledOff) { // turned back before going in: the vehicles stay where they stood
    for (const v of ours()) leaveVehicle(state, p, tile, "its team was lost", v);
    log(state, `${teamName(state, p)} called off the recovery at ${tileLabel(state, tile)}: the convoy stays there.`, "info");
    awaitOrders(state, p, `The team turned back from the convoy at ${tileLabel(state, tile)} without going in.`);
    return;
  }
  if (r.hadVehicle && !r.vehicleKept && p.vehicle) { // nobody went back to the vehicles: they all stay
    log(state, `Nobody got back to the vehicles at ${tileLabel(state, tile)}: they stay there.`, "danger");
    leaveVehicle(state, p, tile, "left at the raid site");
  }
  const left = shedSurplusVehicles(state, p, tile); // walkers.js: a driver for each; the rest stay, marked, cargo inside
  // The cargo of the ones that go: into the team's load as far as it has room; the rest on the ground there.
  const got = [], ground = [];
  for (const v of ours()) {
    const t = takeVehicleCargo(state, p, v);
    got.push(...t.got);
    if (v.cargo) { ground.push(...cargoWords(v.cargo)); leaveOnGround(state, tile, v.cargo.supplies, v.cargo.gear); delete v.cargo; }
  }
  weighTeam(state, p);
  for (let i = 0; i < (r.hours || 1) && state.parties.includes(p); i++) tickHour(state); // the raid took time
  if (!state.parties.includes(p)) return;
  const brought = ours();
  const home = baseById(state, p.homeBaseId) || hub(state);
  const text = brought.length
    ? `Convoy recovered at ${tileLabel(state, tile)}: ${list(brought.map((v) => `the ${vehicleLabel(v)}`))} ${brought.length === 1 ? "drives" : "drive"} for ${home ? home.name : "home"}${got.length ? ` with ${got.join(", ")}` : ""}.${left.length ? ` Nobody to drive ${list(left)}: left there, marked.` : ""}${ground.length ? ` No room for ${ground.join(", ")}: set down on the ground there, marked.` : ""}`
    : `The team got out of ${tileLabel(state, tile)} without the convoy.${left.length ? ` Nobody to drive ${list(left)}: left there, marked.` : ""}`;
  if (!brought.length) p.convoyFailed = { tile, why: left.length ? "too few left to drive" : "nobody got back to the vehicles", fid: null };
  log(state, text, brought.length ? "good" : "danger");
  startReturn(state, p); // home to its base of origin
}
registerCombatHandler("convoyRecover", convoyAfter);

// ---------- an allied group ----------
// Is the request offered to this group at all (allied or friendly enough)?
/** @param {State} state @param {Faction} f */
export const recoverOffered = (state, f) => !!f && f.alive && !f.outsider && !f.nomad && (isMember(state, f) || standing(state, f) >= RECOVER.MIN_STANDING);
// Where the vehicles go: { kind: "base", baseId } or { kind: "tile", tile }; "nearest" is your base nearest the convoy.
export function recoverDest(state, tile, dest) {
  if (dest && dest.kind === "tile" && Number.isInteger(dest.tile) && state.tiles[dest.tile]) return { kind: "tile", tile: dest.tile };
  const b = dest && dest.kind === "base" ? baseById(state, dest.baseId) : null;
  if (b) return { kind: "base", baseId: b.id };
  const near = [...state.bases].sort((a, c) => state.grid.distance(a.tile, tile) - state.grid.distance(c.tile, tile) || a.id - c.id)[0];
  return near ? { kind: "base", baseId: near.id } : null;
}
const destTile = (state, d) => (!d ? null : d.kind === "tile" ? d.tile : (baseById(state, d.baseId) || {}).tile ?? null);
const destName = (state, d) => (!d ? "nowhere" : d.kind === "base" ? (baseById(state, d.baseId) || {}).name || "your base" : tileLabel(state, d.tile));
// The base of theirs nearest the convoy.
const fromOf = (state, f, tile) => [...f.bases].sort((a, b) => state.grid.distance(a, tile) - state.grid.distance(b, tile) || a - b)[0];
// The fee: { value, goods, tiles } (goods: { key: qty } out of base's stock, the good they need most first). short: the
// value base cannot cover.
export function recoverFee(state, f, tile, dest, base = hub(state)) {
  const d = recoverDest(state, tile, dest), to = destTile(state, d), from = f && f.bases.length ? fromOf(state, f, tile) : tile;
  const tiles = state.grid.distance(from, tile) + (to != null ? state.grid.distance(tile, to) : 0);
  const vs = convoyAt(state, tile);
  const F = RECOVER.FEE;
  const value = Math.round(F.BASE + F.PER_TILE * tiles + F.CARGO * vs.reduce((a, v) => a + cargoValue(v), 0) + F.VEHICLE * vs.reduce((a, v) => a + vehicleValue(v), 0));
  const goods = {};
  let owed = value;
  const have = (k) => Math.floor(!base ? 0 : k === "food" ? foodIn(base.stock) : base.stock[k] || 0);
  for (const k of [...RECOVER.FEE_GOODS].sort((a, b) => (f ? need(f, b) - need(f, a) : 0) || RECOVER.FEE_GOODS.indexOf(a) - RECOVER.FEE_GOODS.indexOf(b))) {
    if (owed <= 0) break;
    const unit = supValue(k) || 1;
    const q = Math.min(have(k), Math.ceil(owed / unit));
    if (q <= 0) continue;
    goods[k] = q;
    owed -= q * unit;
  }
  return { value, goods, tiles, short: Math.max(0, Math.round(owed)) };
}
// Why the request cannot go ("" when it can): envoys.js messageProblem.
export function recoverProblem(state, f, P = {}, base = hub(state)) {
  if (!recoverOffered(state, f)) return `${f ? f.name : "They"} are not friendly enough to ask (standing ${RECOVER.MIN_STANDING} or a coalition member).`;
  if (P.tile == null || !convoyAt(state, P.tile).length && !convoyKnownAt(state, P.tile)) return "Pick the convoy: a tile where vehicles of yours stand abandoned.";
  if (!recoverDest(state, P.tile, P.dest)) return "Pick where the vehicles go.";
  const fee = recoverFee(state, f, P.tile, P.dest, base);
  if (fee.short > 0) return `${base ? base.name : "Your base"} cannot pay their fee (worth ${fee.value}).`;
  return "";
}
// Their answer (envoys.js aiAnswer): refused when standing is low or they are at war near the convoy; else the dice.
export function recoverAnswer(state, f, P, roll) {
  if (!recoverOffered(state, f)) return { yes: false, p: null, why: "relations are too poor for them to take the job" };
  for (const w of warsOf(state, f)) {
    const foe = factionById(state, enemyIn(w, f));
    if (foe && foe.alive && foe.bases.some((b) => state.grid.distance(b, P.tile) <= RECOVER.WAR_RANGE)) return { yes: false, p: null, why: `they are at war with ${foe.known ? foe.name : "a group"} near there` };
  }
  const p = Math.max(0.02, Math.min(0.98, 0.5 + (standing(state, f) + RECOVER.ODDS) / 100));
  const yes = roll < p;
  return { yes, p, why: yes ? "" : "they said no" };
}
// Agreed and paid (envoys.js deliver): their party sets out from their base nearest the convoy. Returns the party or null.
/** @param {State} state @param {Faction} f */
export function sendRecovery(state, f, msg) {
  const P = msg.payload || {};
  const vs = convoyAt(state, P.tile);
  const from = fromOf(state, f, P.tile);
  if (from == null) return null;
  const drivers = Math.max(1, vs.filter((v) => !isBike(v)).length + vs.filter(isBike).reduce((a, v) => a + (v.count || 1), 0));
  const p = spawnAiParty(state, f, "recovery", from, P.tile, { strength: drivers + RECOVER.GUARDS });
  if (!p) return null;
  p.recovery = { msgId: msg.id, tile: P.tile, vids: vs.map((v) => v.id), dest: recoverDest(state, P.tile, P.dest), fee: { ...(msg.packed || P.goods || {}) }, phase: "out", home: from };
  log(state, `${f.name} send a party of ${p.heads || drivers + RECOVER.GUARDS} from ${tileLabel(state, from)} to recover your convoy at ${tileLabel(state, P.tile)} and bring it to ${destName(state, p.recovery.dest)}.`, "info");
  return p;
}
// Word to you from the group (by radio now, else by their envoy) and a diary line.
function tell(state, f, text, kind = "info") {
  log(state, `${f.name}: ${text}`, kind);
  cardFromGroup(state, f, "recovery", { text });
}
// Half the fee back by their caravan (to your hub).
function refund(state, f, R) {
  const goods = {};
  for (const [k, q] of Object.entries(R.fee || {})) { const n = Math.floor((q || 0) * RECOVER.REFUND); if (n >= 1) goods[k] = n; }
  const h = hub(state);
  if (!Object.keys(goods).length || !h) return "";
  const c = sendCaravan(state, f, h, { goods: { supplies: goods, gear: [] }, gift: true });
  return c ? ` Half the fee comes back by their caravan (${Object.entries(goods).map(([k, q]) => `${q} ${k}`).join(", ")}).` : "";
}
function goHome(state, p) {
  const f = factionById(state, p.owner);
  const home = f && f.bases.length ? fromOf(state, f, partyTile(p)) : null;
  const res = home != null ? planPath(state, partyTile(p), home, p.vehicle, f.id) || planPath(state, partyTile(p), home, false, f.id) : null;
  p.recovery.phase = "home";
  if (!res || res.path.length <= 1) { removeParty(state, p); return; }
  p.vehicle = false;
  p.path = res.path; p.idx = 0; p.progress = 0;
}
// Their party at the end of its way (parties.js aiPartyHour): at the convoy, at the destination, or home.
/** @param {State} state @param {Party} p */
export function recoveryArrive(state, p) {
  const R = p.recovery, f = factionById(state, p.owner);
  if (!R || !f) { removeParty(state, p); return; }
  if (R.phase === "home") { removeParty(state, p); return; }
  if (R.phase === "out") {
    const t = state.tiles[R.tile];
    const vs = convoyAt(state, R.tile);
    if (!vs.length) {
      tell(state, f, `our party reached ${tileLabel(state, R.tile)} and your convoy was gone.${refund(state, f, R)}`, "danger");
      R.failed = "gone";
      return goHome(state, p);
    }
    // The tile's dead, by the numbers (as their parties meet a horde: parties.js aiPartyHour).
    const n = Math.round((t.infection || 0) * RECOVER.DEAD_PER) + state.hordes.filter((h) => h.tile === R.tile).reduce((a, h) => a + Math.min(h.size, 10), 0);
    const A = !f.outsider ? fightersOf(state, f, { party: p }) : [];
    if (n >= 1 && A.length) {
      const fight = fightSides(state, { f, people: A, kind: "raiders" }, { f: null, people: [], kind: "zombies", count: n, power: n * (1 + zombieToughness(state, R.tile)) });
      const lost = applySide(state, f, fight.rA, A, { holder: fight.attWon ? f : null });
      p.strength *= Math.max(0, A.length - lost.dead.length) / A.length;
      if (!fight.attWon || p.strength < 1) {
        R.failed = "dead";
        if (p.strength < 1) { tell(state, f, `the party we sent for your convoy at ${tileLabel(state, R.tile)} was lost to the dead there. The vehicles still stand there.`, "danger"); removeParty(state, p); return; }
        tell(state, f, `the dead at ${tileLabel(state, R.tile)} were too many: our party pulled back without your convoy.`, "danger");
        return goHome(state, p);
      }
    }
    const to = destTile(state, R.dest);
    const res = to != null ? planPath(state, R.tile, to, true, f.id) : null;
    if (!res) {
      R.failed = "noroad";
      tell(state, f, `there is no road for the vehicles from ${tileLabel(state, R.tile)} to ${destName(state, R.dest)}: they stay where they are.${refund(state, f, R)}`, "danger");
      return goHome(state, p);
    }
    for (const v of vs) v.loc = { kind: "towed", partyId: p.id, factionId: f.id };
    R.vids = vs.map((v) => v.id);
    unmark(state, null, R.tile, vs);
    R.phase = "carry";
    p.vehicle = true;
    p.path = res.path; p.idx = 0; p.progress = 0;
    log(state, `${f.name}'s party got your convoy out of ${tileLabel(state, R.tile)} (${list(vs.map((v) => `the ${vehicleLabel(v)}`))}) and drives it to ${destName(state, R.dest)}.`, "info");
    if (res.path.length <= 1) return recoveryArrive(state, p);
    return;
  }
  if (R.phase === "carry") {
    const vs = towed(state, p);
    const b = R.dest && R.dest.kind === "base" ? baseById(state, R.dest.baseId) : null;
    if (b && b.tile === partyTile(p)) {
      const goods = [];
      for (const v of vs) {
        const c = v.cargo;
        if (c) {
          for (const [k, q] of Object.entries(c.supplies || {})) if (Number.isFinite(q) && q >= 1) { b.stock[k] = (b.stock[k] || 0) + Math.floor(q); goods.push(`${Math.floor(q)} ${(SUPPLIES[k] ? SUPPLIES[k].name : k).toLowerCase()}`); }
          b.armory.push(...(c.gear || []));
          goods.push(...(c.gear || []).map((g) => g.name));
          delete v.cargo;
        }
        v.loc = { kind: "base", baseId: b.id };
      }
      log(state, `${f.name}'s party brought your convoy to ${b.name}: ${list(vs.map((v) => `the ${vehicleLabel(v)}`))}${goods.length ? `, with ${goods.join(", ")} into the stores` : ""}.`, "good");
    } else {
      const tile = partyTile(p);
      for (const v of vs) { v.loc = { kind: "abandoned", tile, since: state.hour }; markAbandonedVehicle(state, v, `brought by ${f.name}`); }
      log(state, `${f.name}'s party left your convoy at ${tileLabel(state, tile)} as asked: ${list(vs.map((v) => `the ${vehicleLabel(v)}`))}${vs.some((v) => v.cargo) ? ", cargo inside" : ""}, marked on the map.`, "good");
    }
    R.done = day(state);
    return goHome(state, p);
  }
  removeParty(state, p);
}
const towed = (state, p) => state.vehicles.filter((v) => v.loc.kind === "towed" && v.loc.partyId === p.id);
// Their party gone on the way (parties.js removeParty: an ambush, a horde, the dead at the tile): the vehicles it was
// driving stay where it happened, abandoned, marked, with what is in them.
/** @param {State} state @param {Party} p */
export function recoveryLost(state, p) {
  const vs = towed(state, p);
  if (!vs.length) return;
  const tile = partyTile(p), f = factionById(state, p.owner);
  for (const v of vs) { v.loc = { kind: "abandoned", tile, since: state.hour }; markAbandonedVehicle(state, v, "its escort was lost"); }
  if (p.recovery) p.recovery.failed = "lost";
  log(state, `${f ? f.name : "The group"}'s party driving your convoy was lost near ${tileLabel(state, tile)}: ${list(vs.map((v) => `the ${vehicleLabel(v)}`))} ${vs.length === 1 ? "stands" : "stand"} abandoned there, marked on the map.`, "danger");
}
