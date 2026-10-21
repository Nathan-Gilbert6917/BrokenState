// @ts-check
// Meeting places for trades (the user's request 2026-10-21): a trade is met at a base, or at a tile in the open, and
// two sides far apart meet in the middle.
//
// Their caravan to a meeting tile (caravans.js sendCaravan { meetTile }, party fields meetTile, baseId null)
// - When you ask a group for a trade caravan, or agree a deal over the radio with "We meet", you name where: one of
//   your bases (as before), halfway along their road to that base (halfwayTile), or any tile you pick on the map.
//   A meeting tile must be land they can walk to, not a base (yours: pick the base; theirs: fetch it yourself), not a
//   hive and not where the dead are (meetProblem); it is refused, like a delivery, when it is beyond the hours they
//   walk for you (meetRefusal: the delivery rule, one way).
// - A meeting costs no delivery fee: each side walks its own leg. Their caravan walks to the tile and waits there
//   MEET.WAIT_HOURS (48) from when it arrives (meetArrive); then it goes home with what it has (a radio deal not
//   done by then costs 3 goodwill, as at your gates).
// - Any team of yours standing on the tile while it waits (waiting for orders, at a caravan stop) opens the trade
//   window, once a team (meetHour); the caravan card at the tile and the orders card offer it again. The team trades
//   from what it carries (supplies and cargo) against what the caravan carries: trade.js context kind "meet" (your
//   side as a visit, theirs as a caravan; the team's carry limit and the caravan's both hold). A radio deal is
//   filled in and honoured as agreed.
// - "We meet" over the radio books their caravan at once with their side, and the trade caravan planner opens from
//   the base you traded from with your side loaded and the meeting tile as its stop (meetCaravanForm).
// - A group that calls you with an offer and finds your base far (MEET.OFFER_HOURS, or too far to deliver) may ask
//   to meet halfway instead (radio.js offerCard → meetOfferCard).
//
// The groups among themselves (AI parity, docs/adr/0001-ai-parity.md: the same choice)
// - A trade convoy between two groups (factions.js, a day's chance) is now a swap both ways, nothing from nowhere:
//   each side packs what it can spare (convoyLoad: up to 10 food above 2 days a head, up to 10 scrap above one a
//   head, out of its own stores).
// - Partners within MEET.AI_FAR_HOURS (14, driving) of each other on the road meet at the partner's base: the convoy hands
//   over its load, takes the partner's back and walks home (groupConvoyArrive).
// - Partners further apart meet in the middle: both send a convoy to the halfway tile. The first there waits up to
//   MEET.AI_WAIT_HOURS (48) for the other; when both are there they swap loads and go home. One that waits in vain
//   (the other robbed, lost to the dead, never sent) goes home with its own load. Home again, the load goes into
//   the group's stores.
/** @import { State, Party } from "./types" */
import { log, factionById, baseById } from "./world.js";
import { planPath, moveCost, travelHours, partyTile, partyMembers, tileLabel, removeParty, spawnAiParty } from "./parties.js";
import { attitude } from "./factions.js";
import { takeFood, foodIn } from "./foods.js";
import { SUPPLY_KEYS, SUPPLIES } from "./data.js";
import { tradeSpeech } from "./skills.js";
import { expandAmmo, kindTheme, dealRounds, partyCals } from "./ammo.js";
import { matchGear } from "./radiotrade.js";
import { CARAVAN_SPEED, caravanLeave, escortParty } from "./caravans.js";
import { tradeContext } from "./trade.js";

export const MEET = {
  WAIT_HOURS: 48, // their caravan waits this long at a meeting tile once there
  OFFER_HOURS: 20, // a group calling with an offer may ask to meet halfway when your base is further than this on foot
  OFFER_CHANCE: 0.4,
  AI_FAR_HOURS: 14, // two groups further apart than this on the road (their convoys drive) meet in the middle
  AI_WAIT_HOURS: 48, // a group's convoy waits this long at the halfway tile for the other's
  NEAR: 3, // how far along the road from the middle a halfway tile may be moved to find good ground
};
const isLand = (state, tile) => { const t = state.tiles[tile]; return !!t && (t.terrain !== "water" || !!t.bridge); };

