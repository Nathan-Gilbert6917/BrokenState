// Occupy (parties.js mission "occupy"): your team moves into an abandoned base (groupworld.js state.abandoned: a base
// left standing by a group that died out, gave it up or lost it in a raid, or an outpost of yours that was lost) and
// it is yours with what still stands there, instead of starting from bare ground as Build outpost does. The AI groups
// have always done this (factions.js expansion, groupworld.js occupyAbandoned); this is the same thing for you.
//
// - Where: any abandoned base you know of (the map's right-click menu, the planner's mission list, a team's orders on
//   the tile). Not on ground a group's base holds (as Build outpost), not with a horde camped on it (cull it first),
//   not while your first Hardcore hub is still to be founded (that is a staging camp: staging.js). With no base at all
//   (the exiles) it becomes your hub.
// - What is inside (groupworld.js abandonedThreat, the same for the groups): the dead that drifted in, and sometimes a
//   band of squatters. On arrival a card shows them and the odds; Clear it out is a fight (a field battle, or by the
//   numbers headless), Back off waits for orders. Nobody inside: the team just moves in. A failed attempt leaves those
//   it killed dead for ABANDON.THIN_DAYS days.
// - What you get: an outpost (the hub when you have none). One of yours: its own buildings as they stand (wear, damage
//   and all, after the rot of the months it stood empty: groupworld.js) and the stores left there, under its old name.
//   A group's: its works as buildings (OCCUPY.FROM_WORKS: walls a section for every OCCUPY.WALL_POINTS wall points,
//   fields as farm plots, a well, quarters as bunkhouses, a workbench, a storehouse), worn OCCUPY.WEAR (+ WEAR_AGE a
//   month it stood empty, at most WEAR_MAX), and its stores. Only what fits the plots and each building's limit stands
//   (buildings.js PLOTS; the rest is rubble). The team stays as its first staff (as Build outpost), with its vehicle.
// - Grievances, as for the groups (parity): the group whose base it was, if it still stands, loses OCCUPY.FORMER_GW
//   goodwill toward you (a "growth" grievance, playerwars.js); every claim of a group's within CLAIM.BASE_RADIUS tiles is
//   yours now, and that group loses CLAIM.TAKEN goodwill a tile (claims.js; a group's base taking another's claims
//   costs their relations the same).
// - The governor (autopilot.js) moves into a nearby abandoned base it can clear instead of founding an outpost when it
//   wants one (occupyCandidate there).
import { BUILDINGS, plotsFree, countAll, count, assignStations } from "./buildings.js";
import { SUPPLIES, STOCK_KEYS } from "./data.js";
import { log, addCard, day, hub, newId, combatPower, armedFactor, snapshot } from "./world.js";
import { abandonedAt, abandonedThreat, ABANDON } from "./groupworld.js";
import { partyMembers, partyTile, tileLabel, awaitOrders, wipeIfEmpty, outpostName, settleInto } from "./parties.js";
import { startCombat, registerCombatHandler, winOdds } from "./combat.js";
import { changeGoodwill, recomputeOwnership } from "./factions.js";
import { CLAIM } from "./claims.js";
import { keyWord } from "./water.js"; // "un-purified water" in texts
import { sumRecs, totalRounds } from "./rounds.js"; // rounds by calibre
import { firstHubPending } from "./hardcore-start.js";

export const OCCUPY = {
  // A group's works as your buildings (groupworks.js keys → buildings.js BUILDINGS).
  FROM_WORKS: { walls: "walls", farms: "farm_plot", water: "well", beds: "bunkhouse", bench: "workbench", store: "storehouse" },
  WALL_POINTS: 3,   // a wall section of yours is 3 wall strength: a group's wall points / 3 (rounded up) sections
  WEAR: 45, WEAR_AGE: 10, WEAR_MAX: 90, // a group's works when you move in: battered, more the longer they stood empty
  FORMER_GW: -10,   // the group whose base it was (still standing): goodwill toward you
  AI_ODDS: 0.6,     // the governor clears it at these odds or better (the card's own choice: Clear it out)
  GOV_RANGE: 10,    // the governor looks this many tiles from the hub for one to move into
  GOV_CREW: 3,      // and sends this many (more when the threat asks for it, up to GOV_CREW_MAX)
  GOV_CREW_MAX: 5,
};
const cap1 = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const emptyStock = () => ({ food: 0, water: 0, rawwater: 0, fuel: 0, meds: 0, ammo: 0, parts: 0, scrap: 0, preserved: 0, jars: 0 });

