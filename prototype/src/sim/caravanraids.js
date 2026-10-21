// Caravans on the road, and robbing them: any caravan on the map can be attacked and everything it carries taken.
//
// What counts as a caravan here (roadCaravans)
// - Merchants from outside (visitors.js, kind "merchants") on the road: their wagons, their escort (escorts.js: light,
//   armed with a pickup, armoured with a Humvee or an MRAP), their stock and wares.
// - The groups' caravans (caravans.js, party kind "caravan") on the road, to your bases, to another group (an escort
//   job) or home again, and the groups' trade convoys between them (party kind "convoy": a truck or hand carts with
//   what they deliver, AI_CONVOY_GOODS when nothing else is listed).
// - Your own trade-route and supply convoys (party kind "convoy", owner "player"): the groups can rob those too. Your
//   trade caravans (a team on the caravan mission) meet the groups on the road like any team (conflicts.js); lost, the
//   whole cargo is taken (conflicts.js onConflictCombat, visitors.js onOutsiderFight).
//
// You attacking one (a team of yours within a tile of it)
// - When a team meets a group's caravan or convoy on a road (one of you on a road tile, within a tile, in sight): a
//   card. Attack it, or move on. Merchants met on the road have their own card (visitors.js: trade, news, rob them).
// - From the team's orders card: "Attack <the caravan>" for one in sight within a tile (you pick the moment: you have
//   the drop on them), or "Intercept <the caravan>" for one in sight within INTERCEPT.RANGE tiles: the team heads for
//   it, follows it (re-routed every hour), and the attack card comes when it is within a tile (for INTERCEPT.HOURS
//   at most).
// - A battle on the road map: its guards (merchants: the escort's kit, combat.js KITS guards / escorts /
//   contractors; a group's: its own fighters), and its vehicle parked behind them.
// - Won: everything it carried (lootCaravan): all its supplies and goods, what the guards had on them (on the map
//   you search the bodies; by the numbers, escorts.js guardGear), and its vehicle if it still runs (ESCORT_TAKE: 60%
//   it runs and joins a team with no vehicle, else it is parked on the tile, marked; 30% it needs an engine repair
//   (foundcars.js: Repair on the spot); 10% it is wrecked and stripped for parts and scrap). What the team cannot
//   carry goes in the parked vehicle, or stays on the tile as cargo left behind (a death site with no names: "Recover"
//   it).
// - Consequences need a witness (witnessesOf): a guard or trader who got away (the fight was lost or broken off, one
//   of them fled the map; merchants beaten by the numbers: a trader slips away WITNESS.TRADER_ESCAPE of the time),
//   another group's base within WITNESS.BASE_RANGE tiles (their lookouts), or anyone else on the road within a tile
//   (another caravan, travellers, raiders). Seen: merchants' reputation −45 and the traders, communes and fortresses
//   you know think less of you (visitors.js blameYou); a group's caravan: that group turns hostile, and the groups
//   you know that are not aggressive lose 5 goodwill (caravans.js turnHostile). Nobody to tell: no consequences;
//   the caravan simply never arrived. A caravan at your gates is always seen (caravans.js, visitors.js).
//
// The groups robbing caravans (aiRaidsHour; dice of their own: hash01, never the world's)
// - Raider gangs rob any caravan within AI_RAID.RANGE tiles of one of their bases (not a group they have a pact
//   with); expansionists and zealots only the caravans of groups they are at war with; and your convoys, when the
//   group would attack your teams (hostile, or aggressive with no pact or alliance). The groups' own caravans near a
//   raider gang's base are ambushed in parties.js aiPartyHour (the same goods taken, the same odds). A group at war with
//   you (playerwars.js, peaceful types too) robs your convoys PW.CARAVAN × as often, PW.CARAVAN_RANGE tiles further out.
// - Only when their war band (AI_RAID.BAND × the group's strength) is at least AI_RAID.EDGE × the caravan's; an hourly
//   chance of AI_RAID.CHANCE, more for a rich cargo (up to ×3). Fought by the numbers (groupfight.js fightSides: the
//   band's very people against the caravan's guards by their strength, or against your convoy's very people, who are
//   the side in your place): won, all the supplies go into the group's stock and the items onto its shelf (its wares),
//   the caravan is gone (your convoy: the cargo gone, it goes on empty). Lost: the band loses people, the caravan a
//   guard or two (your convoy takes what the band's dead carried). Either way the rounds land on the band's people and
//   on your convoy's by the same roll (applySide, applyYours: wounds, deaths, the left behind taken).
// - A group that overheard your convoy's route on the radio (intel.js g.lying) hunts it INTEL.AMBUSH.RANGE tiles further
//   out and INTEL.AMBUSH.MULT × as often until it has passed.
import { typeGoods, FOODS } from "./foods.js"; // a convoy's food as items
import { SUPPLIES, SUPPLY_KEYS, FACTION_TYPES, supValue } from "./data.js";
import { keyWord } from "./water.js"; // "9mm FMJ"
import { log, addCard, day, factionById, newId, combatPower, survivorById } from "./world.js";
import { stripAll } from "./inventory.js"; // a robber's body: what they carried
import { convoyPolicy } from "./breakoff.js"; // your convoy breaks off a fight by its policy
import {
  partyTile, partyMembers, tileLabel, removeParty, planPath, cargoRoom, unitsThatFit, addGearToCargo, wipeParty, awaitOrders, orderMove,
} from "./parties.js";
import { attitude, isAggressiveType, strength as groupStrength, changeGoodwill } from "./factions.js";
import { startCombat, registerCombatHandler } from "./combat.js";
import { fightOdds, halt, resume, afterFight, COOLDOWN_HOURS, rob } from "./conflicts.js";
import { turnHostile, guardPower } from "./caravans.js";
import { visitorsOf, visitorById, vStrength, leaveMap, goodsText, blameYou, openVisitorTrade, attackMerchants, visitorInfo } from "./visitors.js";
import { createVehicle, VEHICLE_TYPES, fitMilitary, carryCargo, factionVehicles } from "./vehicles.js";
import { markAbandonedVehicle, markDeathSite } from "./markers.js";
import { joinTeam } from "./foundcars.js";
import { hash01 } from "./skills.js";
import { pactBetween, warBetween } from "./diplomacy.js";
import { atWarWithYou, PW } from "./playerwars.js"; // wars with you: your convoys hunted
import { caravanGuarded } from "./jobs.js";
import { inCoverage } from "./radio.js";
import { chronicleNote } from "./chronicle.js";
import { escortWords, escortShort, guardGear, ESCORT_VEHICLES, cargoValue } from "./escorts.js";
import { addToArsenal, keepItem, removeFromArsenal, partyLost, issueKit, unloadVehicle } from "./arsenal.js"; // group arsenals: loot to their fighters, guards' kit lost
import { noteFight } from "./groupcare.js";
import { teamName } from "./parties.js";
import { lyingFor, ambushSprung, INTEL } from "./intel.js"; // a group that overheard your convoy's route waits for it
import { note, roundsIn, goodsRounds } from "./ledger.js"; // the conservation test's ledger (off in play)
import { fightSides, fightersOf, applySide, applyYours } from "./groupfight.js"; // fights nobody watches: your rules (your convoy's people too)
import { isWounded } from "./members.js"; // the fit go out on a robbery
const KIND_OF = { raider: "raiders", expansionist: "fighters", zealot: "zealots", military: "soldiers", fortress: "soldiers", traders: "guards", commune: "militia" };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = (c) => `${Math.round(c * 100)}%`;
const cap1 = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const planText = (sup) => Object.entries(sup).filter(([, q]) => q >= 1).map(([k, q]) => `${Math.floor(q)} ${keyWord(k)}`).join(", "); // rounds named by calibre