// ---------- where to meet ----------
// The tile halfway along the land road from one tile to another, by what each step costs on foot (moveCost); moved a little
// along the road to good ground (land, no base, no hive, no horde) when the middle itself is not. null: no road.
export function halfwayTile(state, from, to, who = "player") {
  if (from == null || to == null) return null;
  const r = planPath(state, from, to, false, who);
  if (!r || r.path.length < 3) return null;
  const path = r.path;
  const cost = [0];
  for (let i = 1; i < path.length; i++) cost.push(cost[i - 1] + moveCost(state, path[i - 1], path[i], false, who));
  const half = cost[cost.length - 1] / 2;
  let mid = 1;
  while (mid < path.length - 2 && cost[mid] < half) mid++;
  for (let d = 0; d <= MEET.NEAR; d++) {
    for (const i of d ? [mid - d, mid + d] : [mid]) {
      if (i <= 0 || i >= path.length - 1) continue;
      if (!groundProblem(state, path[i])) return path[i];
    }
  }
  return null;
}
// Why nobody meets on this tile, whoever comes (null: it will do).
function groundProblem(state, tile) {
  const t = state.tiles[tile];
  if (!t) return "Pick a tile on the map.";
  if (!isLand(state, tile)) return "Nobody meets on the water.";
  if (t.hive) return "A hive stands there.";
  if (state.bases.some((b) => b.tile === tile)) return "That is your own base: pick it as a base.";
  const g = state.factions.find((x) => x.alive && x.bases.includes(tile));
  if (g) return `That is ${g.name}'s base.`;
  if ((state.hordes || []).some((h) => state.grid.distance(h.tile, tile) <= 1)) return "The dead are there.";
  return null;
}
// Why this group will not meet you on this tile (null: it will, if it sends a caravan at all).
export function meetProblem(state, f, tile) {
  if (tile == null || !Number.isInteger(tile)) return "Pick a tile to meet at.";
  const g = groundProblem(state, tile);
  if (g) return f && f.bases.includes(tile) ? "That is their own base: fetch it yourself instead." : g;
  if (meetHours(state, f, tile) == null) return `${f.name} have no way to ${tileLabel(state, tile)} over land.`;
  return null;
}
// Hours their caravan walks from their main base to this tile (null: no land road).
export function meetHours(state, f, tile) {
  const from = f && f.bases[0];
  if (from == null || tile == null) return null;
  const r = planPath(state, from, tile, false, f.id);
  return r ? travelHours(state, r.path, { vehicle: false, speed: CARAVAN_SPEED }).hours : null;
}
// Why they will not send a caravan to meet you there (null: they will). The delivery rule (radiotrade.js
// deliveryRefusal), the hours one way to the tile.
export function meetRefusal(state, f, tile, enRoute = false) {
  if (!f || !f.alive) return "Nobody answers any more.";
  if (enRoute) return "Their caravan is already on the road.";
  const why = meetProblem(state, f, tile);
  if (why) return why;
  if (f.pop < 6) return "There are too few of them to spare guards for a caravan.";
  if (state.hordes.some((x) => state.grid.distance(x.tile, f.bases[0]) <= 3)) return "The dead are at their walls: nobody goes out.";
  if (f.atWar && f.goodwill < 40) return "They are at war and keep every gun at home. (Goodwill 40 needed.)";
  if (f.goodwill < 0 && f.type !== "traders") return "They do not trust you enough to send their people out to meet you. (Goodwill 0 needed.)";
  const h = meetHours(state, f, tile) || 0;
  const most = Math.round(48 + Math.max(0, f.goodwill) + (f.type === "traders" ? 24 : 0) + (f.pact ? 24 : 0));
  if (h > most) return `${tileLabel(state, tile)} is too far: about ${h}h for them, and they go at most ${most}h for you.`;
  return null;
}
// The places to offer for a trade with this group: each of your bases they can reach, and halfway to each.
// [{ tile, baseId?, half?, name, hours }] (hours: their caravan's walk there).
export function meetPlaces(state, f) {
  const out = [];
  for (const b of state.bases) {
    const r = f && f.bases[0] != null ? planPath(state, f.bases[0], b.tile, false, f.id) : null;
    if (!r) continue;
    out.push({ tile: b.tile, baseId: b.id, name: b.name, hours: travelHours(state, r.path, { vehicle: false, speed: CARAVAN_SPEED }).hours });
    const mid = halfwayTile(state, f.bases[0], b.tile, f.id);
    if (mid != null) out.push({ tile: mid, half: true, name: `Halfway to ${b.name}: ${tileLabel(state, mid)}`, hours: meetHours(state, f, mid) });
  }
  return out;
}