// ---------- what is there ----------
// Why a team cannot occupy this tile ("" = it can). The sim's truth: the planner offers the mission where your map
// shows an abandoned base; this is checked again on arrival.
export function occupyProblem(state, tile) {
  const t = state.tiles[tile];
  if (!t) return "There is no such tile.";
  if (state.bases.some((b) => b.tile === tile)) return "You already have a base there.";
  const fb = state.factions.find((f) => f.alive && f.bases.includes(tile));
  if (fb) return `${fb.known ? fb.name : "A group"} has moved in there: it is their base now (Assault their base to take it).`;
  if (!abandonedAt(state, tile)) return "No base stands empty there (nothing left of it, or someone moved in).";
  if (typeof t.owner === "number") { const o = state.factions.find((f) => f.id === t.owner); return `That ground is held by ${o && o.known ? o.name : "a group"}'s base nearby.`; }
  if (state.hordes.some((h) => h.tile === tile)) return "A horde is camped on it: cull it first.";
  if (firstHubPending(state)) return "Your first home is a staging camp you build (Establish base).";
  return "";
}
// The buildings a group's works make for you (OCCUPY.FROM_WORKS), worn by the months they stood empty.
function buildingsFromWorks(state, rec) {
  const out = [];
  const months = Math.floor(Math.max(0, day(state) - rec.day) / ABANDON.DECAY);
  const wear = Math.min(OCCUPY.WEAR_MAX, OCCUPY.WEAR + OCCUPY.WEAR_AGE * months);
  for (const [k, type] of Object.entries(OCCUPY.FROM_WORKS)) {
    const q = Math.max(0, Math.floor((rec.works && rec.works[k]) || 0));
    const n = k === "walls" ? Math.ceil(q / OCCUPY.WALL_POINTS) : q;
    for (let i = 0; i < n; i++) out.push({ type, wear });
  }
  return out;
}
// What stands there: a list of { type, wear, broken } (yours: the buildings themselves; a group's: from its works).
export const standingAt = (state, rec) => (rec.buildings ? rec.buildings : buildingsFromWorks(state, rec));
// "2 walls, a well, a bunkhouse (1 broken)".
export function standingText(list) {
  const by = new Map();
  for (const b of list) { const d = BUILDINGS[b.type]; if (!d) continue; const e = by.get(d.name) || { n: 0, broken: 0 }; e.n++; if (b.broken) e.broken++; by.set(d.name, e); }
  const parts = [...by].map(([name, e]) => `${e.n > 1 ? `${e.n} × ` : ""}${name.toLowerCase()}${e.broken ? ` (${e.broken === e.n ? "broken" : `${e.broken} broken`})` : ""}`);
  return parts.length ? parts.join(", ") : "nothing but the shell of it";
}
export function stockText(stock) {
  const parts = STOCK_KEYS.filter((k) => k !== "ammo" && (stock[k] || 0) >= 1).map((k) => `${Math.floor(stock[k])} ${keyWord(k)}`);
  const r = Math.floor(totalRounds(stock));
  if (r >= 1) parts.push(`${r} rounds`);
  return parts.join(", ");
}
// "6 of the dead and 3 squatters".
export function threatText(threat) {
  if (!threat || !threat.count) return "nobody: it is quiet";
  const bits = [];
  if (threat.dead) bits.push(`${threat.dead} of the dead`);
  if (threat.squat) bits.push(`${threat.squat} squatter${threat.squat === 1 ? "" : "s"} with guns`);
  return bits.join(" and ");
}
// Who it angers: the group whose base it was, and the groups whose claims round it you would take.
export function occupyGrievance(state, tile) {
  const rec = abandonedAt(state, tile);
  const out = [];
  const former = rec && typeof rec.from === "number" ? state.factions.find((f) => f.id === rec.from && f.alive) : null;
  if (former) out.push({ f: former, gw: OCCUPY.FORMER_GW, why: "it was their base" });
  const claims = new Map();
  if (state.claims) for (const id of state.grid.within(tile, CLAIM.BASE_RADIUS)) {
    const c = state.claims[id];
    if (!c || typeof c.owner !== "number") continue;
    const f = state.factions.find((o) => o.id === c.owner && o.alive);
    if (f) claims.set(f, (claims.get(f) || 0) + 1);
  }
  for (const [f, n] of claims) out.push({ f, gw: CLAIM.TAKEN * n, why: `${n} of their claims round it` });
  return out;
}
const grievanceWords = (list) => list.map((g) => `${g.f.known ? g.f.name : "a group"} (${g.why}: goodwill ${g.gw})`).join(", ");