export const INTERCEPT = { RANGE: 6, HOURS: 48 };
export const MEET = { COOLDOWN: 48 };
export const WITNESS = { BASE_RANGE: 3, TRADER_ESCAPE: 0.35 };
// The escort's vehicle after a won fight: runs (a share), needs an engine (a share), else wrecked (stripped: parts, scrap).
export const ESCORT_TAKE = { RUNS: 0.6, REPAIR: 0.3, FUEL: [6, 25], COND: [45, 75], REPAIR_COND: [25, 45], SALVAGE: { parts: [2, 4], scrap: [6, 12] } };
export const AI_RAID = { RANGE: 3, CHANCE: 0.03, RICH: 600, BAND: 0.35, EDGE: 1.1, COOLDOWN: 24, KEEP: 1 };
// A group's trade convoy carries what it delivers (parties.js aiPartyHour: 10 food, 10 scrap) when nothing is listed.
export const AI_CONVOY_GOODS = { food: 10, scrap: 10 };
// The groups' fighters by type (combat.js KITS), as in conflicts.js.
const KIT_OF = { raider: "raiders", expansionist: "fighters", zealot: "zealots", military: "soldiers", fortress: "soldiers", traders: "guards", commune: "militia" };

// ---------- the caravans on the map ----------
// A party's key for the dice: a serial of this world's own, handed out the first time it is looked at (ids are
// process-wide, and even localId differs between two worlds made before either plays: tradetest's determinism).
const pKey = (state, q) => `p${q.cvSerial ?? (q.cvSerial = (state.cvSerial = (state.cvSerial || 0) + 1))}`;
const vKey = (v) => `v${v.serial}`;
// What one carries: { supplies, gear } (live: changes to these change the caravan).
function goodsOf(c) {
  if (c.type === "merchants") return { supplies: c.ref.stock, gear: c.ref.wares };
  const q = c.ref;
  if (c.owner === "player") return q.cargo || (q.cargo = { supplies: {}, gear: [] });
  if (!q.goods) q.goods = { supplies: c.type === "convoy" ? typeGoods(null, AI_CONVOY_GOODS, "stores") : {}, gear: [] }; // foods.js: its food as items (no dice)
  return q.goods;
}
function aiEnemy(state, q, f) {
  // escorts.js: the guards the group sent with it (an older caravan: by its strength), their power, its vehicle.
  const e = q.escort;
  const power = e ? e.power : f ? Math.round(guardPower(f) * 10) / 10 : 3;
  const count = e ? clamp(e.guards, 1, 14) : clamp(Math.round((q.strength || 2) / power), 1, 10);
  const V = e && e.vehicle ? ESCORT_VEHICLES[e.vehicle] : q.vehicle ? ESCORT_VEHICLES.truck : null;
  return {
    kind: (f && KIT_OF[f.type]) || "guards", count, power, factionId: f ? f.id : undefined, name: `${f ? f.name : "Their"} caravan guards`,
    ...(V ? { vehicle: "truck", vehicleBody: V.body, vehicleName: V.name, escort: true, ...(V.turret ? { turret: V.turret } : {}) } : {}),
  };
}
// The group's vehicle record that went with a caravan (escorts.js: q.escort.vehicleId), or null.
function escortVehicle(state, q) {
  const id = q && q.escort && q.escort.vehicleId;
  const f = id != null ? factionById(state, q.owner) : null;
  return f && Array.isArray(f.vehicles) ? f.vehicles.find((v) => v.id === id) || null : null;
}
// A group's vehicle that went with a caravan and was lost with it leaves its pool (vehicles.js carryCargo: your
// vehicles' model). Taken by you: lootCaravan made it one of yours (or stripped its wreck), and what was in it went
// into the loot first (onRoadCaravan). Taken by a group (to): it joins that group's motor pool as it ran, and what
// is in it goes into their stores (arsenal.js unloadVehicle; a transfer between groups). Returns the record it became.
function loseGroupVehicle(state, q, to = null) {
  const rec = escortVehicle(state, q);
  if (!rec) return null;
  const f = factionById(state, q.owner);
  f.vehicles = f.vehicles.filter((v) => v !== rec);
  if (!to || to.alive === false) return rec;
  to.vehSeq = (to.vehSeq || 0) + 1;
  const nv = { ...rec, id: `f${to.id}-c${to.vehSeq}`, owner: to.id };
  factionVehicles(to).push(nv);
  unloadVehicle(state, to, nv, "taken", true);
  return nv;
}
// The fight a merchant caravan puts up (visitors.js enemyOf): its escort's kit, every guard, the scout and the turret
// gunner, and its vehicle on the map.
export function escortEnemy(v) {
  const e = v.escort;
  const V = e && e.vehicle && !v.vehicleLost ? ESCORT_VEHICLES[e.vehicle] : null;
  return {
    kind: (e && e.kit) || "guards", count: clamp(v.guards || 1, 1, 14), power: v.power, name: `${cap1(v.name)}'s guards`,
    ...(V ? { vehicle: "truck", vehicleBody: V.body, vehicleName: V.name, escort: true, ...(V.turret ? { turret: V.turret } : {}) } : {}), // combat.js: drawn by its body; vehicles.js: its turret by the numbers
  };
}

// Every caravan on the road: { key, type, ref, tile, owner, name, strength, value, escort, vehicle }.
export function roadCaravans(state, { player = false } = {}) {
  const out = [];
  for (const v of visitorsOf(state)) {
    if (v.kind !== "merchants" || (v.phase !== "travel" && v.phase !== "search") || v.size <= 0) continue; // on the road (not trading at a base)
    out.push({
      key: vKey(v), type: "merchants", ref: v, tile: v.tile, owner: "outsider", name: v.name, strength: vStrength(v),
      value: cargoValue(v.stock, v.wares), escort: v.escort || null, vehicle: v.escort && !v.vehicleLost ? v.escort.vehicle : null,
    });
  }
  for (const q of state.parties) {
    if (!q.path || !q.path.length || q.phase !== "out" && !(q.phase === "back" && (q.owner === "player" || q.kind === "envoy" || q.kind === "loan"))) continue; // envoys.js, loans.js: a group's envoy or volunteers on their way home too
    if (q.owner === "player") {
      if (!player || q.kind !== "convoy") continue;
      const g = q.cargo || { supplies: {}, gear: [] };
      out.push({ key: pKey(state, q), type: "convoy", ref: q, tile: partyTile(q), owner: "player", name: "your convoy", strength: 0, value: cargoValue(g.supplies, g.gear), escort: null, vehicle: q.vehicle ? "truck" : null });
      continue;
    }
    if (!["caravan", "convoy", "envoy", "loan", "opparty"].includes(q.kind)) continue; // envoys.js, loans.js: their envoys, volunteers and joint-op parties can be intercepted
    const f = factionById(state, q.owner);
    const c = { key: pKey(state, q), type: q.kind, ref: q, tile: partyTile(q), owner: q.owner, name: `the ${f ? f.name.replace(/^The /, "") : "group's"} ${{ loan: "volunteers", opparty: "war party" }[q.kind] || q.kind}`, strength: q.strength || 2, escort: q.escort || null, vehicle: q.escort && q.escort.vehicle ? q.escort.vehicle : q.vehicle ? "truck" : null };
    const g = goodsOf(c);
    c.value = cargoValue(g.supplies, g.gear);
    out.push(c);
  }
  return out;
}
export const caravanByKey = (state, key) => roadCaravans(state, { player: true }).find((c) => c.key === key) || null;

