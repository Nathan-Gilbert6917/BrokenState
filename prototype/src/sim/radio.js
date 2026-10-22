// Radio: the network (radio stations and relays), talking to other groups, deals over the radio, and the
// groups' own calls to you.
//
// Network
// - A radio station (buildings.js "radio") reaches RADIO_RANGE (12) tiles around its base. A base holding a Military
//   encrypted radio (data.js milradio, a loot item) in its armory is a station too, reaching MIL_RADIO_RANGE (24).
// - A radio relay (buildings.js "relay": a utility plot at any base, the hub included) reaches RELAY_RANGE (6)
//   tiles. It is an unmanned repeater: it needs no operator but uses 1 part every RELAY_UPKEEP_DAYS (10) days (from
//   its base, else from the hub). With no part it goes offline until one is there (checked each day).
// - A relay only works when it is linked: it stands within range of a station or of another linked relay
//   (a chain back to a station). Coverage is the union of the ranges of every station and linked relay.
// - A base with a station is a station node, whatever else stands there: a relay at the same base adds nothing (its
//   6 tiles sit inside the station's 12), so none can be built where a station stands (buildings.js canBuild), and
//   one already there (a station built after it) stands idle, using no parts, until the station is gone or broken.
//   A relay at a hub without a station is like any other: it works once a station or linked relay reaches it.
// - Your teams in coverage report live (world.js radioBasesInRange); groups whose base is within coverage plus
//   GROUP_REACH (6) tiles (their own sets reach that far) can be called (canRadioGroup) when they have a set of their own
//   (groupHasSet: a station, the military's army sets; envoys.js: otherwise word goes in person), and that is what "in radio
//   reach" means for the coalition too (alliance.js reachVia: a relay that brings a group's base within coverage + 6
//   makes it invitable). A chain runs through your own bases only (every node is one of state.bases); the
//   coalition's other ways in (a team at their gates, a base of yours or a member's next door) are alliance.js's.
// - relayReach / relaySpotFor: the groups a relay at a base would bring into reach, and the base where one would
//   bring a given group in (the invitation's "out of radio reach" line, the radio panel, the autopilot's relay wish).
// - Networks (radioNetworks, networksAt): yours, and one per group around each of its bases (GROUP_NET_RANGE by
//   type). Receivers hear a network only inside its coverage; Listen in tunes one to a channel (radiolisten.js).
//
// Talking to a group (Groups tab → Radio…), each with a cooldown:
// - Greet: +2 goodwill (+1 if hostile), every 3 days. Scan the airwaves: groups in reach you have not met are
//   "heard on the radio" (known, their main base marked), once a day.
// - News (every 5 days, not hostile): a report of every tile within 2 (neutral), 3 (friendly) or 4 (allied) tiles
//   of their bases, and every horde within 10 tiles of them.
// - Request a trade (every 4 days): neutral-or-better groups (aggressive types need goodwill 0+) say yes with a
//   chance of 45% + goodwill% (+25% traders, +15% commune), clamped 10–95%, and send a caravan of what they can
//   spare (caravans.js) if a land route to your base exists.
// - Trade over the radio (radiotrade.js): the full trade window with one of your bases' stores on your side. You
//   fetch the goods with a caravan of yours, or ask them to bring them for a delivery fee (they may say no).
// - A quick deal ("we want 20 meds, paying 60 ammo": the governor's way, dealQuote / radioDeal): accepted when it
//   is fair for them at their prices (trade.js) with the delivery fee on top, they have the goods and they will send
//   a caravan (radiotrade.js deliveryRefusal); their caravan brings the goods and the trade window opens with the deal
//   filled in.
// - Call for help (every 10 days, friendly or a pact): a raid on its way to you is harried (its strength × 0.7);
//   with no raid and less than 3 days of food at the hub they send 20–30 food as aid; costs 4 goodwill either way.
// - Pacts: the same rules as at their gates.
// What the groups overhear of all this, radio discipline (fewer calls from them in scheduled windows), encryption and
// decoys: intel.js.
// Groups also call you: each day a group in reach that is not hostile may radio an offer (their surplus for what
// they need) or a request (they need something, paying with their surplus): 15% a day for traders, 10% for a
// commune, 6% for others, at most one every 6 days per group, never while one of their caravans is out. Mostly they
// bring their side; 30% of the time (always when they cannot send a caravan) they ask you to bring yours to them
// and add the delivery fee to what they pay (radiotrade.js: agreeing books a deal your caravan fetches).
import { FOODS, bestFoodKey, qtyOf, unitsOf, foodIn } from "./foods.js"; // food by type (foods.js)
import { RADIO_RANGE, day, log, hub, baseById, addCard, atBase, skill, snapshot } from "./world.js";
import { SUPPLIES, SUPPLY_KEYS, GEAR, supplyFew, supValue } from "./data.js";
import { count } from "./buildings.js";
import { fieldRelayNodes, groupRelayTiles } from "./fieldworks.js"; // relay masts out on the land
import { radioBoost } from "./power.js";
import { attitude, changeGoodwill, isAggressiveType, strength } from "./factions.js";
import { planPath, spawnAiParty, partyTile, tileLabel } from "./parties.js";
import { packOf } from "./inventory.js";
import { teamKit } from "./fieldheat.js";
import { sellPrice, buyPrice, available, need, maxBuyable, minSellable, proposePact, ensureWares } from "./trade.js";
import { sendCaravan, caravanEnRoute, caravanSurplus } from "./caravans.js";
import { tradeSpeech, gainXp, USE } from "./skills.js";
import { marketOf, dealRoundKey } from "./trade.js"; // a deal's rounds by calibre
import { keyWord } from "./water.js"; // "9mm FMJ", "rounds"
import { diplomacyDaily, knownAs } from "./diplomacy.js";
import { listenDaily } from "./radiolisten.js"; // listening in on a network's traffic (Listen in)
import { intelDaily, discipline, INTEL } from "./intel.js"; // the groups listen in on you: radio discipline, decoys
import { groupHides } from "./hiding.js"; // a group's hidden outposts keep off the air
import { groupsBuild } from "./groupworks.js"; // ai-locks: a group that builds broadcasts from its radio stations
import { thirstFactor } from "./weather.js";
import { rumourFromNews, RUMOUR } from "./survey.js";
import { raidPaceOpen, noteRaid } from "./eras.js";
import { supplyAmt } from "./rounds.js"; // "ammo": every round there, any calibre
import { payoutSpare, payoutBreaks } from "./upkeep.js"; // food and water: never paid out of the base's reserve
import { deliveryFee, deliveryHours, deliveryRefusal, bookDeal, radioDealsDaily, pendingDeal, counterOk } from "./radiotrade.js"; // trades over the radio
import { meetRefusal, halfwayTile, meetHours, MEET } from "./trademeet.js"; // a trade met halfway or at a tile you pick

export const RELAY_RANGE = 6;
export const RELAY_UPKEEP_DAYS = 10;
export const GROUP_REACH = 6;
export const MIL_RADIO_RANGE = 24; // a base with a Military encrypted radio in its armory
export const hasMilRadio = (b) => !!b.armory && b.armory.some((it) => it && it.key === "milradio");
export const COOLDOWN = { greet: 3, news: 5, caravan: 4, help: 10, scan: 1, offer: 6 };

