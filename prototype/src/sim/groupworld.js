// AI parity, part two (groupcare.js has the wounded, repairs, hunger, desertion and the type profiles): what the groups
// know, the vehicles they take, trade and fit out, and the bases left empty that they move into. Coarse, once a day per
// group (factions.js factionsDaily), hashed dice only (skills.js hash01) except a card's own choices.
//
// Knowledge (f.knows = { bases: { tile: { kind: "player" | "group", id, def, walls, day } } }): a group starts knowing
// the bases within KNOW.START tiles of its own; it learns more by scouting (KNOW.SCOUT a day × its profile's patrol,
// raid-minded types × raid for your bases: one target base within KNOW.RANGE, the least known first), by its scavenging
// parties (bases within KNOW.SEE of the site they worked) and by questioning the people of yours it holds (all your
// bases, every KNOW.QUESTION days). def is what the base was worth when they looked (your base: its defence with
// everyone at a post; a group's: its strength), and stays what it was: a raid sized on old intel can meet new walls.
// Raids only go for bases they know (factions.js launchRaid); a group they think too strong for them (known strength
// over KNOW.AVOID × theirs) they leave alone. A scout at your base: your lookouts (watch.js lookoutsSpot) see them
// KNOW.SPOT of the time (KNOW.SPOT_WATCH with the watch manned) and you get a card: chase them off (they learn nothing),
// capture them (one of theirs gone, their gun in your armory, goodwill falls) or let them be. Scouted (seen or not), a
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
// stores), and an outpost of yours that is lost or left (world.js removeBase) stays with its buildings as works; the
// works decay (one level every ABANDON.DECAY days). A group expanding counts an abandoned base nearby ABANDON.PULL ×
// a site (more for its kind: raiders like walls, communes fields, expansionists anything), moves in, takes the works
// and the stores; yours: a card. First come, first served.
import { SUPPLIES, GEAR } from "./data.js";
import { groupStockKey } from "./trade.js"; // a group's one count of parts (part kinds come out of it)
import { day, log, addCard, atBase } from "./world.js";
import { hash01 } from "./skills.js";
import { factionVehicles, vehicleValue, upgradesOf, upgradeCost, VEHICLE_TYPES, TURRET_KG } from "./vehicles.js";
import { workshopFactor, worksAt } from "./groupworks.js";
import { weightOf, tickOf } from "./groupcare.js";
import { removeFromArsenal, issueKit } from "./arsenal.js";
import { relation, changeRelation } from "./diplomacy.js";
import { captivesOf } from "./conflicts.js";
import { preparedDefense, strength } from "./factions.js";
import { lookoutsSpot } from "./watch.js";
import { vehicleDeliveriesDaily } from "./vehicletrade.js"; // vehicles bought over the radio arrive

export const KNOW = {
  START: 18, YOU: 24, WATCH: 12, WATCH_DAYS: 10, RANGE: 30, SCOUT: 0.06, SEE: 3, QUESTION: 7, AVOID: 1.5,
  SPOT: 0.4, SPOT_WATCH: 0.8, SCOUTED: 1.6, SCOUTED_DAYS: 12, FRESH: 3,
};
export const VEH = { TAKE_RANGE: 2, TAKE: 0.08, FIND: 0.05, STEAL: 0.01, STEAL_RANGE: 8, STEAL_GROUP: 0.004, SELL: 0.02, FIT: 0.1, FIT_EVERY: 10, PER: 15 };
export const ABANDON = { DECAY: 30, PULL: 3, STOCK: 0.5 };
const h = (state, ...k) => hash01(state.seed, "groupworld", ...k);
const dist = (state, a, b) => state.grid.distance(a, b);
const nearOwn = (state, f, tile) => (f.bases.length ? Math.min(...f.bases.map((b) => dist(state, b, tile))) : Infinity);