// In words, for cards and tooltips: who guards it, and what it carries.
export function guardText(state, c) {
  if (c.type === "merchants") return `${c.ref.guards} guards and ${2} traders: ${escortWords(c.escort)}`;
  if (c.escort) return `${escortWords(c.escort)}${c.vehicle ? "" : c.type === "caravan" ? ", with a wagon" : ", with hand carts"}`;
  const f = factionById(state, c.owner);
  const e = aiEnemy(state, c.ref, f);
  return `${e.count} guard${e.count === 1 ? "" : "s"}${c.vehicle ? " and a truck" : c.type === "caravan" ? " with a wagon" : " with hand carts"}`;
}
export function cargoText(c) {
  if (c.type === "merchants") return goodsText(c.ref);
  const g = goodsOf(c);
  const sup = Object.entries(g.supplies).filter(([, q]) => q >= 1).sort((a, b) => b[1] * SUPPLIES[b[0]].value - a[1] * SUPPLIES[a[0]].value).slice(0, 4).map(([k]) => SUPPLIES[k].name.toLowerCase());
  return [...sup, ...g.gear.slice(0, 3).map((it) => it.name)].join(", ") || "not much";
}

// ---------- you attack ----------
const teamOk = (state, p) => !!p && state.parties.includes(p) && p.owner === "player" && p.kind !== "convoy" && partyMembers(state, p).length > 0;
const near = (state, a, b, r = 1) => state.grid.distance(a, b) <= r;
function enemyFor(state, c) {
  return c.type === "merchants" ? escortEnemy(c.ref) : aiEnemy(state, c.ref, factionById(state, c.owner));
}

// Starts the fight with a caravan (a group's: the "roadCaravan" battle; merchants: visitors.js attackMerchants).
// ambush: "player" (you picked the moment) or null (face to face on the road).
export function attackRoadCaravan(state, p, key, ambush = "player") {
  const c = caravanByKey(state, key);
  if (!c || c.owner === "player") return "The caravan is gone.";
  if (!teamOk(state, p)) return "";
  if (!near(state, partyTile(p), c.tile)) return "The caravan is out of reach.";
  halt(p);
  if (c.type === "merchants") return attackMerchants(state, c.ref, { partyId: p.id, ambush });
  const f = factionById(state, c.owner);
  const q = c.ref;
  const enemy = enemyFor(state, c);
  log(state, `Your team falls on ${c.name} near ${tileLabel(state, c.tile)}.`, "danger");
  startCombat(state, {
    tile: partyTile(p), partyId: p.id, enemy, ambush, canRetreat: true, handler: "roadCaravan",
    context: { partyId: p.id, caravanId: q.id, key, factionId: f ? f.id : null, type: c.type, tile: c.tile, name: c.name, resumePhase: p.conflictResume || "out", vehicle: c.vehicle },
  });
  return "";
}

function onRoadCaravan(state, result, setup) {
  const c = setup.context;
  const p = state.parties.find((x) => x.id === c.partyId);
  const q = state.parties.find((x) => x.id === c.caravanId);
  const f = factionById(state, c.factionId);
  const lines = [];
  if (f && result.enemiesKilled) f.pop = Math.max(0, f.pop - Math.ceil(result.enemiesKilled * 0.7));
  const tgt = { type: c.type, owner: c.factionId, ref: q, tile: c.tile, key: c.key, name: c.name, by: p && state.parties.includes(p) ? teamName(state, p) : "your people" };
  const seen = witnessesOf(state, tgt, result, p);
  const st = (state.stats.caravanRaids = state.stats.caravanRaids || { byYou: 0, won: 0, seen: 0, unseen: 0, byGroups: 0, groupsWon: 0, convoysLost: 0 });
  st.byYou++;
  if (p && state.parties.includes(p) && !partyMembers(state, p).length) {
    wipeParty(state, p);
    log(state, `The whole team was lost attacking ${c.name}.`, "death");
    if (f && f.alive) consequences(state, tgt, ["their guards saw who you were"], lines);
    addCard(state, { title: `The attack on ${c.name}`, text: `The whole team was lost attacking ${c.name}.${lines.length ? ` ${lines.join(" ")}` : ""}`, choices: [{ label: "OK", resolve: () => "" }] });
    return;
  }
  if (!p || !state.parties.includes(p)) return;
  if (result.outcome === "victory") {
    st.won++;
    lines.push(`You took ${c.name}: ${result.enemiesKilled || "all"} of the guards are down.`);
    const goods = q ? goodsOf({ type: c.type, owner: c.factionId, ref: q }) : { supplies: {}, gear: [] };
    if (q && !result.humveeOut) carryCargo(escortVehicle(state, q), { cargo: goods }); // vehicles.js: anything in their vehicle is loot too
    lines.push(...lootCaravan(state, p, goods, { tile: partyTile(p), name: c.name, kit: setup.enemy.kind, guards: result.enemiesKilled || setup.enemy.count, tactical: !!result.tactical, vehicle: result.humveeOut ? null : c.vehicle, key: c.key, result })); // humveeOut: their armoured escort drove off (combat.js carTurn)
    if (q) { if (!result.humveeOut) loseGroupVehicle(state, q); removeParty(state, q); }
  } else {
    if (q) { q.strength = Math.max(1, (q.strength || 2) * Math.max(0.3, (result.enemiesLeft || 1) / Math.max(1, setup.enemy.count))); q.met = { ...(q.met || {}), [pKey(state, p)]: state.hour }; }
    if (result.outcome === "retreat") lines.push(result.summary ? `${result.summary} You pulled back.` : "You pulled back; the caravan went on.");
    else { const lost = rob(state, p, 0.25, f, false); lines.push(`You lost the fight. The guards took ${lost} off you.`); }
  }
  consequences(state, tgt, seen, lines);
  const dead = (result.survivorsDead || []).length;
  if (dead) lines.push(`${dead} of yours died.`);
  log(state, `Attack on ${c.name} near ${tileLabel(state, partyTile(p))}: ${result.outcome}.`, result.outcome === "victory" ? "good" : "danger");
  afterFight(state, p, { resumePhase: c.resumePhase }, lines.join(" "));
}
registerCombatHandler("roadCaravan", onRoadCaravan);