// ---------- their caravan at the meeting tile ----------
export const isMeet = (c) => !!c && c.kind === "caravan" && c.meetTile != null;
// Where a caravan of theirs is headed or waiting, in words.
export const caravanWhere = (state, c) => (isMeet(c) ? tileLabel(state, c.meetTile) : baseById(state, c.baseId)?.name || "your base");
// Their caravans waiting at (or on the way to) a meeting tile.
export const meetCaravans = (state) => state.parties.filter((c) => isMeet(c) && !c.leaving && c.escortJob == null);
export const meetCaravanAt = (state, tile) => meetCaravans(state).find((c) => c.meetTile === tile && c.phase === "trading") || null;
// Can this team trade with this caravan now?
export function meetOk(state, c, p) {
  if (!isMeet(c) || c.phase !== "trading" || !state.parties.includes(c) || !p || !state.parties.includes(p)) return false;
  const f = factionById(state, c.owner);
  return !!f && f.alive && attitude(f) !== "Hostile" && p.owner === "player" && p.kind !== "convoy" && partyTile(p) === c.meetTile && partyMembers(state, p).length > 0;
}
// caravans.js caravanArrive: their caravan reached the meeting tile.
export function meetArrive(state, c) {
  const f = factionById(state, c.owner);
  c.phase = "trading";
  c.stayUntil = state.hour + MEET.WAIT_HOURS;
  if (f) f.known = true;
  log(state, `A caravan from ${f ? f.name : "a group"} waits at ${tileLabel(state, c.meetTile)}${c.deal ? " with the goods you agreed on" : ""} until day ${Math.floor(c.stayUntil / 24) + 1}, ${String(c.stayUntil % 24).padStart(2, "0")}:00. A team of yours on that tile can trade with it.`, "good");
  meetHour(state, c);
}
// caravans.js caravanHour, each hour it waits: a team of yours on the tile opens the trade window (once a team);
// when its wait is up it goes home.
export function meetHour(state, c) {
  if (state.hour >= c.stayUntil) {
    const met = Object.keys(c.metTeams || {}).length > 0;
    caravanLeave(state, c, met ? "Its wait is up." : "Nobody came to meet it.");
    return;
  }
  for (const p of state.parties) {
    if (p.phase !== "waiting" || (c.metTeams && c.metTeams[p.id] != null) || !meetOk(state, c, p)) continue;
    openMeetTrade(state, c, p);
    return;
  }
}
// Opens the trade window between this team and their caravan (or queues it). A radio deal is filled in.
export function openMeetTrade(state, c, p) {
  if (!meetOk(state, c, p)) return false;
  (c.metTeams = c.metTeams || {})[p.id] = state.hour;
  if (state.trade && state.trade.meet && state.trade.caravanId === c.id && state.trade.partyId === p.id) return true;
  const f = factionById(state, c.owner);
  const t = { meet: true, caravanId: c.id, partyId: p.id, factionId: c.owner, deal: c.deal && !c.dealDone ? c.deal : null, offer: {}, ask: {}, offerGear: [], askGear: [], intel: { area: "", sightings: false, sell: false } };
  if (t.deal && ((t.deal.ask && t.deal.ask.ammo) || (t.deal.offer && t.deal.offer.ammo))) { // ammo.js: "N ammo" as rounds by calibre
    expandAmmo(c.goods.supplies, kindTheme(f.type));
    const cals = partyCals(state, p);
    const mine = { ...p.supplies };
    for (const [k, q] of Object.entries(p.cargo.supplies)) mine[k] = (mine[k] || 0) + q;
    t.deal = { ...t.deal, ask: dealRounds(t.deal.ask, c.goods.supplies, cals, true), offer: dealRounds(t.deal.offer, mine, cals, false) };
  }
  if (t.deal) {
    t.offer = { ...t.deal.offer };
    t.ask = { ...t.deal.ask };
    t.offerGear = matchGear(p.cargo.gear, t.deal.offerGear || []) || []; // what your team brought for the deal
    t.askGear = matchGear(c.goods.gear, t.deal.askGear || []) || [];
  }
  p.phase = "engaged";
  if (state.trade && tradeContext(state)) {
    const q = (state.tradeQueue = state.tradeQueue || []);
    if (!q.some((v) => v.meet && v.caravanId === c.id && v.partyId === p.id)) q.push(t);
    return false;
  }
  state.trade = t;
  return true;
}
// trade.js advanceTradeQueue: a waiting meeting gets the screen if both are still there.
export function resumeMeetTrade(state, t) {
  const c = state.parties.find((x) => x.id === t.caravanId);
  const p = state.parties.find((x) => x.id === t.partyId);
  if (!p || p.phase !== "engaged") return;
  if (!meetOk(state, c, p)) return;
  state.trade = t;
}
// trade.js tradeContext for a meeting: the team's side as a visit, theirs as a caravan.
export function meetTradeContext(state, t) {
  const f = factionById(state, t.factionId);
  if (!f || !f.alive) return null;
  const c = state.parties.find((x) => x.id === t.caravanId);
  const p = state.parties.find((x) => x.id === t.partyId);
  if (!c || !p || !isMeet(c) || c.phase !== "trading" || partyTile(p) !== c.meetTile) return null;
  expandAmmo(c.goods.supplies, kindTheme(f.type)); // ammo.js: their ammo as rounds by calibre
  const have = {}, theirHave = {};
  for (const k of SUPPLY_KEYS) {
    have[k] = Math.max(0, Math.floor((p.supplies[k] || 0) + (p.cargo.supplies[k] || 0)));
    theirHave[k] = Math.max(0, Math.floor(c.goods.supplies[k] || 0));
  }
  have.ammo = theirHave.ammo = 0; // rounds change hands by calibre and type (ammo.js)
  return { kind: "meet", t, f, caravan: c, base: null, p, speech: tradeSpeech(partyMembers(state, p)), have, theirHave, myGear: p.cargo.gear, theirGear: c.goods.gear, center: c.meetTile };
}
// The trade caravan planner's form for a meeting: from the base the deal was made at (else the hub), to the meeting
// tile, your side of a radio deal loaded.
export function meetCaravanForm(state, c) {
  const d = c.deal || null;
  const base = (d && baseById(state, d.baseId)) || state.bases.find((b) => b.type === "hub") || state.bases[0];
  const gear = d && base ? matchGear(base.armory, d.offerGear || []) || [] : [];
  const goods = {};
  for (const [k, q] of Object.entries((d && d.offer) || {})) if (q > 0 && (SUPPLIES[k] || k === "food")) goods[k] = q;
  return {
    crew: [], vehicleId: null, stance: "normal", goods, travel: { food: 0, water: 0, fuel: 0 },
    gear: gear.map((g) => base.armory.indexOf(g)), stops: [c.meetTile], fromBaseId: base ? base.id : null, meetId: c.id,
  };
}