// ---------- the odds ----------
// The same sum as any fight by the numbers (combat.js byNumbersOdds): the team's power against the count × power inside.
export function occupyOdds(members, threat, ammo = null, arrows = 0) {
  if (!threat || !threat.count) return 1;
  if (!members.length) return 0;
  const mine = members.reduce((a, s) => a + combatPower(s), 0) * (ammo == null ? 1 : armedFactor(members, ammo, arrows));
  return winOdds(mine / Math.max(0.1, threat.count * threat.power), { kind: threat.kind, count: threat.count, people: members.length });
}
const carriedOf = (p, k) => Math.max(0, Math.floor(p.supplies[k] || 0)) + Math.max(0, Math.floor((p.cargo && p.cargo.supplies[k]) || 0));
export const teamOccupyOdds = (state, p, threat) => occupyOdds(partyMembers(state, p), threat, sumRecs(p.supplies, p.cargo && p.cargo.supplies), carriedOf(p, "arrows"));

// For the planner and the tile panel: what you know of the base and what is inside today. people: the crew picked
// (their odds), or none.
export function occupyPreview(state, tile, people = []) {
  const rec = abandonedAt(state, tile);
  if (!rec) return null;
  const threat = abandonedThreat(state, tile);
  return {
    mine: rec.from === "player", fromName: rec.fromName, day: rec.day, standing: standingText(standingAt(state, rec)), stock: stockText(rec.stock || {}),
    threat, threatText: threatText(threat), odds: people.length ? occupyOdds(people, threat) : null, grievance: grievanceWords(occupyGrievance(state, tile)), problem: occupyProblem(state, tile),
  };
}

// ---------- the mission ----------
export function occupyArrive(state, p) {
  const tile = partyTile(p);
  const why = occupyProblem(state, tile);
  if (why) { awaitOrders(state, p, why, { failed: true }); return ""; }
  const threat = abandonedThreat(state, tile);
  if (!threat.count) return takeAbandoned(state, tile, p);
  p.phase = "engaged";
  addCard(state, occupyCard(state, p, threat));
  return "";
}
function occupyCard(state, p, threat) {
  const tile = partyTile(p);
  const rec = abandonedAt(state, tile);
  const odds = teamOccupyOdds(state, p, threat);
  const griev = occupyGrievance(state, tile);
  const whose = rec.from === "player" ? `${rec.fromName}, your old outpost,` : `The base ${rec.fromName} left`;
  const stock = stockText(rec.stock || {});
  return {
    title: `Occupy: ${tileLabel(state, tile)}`, partyId: p.id, where: tileLabel(state, tile), occupy: { tile },
    text: `${whose} stands empty (since day ${rec.day}): ${standingText(standingAt(state, rec))}.${stock ? ` Stores left: ${stock}.` : ""} Inside: ${threatText(threat)}.${griev.length ? ` Moving in angers ${grievanceWords(griev)}.` : ""}`,
    choices: [
      { label: "Clear it out and move in", fight: { odds, enemy: occupyEnemy(threat), ambush: null }, hint: `About ${Math.round(odds * 100)}% to win against ${threatText(threat)}. Win and it is your ${hub(state) ? "outpost" : "hub"}, with what stands there; the team stays as its staff`,
        ai: (st) => (teamOccupyOdds(st, p, abandonedThreat(st, tile) || threat) >= OCCUPY.AI_ODDS ? 2 : -1), resolve: (st) => startOccupyFight(st, p) },
      { label: "Back off", hint: "No fight: the team waits here for orders", ai: () => 0, resolve: (st) => { awaitOrders(st, p, `The team pulled back from ${tileLabel(st, tile)}.`); return "The team pulls back."; } },
    ],
  };
}
const occupyEnemy = (threat) => ({ kind: threat.kind, count: threat.count, power: threat.power, name: cap1(threat.name) });
export function startOccupyFight(state, p) {
  if (!state.parties.includes(p)) return "";
  const tile = partyTile(p);
  const why = occupyProblem(state, tile);
  if (why) { awaitOrders(state, p, why, { failed: true }); return ""; }
  const threat = abandonedThreat(state, tile);
  if (!threat.count) return takeAbandoned(state, tile, p);
  p.phase = "engaged";
  startCombat(state, { tile, partyId: p.id, enemy: occupyEnemy(threat), ambush: null, canRetreat: true, handler: "occupyBase", context: { partyId: p.id, tile } });
  return "";
}
registerCombatHandler("occupyBase", (state, result, setup) => {
  const c = setup.context;
  const p = state.parties.find((x) => x.id === c.partyId);
  if (p && !partyMembers(state, p).length) {
    wipeIfEmpty(state, p);
    log(state, `The team sent to occupy ${tileLabel(state, c.tile)} died there.`, "death");
    return;
  }
  const rec = abandonedAt(state, c.tile);
  if (result.outcome === "victory") {
    const why = occupyProblem(state, c.tile);
    if (why) { if (p) awaitOrders(state, p, `The place is cleared, but: ${why}`, { failed: true }); return; }
    const text = takeAbandoned(state, c.tile, p);
    if (p && state.parties.includes(p)) awaitOrders(state, p, text);
    return;
  }
  // Those killed stay dead a while (groupworld.js abandonedThreat): a second try soon after meets fewer.
  if (rec && result.enemiesKilled) {
    const d = day(state);
    const before = rec.thinned && d - rec.thinned.day < ABANDON.THIN_DAYS ? rec.thinned.n : 0;
    rec.thinned = { day: d, n: before + result.enemiesKilled };
  }
  const text = result.outcome === "retreat" ? `The team pulled back from ${tileLabel(state, c.tile)}.` : `The team was driven off at ${tileLabel(state, c.tile)}.`;
  log(state, text, "danger");
  if (p && state.parties.includes(p) && !wipeIfEmpty(state, p)) awaitOrders(state, p, text, { failed: true });
});