// ---------- won: everything it carried ----------
// Everything into the team's cargo as far as it goes: the escort's vehicle first (it may carry the rest), all the
// supplies and items, the guards' gear (a fight by the numbers; on the map the bodies were searched), and what does
// not fit in the parked vehicle or left on the tile. opts: { tile, name, kit, guards, tactical, vehicle, key, result }.
// Returns the card's lines.
export function lootCaravan(state, p, goods, opts) {
  const out = [];
  const dice = (...k) => hash01(state.seed, "cvloot", opts.key || "", state.hour, ...k);
  const sup = {};
  for (const [k, q] of Object.entries(goods.supplies || {})) if (SUPPLIES[k] && q >= (FOODS[k] ? 1e-6 : 1)) sup[k] = FOODS[k] ? q : Math.floor(q); // food items: fractions kept
  const gear = [...(goods.gear || [])];
  for (const k of Object.keys(goods.supplies || {})) goods.supplies[k] = 0;
  if (goods.gear) goods.gear.length = 0;
  if (!opts.tactical && opts.guards > 0) {
    const gg = guardGear(opts.kit, opts.guards, (i, k) => dice("guard", i, k));
    for (const [k, q] of Object.entries(gg.supplies)) sup[k] = (sup[k] || 0) + q;
    // A group's guards (arsenal.js settleArsenal): what they really carried, not new gear.
    const real = opts.result && opts.result.arsDropped;
    if (real && real.length) gg.gear = real.slice();
    gear.push(...gg.gear);
    if (gg.gear.length) out.push(`The guards had ${gg.gear.map((it) => it.name).join(", ")} on them.`);
  }
  // The vehicle: runs, needs an engine, or wrecked (stripped).
  let parked = null;
  if (opts.vehicle && ESCORT_VEHICLES[opts.vehicle]) {
    const V = ESCORT_VEHICLES[opts.vehicle];
    const r = dice("veh");
    const tile = opts.tile;
    if (r < ESCORT_TAKE.RUNS + ESCORT_TAKE.REPAIR) {
      const fix = r >= ESCORT_TAKE.RUNS;
      const range = (lo, hi, k) => Math.round(lo + dice(k) * (hi - lo));
      const T = VEHICLE_TYPES[V.type];
      const v = createVehicle(state, V.type, { kind: "abandoned", tile, since: state.hour }, {
        fuel: Math.min(T.tank, range(ESCORT_TAKE.FUEL[0], ESCORT_TAKE.FUEL[1], "fuel")),
        condition: fix ? range(ESCORT_TAKE.REPAIR_COND[0], ESCORT_TAKE.REPAIR_COND[1], "cond") : range(ESCORT_TAKE.COND[0], ESCORT_TAKE.COND[1], "cond"),
        name: V.model === "humvee" ? "Humvee" : V.model === "mrap" ? "MRAP" : undefined,
      });
      const mil = V.model === "humvee" || V.model === "mrap";
      v.found = { model: V.model, at: tileLabel(state, tile), hour: state.hour, repair: fix ? { parts: 2, scrap: 2, hours: 6, mech: mil ? 5 : 4, what: ["the engine"] } : null };
      if (mil) fitMilitary(v, V.turret); // vehicles.js: its plating, glass and the M2 on the roof come with it
      if (!fix && p && state.parties.includes(p) && !p.vehicle) {
        joinTeam(state, p, v);
        out.push(`Their ${V.name} runs: it is the team's now (fuel ${Math.round(v.fuel)}, condition ${Math.round(v.condition)}%).`);
      } else {
        markAbandonedVehicle(state, v, fix ? "needs repair" : "taken from a caravan");
        parked = v;
        out.push(fix ? `Their ${V.name} took hits to the engine: it stands on the tile, marked on the map (Repair it there: 2 parts, 2 scrap, Mechanics ${mil ? 5 : 4}+).`
          : `Their ${V.name} runs (fuel ${Math.round(v.fuel)}): the team already has a vehicle, so it is parked on the tile, marked (send someone home in it, or come back for it).`);
      }
    } else {
      const P = ESCORT_TAKE.SALVAGE;
      const parts = P.parts[0] + Math.floor(dice("sp") * (P.parts[1] - P.parts[0] + 1)), scrap = P.scrap[0] + Math.floor(dice("ss") * (P.scrap[1] - P.scrap[0] + 1));
      sup.parts = (sup.parts || 0) + parts;
      sup.scrap = (sup.scrap || 0) + scrap;
      out.push(`Their ${V.name} was shot to pieces: stripped for ${parts} parts and ${scrap} scrap.`);
    }
  }
  // Into the team's cargo as far as it goes.
  const got = {}, left = {}, items = [], leftItems = [];
  for (const [k, q] of Object.entries(sup)) {
    const room = p && state.parties.includes(p) ? cargoRoom(state, p) : 0;
    const take = Math.min(q, unitsThatFit(room, k));
    if (take > 0) { p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + take; got[k] = take; }
    if (q - take > 0) left[k] = q - take;
  }
  for (const it of gear) {
    if (p && state.parties.includes(p) && addGearToCargo(state, p, it)) items.push(it.name);
    else leftItems.push(it);
  }
  const taken = [planText(got), ...items].filter(Boolean).join(", ");
  out.push(taken ? `Taken: ${taken}.` : "The team could carry none of it.");
  if (Object.keys(left).length || leftItems.length) {
    const what = [planText(left), ...leftItems.map((it) => it.name)].filter(Boolean).join(", ");
    if (parked) {
      parked.cargo = parked.cargo || { supplies: {}, gear: [] };
      for (const [k, q] of Object.entries(left)) parked.cargo.supplies[k] = (parked.cargo.supplies[k] || 0) + q;
      parked.cargo.gear.push(...leftItems);
      out.push(`No room for the rest: ${what}, loaded in the ${parked.name} (Take the cargo left in the vehicle).`);
    } else {
      leaveCache(state, opts.tile, left, leftItems);
      out.push(`No room for the rest: ${what}, left on the tile and marked (Recover it).`);
    }
  }
  return out;
}
// Cargo left on a tile: a death site with no names ("Cargo left behind": the Recover mission picks it up).
export function leaveCache(state, tile, supplies, gear) {
  let site = state.deathSites.find((d) => d.tile === tile);
  if (!site) { site = { id: newId(), tile, items: [], day: day(state), names: [], lastConfirmed: day(state) }; state.deathSites.push(site); }
  for (const [k, q] of Object.entries(supplies)) {
    if (!SUPPLIES[k] || q < 1) continue;
    const cur = site.items.find((i) => i.kind === "supply" && i.key === k);
    if (cur) { cur.qty += q; cur.value = cur.qty * supValue(k); } else site.items.push({ kind: "supply", key: k, name: SUPPLIES[k].name, qty: q, value: q * supValue(k) });
  }
  for (const g of gear) site.items.push({ kind: "gear", key: g.key, name: g.name, qty: 1, value: 0, item: g });
  markDeathSite(state, site);
  return site;
}