// ---------- knowledge ----------
export function knowsOf(state, f) {
  if (f.knows) return f.knows;
  f.knows = { bases: {} };
  const d0 = day(state);
  for (const b of state.bases) if (nearOwn(state, f, b.tile) <= KNOW.YOU) learnBase(state, f, b.tile, d0); // your bases: known within YOU tiles from the start
  for (const o of state.factions) if (o !== f && o.alive) for (const t of o.bases) if (nearOwn(state, f, t) <= KNOW.START) learnBase(state, f, t, d0);
  return f.knows;
}
// What they now know of the base on this tile (true values, as of today).
export function learnBase(state, f, tile, d = day(state)) {
  const K = f.knows || (f.knows = { bases: {} });
  const pb = state.bases.find((b) => b.tile === tile);
  if (pb) {
    K.bases[tile] = { kind: "player", id: pb.id, def: Math.round(defOf(state, pb)), walls: pb.buildings.filter((x) => x.type === "walls" && !x.broken).length, day: d };
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
    for (const b of state.bases) if (nearOwn(state, f, b.tile) <= KNOW.WATCH) learnBase(state, f, b.tile, d);
    for (const o of state.factions) if (o !== f && o.alive) for (const t of o.bases) if (nearOwn(state, f, t) <= KNOW.WATCH) learnBase(state, f, t, d);
  }
  // Your people they hold talk.
  if (d % KNOW.QUESTION === 0 && captivesOf(state, f.id).length) for (const b of state.bases) learnBase(state, f, b.tile, d);
  const odds = KNOW.SCOUT * Math.max(weightOf(f, "patrol"), weightOf(f, "raid"));
  if (h(state, f.name, tickOf(f), "scout") >= odds) return null;
  const cands = [...state.bases.map((b) => b.tile), ...state.factions.filter((o) => o.alive && o !== f).flatMap((o) => o.bases)]
    .filter((t) => nearOwn(state, f, t) <= KNOW.RANGE)
    .map((t) => [t, K.bases[t] ? d - K.bases[t].day : 999, h(state, f.name, tickOf(f), "pick", t)])
    .sort((a, b) => b[1] - a[1] || a[2] - b[2]);
  if (!cands.length) return null;
  const tile = cands[0][0];
  const pb = state.bases.find((b) => b.tile === tile);
  if (pb) return scoutYou(state, f, pb, d);
  learnBase(state, f, tile, d);
  return { tile };
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
      { label: "Capture them", hint: "One of theirs gone, their gun is yours; relations with them fall", disabled: (st) => !atBase(st, base.id).length, ai: (st) => (atBase(st, base.id).length >= 3 ? 2 : -1), resolve: (st) => captureScout(st, f, base) },
      { label: "Let them watch", hint: `${name[0].toUpperCase() + name.slice(1)} learn your defences and are more likely to raid`, resolve: (st) => { learnBase(st, f, base.tile); f.scoutedYou = day(st); return "You let them watch."; } },
    ],
  });
  return { tile: base.tile, seen: true };
}
const lookoutsSpotSafe = (state, base) => lookoutsSpot(state, base, base.tile, 1, true);
function captureScout(state, f, base) {
  if (!f.alive) return "They were gone.";
  f.pop = Math.max(0, f.pop - 1);
  const lo = issueKit(state, f, f.pop + 1, "field")[0];
  const got = [];
  if (lo && lo.weapon && removeFromArsenal(f, lo.weapon, "captured")) { base.armory.push(lo.weapon); got.push(lo.weapon.name); }
  f.goodwill = Math.max(-100, f.goodwill - 4);
  f.scoutsCaught = (f.scoutsCaught || 0) + 1;
  return `Your people caught the watcher${f.known ? `, one of ${f.name}` : ""}${got.length ? `, and took their ${got[0]}` : ""}.`;
}