// ---------- radio networks (who broadcasts where; listening: radiolisten.js) ----------
// Yours (every linked station and relay: radioNodes) and one per AI group with a radio station: since ai-locks
// (2026-10-11, the user's rule "AI groups need to have the same restrictions and gameplay features") a group broadcasts
// only as you do: from its radio stations (groupworks.js "radio" work: your Mechanics 4) at your RADIO_RANGE, the
// military from every base at MIL_RADIO_RANGE (their army sets: as a Military encrypted radio in your armory makes a
// base a station), and its relay masts (fieldworks.js) while linked to one of those (your relays' rule). A group with
// no station has no network (nothing to listen in on, nothing heard of it). Old saves' groups and the hardcore military
// (they do not build: groupworks.js groupsBuild) keep the old ranges by type, GROUP_NET_RANGE (military 24, traders and
// fortresses 12, communes, zealots and expansionists 8, raiders 6) around each base. So a base taken or lost changes
// the group's coverage. A receiver hears a network only while it stands inside that network's coverage: nothing beyond
// it (the old "+6 tiles past coverage" band is gone, HEAR_EXTRA 0). Transmitting is unchanged: canRadioGroup (your
// coverage + GROUP_REACH) decides who can be called.
export const GROUP_NET_RANGE = { military: 24, traders: 12, fortress: 12, commune: 8, zealot: 8, expansionist: 8, raider: 6 };
export const PLAYER_NET = "player";
export const PLAYER_NET_COLOR = "#4f8fd6"; // render.js PLAYER_COLOR
// { id, name, color, kind: "player" | "group", faction?, nodes: [{ tile, range }] }; null: no network.
export function playerNetwork(state) {
  const nodes = radioNodes(state).filter((n) => n.linked && !n.offline).map((n) => ({ tile: n.tile, range: n.range }));
  return nodes.length ? { id: PLAYER_NET, name: "Your network", color: PLAYER_NET_COLOR, kind: "player", nodes } : null;
}
export function groupNetwork(state, f) {
  if (!f || !f.alive || !f.bases || !f.bases.length) return null;
  const net = (nodes) => (nodes.length ? { id: f.id, name: f.known ? f.name : knownAs(state, f), color: f.color, kind: "group", faction: f, nodes } : null);
  if (!groupsBuild(state, f)) { // old saves, the hardcore military: every base by type, as before
    const range = GROUP_NET_RANGE[f.type] ?? 8;
    const on = f.bases.filter((tile) => !groupHides(state, f, tile)); // hiding.js: a hidden outpost keeps off the air
    return net([...(on.length ? on : f.bases), ...groupRelayTiles(state, f)].map((tile) => ({ tile, range }))); // fieldworks.js: their relay masts
  }
  // ai-locks: their stations (the military and the Guard's splinters: every base), the hidden ones kept off the air
  // unless all are hidden.
  const mil = f.type === "military" || !!f.hcSplinter; // hardcore-groups.js: what was left of the Guard carries its sets
  const st = f.bases.filter((tile) => mil || (f.works && f.works[tile] && f.works[tile].radio > 0));
  const on = st.filter((tile) => !groupHides(state, f, tile));
  const nodes = (on.length ? on : st).map((tile) => ({ tile, range: mil ? MIL_RADIO_RANGE : RADIO_RANGE }));
  // Their relay masts, linked as yours are: within reach of a station or of a linked relay.
  const g = state.grid;
  let relays = groupRelayTiles(state, f);
  for (let grew = true; grew && relays.length;) {
    grew = false;
    const linked = relays.filter((t) => nodes.some((n) => g.distance(n.tile, t) <= n.range));
    if (linked.length) { nodes.push(...linked.map((tile) => ({ tile, range: RELAY_RANGE }))); relays = relays.filter((t) => !linked.includes(t)); grew = true; }
  }
  return net(nodes);
}
export function radioNetworks(state) {
  const out = [];
  const mine = playerNetwork(state);
  if (mine) out.push(mine);
  for (const f of state.factions) { const n = groupNetwork(state, f); if (n) out.push(n); }
  return out;
}
export const netCovers = (state, net, tile) => !!net && net.nodes.some((n) => state.grid.distance(n.tile, tile) <= n.range);
// The networks whose coverage contains a tile (yours first).
export const networksAt = (state, tile) => radioNetworks(state).filter((n) => netCovers(state, n, tile));
// A network by its id ("player" or a group's id), as it is now (null: gone or off the air).
export const networkById = (state, id) => (id === PLAYER_NET ? playerNetwork(state) : groupNetwork(state, state.factions.find((f) => f.id === Number(id))));