// ---------- witnesses and consequences ----------
// Why word of it gets out ([] when nobody saw). c: { type, owner, ref, tile, key }; result: the battle's; p: your team.
export function witnessesOf(state, c, result, p) {
  const why = [];
  const g = state.grid, tile = c.tile;
  if (!result || result.outcome !== "victory") why.push("their guards got away");
  else if ((result.enemiesLeft || 0) > 0) why.push(`${result.enemiesLeft} of them got away`);
  else if (c.type === "merchants" && !result.tactical && hash01(state.seed, "cvwit", c.key || "", state.hour) < WITNESS.TRADER_ESCAPE) why.push("one of the traders slipped away in the fighting");
  const base = state.factions.find((f) => f.alive && f.id !== c.owner && f.bases.some((b) => g.distance(b, tile) <= WITNESS.BASE_RANGE));
  if (base) why.push(`lookouts of ${base.known ? base.name : "a group's base"} nearby saw it`);
  const other = state.parties.some((q) => q !== c.ref && q !== p && q.owner !== "player" && q.path && q.path.length && g.distance(partyTile(q), tile) <= 1)
    || visitorsOf(state).some((v) => v !== c.ref && g.distance(v.tile, tile) <= 1);
  if (other) why.push("others on the road saw it");
  return why;
}
// Applies what word of the attack costs you (nothing when nobody saw). Adds a line to `lines`.
export const RUMOUR = { CHANCE: 0.15, DAYS: [1, 4] };
// The robberies nobody saw that are traced after all: the consequences when word gets around.
function rumoursHour(state) {
  const list = state.caravanRumours;
  if (!list || !list.length) return;
  for (const r of [...list]) {
    if (state.hour < r.at) continue;
    list.splice(list.indexOf(r), 1);
    const st = state.stats.caravanRaids || (state.stats.caravanRaids = { byYou: 0, won: 0, seen: 0, unseen: 0, byGroups: 0, groupsWon: 0, convoysLost: 0 });
    st.traced = (st.traced || 0) + 1;
    if (r.type === "merchants") {
      blameYou(state, { goodwill: 0, name: r.name }); // visitors.js: their reputation and the traders' goodwill (the caravan itself is gone)
      log(state, `Word got around that ${r.by} robbed ${r.name}: merchants will shun you, and the traders you know think less of you.`, "danger");
    } else {
      const f = factionById(state, r.owner);
      if (!f || !f.alive) continue;
      turnHostile(state, f, "word got around that you robbed their caravan");
      log(state, `Word got around that ${r.by} robbed ${r.name}: ${f.name} are your enemies now.`, "danger");
    }
  }
}
export function consequences(state, c, why, lines) {
  const st = (state.stats.caravanRaids = state.stats.caravanRaids || { byYou: 0, won: 0, seen: 0, unseen: 0, byGroups: 0, groupsWon: 0, convoysLost: 0 });
  if (!why.length) {
    st.unseen++;
    lines.push("Nobody got away to tell who did it: as far as anyone knows, the caravan never arrived.");
    // Word gets out anyway now and then (a rumour, a body found, a trader who hid): RUMOUR.CHANCE, its own dice, a few
    // days later; you hear of it only then (rumoursHour).
    const k = c.key || c.name || "";
    if (hash01(state.seed, "cvrumour", k, state.hour) < RUMOUR.CHANCE) {
      const days = RUMOUR.DAYS[0] + Math.floor(hash01(state.seed, "cvrumourday", k, state.hour) * (RUMOUR.DAYS[1] - RUMOUR.DAYS[0] + 1));
      (state.caravanRumours = state.caravanRumours || []).push({ at: state.hour + days * 24, type: c.type, owner: c.owner, name: c.name || "a caravan", by: c.by || "your people", merchant: c.type === "merchants" && c.ref ? { name: c.ref.name } : null });
    }
    return false;
  }
  st.seen++;
  if (c.type === "merchants") {
    if (c.ref && !c.ref.blamed) { blameYou(state, c.ref); c.ref.blamed = true; }
    lines.push(`Word gets out (${why[0]}): merchants will shun you, and the traders you know think less of you.`);
  } else {
    const f = factionById(state, c.owner);
    if (f && f.alive) {
      turnHostile(state, f, "you attacked their caravan");
      lines.push(`Word gets out (${why[0]}): ${f.name} are your enemies now.`);
    }
  }
  return true;
}

// ---------- cards: meeting a caravan, catching up with one ----------
function inTheOpen(state, p) {
  if (!teamOk(state, p) || ["engaged", "holding", "helping", "siege"].includes(p.phase)) return false;
  const tile = partyTile(p);
  return tile != null && !state.bases.some((b) => state.grid.distance(b.tile, tile) <= 1);
}
const enemyOf = (state, q) => {
  const f = factionById(state, q.owner);
  if (!f || !f.alive) return true;
  const att = attitude(f);
  return att === "Hostile" || (isAggressiveType(f) && att !== "Allied" && !f.pact);
};
export function caravanCard(state, p, c, lead = "", ambush = null) {
  halt(p);
  const enemy = enemyFor(state, c);
  const odds = fightOdds(state, p, enemy, ambush);
  const key = c.key;
  const ok = (st) => teamOk(st, p) && !!caravanByKey(st, key) && near(st, partyTile(p), caravanByKey(st, key).tile);
  const done = (st, text) => { resume(st, p); return text; };
  const f = c.type === "merchants" ? null : factionById(state, c.owner);
  const who = c.type === "merchants" ? `A merchant caravan from ${c.ref.home}` : f && f.known ? `A ${f.name} ${c.type}` : `A ${c.type} of a group you have not met`;
  const choices = [];
  if (c.type === "merchants" && attitude(c.ref) !== "Hostile") choices.push({ label: "Trade with them", hint: "The trade window, from what the team carries", ai: () => 60, resolve: (st) => { if (!ok(st)) return done(st, "They are gone."); openVisitorTrade(st, c.ref, { partyId: p.id, back: "raid" }); delete p.conflictResume; return ""; } });
  choices.push({
    label: `Attack the caravan (${pct(odds)} by the numbers)`,
    hint: `A fight with its guards (${guardText(state, c)}). Win and everything it carries is yours, and its vehicle if it still runs. If anyone gets away or sees it, ${c.type === "merchants" ? "merchants will shun you" : `${f ? f.name : "its group"} will be your enemies`}`,
    fight: { odds, enemy, ambush }, ai: () => -50,
    resolve: (st) => (ok(st) ? attackRoadCaravan(st, p, key, ambush) : done(st, "The caravan is gone.")),
  });
  choices.push({ label: "Let it pass", hint: "Carry on", ai: () => 20, resolve: (st) => done(st, "") });
  return {
    title: `${c.type === "merchants" ? "Merchants" : "A caravan"} on the road: ${cap1(c.name)}`, partyId: p.id, isCaravanMeet: true, where: tileLabel(state, partyTile(p)),
    text: `${lead ? `${lead} ` : ""}${who}, ${guardText(state, c)}. ${c.type === "merchants" ? "Their wagons carry" : "It carries"} ${cargoText(c)}.${f && attitude(f) === "Hostile" ? ` ${f.name} are already your enemies.` : ""}`,
    choices,
  };
}