// ---------- vehicles ----------
export const vehicleWant = (f) => Math.max(0, Math.round((f.pop / VEH.PER) * weightOf(f, "vehicles")));
const live = (f) => factionVehicles(f).filter((v) => v.condition > 0);
function record(f, v, extra = {}) {
  f.vehSeq = (f.vehSeq || 0) + 1;
  const rec = { id: `f${f.id}-g${f.vehSeq}${extra.salt || ""}`, type: v.type, name: v.name, fuel: Math.round(v.fuel || 0), condition: Math.round(v.condition ?? 60), owner: f.id };
  if (v.upgrades) rec.upgrades = JSON.parse(JSON.stringify(v.upgrades));
  factionVehicles(f).push(rec);
  return rec;
}
// One of yours (or one left on the map) into a group's motor pool.
export function takeVehicle(state, f, v, why = "took") {
  const i = state.vehicles.indexOf(v);
  if (i < 0) return null;
  state.vehicles.splice(i, 1);
  for (let j = state.markers.length - 1; j >= 0; j--) if (state.markers[j].key === `vehicle:${v.id}`) state.markers.splice(j, 1);
  const rec = record(f, v);
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
    const v = state.vehicles.find((x) => x.loc.kind === "base" && x.type !== "bike" && (() => { const b = state.bases.find((bb) => bb.id === x.loc.baseId); return b && b.type !== "hub" && !atBase(state, b.id).length && nearOwn(state, f, b.tile) <= VEH.STEAL_RANGE; })());
    if (v) { stealYours(state, f, v); return; }
  }
  // From another group.
  if (h(state, f.name, tickOf(f), "gsteal") < VEH.STEAL_GROUP * S) {
    const o = state.factions.filter((x) => x.alive && x !== f && !x.outsider && live(x).length && nearOwn(state, f, x.bases[0] ?? -1) <= 12 && x.pop < 25).sort((a, b) => a.pop - b.pop || a.id - b.id)[0];
    if (o) stealFromGroup(state, f, o, d);
  }
  // Sell a spare.
  if (live(f).length > vehicleWant(f) + 1 && f.type !== "military" && h(state, f.name, tickOf(f), "sell") < VEH.SELL) {
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
  f.vehiclesStolen = (f.vehiclesStolen || 0) + 1;
  if (h(state, f.name, o.name, tickOf(f), "found") < 0.5) {
    changeRelation(state, f, o, -15);
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
    const have = Math.max(0, Math.floor((from[k] || 0) - (k === "food" ? 20 : 0)));
    const q = Math.min(have, Math.ceil(owed / ((SUPPLIES[k] && SUPPLIES[k].value) || 1)));
    if (q <= 0) continue;
    from[k] -= q;
    to[k] = (to[k] || 0) + q;
    paid[k] = q;
    owed -= q * ((SUPPLIES[k] && SUPPLIES[k].value) || 1);
  }
  return { paid, short: Math.max(0, owed) };
}
export function sellBetween(state, f, buyer) {
  const v = live(f).filter((x) => !upgradesOf(x).turret).sort((a, b) => vehicleValue(a) - vehicleValue(b))[0];
  if (!v) return null;
  const price = vehiclePrice(buyer, v);
  const worth = ["scrap", "fuel", "ammo", "parts", "food", "meds"].reduce((a, k) => a + Math.max(0, (buyer.stock[k] || 0) - (k === "food" ? 20 : 0)) * ((SUPPLIES[k] && SUPPLIES[k].value) || 1), 0);
  if (worth < price) return null;
  payGoods(buyer.stock, f.stock, price);
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
  if (v.cargo && v.cargo.supplies) for (const [k, q] of Object.entries(v.cargo.supplies)) base.stock[k] = (base.stock[k] || 0) + q;
  takeVehicle(state, f, v);
  return { price, paid, short };
}
// You buy one of theirs: paid from the base's stock, it is parked there.
export function buyVehicleFrom(state, f, rec, base, createVehicle) {
  const i = factionVehicles(f).indexOf(rec);
  if (i < 0 || !base) return null;
  const price = vehiclePrice(f, rec, false);
  const worth = ["scrap", "fuel", "ammo", "parts", "food", "meds"].reduce((a, k) => a + Math.max(0, base.stock[k] || 0) * ((SUPPLIES[k] && SUPPLIES[k].value) || 1), 0);
  if (worth < price) return { refused: `They want goods worth ${price}.` };
  payGoods(base.stock, f.stock, price);
  factionVehicles(f).splice(i, 1);
  const v = createVehicle(state, VEHICLE_TYPES[rec.type] ? rec.type : "truck", { kind: "base", baseId: base.id }, { fuel: rec.fuel, condition: rec.condition, name: rec.name });
  if (rec.upgrades) v.upgrades = JSON.parse(JSON.stringify(rec.upgrades));
  return { v, price };
}
// A scavenging party brings a wreck home now and then (aiscav.js): by the site, wanted, repaired at their workshop.
export function scavVehicle(state, f, site) {
  if (live(f).length >= vehicleWant(f) || h(state, f.name, state.hour, "vfind") >= VEH.FIND * weightOf(f, "vehicles")) return null;
  const t = state.tiles[site];
  const mil = t && t.loc && ["military", "airport", "police"].includes(t.loc.type);
  const types = mil ? ["miltruck", "hummer", "truck"] : ["truck", "sedan", "van", "suv"];
  const type = types[Math.floor(h(state, f.name, state.hour, "vtype") * types.length) % types.length];
  if (!VEHICLE_TYPES[type]) return null;
  return record(f, { id: state.hour, type, name: VEHICLE_TYPES[type].name, fuel: 2, condition: 25 + Math.round(35 * h(state, f.name, state.hour, "vcond")) }, { salt: "s" });
}
// Fit one upgrade by type (raiders: scrap plating; the military: plate, then glass; a fortress: plate; traders and
// communes: mesh), paid from the stock; a machine gun in the arsenal goes on a turret.
const FITS = { raider: ["scrapPlate"], expansionist: ["scrapPlate", "mesh"], zealot: ["mesh"], military: ["plating", "glass"], fortress: ["plating", "mesh"], traders: ["mesh"], commune: ["mesh"] };
export function fitUpgrade(state, f) {
  const cars = live(f).filter((v) => v.type !== "bike");
  if (!cars.length || h(state, f.name, tickOf(f), "fit") >= VEH.FIT * 10 * weightOf(f, "vehicles") * (f.type === "commune" ? 0.3 : 1)) return null;
  // A machine gun from the arsenal on a turret.
  const mg = f.arsenal && f.arsenal.items.find((it) => TURRET_KG[it.key]);
  const bare = cars.find((v) => !upgradesOf(v).turret);
  if (mg && bare) { removeFromArsenal(f, mg, "turret"); bare.upgrades = { ...upgradesOf(bare), turret: { gun: mg.key, item: mg } }; return { v: bare, key: "turret" }; }
  for (const key of FITS[f.type] || []) {
    const v = cars.find((x) => { const u = upgradesOf(x); return key === "plating" ? u.plating < 1 && !u.scrapPlate : key === "scrapPlate" ? !u.plating && !u.scrapPlate : !u[key] && !(key === "mesh" && u.glass) && !(key === "glass" && u.mesh); });
    if (!v) continue;
    // (trade.js groupStockKey: a group keeps one count of parts, so car parts come out of it)
    const cost = {};
    for (const [k, q] of Object.entries(upgradeCost(key))) { const sk = groupStockKey(k, f); cost[sk] = (cost[sk] || 0) + q; }
    if (Object.entries(cost).some(([k, q]) => (f.stock[k] || 0) < q + (k === "scrap" ? 5 : 0))) continue;
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
const PLAYER_WORKS = { walls: "walls", palisade: "walls", farm: "farms", field: "farms", greenhouse: "farms", well: "water", watertower: "water", raincatcher: "water", bunkhouse: "beds", barracks: "beds", tents: "beds", workshop: "bench", bench: "bench", workbench: "bench", machine_shop: "bench", storehouse: "store" };
// A group's base its people left (it died out): the works stay, and some of the stores.
export function leaveGroupBase(state, f, tile, share) {
  if (abandonedAt(state, tile) || state.bases.some((b) => b.tile === tile) || state.factions.some((o) => o.alive && o.bases.includes(tile))) return null;
  const stock = {};
  for (const [k, q] of Object.entries(f.stock || {})) if (q > 0 && SUPPLIES[k]) stock[k] = Math.floor(q * share * ABANDON.STOCK);
  const rec = { tile, from: f.id, fromName: f.name, works: { ...((f.works && f.works[tile]) || {}) }, stock, day: day(state) };
  abandonedList(state).push(rec);
  return rec;
}
// An outpost of yours that was lost or left (world.js removeBase): its buildings as works.
export function leavePlayerBase(state, base) {
  if (!base || base.type === "hub" || abandonedAt(state, base.tile)) return null;
  const works = {};
  for (const b of base.buildings || []) { const k = PLAYER_WORKS[b.type]; if (k && !b.broken) works[k] = (works[k] || 0) + 1; }
  const rec = { tile: base.tile, from: "player", fromName: base.name, works, stock: {}, day: day(state) };
  abandonedList(state).push(rec);
  return rec;
}
// How much more a group wants this abandoned base than an empty site.
export function abandonedPull(f, rec) {
  const w = rec.works || {};
  let fit = 1;
  if (f.type === "raider" && (w.walls || 0) >= 1) fit = 1.5;
  if (f.type === "commune" && (w.farms || 0) >= 1) fit = 1.5;
  if (f.type === "fortress" && (w.walls || 0) >= 2) fit = 1.5;
  return ABANDON.PULL * weightOf(f, "expand") * fit;
}
export function occupyAbandoned(state, f, tile) {
  const rec = abandonedAt(state, tile);
  if (!rec) return null;
  state.abandoned.splice(state.abandoned.indexOf(rec), 1);
  const w = worksAt(f, tile);
  for (const [k, q] of Object.entries(rec.works || {})) w[k] = Math.max(w[k] || 0, q);
  for (const [k, q] of Object.entries(rec.stock || {})) f.stock[k] = (f.stock[k] || 0) + q;
  f.basesOccupied = (f.basesOccupied || 0) + 1;
  if (rec.from === "player") addCard(state, { title: `Someone moved into ${rec.fromName}`, text: `${f.known ? f.name : "Another group"} has moved into ${rec.fromName}, the outpost you lost: they use what you built there. It is theirs now; you can take it back like any of their bases.`, choices: [{ label: "OK", resolve: () => "" }] });
  return rec;
}
function decayAbandoned(state, d) {
  for (const rec of [...(state.abandoned || [])]) {
    if ((d - rec.day) % ABANDON.DECAY || d === rec.day) continue;
    const keys = Object.keys(rec.works).filter((k) => rec.works[k] > 0);
    if (keys.length) { const k = keys[Math.floor(h(state, rec.tile, d, "decay") * keys.length)]; rec.works[k] -= 1; }
    // Taken by someone else or empty with nothing left: off the list.
    if (state.bases.some((b) => b.tile === rec.tile) || state.factions.some((o) => o.alive && o.bases.includes(rec.tile)) || (!Object.values(rec.works).some((q) => q > 0) && !Object.values(rec.stock).some((q) => q > 0))) state.abandoned.splice(state.abandoned.indexOf(rec), 1);
  }
}

// One group's day (factions.js factionsDaily).
export function groupWorldDaily(state, f) {
  const d = day(state);
  knowsOf(state, f);
  scoutDaily(state, f, d);
  vehicleDaily(state, f, d);
}
export function groupWorldWorld(state) { decayAbandoned(state, day(state)); vehicleDeliveriesDaily(state); }
// A scavenging party's look around the site (aiscav.js): the bases within KNOW.SEE.
export function scavSaw(state, f, site) {
  knowsOf(state, f);
  for (const b of state.bases) if (dist(state, b.tile, site) <= KNOW.SEE) learnBase(state, f, b.tile);
  for (const o of state.factions) if (o !== f && o.alive) for (const t of o.bases) if (dist(state, t, site) <= KNOW.SEE) learnBase(state, f, t);
}