// ---------- moving in ----------
// The buildings that fit (buildings.js: a plot each where the type needs one, at most its max, one of a family):
// copies with new ids, in the order given. Returns the ones left out (rubble).
function raise(base, list) {
  const left = [];
  for (const src of list) {
    const def = BUILDINGS[src.type];
    if (!def || def.shelterOnly || def.tierUp) { left.push(src); continue; }
    if (countAll(base, src.type) >= (def.max || 1)) { left.push(src); continue; }
    if (def.family && base.buildings.some((x) => BUILDINGS[x.type] && BUILDINGS[x.type].family === def.family)) { left.push(src); continue; }
    if (def.plot && plotsFree(base, def.plot) <= 0) { left.push(src); continue; }
    const b = { ...JSON.parse(JSON.stringify(src)), id: newId() };
    if (def.barrel && !b.tier) { b.tier = 1; b.holds = "rawwater"; }
    base.buildings.push(b);
  }
  base.radio = count(base, "radio") > 0;
  base.watchtower = count(base, "watchtower") > 0;
  return left;
}
// The base is yours. p: the team that moves in (null: a test). Returns a line for the card and the log.
export function takeAbandoned(state, tile, p = null) {
  const rec = abandonedAt(state, tile);
  if (!rec) return "";
  const mine = rec.from === "player";
  const noHub = !hub(state);
  const name = mine && !state.bases.some((b) => b.name === rec.fromName) ? rec.fromName : outpostName(state, tile);
  const base = { id: newId(), tile, type: noHub ? "hub" : "outpost", name, stock: emptyStock(), radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  base.occupiedFrom = { from: rec.from, name: rec.fromName, day: day(state), left: rec.day }; // the tile panel: whose it was
  const list = standingAt(state, rec);
  const rubble = raise(base, list);
  const got = stockText(rec.stock || {});
  for (const [k, q] of Object.entries(rec.stock || {})) if (SUPPLIES[k] && q >= 1) base.stock[k] = (base.stock[k] || 0) + Math.floor(q);
  // The grievances before the record goes and the land changes hands (occupyGrievance reads both as they are).
  const griev = occupyGrievance(state, tile);
  state.abandoned.splice(state.abandoned.indexOf(rec), 1);
  const t = state.tiles[tile];
  if (t.ruin) delete t.ruin;
  state.bases.push(base);
  const people = p && state.parties.includes(p) ? partyMembers(state, p).length : 0;
  if (p && state.parties.includes(p)) settleInto(state, p, base);
  assignStations(state, base);
  recomputeOwnership(state);
  // The groups' claims round it are yours now.
  if (state.claims) for (const id of state.grid.within(tile, CLAIM.BASE_RADIUS)) {
    const c = state.claims[id];
    if (c && typeof c.owner === "number") state.claims[id] = { owner: "player", since: state.hour, ...(c.well ? { well: c.well } : {}) };
  }
  for (const g of griev) changeGoodwill(state, g.f, g.gw, g.why === "it was their base" ? "your expansion near their land: you moved into their old base" : "your expansion near their land: you took their claims");
  state.knowledge[tile] = snapshot(state, tile);
  state.stats.basesOccupied = (state.stats.basesOccupied || 0) + 1;
  const stand = base.buildings.length ? standingText(base.buildings) : "";
  const text = `${people ? `The team moved into ${mine ? `${base.name}, your old outpost` : `the base ${rec.fromName} left at ${tileLabel(state, tile)}`}` : `${base.name} is yours`}: ${base.type === "hub" ? "your new hub" : "a new outpost"}${stand ? ` with ${stand}` : ", bare"}.${rubble.length ? ` ${rubble.length} more ${rubble.length === 1 ? "was" : "were"} beyond saving (no plot or room for ${rubble.length === 1 ? "it" : "them"}).` : ""}${got ? ` Stores left there: ${got}.` : ""}${griev.length ? ` ${griev.map((g) => g.f.known ? g.f.name : "A group").join(" and ")} will not like it.` : ""}`;
  log(state, text, "good");
  return text;
}