// The team's orders card (parties.js ordersCard): attack a caravan in sight within a tile, or go after one further out.
export function caravanOrderChoices(state, p) {
  if (!teamOk(state, p)) return [];
  const tile = partyTile(p);
  const out = [];
  for (const c of roadCaravans(state)) {
    if (!state.live.has(c.tile)) continue;
    const d = state.grid.distance(tile, c.tile);
    if (d <= 1) {
      const enemy = enemyFor(state, c);
      const odds = fightOdds(state, p, enemy, "player");
      out.push({
        label: `Attack ${c.name} (${pct(odds)})`, hint: `${cap1(guardText(state, c))}; carrying ${cargoText(c)}. You pick the moment: the team has the drop on them. Win and everything it carries is yours.`,
        fight: { odds, enemy, ambush: "player" },
        resolve: (st) => attackRoadCaravan(st, p, c.key, "player"),
      });
    } else if (d <= INTERCEPT.RANGE) {
      out.push({
        label: `Intercept ${c.name} (${d} tiles)`, hint: `${cap1(guardText(state, c))}; carrying ${cargoText(c)}. The team goes after it and follows it; when it is within a tile you decide whether to attack (for ${INTERCEPT.HOURS}h at most).`,
        resolve: (st) => intercept(st, p, c.key),
      });
    }
  }
  return out;
}
export function intercept(state, p, key) {
  const c = caravanByKey(state, key);
  if (!c || !teamOk(state, p)) return "The caravan is gone.";
  const msg = orderMove(state, p, c.tile);
  if (p.dest !== c.tile) return msg;
  p.intercept = { key, since: state.hour };
  return `${msg} Going after ${c.name}.`;
}

// ---------- every hour ----------
export function caravanRaidsHour(state) {
  if (state.gameOver) return;
  rumoursHour(state);
  interceptsHour(state);
  meetingsHour(state);
  aiRaidsHour(state);
}

function interceptsHour(state) {
  for (const p of state.parties) {
    if (!p.intercept || p.owner !== "player") continue;
    const c = caravanByKey(state, p.intercept.key);
    const give = (text) => { delete p.intercept; if (p.phase === "out" || p.phase === "waiting") awaitOrders(state, p, text, { failed: true }); };
    if (!teamOk(state, p)) { delete p.intercept; continue; }
    if (!c) { give("The caravan the team was after is gone or out of reach (trading at a base)."); continue; }
    if (state.hour - p.intercept.since > INTERCEPT.HOURS) { give(`The team gave up the chase after ${INTERCEPT.HOURS} hours.`); continue; }
    const tile = partyTile(p);
    if (near(state, tile, c.tile)) {
      delete p.intercept;
      if (state.cards.some((x) => x.partyId === p.id && !x.isOrders)) continue; // met already (visitors.js merchants' card)
      for (let i = state.cards.length - 1; i >= 0; i--) if (state.cards[i].partyId === p.id && state.cards[i].isOrders) state.cards.splice(i, 1);
      p.lastConflict = state.hour;
      addCard(state, caravanCard(state, p, c, "The team has caught up with the caravan.", "player"));
      continue;
    }
    if (p.phase === "waiting" || (p.phase === "out" && p.dest !== c.tile)) {
      const res = planPath(state, tile, c.tile, p.vehicle);
      if (!res) { give("The team cannot reach the caravan."); continue; }
      for (let i = state.cards.length - 1; i >= 0; i--) if (state.cards[i].partyId === p.id && state.cards[i].isOrders) state.cards.splice(i, 1);
      // The progress toward the next tile carries over (re-routed every hour it would never get anywhere otherwise).
      Object.assign(p, { path: res.path, idx: 0, dest: c.tile, phase: "out", mission: "move" });
    }
  }
}

// A team on the road meets a group's caravan or convoy (not an enemy's: those attack it, conflicts.js contactAttack).
function meetingsHour(state) {
  const cars = roadCaravans(state).filter((c) => c.type !== "merchants" && c.owner !== "player" && !c.ref.escortJob && !enemyOf(state, c.ref));
  if (!cars.length) return;
  for (const p of state.parties) {
    if (p.owner !== "player" || p.intercept || !inTheOpen(state, p)) continue;
    if (state.cards.some((x) => x.partyId === p.id)) continue;
    if (p.lastConflict != null && state.hour - p.lastConflict < COOLDOWN_HOURS) continue;
    const tile = partyTile(p);
    for (const c of cars) {
      if (!near(state, tile, c.tile) || !state.live.has(c.tile) || !(state.tiles[tile].road || state.tiles[c.tile].road)) continue;
      const met = c.ref.met || (c.ref.met = {});
      const id = pKey(state, p);
      if (met[id] != null && state.hour - met[id] < MEET.COOLDOWN) continue;
      met[id] = state.hour;
      p.lastConflict = state.hour;
      addCard(state, caravanCard(state, p, c, "", null));
      break;
    }
  }
}