// ---------- the groups among themselves ----------
// What a group packs for a trade convoy, out of its own stores: { supplies, gear }.
export function convoyLoad(state, f) {
  const food = takeFood(f.stock, Math.min(Math.max(0, foodIn(f.stock) - f.pop * 2), 10), { eggs: false, state });
  const scrap = Math.max(0, Math.min(10, Math.floor((f.stock.scrap || 0) - f.pop)));
  f.stock.scrap = (f.stock.scrap || 0) - scrap;
  return { supplies: { ...food.items, ...(scrap ? { scrap } : {}) }, gear: [] };
}
// Hours on the road between two groups' main bases (their convoys drive where they can). null: no road.
export function groupRoadHours(state, f, o) {
  const a = f.bases[0], b = o.bases[0];
  if (a == null || b == null) return null;
  const car = planPath(state, a, b, true, f.id);
  const r = car || planPath(state, a, b, false, f.id);
  return r ? travelHours(state, r.path, { vehicle: !!car }).hours : null;
}
function spawnConvoy(state, f, to, dest) {
  const q = spawnAiParty(state, f, "convoy", f.bases[0], dest, { strength: Math.max(2, f.pop * 0.1), targetFaction: to.id });
  if (!q) return null;
  q.home = f.bases[0];
  q.goods = convoyLoad(state, f);
  escortParty(state, f, q, q.goods); // caravans.js: what it carries is worth a token guard to them
  return q;
}
// factions.js: f sends a trade convoy to `to`. Near: to its base. Far: both meet halfway. Returns the convoys sent.
export function sendGroupConvoy(state, f, to) {
  const hrs = groupRoadHours(state, f, to);
  if (hrs == null) return [];
  const mid = hrs > MEET.AI_FAR_HOURS ? halfwayTile(state, f.bases[0], to.bases[0], f.id) : null;
  if (mid == null || to.pop < 4) {
    const q = spawnConvoy(state, f, to, to.bases[0]);
    return q ? [q] : [];
  }
  const a = spawnConvoy(state, f, to, mid);
  if (!a) return [];
  const b = spawnConvoy(state, to, f, mid);
  a.meetTile = mid;
  if (b) { b.meetTile = mid; b.meetWith = a.id; a.meetWith = b.id; }
  return b ? [a, b] : [a];
}
// Unloads a convoy's goods into its group's stores (home again).
function unload(f, q) {
  for (const [k, n] of Object.entries((q.goods && q.goods.supplies) || {})) if (n > 0) f.stock[k] = (f.stock[k] || 0) + n;
  for (const it of (q.goods && q.goods.gear) || []) (f.wares = f.wares || []).push(it);
  q.goods = { supplies: {}, gear: [] };
}
// Hands a load over to a group's stores and gives the convoy what it got in return.
function handOver(state, q, to) {
  unload(to, q);
  q.goods = convoyLoad(state, to);
}
function goHome(state, q) {
  const home = q.home ?? factionById(state, q.owner)?.bases[0];
  const back = home != null ? planPath(state, partyTile(q), home, q.vehicle, q.owner) || planPath(state, partyTile(q), home, false, q.owner) : null;
  if (!back) return removeParty(state, q);
  Object.assign(q, { leaving: true, phase: "out", path: back.path, idx: 0, progress: 0, targetFaction: q.owner, meetTile: null, meetWith: null });
}
const loadText = (g) => Object.entries((g && g.supplies) || {}).filter(([, n]) => n >= 1).map(([k, n]) => `${Math.floor(n)} ${SUPPLIES[k] ? SUPPLIES[k].name.toLowerCase() : k}`).join(", ") || "nothing";
// parties.js aiPartyHour: a group's trade convoy reached the end of its road.
export function groupConvoyArrive(state, q) {
  const f = factionById(state, q.owner);
  if (q.leaving) {
    if (f && f.alive) unload(f, q);
    return removeParty(state, q);
  }
  if (q.meetTile != null) {
    q.phase = "meet";
    q.waitUntil = state.hour + MEET.AI_WAIT_HOURS;
    return convoyMeetHour(state, q);
  }
  const to = factionById(state, q.targetFaction);
  if (to && to.alive && f && f.alive) {
    handOver(state, q, to);
    state.stats = state.stats || {};
    state.stats.groupTrades = (state.stats.groupTrades || 0) + 1;
  }
  goHome(state, q);
}
// Each hour a convoy waits at the halfway tile: the other there too, they swap; its wait up, home.
export function convoyMeetHour(state, q) {
  const o = state.parties.find((x) => x.id === q.meetWith && x.kind === "convoy");
  if (o && o.phase === "meet" && partyTile(o) === partyTile(q)) {
    const mine = q.goods, theirs = o.goods;
    q.goods = theirs || { supplies: {}, gear: [] };
    o.goods = mine || { supplies: {}, gear: [] };
    state.stats = state.stats || {};
    state.stats.groupTrades = (state.stats.groupTrades || 0) + 1;
    state.stats.groupMeets = (state.stats.groupMeets || 0) + 1;
    const fa = factionById(state, q.owner), fb = factionById(state, o.owner);
    if (fa && fb && (fa.known || fb.known) && (state.knowledge || {})[q.meetTile ?? partyTile(q)]) log(state, `Convoys of ${fa.name} and ${fb.name} met at ${tileLabel(state, partyTile(q))} and traded (${loadText(o.goods)} for ${loadText(q.goods)}).`, "info");
    goHome(state, q);
    goHome(state, o);
    return;
  }
  if (!o || state.hour >= q.waitUntil) goHome(state, q);
}
// The orders card and the caravan card at a meeting tile: trade with the caravan waiting there.
export function meetChoices(state, p) {
  const c = meetCaravanAt(state, partyTile(p));
  if (!c || !meetOk(state, c, p)) return [];
  const f = factionById(state, c.owner);
  return [{
    label: `Trade with the ${f.name} caravan here`, hint: `It waits until day ${Math.floor(c.stayUntil / 24) + 1}, ${String(c.stayUntil % 24).padStart(2, "0")}:00${c.deal && !c.dealDone ? ", with the deal agreed over the radio" : ""}. The team trades from what it carries.`,
    resolve: (st) => { openMeetTrade(st, c, p); return ""; },
  }];
}