// ---------- receivers: hand-crank radios (data.js handradio: never a transmitter), stations, military radios ----------
// A base with a hand-crank radio in its armory (or on someone there) and a player team carrying one are listeners;
// a base with a station or a Military encrypted radio, and a team carrying a military radio, receive too. Inside a
// network's coverage they hear it (scan, news, callers, rumours, and with Listen in its traffic: radiolisten.js);
// outside every network they hear nothing. A team's handheld cannot answer: parties.js updateRadio sets
// p.radioHear, never p.radioLive. Hearing calls nobody: canRadioGroup, commandable (plans.js) and the coverage
// (radioNodes) ignore listeners.
export const HEAR_EXTRA = 0; // no listening band beyond a network's coverage any more
const isHandRadio = (it) => !!(it && GEAR[it.key] && GEAR[it.key].listen);
export const hasHandRadioIn = (list) => Array.isArray(list) && list.some(isHandRadio);
export const baseListens = (state, b) => hasHandRadioIn(b.armory) || atBase(state, b.id).some((s) => isHandRadio(s.gear && s.gear.tool) || hasHandRadioIn(s.pockets) || hasHandRadioIn(packOf(s))); // packOf: the pack's slots
export const teamListens = (state, p) => !!p && p.owner === "player" && p.kind !== "convoy" && teamKit(state, p).some(isHandRadio);
// Any receiver: a base's station or military radio, or a hand-crank radio; a team's hand-crank or military radio.
export const baseReceives = (state, b) => !!b && (!!b.radio || hasMilRadio(b) || baseListens(state, b));
export const teamMilRadio = (state, p) => teamKit(state, p).some((it) => it && it.key === "milradio");
export const teamReceives = (state, p) => !!p && p.owner === "player" && p.kind !== "convoy" && teamKit(state, p).some((it) => isHandRadio(it) || (it && it.key === "milradio"));
// Every receiver switched on: { tile, base } or { tile, party }.
export function receivers(state) {
  const out = [];
  for (const b of state.bases) if (baseReceives(state, b)) out.push({ tile: b.tile, base: b });
  for (const p of state.parties) if (teamReceives(state, p)) out.push({ tile: partyTile(p), party: p });
  return out;
}
// Every hand-crank radio that hears something: inside some network's coverage ({ tile, base } or { tile, party }).
export function listeners(state) {
  const out = [];
  let nets = null;
  const onAir = (tile) => (nets = nets || radioNetworks(state)).some((n) => netCovers(state, n, tile));
  for (const b of state.bases) if (baseListens(state, b) && onAir(b.tile)) out.push({ tile: b.tile, base: b });
  for (const p of state.parties) if (teamListens(state, p) && onAir(partyTile(p))) out.push({ tile: partyTile(p), party: p });
  return out;
}
// Something to hear with: a station or linked relay on the air, or a hand-crank radio inside some network.
export const canListen = (state) => hasNetwork(state) || listeners(state).length > 0;
// A tile within earshot of a hand-crank radio that is on the air: RADIO_RANGE (+ extra) around it (outsiders' own
// sets: visitors.js sight).
export const heardBy = (state, tile, extra = 0) => listeners(state).some((l) => state.grid.distance(l.tile, tile) <= RADIO_RANGE + extra);
// A group whose set is heard: callable (canRadioGroup, two-way) or a receiver of yours inside its network (one-way).
export function canHearGroup(state, f) {
  if (!f || !f.alive) return false;
  if (canRadioGroup(state, f)) return true;
  const net = groupNetwork(state, f);
  return !!net && receivers(state).some((r) => netCovers(state, net, r.tile));
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- network ----------
// Every transmitter: { base, tile, range, kind: "station" | "relay", linked, offline }. A base with a station is a
// station node and nothing else (a relay there stands idle). plus: a base counted as if a working relay stood there
// (relayReach: what one would add).
export const hasStation = (b) => !!b.radio || hasMilRadio(b);
export function radioNodes(state, plus = null) {
  const nodes = [];
  for (const b of state.bases) {
    if (hasStation(b)) nodes.push({ base: b, tile: b.tile, range: (hasMilRadio(b) ? MIL_RADIO_RANGE : RADIO_RANGE) + radioBoost(b), kind: "station", linked: true, offline: false, military: hasMilRadio(b) }); // +2 on generator power (power.js)
    else if (count(b, "relay") || b === plus) nodes.push({ base: b, tile: b.tile, range: RELAY_RANGE, kind: "relay", linked: false, offline: b === plus ? false : !!b.relayOffline });
  }
  nodes.push(...fieldRelayNodes(state)); // fieldworks.js: relay masts on the land outside the bases (node.field: the mast's id)
  const g = state.grid;
  for (let grew = true; grew;) {
    grew = false;
    for (const n of nodes) {
      if (n.linked || n.offline) continue;
      if (nodes.some((m) => m.linked && g.distance(m.tile, n.tile) <= m.range)) { n.linked = true; grew = true; }
    }
  }
  return nodes;
}
// Linked transmitters whose range (plus extra) covers a tile.
export function coverNodes(state, tile, extra = 0) {
  return radioNodes(state).filter((n) => n.linked && state.grid.distance(n.tile, tile) <= n.range + extra);
}
export const inCoverage = (state, tile, extra = 0) => coverNodes(state, tile, extra).length > 0;
export const hasNetwork = (state) => radioNodes(state).some((n) => n.linked);
// The groups a relay at this base would bring into call reach (canRadioGroup) that are out of it now: none where a
// station or a relay already stands, or where the new relay would not link (no station or linked relay reaches the
// base: a relay links within the other node's range, so coverage + 6 is not enough). It counts a chain it completes
// (a relay standing unlinked further out that this one links). groups: the ones to look at (default every group).
// outOfReach: the caller knows every group in `groups` is out of call reach now (spares canRadioGroup).
export function relayReach(state, base, groups = null, outOfReach = false) {
  if (!base || hasStation(base) || count(base, "relay")) return [];
  const nodes = radioNodes(state, base).filter((n) => n.linked); // the cheap test first: would it link at all?
  if (!nodes.some((n) => n.base === base && !n.field)) return [];
  const list = (groups || state.factions).filter((f) => f && f.alive && f.bases.length && groupHasSet(state, f) && (outOfReach || !canRadioGroup(state, f))); // a group with no set of its own is never brought in
  if (!list.length) return [];
  const g = state.grid;
  return list.filter((f) => f.bases.some((t) => nodes.some((n) => g.distance(n.tile, t) <= n.range + GROUP_REACH)));
}
// The base of yours (nearest to them first) where a relay would bring this group into call reach, or null. Asked
// for every group outside the coalition many times a day (alliance.js inviteProblem: the daily ask, goalsProgress,
// the Groups tab), so it is kept for the hour and the network as it stands (state.relaySpots, not saved).
export function relaySpotFor(state, f) {
  if (!f || !f.alive || !f.bases.length) return null;
  const key = `${state.hour}|${state.bases.map((b) => `${b.id}:${b.tile}${hasStation(b) ? "s" : ""}${count(b, "relay") ? (b.relayOffline ? "o" : "r") : ""}`).join(",")}`;
  let c = state.relaySpots;
  if (!c || c.key !== key) {
    c = { key, by: new Map() };
    Object.defineProperty(state, "relaySpots", { value: c, writable: true, configurable: true, enumerable: false });
  }
  const fk = `${f.id}|${f.bases.join(",")}`;
  if (!c.by.has(fk)) c.by.set(fk, relaySpotNow(state, f));
  return c.by.get(fk);
}
function relaySpotNow(state, f) {
  const cur = radioNodes(state).filter((n) => n.linked);
  if (!cur.length || !groupHasSet(state, f) || canRadioGroup(state, f)) return null;
  const g = state.grid;
  const near = (b) => Math.min(...f.bases.map((t) => g.distance(t, b.tile)));
  // Only a base a linked node reaches can link a new relay (radioNodes): the rest are never worth the full test.
  const cands = state.bases.filter((b) => !hasStation(b) && !count(b, "relay") && cur.some((n) => g.distance(n.tile, b.tile) <= n.range));
  return cands.sort((a, b) => near(a) - near(b) || a.id - b.id).find((b) => relayReach(state, b, [f], true).length > 0) || null;
}

// One line for the base screen.
export function radioSummary(state, base) {
  const n = radioNodes(state).find((x) => x.base === base && !x.field);
  const tuned = base.tuned != null ? networkById(state, base.tuned) : null; // radiolisten.js Listen in
  const ear = tuned ? `. Tuned to ${tuned.name}${netCovers(state, tuned, base.tile) ? "" : " (out of range)"}` : "";
  if (n && n.kind === "station") return `Radio station: ${n.range} tiles of coverage${n.military ? " (a Military encrypted radio in the armory)" : ""}${count(base, "relay") ? ". The relay here stands idle (the station covers more)" : ""}${ear}`;
  if (n) {
    if (n.offline) return `Relay offline: it needs 1 part (from ${base.type === "hub" ? "this base" : "this base or the hub"})`;
    if (!n.linked) return `Relay not linked: no station or linked relay within range (it reaches ${n.range} tiles)`;
    return `Relay linked: ${n.range} tiles of coverage. Upkeep 1 part every ${RELAY_UPKEEP_DAYS} days, next on day ${base.relayDue ?? day(state) + RELAY_UPKEEP_DAYS}`;
  }
  const by = coverNodes(state, base.tile)[0];
  return (by ? `In coverage (from ${by.base.name})` : baseListens(state, base) ? "A hand-crank radio: it listens, calls nobody" : "No radio here, and out of coverage") + ear;
}

// Relays use a part every few days; without one they go offline until one turns up. A relay idle beside a station
// (radioNodes) uses nothing; its clock starts again when it is back on the air.
function relayUpkeep(state) {
  const today = day(state);
  const h = hub(state);
  for (const b of state.bases) {
    if (!count(b, "relay")) continue;
    if (hasStation(b)) { b.relayDue = null; b.relayOffline = false; continue; }
    if (b.relayDue == null) b.relayDue = today + RELAY_UPKEEP_DAYS;
    if (today < b.relayDue && !b.relayOffline) continue;
    const from = (b.stock.parts || 0) >= 1 ? b : h && (h.stock.parts || 0) >= 1 ? h : null;
    if (from) {
      from.stock.parts -= 1;
      b.relayDue = today + RELAY_UPKEEP_DAYS;
      if (b.relayOffline) log(state, `The radio relay at ${b.name} is back on the air.`, "good");
      b.relayOffline = false;
    } else if (!b.relayOffline) {
      b.relayOffline = true;
      log(state, `The radio relay at ${b.name} went off the air: it needs 1 part (at ${b.type === "hub" ? "the hub" : "that base or the hub"}).`, "danger");
    }
  }
}

// ---------- who can be called ----------
// A two-way link (envoys.js, 2026-10-21: "Radios should be a mid to late game communication"): their base within your
// coverage + GROUP_REACH and a set of their own to answer on (groupHasSet). Without one, word goes by envoy (envoys.js).
export const canRadioGroup = (state, f) => !!f && f.alive && groupHasSet(state, f) && f.bases.some((b) => inCoverage(state, b, GROUP_REACH));
// In your coverage + GROUP_REACH, set or no set (the "build a relay" hints).
export const inRadioReach = (state, f) => !!f && f.alive && f.bases.some((b) => inCoverage(state, b, GROUP_REACH));
// A set of their own: a radio station at a base (groupworks.js "radio" work), the military's and the Guard's splinters'
// army sets at every base, an old save's or the hardcore Guard's network by type (groupNetwork's rule, cheaply).
export function groupHasSet(state, f) {
  if (!f || !f.alive || !f.bases || !f.bases.length) return false;
  if (!groupsBuild(state, f) || f.type === "military" || f.hcSplinter) return true;
  return f.bases.some((t) => !!(f.works && f.works[t] && f.works[t].radio > 0));
}
// Speech on the radio: the best talker at a base with a transmitter that reaches them (else at the hub).
export function radioSpeech(state) {
  const h = hub(state);
  return tradeSpeech(h ? atBase(state, h.id) : []); // Haggler +5 (skills.js)
}
const since = (state, f, key) => day(state) - (f.radio?.[key] ?? -999);
const mark = (state, f, key) => { (f.radio = f.radio || {})[key] = day(state); };
// Days until a call of this kind can be made again (0 = now).
export const radioCooldown = (state, f, key) => Math.max(0, (COOLDOWN[key] || 0) - since(state, f, key));
function note(state, f, text) {
  const r = (f.radioLog = f.radioLog || []);
  r.unshift({ day: day(state), text });
  if (r.length > 6) r.pop();
  return text;
}
// Why a group will not take your call or your business (null = they will).
export function refusal(state, f, forTrade = false) {
  if (!f || !f.alive) return "Nobody answers on that channel any more.";
  if (!canRadioGroup(state, f)) return inRadioReach(state, f) && !groupHasSet(state, f) ? `${f.name} have no radio of their own: send them an envoy (Diplomacy → Envoys).` : `${f.name} is out of radio reach.`;
  if (attitude(f) === "Hostile") return `${f.name} curse at you and go silent.`;
  if (forTrade && f.goodwill < (isAggressiveType(f) ? 0 : -15)) return `${f.name} do not trust you enough to deal. (Goodwill ${isAggressiveType(f) ? 0 : -15} needed.)`;
  return null;
}
// The base their caravans come to: the hub if they can reach it over land, else your nearest reachable base.
export function tradeBase(state, f) {
  const from = f.bases[0];
  if (from == null) return null;
  const list = [...state.bases].sort((a, b) => (a.type === "hub" ? -1 : 0) - (b.type === "hub" ? -1 : 0) || state.grid.distance(from, a.tile) - state.grid.distance(from, b.tile));
  return list.find((b) => planPath(state, from, b.tile, false)) || null;
}

// ---------- your calls ----------
export function radioScan(state) {
  if (!canListen(state)) return "You need a radio station (or a hand-crank radio) first.";
  if (state.radioScanDay === day(state)) return "You already scanned the airwaves today.";
  state.radioScanDay = day(state);
  const heard = [], onHand = [];
  for (const f of state.factions) {
    if (!f.alive || f.known) continue;
    const call = canRadioGroup(state, f);
    if (!call && !canHearGroup(state, f)) continue; // a receiver of yours inside their network hears them (one way)
    f.known = true;
    f.heard = true;
    const b = f.bases[0];
    if (b != null) state.knowledge[b] = snapshot(state, b);
    heard.push(f.name);
    if (!call) onHand.push(f.name);
  }
  const hand = onHand.length ? ` ${onHand.length === heard.length ? "Heard" : `${onHand.join(", ")} heard`} on their own channel: within earshot, not within call.` : "";
  const text = heard.length ? `New voices on the radio: ${heard.join(", ")}. Their base is marked on the map.${hand}` : "Static. No new voices within reach.";
  log(state, text, heard.length ? "good" : "info");
  return text;
}

export function radioGreet(state, f) {
  if (!f || !f.alive || !canRadioGroup(state, f)) return refusal(state, f);
  if (since(state, f, "greet") < COOLDOWN.greet) return "You talked recently. Give it a few days.";
  mark(state, f, "greet");
  f.lastRadio = day(state);
  f.lastDiplomacy = day(state);
  f.known = true;
  changeGoodwill(state, f, attitude(f) === "Hostile" ? 1 : 2, "regular contact");
  return note(state, f, attitude(f) === "Hostile" ? `${f.name} listen, then cut you off. A little less hostile, maybe.` : `You keep in touch with ${f.name} over the radio.`);
}

export function radioNews(state, f) {
  const why = refusal(state, f);
  if (why) return note(state, f, why);
  if (since(state, f, "news") < COOLDOWN.news) return "They told you what they know a few days ago.";
  mark(state, f, "news");
  const a = attitude(f);
  const r = a === "Allied" ? 4 : a === "Friendly" ? 3 : 2;
  const g = state.grid;
  const tiles = new Set();
  for (const b of f.bases) for (const id of g.within(b, r)) tiles.add(id);
  let hordes = 0;
  for (const h of state.hordes) if (f.bases.some((b) => g.distance(b, h.tile) <= 10)) { tiles.add(h.tile); hordes++; }
  for (const id of tiles) {
    const cur = state.knowledge[id];
    if (!cur || cur.hour <= state.hour) state.knowledge[id] = snapshot(state, id);
  }
  f.lastDiplomacy = day(state);
  const rumour = rumourFromNews(state, f.name, "radio", RUMOUR.groupNews); // survey.js: now and then word of a hidden place
  return note(state, f, `${f.name} pass on what they see: ${tiles.size} tiles around their land${hordes ? `, ${hordes} horde${hordes === 1 ? "" : "s"} on the move near them` : ", no hordes near them"}. It is on your map.${rumour}`);
}

// Ask them to send a caravan of their goods. Rolls once (uses the world's random numbers). where: { baseId } one of
// your bases (default: tradeBase), or { meetTile } a tile to meet at (trademeet.js: halfway, or one you picked).
export function radioRequestCaravan(state, f, where = {}) {
  const why = refusal(state, f, true);
  if (why) return note(state, f, why);
  if (caravanEnRoute(state, f)) return "Their caravan is already on its way or at your gates.";
  if (since(state, f, "caravan") < COOLDOWN.caravan) return `You asked ${f.name} for a caravan recently.`;
  const meetTile = where && Number.isInteger(where.meetTile) ? where.meetTile : null;
  if (meetTile != null) {
    const no = meetRefusal(state, f, meetTile);
    if (no) return note(state, f, `${f.name} will not meet you there: ${no}`);
  }
  const picked = where && where.baseId != null ? baseById(state, where.baseId) : null;
  const base = meetTile != null ? null : picked && planPath(state, f.bases[0], picked.tile, false) ? picked : tradeBase(state, f);
  if (meetTile == null && !base) return note(state, f, `${f.name} have no way to reach any of your bases over land.`);
  mark(state, f, "caravan");
  const bonus = f.type === "traders" ? 0.25 : f.type === "commune" ? 0.15 : 0;
  const chance = clamp(0.45 + f.goodwill / 100 + bonus, 0.1, 0.95);
  if (!state.rng.chance(chance)) return note(state, f, `${f.name} have nothing to spare for a trip right now. (${Math.round(chance * 100)}% chance with them.)`);
  ensureWares(state, f);
  const c = sendCaravan(state, f, base, { goods: caravanSurplus(state, f), meetTile });
  const place = meetTile != null ? tileLabel(state, meetTile) : base.name;
  if (!c) return note(state, f, `${f.name} cannot get a caravan to ${place}.`);
  return note(state, f, meetTile != null ? `${f.name} agree: a caravan sets out to meet you at ${place} (about ${c.eta}h) and waits there two days. Send a team to that tile.` : `${f.name} agree: a caravan sets out for ${place} (about ${c.eta}h).`);
}

// What a deal { wantKey, wantQty, payKey, payQty } looks like to them (no random numbers; the UI shows it).
// A deal's generic "ammo" made one round key (trade.js dealRoundKey): what you want, the round your guns want most of
// what they can spare; what you pay, the round your hub's guns need least (2026-10-09, user request: rounds by calibre).
function calQuote(state, f, d) {
  if (!d || (d.wantKey !== "ammo" && d.payKey !== "ammo")) return d;
  const h = hub(state), at = tradeBase(state, f) || h;
  return { ...d, wantKey: d.wantKey === "ammo" ? dealRoundKey(state, f, at, Math.floor(Number(d.wantQty)) || 1, true) : d.wantKey, payKey: d.payKey === "ammo" ? dealRoundKey(state, f, h, Math.floor(Number(d.payQty)) || 1, false) : d.payKey };
}
export function dealQuote(state, f, d) {
  d = calQuote(state, f, d);
  const out = { ok: false, reason: "", minPay: null, maxWant: null };
  const wantQty = Math.floor(Number(d.wantQty)), payQty = Math.floor(Number(d.payQty));
  if (!SUPPLIES[d.wantKey] || !SUPPLIES[d.payKey]) return { ...out, reason: "Pick what you want and what you pay with." };
  if (d.wantKey === d.payKey) return { ...out, reason: "Ask for one good and pay with another." };
  if (!(wantQty >= 1) || !(payQty >= 1)) return { ...out, reason: "Both amounts must be at least 1." };
  const speech = radioSpeech(state);
  const have = available(f, d.wantKey);
  const pay = payQty * sellPrice(state, f, d.payKey, speech, payQty);
  const fee = deliveryFee(state, f, tradeBase(state, f)); // they bring it (radiotrade.js)
  const cost = wantQty * buyPrice(state, f, d.wantKey, speech, wantQty) + fee;
  out.maxWant = maxBuyable(state, f, d.wantKey, speech, Math.max(0, pay - fee));
  const min = minSellable(state, f, d.payKey, speech, cost);
  out.minPay = Number.isFinite(min) ? min : null;
  if (have < wantQty) return { ...out, reason: `They can spare only ${have} ${keyWord(d.wantKey)}.` };
  if (pay + 1e-9 < cost) return { ...out, reason: `Not enough for them: they would want at least ${out.minPay ?? "more"} ${keyWord(d.payKey)}, or give at most ${out.maxWant} ${keyWord(d.wantKey)}.` };
  const h = hub(state);
  const short = supplyAmt(h.stock, d.payKey) < payQty ? ` The hub has only ${Math.floor(supplyAmt(h.stock, d.payKey))} ${keyWord(d.payKey)} right now: have it ready when they arrive.` : "";
  return { ...out, ok: true, reason: `Fair for them.${short}` };
}

export function radioDeal(state, f, d) {
  const why = refusal(state, f, true);
  if (why) return { ok: false, text: note(state, f, why) };
  if (caravanEnRoute(state, f)) return { ok: false, text: "Their caravan is already on its way or at your gates." };
  d = calQuote(state, f, d);
  const q = dealQuote(state, f, d);
  if (!q.ok) return { ok: false, text: note(state, f, `${f.name}: no deal. ${q.reason}`) };
  const base = tradeBase(state, f);
  if (!base) return { ok: false, text: note(state, f, `${f.name} have no way to reach any of your bases over land.`) };
  const no = deliveryRefusal(state, f, base);
  if (no) return { ok: false, text: note(state, f, `${f.name} will not send a caravan: ${no}`) };
  const wantQty = Math.floor(Number(d.wantQty)), payQty = Math.floor(Number(d.payQty));
  const c = sendCaravan(state, f, base, { goods: { supplies: { [d.wantKey]: wantQty }, gear: [] }, deal: { offer: { [d.payKey]: payQty }, ask: { [d.wantKey]: wantQty } } });
  if (!c) return { ok: false, text: note(state, f, `${f.name} cannot get a caravan to ${base.name}.`) };
  mark(state, f, "caravan");
  const h = hub(state);
  if (h) gainXp(state, atBase(state, h.id).sort((a, b) => skill(b, "speech") - skill(a, "speech") || a.id - b.id)[0], "speech", USE.radio); // skills.js
  return { ok: true, caravan: c, text: note(state, f, `Deal: ${wantQty} ${keyWord(d.wantKey)} for ${payQty} ${keyWord(d.payKey)}. Their caravan sets out for ${base.name} (about ${c.eta}h).`) };
}

export function radioHelp(state, f) {
  const why = refusal(state, f);
  if (why) return note(state, f, why);
  if (!(attitude(f) === "Friendly" || attitude(f) === "Allied" || f.pact)) return note(state, f, `${f.name} do not owe you that kind of favour. (Friendly or a pact needed.)`);
  if (since(state, f, "help") < COOLDOWN.help) return `${f.name} helped you not long ago.`;
  const raid = state.parties.find((q) => q.kind === "raid" && !q.returning && q.target && q.target.kind === "player" && q.owner !== f.id);
  const h = hub(state);
  const mouths = Math.max(1, atBase(state, h.id).length);
  if (raid) {
    mark(state, f, "help");
    raid.strength *= 0.7;
    changeGoodwill(state, f, -4, "a favour");
    return note(state, f, `${f.name} send fighters to harry the raiders heading for ${baseById(state, raid.target.baseId)?.name || "your base"}. The raid is weaker (strength about ${Math.round(raid.strength)}).`);
  }
  if (foodIn(h.stock) < mouths * 3) {
    const base = tradeBase(state, f);
    const food = Math.min(available(f, "food"), state.rng.int(20, 30));
    if (!base || food < 5) return note(state, f, `${f.name} have no food to spare.`);
    mark(state, f, "help");
    const c = sendCaravan(state, f, base, { goods: { supplies: { food }, gear: [] }, gift: true });
    if (!c) return note(state, f, `${f.name} cannot reach ${base.name}.`);
    changeGoodwill(state, f, -4, "a favour");
    return note(state, f, `${f.name} send ${food} days of food as aid (about ${c.eta}h).`);
  }
  return note(state, f, `${f.name}: "You look fine from here. Call us when you are in real trouble."`);
}

export function radioPact(state, f, kind) {
  const why = refusal(state, f);
  if (why) return note(state, f, why);
  return note(state, f, proposePact(state, f, kind));
}

// ---------- daily: relays, groups' water and wares, grudges, and the groups' own calls ----------
export function radioDaily(state) {
  relayUpkeep(state);
  const today = day(state);
  const rng = state.rng;
  for (const f of state.factions) {
    if (!f.alive) continue;
    // Groups have wells: water refills toward 6 a head (what you sell them stays), slower when they drink more (summer,
    // a heat wave: weather.js), so their water runs lower and dearer then.
    const cap = f.pop * 6;
    if (f.stock.water == null) f.stock.water = cap;
    else if (f.stock.water < cap) f.stock.water = Math.min(cap, f.stock.water + (f.pop * 0.5) / thirstFactor(state));
    if (f.wares && today - (f.waresDay || 0) >= 7) ensureWares(state, f, true);
    grudgeRaid(state, f);
  }
  radioDealsDaily(state); // radiotrade.js: deals your caravan never came for lapse
  diplomacyDaily(state); // diplomacy.js: relations, pacts and wars between groups, market lists, jobs, the coalition
  listenDaily(state); // radiolisten.js: the groups' channel traffic, and what your tuned receivers pick up of it
  intelDaily(state); // intel.js: what the groups overhear of yours and of each other's (hiding.js: hidden bases)
  if (!hasNetwork(state)) return;
  for (const f of state.factions) {
    if (!f.alive || !f.known || refusal(state, f, true) || caravanEnRoute(state, f)) continue;
    if (since(state, f, "offer") < COOLDOWN.offer || state.cards.some((c) => c.radioFrom === f.id) || pendingDeal(state, f)) continue;
    const chance = (f.type === "traders" ? 0.15 : f.type === "commune" ? 0.1 : 0.06) * (discipline(state) === "windows" ? INTEL.OFFERS : 1); // intel.js: radio discipline, fewer windows to call in
    if (!rng.chance(chance)) continue;
    const card = offerCard(state, f);
    if (card) { addCard(state, card); mark(state, f, "offer"); }
  }
}

// A group you crossed (you attacked their caravan) sends raids for a while, whatever its type.
function grudgeRaid(state, f) {
  if (!f.grudgeUntil || day(state) > f.grudgeUntil || attitude(f) !== "Hostile" || f.pop < 6) return;
  if (state.parties.some((q) => q.owner === f.id && q.kind === "raid")) return;
  if (!raidPaceOpen(state)) return; // eras.js: the pace of raids on you
  if (!state.rng.chance(0.12)) return;
  const g = state.grid;
  const targets = state.bases.filter((b) => f.bases.some((fb) => g.distance(fb, b.tile) <= 24));
  if (!targets.length) return;
  const b = state.rng.pick(targets);
  const p = spawnAiParty(state, f, "raid", f.bases[0], b.tile, { strength: Math.max(4, strength(f) * state.rng.range(0.25, 0.4)), target: { kind: "player", baseId: b.id, tile: b.tile } });
  if (p) { p.grudge = true; noteRaid(state); }
}

// What the hub can spare of a good (keeps a few days of food and water, some meds and ammo).
export function hubSpare(state, key, h = hub(state)) {
  const n = Math.max(1, atBase(state, h.id).length);
  const keep = { food: n * 6, water: n * 5, meds: 3, ammo: n * 10, fuel: 8, parts: 2, scrap: 20 }[key] || 0;
  return Math.min(payoutSpare(state, h, key), Math.max(0, Math.floor(supplyAmt(h.stock, key) - keep))); // upkeep.js PAYOUT: everyone fed there
}

// An offer or a request from a group, as a card. null when they have nothing sensible to say.
export function offerCard(state, f) {
  const base = tradeBase(state, f);
  if (!base) return null;
  const speech = radioSpeech(state);
  const keys = SUPPLY_KEYS.filter((k) => !SUPPLIES[k].round); // rounds: as "ammo" (sorted by calibre at the gates, ammo.js)
  // What they are short of and you can spare; what they have plenty of: this week's wants and surplus lists
  // (trade.js marketOf), most wanted / most plentiful first.
  const m = marketOf(state, f);
  const wants = m.wants.map((x) => x.key).filter((k) => hubSpare(state, k) >= supplyFew(k, 3));
  const spare = m.surplus.map((x) => x.key).filter((k) => available(f, k) >= supplyFew(k, 5));
  if (!spare.length) return null;
  const rng = state.rng;
  const payKey = spare[0] === "ammo" ? dealRoundKey(state, f, base, REF_QTY.ammo, true) : spare[0]; // rounds by calibre: the ones your guns want of what they can spare
  let deal, text;
  if (wants.length && rng.chance(0.5)) {
    // A request: they need something, paying with their surplus.
    const k = wants[0] === "ammo" ? dealRoundKey(state, f, base, REF_QTY.ammo, false) : wants[0]; // rounds by calibre: the ones your guns need least
    const qty = Math.max(3, Math.min(hubSpare(state, k), Math.ceil((refQty(k) || 10) * rng.range(0.6, 1.2))));
    const value = qty * sellPrice(state, f, k, speech, qty);
    let pay = maxBuyable(state, f, payKey, speech, value);
    // A cheap, bulky surplus (wood, scrap) pays for little: the caravan brings at most two lots of it and asks for
    // what that is worth, not hundreds of units for a few jars.
    const cap = (refQty(payKey) || 10) * 2;
    let want = qty;
    if (pay > cap) { pay = cap; want = Math.min(qty, Math.floor((pay * buyPrice(state, f, payKey, speech, pay)) / sellPrice(state, f, k, speech, qty))); }
    if (pay < 1 || want < 1) return null;
    deal = { offer: { [k]: want }, ask: { [payKey]: pay } };
    text = `"We need ${want} ${keyWord(k)}. We can pay ${pay} ${keyWord(payKey)}, delivered to ${base.name}."`;
  } else {
    // An offer: their surplus for something you have.
    const qty = Math.max(5, Math.min(available(f, payKey), Math.ceil((refQty(payKey) || 10) * rng.range(0.8, 1.5))));
    const cost = qty * buyPrice(state, f, payKey, speech, qty);
    const k0 = keys.filter((x) => x !== payKey && !(x === "ammo" && SUPPLIES[payKey] && SUPPLIES[payKey].round) && hubSpare(state, x) > 0).sort((a, b) => need(f, b) - need(f, a))[0];
    if (!k0) return null;
    const k = k0 === "ammo" ? dealRoundKey(state, f, base, REF_QTY.ammo, false) : k0; // rounds by calibre
    const want = minSellable(state, f, k, speech, cost);
    if (!Number.isFinite(want) || want < 1) return null;
    deal = { offer: { [k]: want }, ask: { [payKey]: qty } };
    text = `"We have ${qty} ${keyWord(payKey)} to spare. We would take ${want} ${keyWord(k)} for it, delivered to ${base.name}."`;
  }
  const [giveKey, giveQty] = Object.entries(deal.offer)[0];
  const [getKey, getQty] = Object.entries(deal.ask)[0];
  // They may ask you to bring your side to them instead (always when they will not send a caravan), adding the
  // delivery fee to what they pay (radiotrade.js).
  const cannot = deliveryRefusal(state, f, base);
  // Your base is far from them (or too far to deliver to): they may ask to meet halfway instead (trademeet.js).
  const hrs = deliveryHours(state, f, base);
  if (hrs != null && (hrs > MEET.OFFER_HOURS || /too far/.test(cannot || "")) && rng.chance(MEET.OFFER_CHANCE)) {
    const mid = halfwayTile(state, f.bases[0], base.tile, f.id);
    if (mid != null && !meetRefusal(state, f, mid, caravanEnRoute(state, f))) return meetOfferCard(state, f, base, mid, deal, text);
  }
  if (cannot || rng.chance(0.3)) {
    const fee = deliveryFee(state, f, base);
    const extra = Math.min(available(f, getKey) - getQty, Math.max(1, Math.round(fee / buyPrice(state, f, getKey, speech, getQty))));
    if (extra >= 1) return bringCard(state, f, base, { giveKey, giveQty, getKey, getQty: getQty + extra, extra, more: Math.min(available(f, getKey) - getQty - extra, Math.max(1, Math.ceil(extra / 2))) }, text);
    if (cannot) return null;
  }
  return {
    title: `On the radio: ${f.name}`,
    radioFrom: f.id,
    text: `${f.name} (${attitude(f).toLowerCase()}) call you. ${text} If you agree, their caravan brings the ${keyWord(getKey)} and the trade window opens when it arrives; it waits a day.`,
    choices: [
      {
        label: `Agree: ${giveQty} ${keyWord(giveKey)} for ${getQty} ${keyWord(getKey)}`,
        affordable: (st) => (hub(st).stock[giveKey] || 0) >= giveQty && !payoutBreaks(st, hub(st), { [giveKey]: giveQty }), // the autopilot agrees only then (and never out of the food and water reserve)
        hint: `Have ${giveQty} ${keyWord(giveKey)} ready at ${base.name} when they arrive (the hub has ${Math.floor(hub(state).stock[giveKey] || 0)} now)`,
        resolve: (st) => {
          const why = refusal(st, f, true);
          if (why) return why;
          if (caravanEnRoute(st, f)) return "Their caravan is already on its way.";
          const c = sendCaravan(st, f, base, { goods: { supplies: { [getKey]: getQty }, gear: [] }, deal });
          if (!c) return `${f.name} cannot reach ${base.name} after all.`;
          return note(st, f, `Deal: ${giveQty} ${keyWord(giveKey)} for ${getQty} ${keyWord(getKey)}. Their caravan sets out for ${base.name} (about ${c.eta}h).`);
        },
      },
      { label: "No, thank you", hint: "Nothing changes", resolve: (st) => note(st, f, `You turned down ${f.name}'s offer.`) },
    ],
  };
}
// A call asking you to bring your side to them: agree (a pending deal your caravan fetches; the trade caravan
// planner opens) or decline.
// b: { giveKey, giveQty, getKey, getQty (their fee included), extra (their fee), more (what you may ask on top; 0: you
// asked already) }. The governor answers through card.bring (autopilot.js).
function bringCard(state, f, base, b, said) {
  const { giveKey, giveQty, getKey, getQty, extra, more } = b;
  const where = tileLabel(state, f.bases[0]);
  const text = said.replace(/, delivered to [^."]+\./, ".");
  const agree = (qty, label, hint) => ({
    label, hint, uiAction: { type: "radioCaravan", factionId: f.id },
    affordable: () => false, // the governor answers through card.bring (autopilot.js)
    resolve: (st) => {
      const why = refusal(st, f, true);
      if (why) return why;
      if (pendingDeal(st, f)) return `A radio deal with ${f.name} is already waiting.`;
      const d = bookDeal(st, f, base, { supplies: { [giveKey]: giveQty }, gear: [] }, { supplies: { [getKey]: qty }, gear: [] }, "them");
      return note(st, f, `Agreed: your caravan brings ${giveQty} ${keyWord(giveKey)} to ${f.name} by day ${d.due} and comes back with ${qty} ${keyWord(getKey)}.`);
    },
  });
  const choices = [agree(getQty, `Agree and send a caravan: ${giveQty} ${keyWord(giveKey)} for ${getQty} ${keyWord(getKey)}…`, `Their fee: ${extra} ${keyWord(getKey)}. Opens the trade caravan planner from ${base.name} with the ${keyWord(giveKey)} loaded (it has ${Math.floor(base.stock[giveKey] || 0)} now)`)];
  if (more > 0) {
    // Set your own fee: ask for more for the trip. Yes: the deal at your fee and the planner; no: the call again, at their fee.
    const yes = agree(getQty + more, "", "");
    choices.push({
      label: `Ask more for the trip: ${getQty + more} ${keyWord(getKey)} (fee ${extra + more})…`,
      hint: `They may agree (they like you, or they need the ${keyWord(giveKey)}); if not, their offer stands`,
      uiAction: { type: "radioCaravan", factionId: f.id }, affordable: () => false,
      resolve: (st) => {
        if (counterOk(st, f, giveKey) && available(f, getKey) >= getQty + more) return `${f.name}: "Fair enough." ${yes.resolve(st)}`;
        addCard(st, bringCard(st, f, base, { ...b, more: 0 }, said));
        return note(st, f, `${f.name}: "We cannot pay more than ${extra} ${keyWord(getKey)} for the trip."`);
      },
    });
  }
  choices.push({ label: "No, thank you: we will not send a caravan", hint: "Nothing changes", resolve: (st) => note(st, f, `You told ${f.name} you would not send a caravan.`) });
  return {
    title: `On the radio: ${f.name}`,
    radioFrom: f.id,
    bring: { factionId: f.id, baseId: base.id, give: { supplies: { [giveKey]: giveQty }, gear: [] }, get: { supplies: { [getKey]: getQty }, gear: [] } },
    text: `${f.name} (${attitude(f).toLowerCase()}) call you. ${text} "Could you bring it to us at ${where}? We will add ${extra} ${keyWord(getKey)} for the trip." If you agree, they set the ${keyWord(getKey)} aside for you and your caravan takes the ${keyWord(giveKey)} to them; the deal waits about ten days.`,
    choices,
  };
}
// A call asking to meet halfway (trademeet.js): their caravan takes their side to the tile and waits two days; the
// trade caravan planner opens from your base with your side loaded. The governor declines (it plans no meetings).
function meetOfferCard(state, f, base, tile, deal, said) {
  const [giveKey, giveQty] = Object.entries(deal.offer)[0];
  const [getKey, getQty] = Object.entries(deal.ask)[0];
  const where = tileLabel(state, tile);
  const text = said.replace(/, delivered to [^."]+\./, ".");
  return {
    title: `On the radio: ${f.name}`,
    radioFrom: f.id,
    text: `${f.name} (${attitude(f).toLowerCase()}) call you. ${text} "${base.name} is a long way for us. Meet us halfway, at ${where}?" If you agree, their caravan brings the ${keyWord(getKey)} there (about ${meetHours(state, f, tile)}h for them) and waits two days; send a team with the ${keyWord(giveKey)} and the trade window opens when it gets there. No fee: each side walks its own half.`,
    choices: [
      {
        label: `Agree to meet at ${where}: ${giveQty} ${keyWord(giveKey)} for ${getQty} ${keyWord(getKey)}…`,
        hint: `Opens the trade caravan planner from ${base.name} with the ${keyWord(giveKey)} loaded (it has ${Math.floor(base.stock[giveKey] || 0)} now)`,
        uiAction: { type: "meetCaravan", factionId: f.id }, affordable: () => false,
        resolve: (st) => {
          const why = refusal(st, f, true) || meetRefusal(st, f, tile, caravanEnRoute(st, f));
          if (why) return note(st, f, why);
          const c = sendCaravan(st, f, base, { goods: { supplies: { [getKey]: getQty }, gear: [] }, deal, meetTile: tile });
          if (!c) return `${f.name} cannot get to ${where} after all.`;
          return note(st, f, `Agreed: ${giveQty} ${keyWord(giveKey)} for ${getQty} ${keyWord(getKey)}, met at ${where}. Their caravan sets out (about ${c.eta}h) and waits there two days.`);
        },
      },
      { label: "No, thank you", hint: "Nothing changes", resolve: (st) => note(st, f, `You turned down ${f.name}'s offer.`) },
    ],
  };
}
const REF_QTY = { food: 25, water: 25, fuel: 12, meds: 8, ammo: 60, parts: 3, scrap: 20, wood: 600 }; // wood: woodcutting.js (60 kg)
const refQty = (k) => (FOODS[k] ? Math.max(1, Math.round(qtyOf(k, REF_QTY.food))) : REF_QTY[SUPPLIES[k] && SUPPLIES[k].round ? "ammo" : k]); // a food item: 25 days of food of it // a round key: a lot of rounds, as "ammo" was

// ---------- autopilot: radio trade when the hub runs short ----------
// needs: the governor's needs table (0 plenty … 3 urgent). Picks the most urgent good, a group in reach that has
// it, and pays with the hub's most plentiful good. At most one radio deal every 6 days. Returns a log text or "".
// base: a base leader's deal (steward.js, Trading) for that base: only with groups whose caravan comes to it (tradeBase),
// paid from its own surplus, at its people's Speech, for the `keys` it may buy (default any), at most `cap` of each
// (default REF_QTY); the caller keeps its own cooldown (state.radioAutoDay is the governor's).
export function radioTradeIfShort(state, needs, { base = null, keys = null, cap = null } = {}) {
  if (!hasNetwork(state)) return "";
  if (!base && state.radioAutoDay != null && day(state) - state.radioAutoDay < 6) return "";
  const at = base || hub(state);
  if (!at) return "";
  // Food (foods.js): paid with the item the base holds most of; asked for as each group's food that keeps (below).
  const sellFood = needs.food != null && needs.food <= 0.4 ? bestFoodKey(at.stock) : null;
  needs = { ...needs };
  if (sellFood) needs[sellFood] = needs.food;
  const short = Object.keys(needs).filter((k) => needs[k] >= 1.8 && (!keys || keys.includes(k)) && k !== "preserved" && !FOODS[k]).sort((a, b) => needs[b] - needs[a]);
  const plenty = Object.keys(needs).filter((k) => k !== "food" && k !== "preserved" && needs[k] <= 0.4 && hubSpare(state, k, at) >= supplyFew(k, 5)).sort((a, b) => needs[a] - needs[b]);
  if (!short.length || !plenty.length) return "";
  const speech = base ? tradeSpeech(atBase(state, base.id)) : radioSpeech(state);
  for (const want0 of short) {
    // Every group and every way to pay, cheapest first (what the payment is worth to the hub per unit got): the
    // group that sells it cheap and wants what you pay with most (their kind and state, trade.js) wins.
    const deals = [];
    for (const f of state.factions) {
      const want = want0 === "food" ? bestFoodKey(f.stock, true) : want0; // foods.js: their food that keeps, the item they hold most of
      if (!want) continue;
      if (!f.known || refusal(state, f, true) || caravanEnRoute(state, f) || available(f, want, { kinds: true }) < 3) continue; // part kinds: out of their parts (trade.js KIND_MIX)
      const tb = tradeBase(state, f);
      if (base && tb !== base) continue; // their caravan would go to another base
      if (!tb || deliveryRefusal(state, f, tb)) continue; // they will not bring it (radiotrade.js)
      const fee = deliveryFee(state, f, tb); // what they charge to bring it
      for (const pay of plenty) {
        if (pay === want) continue;
        const budgetUnits = hubSpare(state, pay, at);
        const value = budgetUnits * sellPrice(state, f, pay, speech, budgetUnits);
        const qty = Math.min((cap && cap[want0]) ? (FOODS[want] ? Math.ceil(qtyOf(want, cap[want0])) : cap[want0]) : FOODS[want] ? Math.ceil(qtyOf(want, refQty("food") || 20)) : refQty(want) || 10, maxBuyable(state, f, want, speech, Math.max(0, value - fee), Infinity, true));
        if (qty < 2) continue;
        const cost = qty * buyPrice(state, f, want, speech, qty) + fee;
        const payQty = minSellable(state, f, pay, speech, cost, budgetUnits);
        if (!Number.isFinite(payQty)) continue;
        deals.push({ f, pay, qty, payQty, want, per: (payQty * supValue(pay) * (needs[pay] + 0.2)) / (qty * (FOODS[want] ? unitsOf(want, 1) : 1)) });
      }
    }
    deals.sort((a, b) => a.per - b.per || a.f.id - b.f.id);
    for (const d of deals) {
      const res = radioDeal(state, d.f, { wantKey: d.want, wantQty: d.qty, payKey: d.pay, payQty: d.payQty });
      if (res.ok) {
        if (!base) state.radioAutoDay = day(state);
        return `radio deal with ${d.f.name}: ${d.qty} ${keyWord(d.want)} for ${d.payQty} ${keyWord(d.pay)}`;
      }
    }
  }
  return "";
}