// ---------- the groups rob caravans ----------
// Would group f rob this caravan?
export function wouldRaid(state, f, c) {
  if (!f.alive || !f.bases.length || f.id === c.owner) return false;
  if (c.owner === "player") {
    const att = attitude(f);
    return att === "Hostile" || (isAggressiveType(f) && att !== "Allied" && !f.pact);
  }
  if (c.type === "merchants") return f.type === "raider";
  const o = factionById(state, c.owner);
  if (!o || !o.alive) return false;
  if (f.type === "raider") return !(state.diplo && pactBetween(state, f, o));
  return isAggressiveType(f) && !!state.diplo && !!warBetween(state, f, o);
}
export function aiRaidsHour(state) {
  const g = state.grid;
  const groups = state.factions.filter((f) => f.alive && f.bases.length && (isAggressiveType(f) || atWarWithYou(state, f))); // playerwars.js: at war with you, peaceful types rob your convoys too
  if (!groups.length) return;
  for (const c of roadCaravans(state, { player: true })) {
    // The groups' caravans near a raider gang are ambushed on the way (parties.js aiPartyHour); escorted ones (jobs.js) are left alone.
    if (c.type !== "merchants" && c.owner !== "player") continue;
    if (c.ref.raidedAt != null && state.hour - c.ref.raidedAt < AI_RAID.COOLDOWN) continue;
    const strength = c.owner === "player" ? partyMembers(state, c.ref).reduce((a, s) => a + combatPower(s), 0) * 1.1 : c.strength; // as visitors.js hitConvoy
    for (const f of groups) {
      const war = c.owner === "player" && atWarWithYou(state, f); // playerwars.js: your convoys near an enemy at war
      const lying = c.owner === "player" && lyingFor(state, f, c.ref); // intel.js: they heard its route on your radio
      if (!f.bases.some((b) => g.distance(b, c.tile) <= AI_RAID.RANGE + (war ? PW.CARAVAN_RANGE : 0) + (lying ? INTEL.AMBUSH.RANGE : 0)) || !wouldRaid(state, f, c)) continue;
      const band = groupStrength(f) * AI_RAID.BAND;
      if (band < Math.max(1, strength) * AI_RAID.EDGE) continue;
      const fi = state.factions.indexOf(f);
      const chance = AI_RAID.CHANCE * (1 + Math.min(2, (c.value || 0) / AI_RAID.RICH)) * (war ? PW.CARAVAN : 1) * (lying ? INTEL.AMBUSH.MULT : 1);
      if (hash01(state.seed, "cvraid", state.hour, c.key, fi) >= chance) continue;
      const took = groupRobs(state, f, c, band, strength);
      if (lying) ambushSprung(state, f, c.ref, took); // "They knew we were coming"
      break;
    }
  }
}
// A group falls on a caravan, decided by the numbers. Returns true when the caravan was taken.
export function groupRobs(state, f, c, band = groupStrength(f) * AI_RAID.BAND, strength = c.strength) {
  const st = (state.stats.caravanRaids = state.stats.caravanRaids || { byYou: 0, won: 0, seen: 0, unseen: 0, byGroups: 0, groupsWon: 0, convoysLost: 0 });
  st.byGroups++;
  // groupfight.js: their band (the fittest of them at home, as many as the band's strength holds) against the
  // caravan's guards by its strength, by your by-the-numbers rules; the band's wounds and dead are their very people.
  const A = fightersOf(state, f, { tile: f.bases[0] }).filter((s) => !isWounded(s)); // the fit go out (members.js sendMembers: as a party is picked)
  const per = A.length ? A.reduce((a, s) => a + combatPower(s), 0) / A.length : 1;
  const crew = A.slice(0, Math.max(1, Math.round(band / Math.max(0.5, per))));
  // Your convoy (docs/adr/0001-ai-parity.md): its very people are the side in your place (your rules for yours: their
  // combat power, its retreat policy: breakoff.js convoyPolicy, its vehicle on the way out), and the fight's rounds land on them as they
  // land on the band's (applyYours: wounds, the carried out, the left behind taken by the band or dead). Anyone else's
  // caravan fights by its guards' strength.
  const q = c.owner === "player" ? c.ref : null;
  const yours = q ? partyMembers(state, q) : [];
  const att = { f, people: crew, kind: KIND_OF[f.type] || "raiders" };
  const def = yours.length ? { f: null, yours: true, people: yours, party: q, policy: convoyPolicy(state, q), kind: "militia" }
    : { f: null, people: [], kind: c.type === "merchants" ? "guards" : "militia", count: Math.max(1, Math.round(strength / 3)), power: Math.max(1, strength) };
  const fight = fightSides(state, att, def, yours.length ? { mine: "def" } : {});
  const win = fight.attWon;
  const seen = state.live.has(c.tile) || inCoverage(state, c.tile);
  const who = f.known ? f.name : "Raiders";
  const where = tileLabel(state, c.tile);
  c.ref.raidedAt = state.hour;
  const theirs = applySide(state, f, fight.rA, crew, { holder: win ? f : null, captor: null }); // beaten off, their dead's kit stays with the caravan's guards
  const mine = yours.length ? applyYours(state, fight.rD, yours, { tile: c.tile, cause: `when ${who} robbed the convoy`, kind: att.kind, captor: f, party: q }) : null;
  const hurtText = mine ? convoyPeopleText(state, mine) : "";
  if (!win) {
    if (c.type === "merchants") { c.ref.size = Math.max(1, c.ref.size - 1); c.ref.guards = Math.max(0, (c.ref.guards || 0) - 1); }
    if (q) {
      // The field is your convoy's: what the band's dead carried goes into its cargo (left on the tile, marked, when
      // there is no room), as their own band takes yours when it holds the field.
      const kit = theirs.dead.flatMap((s) => stripAll(s));
      const left = kit.filter((it) => !(state.parties.includes(q) && addGearToCargo(state, q, it)));
      if (left.length) leaveCache(state, c.tile, {}, left);
      log(state, `Your convoy near ${where} beat off ${who}${kit.length ? `, and took ${kit.map((it) => it.name).join(", ")} off their dead` : ""}.${hurtText}`, "good");
      convoyEmpty(state, q);
    } else if (seen) log(state, `The guards of ${c.name} beat off ${who} near ${where}.`, "info");
    return false;
  }
  st.groupsWon++;
  const goods = goodsOf(c);
  if (c.owner === "player") note(state, "taken from you", roundsIn(goods.supplies) + goodsRounds(goods.gear)); // ledger.js (a test switch)
  const took = takeInto(f, goods, state);
  if (c.type !== "merchants" && c.owner !== "player") escortLost(state, factionById(state, c.owner), c.ref, f);
  if (c.type === "merchants") {
    const v = c.ref;
    // (their own losses in the fight are on their people already: groupfight.js applySide)
    visitorInfo(state).stats.robbed++;
    if (seen || v.known) log(state, `${who} fell on ${v.name} near ${where} and took everything they carried.`, "danger");
    chronicleNote(state, `${who} plundered ${v.name}, merchants from outside, near ${where}.`, "world", c.tile);
    leaveMap(state, v, "broken");
  } else if (q) {
    st.convoysLost++;
    log(state, `${who} ambushed your convoy near ${where} and took the whole load${took ? `: ${took}` : ""}.${hurtText}`, "danger");
    chronicleNote(state, `${who} robbed your convoy near ${where}.`, "danger", c.tile);
    convoyEmpty(state, q);
  }
  return true;
}
// What a robbery did to your convoy's people (groupfight.js applyYours), for the log: " Dana and Lee were hurt; Sam
// died; Jo was taken." ("" when nobody was touched).
export function convoyPeopleText(state, r) {
  const nm = (id) => { const s = survivorById(state, id); return s ? s.name.split(" ")[0] : "someone"; };
  const and = (ids) => (ids.length <= 1 ? ids.map(nm).join("") : `${ids.slice(0, -1).map(nm).join(", ")} and ${nm(ids[ids.length - 1])}`);
  const hurtIds = [...r.hurtIds].filter((id) => !r.deadIds.includes(id) && !r.captured.includes(id));
  const bits = [];
  if (hurtIds.length) bits.push(`${and(hurtIds)} ${hurtIds.length === 1 ? "was" : "were"} hurt`);
  if (r.deadIds.length) bits.push(`${and(r.deadIds)} died`);
  if (r.captured.length) bits.push(`${and(r.captured)} ${r.captured.length === 1 ? "was" : "were"} taken`);
  return bits.length ? ` ${bits.join("; ")}.` : "";
}
// A convoy of yours with nobody left after a robbery (killed, or taken): its vehicle and what is left in it stay on
// the tile (parties.js wipeParty), as a team's do.
function convoyEmpty(state, q) {
  if (q && state.parties.includes(q) && !partyMembers(state, q).length) wipeParty(state, q);
}
// All of a caravan's goods into a group's stock (supplies) and onto its shelf (items). Returns what, in words.
export function takeInto(f, goods, state = null) {
  const got = {};
  for (const [k, q] of Object.entries(goods.supplies || {})) {
    if (!SUPPLIES[k] || !(q >= (FOODS[k] ? 1e-6 : 1))) continue;
    const tk = k === "rawwater" ? "water" : k;
    const n = FOODS[k] ? q : Math.floor(q); // food items (foods.js): fractions kept (kg)
    f.stock[tk] = (f.stock[tk] || 0) + n;
    got[k] = n;
    goods.supplies[k] = 0;
  }
  const items = (goods.gear || []).splice(0);
  // arsenal.js: guns, armour and explosives go to their fighters; the rest on their shelf.
  for (const it of items) { if (state) keepItem(state, f, it, "stolen"); else (f.wares || (f.wares = [])).push(it); } // arsenal.js: nothing lost off the end of a shelf
  if (f.lootedGear) for (const it of items) f.lootedGear.push(it.name);
  return [planText(got), ...items.map((it) => it.name)].filter(Boolean).join(", ");
}
// parties.js aiPartyHour: a raider gang near its base ambushes a group's caravan or convoy (the encounter rolled
// there): decided by the numbers; won, everything it carried is theirs. Returns true when the caravan is taken.
export function gangAmbush(state, r, q) {
  const c = { key: pKey(state, q), type: q.kind, ref: q, tile: partyTile(q), owner: q.owner, name: `a ${q.kind}`, strength: q.strength || 2 };
  const band = groupStrength(r) * AI_RAID.BAND;
  const st = (state.stats.caravanRaids = state.stats.caravanRaids || { byYou: 0, won: 0, seen: 0, unseen: 0, byGroups: 0, groupsWon: 0, convoysLost: 0 });
  st.byGroups++;
  // groupfight.js: the gang (the fittest at home, as many as its band) against the caravan's own people (members.js:
  // the party's), by your by-the-numbers rules on both sides.
  const owner = factionById(state, q.owner);
  const A = fightersOf(state, r, { tile: r.bases[0] });
  const per = A.length ? A.reduce((a, s) => a + combatPower(s), 0) / A.length : 1;
  const crew = A.slice(0, Math.max(1, Math.round(band / Math.max(0.5, per))));
  const D = owner ? fightersOf(state, owner, { party: q }) : [];
  const fight = fightSides(state, { f: r, people: crew, kind: KIND_OF[r.type] || "raiders" }, { f: owner, people: D, kind: owner ? KIND_OF[owner.type] || "militia" : "militia", count: Math.max(1, D.length), power: D.length ? 0 : c.strength });
  const win = fight.attWon;
  applySide(state, r, fight.rA, crew, { holder: win ? r : owner, captor: owner });
  if (owner) applySide(state, owner, fight.rD, D, { holder: win ? r : owner, captor: r });
  if (!win) {
    q.strength = (q.strength || 2) * 0.8;
    return false;
  }
  st.groupsWon++;
  takeInto(r, goodsOf(c), state);
  if (!D.length) escortLost(state, owner, q, r); // arsenal.js: a caravan not yet people: the guards' dead and their kit by the numbers
  loseGroupVehicle(state, q, r); // its vehicle is the gang's now, with anything in it (as you take a caravan's)
  return true;
}

// A group's caravan taken: half its guards are dead (people and kit gone from its books), the winners pick up their
// kit (arsenal.js clashKit: the field is theirs).
function escortLost(state, owner, q, winner) {
  if (!owner || !owner.alive || !owner.arsenal) return;
  const guards = q && q.escort ? q.escort.guards : Math.max(1, Math.round(((q && q.strength) || 2) / 4));
  const dead = Math.min(owner.pop, Math.ceil(guards / 2));
  if (dead <= 0) return;
  const issue = issueKit(state, owner, guards, "field");
  issue.slice(0, dead).forEach((lo, i) => { for (const it of [lo.weapon, ...Object.values(lo.armour)]) if (it && removeFromArsenal(owner, it, "died:caravan") && winner && i % 2 === 0) addToArsenal(state, winner, it, "field"); });
  owner.pop = Math.max(0, owner.pop - dead);
  noteFight(owner, dead, 0);
}
// ---------- tooltips ----------
// Map tooltip lines for the groups' caravans and convoys on a tile you can see (render.js).
export function caravanTipLines(state, tile, liveSet = state.live) {
  if (!liveSet.has(tile)) return [];
  const out = [];
  for (const c of roadCaravans(state)) {
    if (c.tile !== tile || c.type === "merchants") continue;
    const f = factionById(state, c.owner);
    if (f && !f.known) out.push(`A ${c.type} of a group you have not met: ${guardText(state, c)}`);
    else out.push(`${cap1(c.name)}: ${guardText(state, c)}, carrying ${cargoText(c)}`);
  }
  return out;
}
export { escortShort };

// ---------- Help (ui/help.js: "Caravans on the road") ----------
export const CARAVAN_HELP = `Caravans travel the roads: <b>merchants from outside the state</b> with their wagons, the <b>groups' caravans</b> (to your bases, to each other) and their <b>trade convoys</b>, and your own convoys. Any of them can be attacked, and whoever wins takes <b>everything</b> it carried.<br><br>
<b>Escorts.</b> Nobody guards a caravan with a fixed list: what the cargo is worth sets how much of what they have the sender wants to put on it (guns, armour and military kit count half again), and what they have caps it. Cheap cargo gets a token guard; rich cargo as much as they can spare. A merchant company from outside has its own means: 2 to 8 hired guns, their gear (pistols and shotguns, riflemen in vests, or hired guns in plate with automatic rifles) and maybe a pickup, a Humvee or an MRAP (the companies grow richer over the years); the armoured ones go only with rich cargo, with an M2 in the turret, and a scout rides ahead when they send nearly everyone. A group sends the fighters it can spare from home (more stay home at war or with the dead at its gates), at its own strength and with its best guns from the shelf, and a military group its Humvee. So a rich cargo of a poor sender still goes lightly guarded. Every merchant caravan has a speciality (arms dealers, medics, mechanics or general traders). The map shows the escort (a guard ahead of the wagon, a pickup behind it, a Humvee or MRAP leading it) and the tooltip says it in words.<br><br>
<b>Attacking one.</b> A team within a tile of a caravan can attack it: from the card when they meet on a road, or from the team's orders card (<i>Attack …</i> for one in sight within a tile: you pick the moment and have the drop on them; <i>Intercept …</i> for one in sight up to ${INTERCEPT.RANGE} tiles away: the team follows it and asks again when it is close, for ${INTERCEPT.HOURS} hours at most). The battle is on the road: its guards, and its vehicle parked behind them. Win and you take all its goods, the guards' gear, and its vehicle if it still runs (it joins a team that has none; otherwise it waits on the tile, marked; one with a shot-up engine needs repairs there; a wreck is stripped for parts and scrap). What the team cannot carry stays in that vehicle or on the tile as <i>cargo left behind</i>: send a team to recover it.<br><br>
<b>Witnesses.</b> Word gets out only if someone saw it: a guard or trader who got away (you lost, pulled back, one fled, or with merchants a trader slipped off in the fighting), another group's base within ${WITNESS.BASE_RANGE} tiles, or anyone else on the road within a tile. Then merchants shun you (reputation −45, the trading groups you know think less of you), or the caravan's group turns hostile and the peaceful groups you know lose goodwill. Leave no one to tell and the caravan simply never arrived; even then word gets around ${Math.round(RUMOUR.CHANCE * 100)}% of the time (a rumour, a body found, a trader who hid), a few days later, and you hear of it only then. Attacking a caravan at your own gates is always seen.<br><br>
<b>The groups rob them too.</b> Raider gangs fall on caravans that pass within ${AI_RAID.RANGE} tiles of their bases (expansionists and zealots only those of groups they are at war with), and on your convoys when they would attack your teams. It is decided by the numbers; the winners put the goods into their stores and the items on their shelves. A trade caravan of yours that loses a fight on the road loses its whole load.`;
