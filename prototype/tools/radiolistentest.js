// Radio networks and listening in on radio traffic (src/sim/radio.js radioNetworks / networksAt, src/sim/radiolisten.js,
// src/ui/radiolisten.js; 2026-10-06):
// - networks: yours (stations and linked relays: an outpost's relay is a node, one beside a station is not, a hub
//   relay without a station is once a station reaches it) and one per group with a base, each base broadcasting by the group's
//   type (military 24, traders and fortresses 12, communes, zealots and expansionists 8, raiders 6); a base taken or
//   lost changes it; networksAt with two overlapping networks;
// - a receiver hears a network only inside its coverage: a hand-crank radio outside every network hears nothing;
// - Listen in (a 1-hour team order, a base's set): with two networks in range you choose, and switch; the tuned id is
//   remembered; your own channel gives what it did;
// - a group's channel over N days, by the world's dice: caravans, raids (a warning card when your base is the target),
//   war parties against the hives; deterministic; odds rise with Scouting; a military channel is encrypted;
// - transmitting is unchanged: a hand-crank radio calls nobody; being caught listening (−5 goodwill); the governor's
//   tuning; the UI pieces and their handlers; save / load (old saves: untuned).
// Usage: node tools/radiolistentest.js [seed]
import { createWorld, tickHour, hub, atBase, day, peekNextId, setNextId, RADIO_RANGE } from "../src/sim/world.js";
import { worksAt } from "../src/sim/groupworks.js"; // ai-locks: a group's radio station
import { newItem } from "../src/sim/inventory.js";
import { spawnAiParty, partyTile } from "../src/sim/parties.js";
import { startOrder } from "../src/sim/orders.js";
import { commandable } from "../src/sim/plans.js";
import {
  radioNetworks, networksAt, groupNetwork, playerNetwork, networkById, netCovers, GROUP_NET_RANGE, PLAYER_NET, HEAR_EXTRA,
  canRadioGroup, radioNodes, hasNetwork, canListen, listeners, teamReceives, baseReceives, radioSummary, inCoverage,
} from "../src/sim/radio.js";
import { LISTEN, ODDS, hearOdds, listenIn, listenProblem, listenDaily, channelTraffic, autoTune, tunedNetworks } from "../src/sim/radiolisten.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { groupHides } from "../src/sim/hiding.js"; // a hidden outpost keeps off its group's network
import { listenBlock, teamRadioLine, baseListenSection, LISTEN_ACTIONS } from "../src/ui/radiolisten.js";
import { renderExpedition } from "../src/ui/expedition.js";
import { groupsRadioHeader } from "../src/ui/tradewindow.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(t);
const t0 = Date.now();

// stations: the groups' networks by your rules (ai-locks: radio stations only); by default an older save's groups, every
// base on the air by type (radio.js GROUP_NET_RANGE), so the listening below has networks to hear.
function world(s = seed, stations = false) {
  const st = createWorld({ seed: s, factionCount: 7 });
  st.started = true; st.visitorsOff = true; st.noWanderers = true;
  if (!stations) st.groupWorks = null;
  const h = hub(st);
  h.radio = false;
  st.hordes.length = 0;
  return { st, h };
}
// A hand-made team of `n` from the hub standing on `tile`.
function team(st, h, tile, n = 1) {
  const members = atBase(st, h.id).slice(0, n);
  const p = { id: 90000 + st.parties.length, owner: "player", kind: "expedition", mission: "scavenge", members: members.map((s) => s.id), supplies: { food: 20, water: 20, meds: 0 }, cargo: { supplies: {}, gear: [] }, path: [tile], idx: 0, progress: 0, phase: "waiting", stance: "normal", seen: new Map(), spotted: new Map(), sightNow: [], radioLive: false, dest: tile, departed: st.hour };
  for (const s of members) s.location = { kind: "party", partyId: p.id };
  st.parties.push(p);
  return { p, members };
}
const land = (st, t) => t.terrain !== "water" && t.terrain !== "mountain" && !t.loc && !st.bases.some((b) => b.tile === t.id) && !st.factions.some((f) => f.bases.includes(t.id));
// Two groups set up around a spot far from the hub: f1 (traders, a base 3 tiles off) and f2 (a commune, 5 tiles off).
function twoNets(st, h) {
  const g = st.grid;
  const spot = st.tiles.find((t) => land(st, t) && g.distance(h.tile, t.id) >= 30 && g.distance(h.tile, t.id) <= 40 && networksAt(st, t.id).length === 0);
  const ring = (d) => st.tiles.find((t) => land(st, t) && g.distance(spot.id, t.id) === d);
  const alive = st.factions.filter((f) => f.alive && f.bases.length);
  const [f1, f2] = alive;
  f1.type = "traders"; f2.type = "commune";
  f1.bases = [ring(3).id]; f2.bases = [ring(5).id];
  f1.known = true; f2.known = true;
  return { spot, f1, f2 };
}
const clearCards = (st) => { st.cards.length = 0; };
const nextDay = (st) => { st.hour = (day(st) + 1) * 24; };

// ---------- 0. the groups' stations (ai-locks 2026-10-11: they broadcast by your rules) ----------
section("Networks by your rules: a group is on the air from its radio stations");
{
  const { st } = world(seed, true);
  const groups = st.factions.filter((f) => f.alive && f.bases.length && f.type !== "military");
  check(groups.length > 0 && groups.every((f) => groupNetwork(st, f) === null), `no station built: no network (${groups.length} groups)`);
  const f = groups[0];
  worksAt(f, f.bases[0]).radio = 1;
  const n = groupNetwork(st, f);
  check(n && n.nodes.length === 1 && n.nodes[0].tile === f.bases[0] && n.nodes[0].range === RADIO_RANGE, `a station at its main base: one node of ${RADIO_RANGE} tiles (yours)`);
  const mil = st.factions.find((x) => x.alive && x.bases.length && x.type === "military");
  if (mil) check(groupNetwork(st, mil).nodes.every((x) => x.range === 24), "the military: every base on the air at 24 (their army sets)");
}
// ---------- 1. networks ----------
section("Networks: yours and one per group, ranges by type");
{
  const { st, h } = world();
  check(GROUP_NET_RANGE.military === 24 && GROUP_NET_RANGE.traders === 12 && GROUP_NET_RANGE.fortress === 12 && GROUP_NET_RANGE.commune === 8 && GROUP_NET_RANGE.zealot === 8 && GROUP_NET_RANGE.expansionist === 8 && GROUP_NET_RANGE.raider === 6, `ranges: ${JSON.stringify(GROUP_NET_RANGE)}`);
  check(HEAR_EXTRA === 0, "no band past a network's coverage (HEAR_EXTRA 0)");
  check(!playerNetwork(st) && !radioNetworks(st).some((n) => n.id === PLAYER_NET), "no station: you have no network");
  h.radio = true;
  const mine = playerNetwork(st);
  check(mine && mine.id === PLAYER_NET && mine.nodes.length === 1 && mine.nodes[0].tile === h.tile && mine.nodes[0].range === radioNodes(st)[0].range, `a station: your network, one node of ${mine && mine.nodes[0].range} tiles at the hub`);
  const groups = st.factions.filter((f) => f.alive && f.bases.length);
  const nets = radioNetworks(st);
  check(nets.length === groups.length + 1 && nets[0].id === PLAYER_NET, `one network per group with a base (${groups.length}) plus yours, yours first`);
  check(groups.every((f) => { const n = nets.find((x) => x.id === f.id); return n && n.color === f.color && n.nodes.length === f.bases.length && n.nodes.every((x, i) => x.tile === f.bases[i] && x.range === GROUP_NET_RANGE[f.type]); }), "every group's network: its colour, one node per base at its type's range");
  const f = groups[0];
  const g = st.grid;
  const t = st.tiles.find((x) => land(st, x) && g.distance(x.id, f.bases[0]) > 40 && !netCovers(st, groupNetwork(st, f), x.id));
  f.bases.push(t.id);
  if (groupHides(st, f, t.id)) check(!netCovers(st, groupNetwork(st, f), t.id), "a base taken and kept hidden (hiding.js): it keeps off their network");
  else check(netCovers(st, groupNetwork(st, f), t.id) && networksAt(st, t.id).some((n) => n.id === f.id), "a base taken: their network covers it");
  f.bases.pop();
  check(!networksAt(st, t.id).some((n) => n.id === f.id), "lost again: it does not");
  for (const type of Object.keys(GROUP_NET_RANGE)) {
    f.type = type;
    const at = (d) => st.tiles.find((x) => g.distance(x.id, f.bases[0]) === d);
    check(netCovers(st, groupNetwork(st, f), at(GROUP_NET_RANGE[type]).id) && !netCovers(st, groupNetwork(st, f), at(GROUP_NET_RANGE[type] + 1).id), `${type}: ${GROUP_NET_RANGE[type]} tiles covered, ${GROUP_NET_RANGE[type] + 1} not`);
  }
  const dead = groups[1];
  dead.alive = false;
  check(!radioNetworks(st).some((n) => n.id === dead.id) && networkById(st, dead.id) === null, "a group gone: its network is off the air");
  dead.alive = true;
  check(networkById(st, PLAYER_NET).id === PLAYER_NET && networkById(st, String(f.id)).id === f.id, "networkById: \"player\" or a group's id (a string id from the page works too)");
  // Relays (any base, the hub too): an outpost's linked relay is a node of your network; one beside a station is not
  // (the base is a station node only); a hub relay with no station there is a node once an outpost's station links it.
  const oT = st.tiles.find((x) => land(st, x) && g.distance(x.id, h.tile) >= 8 && g.distance(x.id, h.tile) <= 10);
  const o = { id: 99001, tile: oT.id, type: "outpost", name: "Mast Hill", stock: { parts: 0 }, buildings: [{ id: 99002, type: "relay" }], construction: [], armory: [], radio: false, watchtower: false };
  st.bases.push(o);
  const withRelay = playerNetwork(st);
  check(withRelay.nodes.length === 2 && withRelay.nodes.some((n) => n.tile === oT.id && n.range === 6) && networksAt(st, oT.id)[0].id === PLAYER_NET, "an outpost's linked relay: a second node (6 tiles) of your network");
  h.buildings.push({ id: 99003, type: "relay" });
  check(playerNetwork(st).nodes.length === 2 && playerNetwork(st).nodes.find((n) => n.tile === h.tile).range > 6, "a relay beside the hub's station adds no node (the station's own range stands)");
  h.radio = false; o.radio = true; o.buildings = [];
  const hubRelay = playerNetwork(st);
  check(hubRelay && hubRelay.nodes.some((n) => n.tile === h.tile && n.range === 6), "a hub relay without a station, linked from an outpost's station: a node of your network");
  h.buildings = h.buildings.filter((b) => b.id !== 99003);
  st.bases.splice(st.bases.indexOf(o), 1);
}

// ---------- 2. overlapping networks ----------
section("networksAt: two networks overlapping");
{
  const { st, h } = world();
  const { spot, f1, f2 } = twoNets(st, h);
  const here = networksAt(st, spot.id);
  check(here.length === 2 && here.some((n) => n.id === f1.id) && here.some((n) => n.id === f2.id), `at the spot: ${here.map((n) => n.name).join(" + ")}`);
  const g = st.grid;
  const onlyF1 = st.tiles.find((t) => land(st, t) && g.distance(t.id, f1.bases[0]) === 12 && g.distance(t.id, f2.bases[0]) > 8);
  check(onlyF1 && networksAt(st, onlyF1.id).some((n) => n.id === f1.id) && !networksAt(st, onlyF1.id).some((n) => n.id === f2.id), "further out only the traders' network (12) reaches, not the commune's (8)");
}

// ---------- 3. outside every network ----------
section("A hand-crank radio outside every network hears nothing");
{
  const { st, h } = world();
  const g = st.grid;
  const silent = st.tiles.find((t) => land(st, t) && g.distance(h.tile, t.id) > 14 && networksAt(st, t.id).length === 0);
  const { p, members } = team(st, h, silent.id, 1);
  members[0].pockets[0] = newItem("handradio");
  p.lastConflict = st.hour;
  tickHour(st);
  check(teamReceives(st, p) && p.radioHear === false && !p.radioLive && !commandable(st, p), "the team carries a receiver: no listening state, no contact");
  check(listeners(st).length === 0 && !canListen(st), "it is not on the air: canListen false (no station)");
  check(/Static: no radio network reaches this spot/.test(listenProblem(st, p, false)) && !listenIn(st, p, null, false).ok && p.tuned == null, "Listen in: static, nothing tuned");
  check(teamRadioLine(st, p, true) === "", "the team panel shows no radio line");
}

// ---------- 4. Listen in: choose and switch ----------
section("Listen in with two networks in range: choose, switch; your own channel");
{
  const { st, h } = world();
  const { spot, f1, f2 } = twoNets(st, h);
  const { p, members } = team(st, h, spot.id, 2);
  members[0].pockets[0] = newItem("handradio");
  p.lastConflict = st.hour;
  tickHour(st);
  check(p.radioHear === true && !commandable(st, p), "inside both networks: listening, not in contact");
  clearCards(st);
  const msg = startOrder(st, p, { type: "listen", net: f2.id });
  check(p.phase === "task" && p.task.type === "listen" && p.task.hours === LISTEN.HOURS && /listens in/.test(msg), `the order: "${msg}"`);
  tickHour(st);
  check(p.tuned === f2.id && p.phase === "waiting", `after ${LISTEN.HOURS}h: tuned to ${f2.name} (p.tuned ${p.tuned})`);
  const card = st.cards.find((c) => c.isOrders && c.partyId === p.id);
  check(!!card && /channel/.test(card.text || ""), `the orders card says what was heard: "${card && (card.text || "").slice(0, 100)}"`);
  const r = listenIn(st, p, f1.id, false);
  check(r.ok && p.tuned === f1.id && /switched to/.test(r.text), `switching is the same action: "${r.text}"`);
  check(!listenIn(st, p, 987654, false).ok && p.tuned === f1.id, "a channel not in range: refused, still tuned");
  const pick = listenIn(st, p, null, false);
  check(pick.ok && (p.tuned === f1.id || p.tuned === f2.id), "no channel named with two in range: one of the groups'");
  // The panel: one Listen in per network, in their colours.
  st.cards.push({ partyId: p.id, isOrders: true, title: "Orders", text: "", choices: [] }); // in contact through its card
  const html = renderExpedition(st, { xpQueue: false, expedition: p.id }, p);
  const n = (html.match(/data-action="xp-listen"/g) || []).length;
  check(n === 2 && html.includes(f1.color) && html.includes(f2.color) && !/undefined|NaN/.test(html), `the team panel offers ${n} channels with their colours`);
  const ui = { xpQueue: false, expedition: p.id };
  LISTEN_ACTIONS["xp-listen"](st, ui, { id: String(p.id), net: String(f2.id) });
  check(p.phase === "task" && p.task.type === "listen" && p.task.net === f2.id, `the handler starts the order (${ui.xpMsg})`);
  // Your own network: tuning to it adds nothing new.
  const { st: s2, h: h2 } = world();
  h2.radio = true;
  const { p: q, members: m2 } = team(s2, h2, s2.grid.neighbors(h2.tile)[0], 1);
  m2[0].pockets[0] = newItem("handradio");
  const own = listenIn(s2, q, PLAYER_NET, false);
  check(own.ok && q.tuned === PLAYER_NET && /your own network/.test(own.text) && own.heard.length === 0, `your own channel: "${own.text}"`);
  const before = s2.log.length;
  for (let d = 0; d < 3; d++) { nextDay(s2); listenDaily(s2); }
  check(!(q.heard || []).length && s2.log.slice(0, s2.log.length - before).every((l) => !/Heard on/.test(l.text)), "tuned to your own network: no channel lines");
}

// ---------- 5. a group's channel over days ----------
function trafficRun(s, ids = null) {
  if (ids != null) setNextId(ids); // the same ids as the first run (world.js newId is one counter per process)
  const { st, h } = world(s);
  const { spot, f1, f2 } = twoNets(st, h);
  const { p, members } = team(st, h, spot.id, 2);
  members[0].pockets[0] = newItem("handradio");
  for (const m of members) m.skills.scouting = 20;
  channelTraffic(st); // the hive memo starts here
  // Their traffic: a convoy to the commune, a raid on your hub, a war party at a hive.
  const cv = spawnAiParty(st, f1, "convoy", f1.bases[0], f2.bases[0], { strength: 3, targetFaction: f2.id });
  const raid = spawnAiParty(st, f1, "raid", f1.bases[0], h.tile, { strength: 12, target: { kind: "player", baseId: h.id, tile: h.tile } });
  f1.hiveFights = (f1.hiveFights || 0) + 1; f1.hiveKills = (f1.hiveKills || 0) + 14;
  listenIn(st, p, f1.id, false);
  const kinds = new Set();
  for (let d = 0; d < 5; d++) { nextDay(st); listenDaily(st); for (const x of st.radioChan.traffic[f1.id]) kinds.add(x.kind); }
  return { st, h, p, f1, f2, cv, raid, kinds };
}
section("A group's channel over 5 days: caravans, raids, hive war parties, by the dice");
{
  const ids = peekNextId();
  const { st, h, p, f1, cv, raid, kinds: seen } = trafficRun(seed, ids);
  // Everything heard over the 5 days (the log): the team's own list keeps only the LISTEN.HEARD_MAX newest, so a line
  // heard on day 1 can be pushed off it by later talk (how much talk there is turns on the world-local ids).
  const heard = st.log.filter((l) => /^📻 Heard on /.test(l.text)).map((l) => l.text);
  check(!!cv && !!raid, "the convoy and the raid are on the road");
  const kinds = [...seen];
  check(kinds.includes("caravan") && kinds.includes("raidYou") && kinds.includes("hive"), `their channel carries: ${[...new Set(kinds)].join(", ")}`);
  check(heard.some((t) => /trade convoy set out from .* for /.test(t)), "heard: the convoy, its route and destination");
  check(heard.some((t) => new RegExp(`war party .* on its way to your ${h.name}`).test(t)), "heard: the raid on your hub, with its rough day");
  check(heard.some((t) => /stormed .* driven off, after cutting down about 14/.test(t)), "heard: their war party at the hive and how it went");
  const card = st.cards.find((c) => c.radioRaid === raid.id);
  check(card && /^Heard on the radio: /.test(card.title) && card.choices[0].label === "Prepare defenses", `a warning card: "${card && card.title}"`);
  check(card && card.choices[0].ai() > card.choices[1].ai(), "its choices carry the governor's scores (prepare first)");
  if (card) { card.choices[0].resolve(st); check(h.alert === true, "Prepare defenses: the hub is on alert"); }
  check(st.log.some((l) => /^📻 Heard on .*'s channel: /.test(l.text)), "the lines are in the log");
  check((p.heard || []).length <= LISTEN.HEARD_MAX && p.heard.every((x) => x.net === f1.id && x.name === f1.name && x.day >= 0), `the team's list: ${p.heard.length} lines, newest first`);
  const again = trafficRun(seed, ids);
  check(JSON.stringify(again.p.heard) === JSON.stringify(p.heard), "deterministic: the same world hears the same lines");
  const got = Object.keys(st.radioChan.got).length;
  nextDay(st); listenDaily(st);
  check(!(p.heard || []).slice(0, 1).some((x) => x.day === day(st) && heard.includes(x.text)), "a line heard once is not heard again");
  check(got > 0, `heard keys remembered (${got})`);
  // Odds: Scouting helps, never perfect; a military channel is encrypted.
  check(hearOdds("raid", 0) < hearOdds("raid", 10) && hearOdds("raid", 10) < hearOdds("raid", 20) && hearOdds("raidYou", 20) <= LISTEN.CAP && hearOdds("raid", 10, true) < hearOdds("raid", 10), `odds: raids ${Math.round(hearOdds("raid", 0) * 100)}% → ${Math.round(hearOdds("raid", 20) * 100)}% (Scouting 0 → 20), at most ${LISTEN.CAP * 100}%, encrypted ×${LISTEN.ENCRYPTED}`);
  check(Object.keys(ODDS).every((k) => hearOdds(k, 0) > 0 && hearOdds(k, 20) <= LISTEN.CAP), "every kind of line can be missed and caught");
  // Out of range: the tuned channel stays but nothing is heard.
  const far = st.tiles.find((t) => land(st, t) && networksAt(st, t.id).length === 0);
  p.path = [far.id]; p.idx = 0;
  const n0 = (p.heard || []).length;
  spawnAiParty(st, f1, "convoy", f1.bases[0], f1.bases[0], { strength: 3 });
  for (let d = 0; d < 3; d++) { nextDay(st); listenDaily(st); }
  check(p.tuned === f1.id && (p.heard || []).length === n0, "moved out of their network: still tuned, hears nothing");
}

// ---------- 6. transmitting, being caught, the base set, the governor ----------
section("Transmitting unchanged; caught listening; a base's set; the governor");
{
  const { st, h } = world();
  const { spot, f1 } = twoNets(st, h);
  const { p, members } = team(st, h, spot.id, 1);
  members[0].pockets[0] = newItem("handradio");
  listenIn(st, p, f1.id, false);
  p.lastConflict = st.hour; tickHour(st); clearCards(st);
  check(p.tuned === f1.id && !canRadioGroup(st, f1) && !hasNetwork(st) && radioNodes(st).length === 0 && !commandable(st, p) && !inCoverage(st, spot.id), "tuned to them, yet nobody can be called, the team takes no orders, nobody has coverage");
  const keep = LISTEN.CAUGHT;
  LISTEN.CAUGHT = 1;
  const gw = f1.goodwill;
  nextDay(st); listenDaily(st);
  LISTEN.CAUGHT = keep;
  check(Math.abs(f1.goodwill - (gw + LISTEN.CAUGHT_GW)) < 1e-6 && st.log.some((l) => /caught on that you listen in/.test(l.text)), `caught listening: goodwill ${Math.round(gw)} → ${Math.round(f1.goodwill)}`);
  // A base's set: a hand-crank radio at the hub inside a group's network.
  const { st: s2, h: h2 } = world();
  const g = s2.grid;
  const f = s2.factions.find((x) => x.alive && x.bases.length);
  f.known = true; f.type = "raider";
  const t = s2.tiles.find((x) => land(s2, x) && g.distance(x.id, h2.tile) === 3);
  f.bases.push(t.id);
  check(!baseReceives(s2, h2) && /No receiver/.test(listenProblem(s2, h2, true)), "the hub without a radio: no receiver");
  h2.armory.push(newItem("handradio"));
  check(baseReceives(s2, h2) && listenProblem(s2, h2, true) === null, "a hand-crank radio in the armory: the hub can listen in");
  const html = groupsRadioHeader(s2);
  check(/data-action="bl-listen"/.test(html) && html.includes(f.color) && !/undefined|NaN/.test(html), "the Groups tab's radio header offers the hub's set, with the channels' colours");
  const ui = {};
  LISTEN_ACTIONS["bl-listen"](s2, ui, { id: String(h2.id), net: String(f.id) });
  check(h2.tuned === f.id && h2.listenHour === s2.hour && /tuned to/.test(ui.radioMsg), `the handler tunes the hub: "${ui.radioMsg}"`);
  check(/Tuned to /.test(radioSummary(s2, h2)), `the base's radio line: "${radioSummary(s2, h2)}"`);
  check(tunedNetworks(s2).some((n) => n.id === f.id), "the map draws the tuned channel's coverage (tunedNetworks)");
  // The governor: the group that raided it last.
  h2.tuned = null; h2.tunedDay = null;
  const other = s2.factions.find((x) => x.alive && x !== f && x.bases.length);
  other.bases.push(s2.tiles.find((x) => land(s2, x) && g.distance(x.id, h2.tile) === 4).id);
  other.known = true;
  other.raidedYou = 3; f.raidedYou = 1;
  autoTune(s2);
  check(h2.tuned === other.id, `the governor tunes the hub to ${other.name} (raided it last)`);
  const tuned = h2.tunedDay;
  nextDay(s2);
  autoTune(s2);
  check(h2.tunedDay === tuned, "and leaves it for a week");
}

// ---------- 7. save / load ----------
section("Save and load");
{
  const { st, p, f1 } = trafficRun(seed);
  clearCards(st);
  const ld = loadFromString(saveToString(st));
  const p2 = ld.parties.find((x) => x.id === p.id);
  check(p2 && p2.tuned === f1.id && JSON.stringify(p2.heard) === JSON.stringify(p.heard), "the team's channel and what it heard come back");
  check(JSON.stringify(ld.radioChan) === JSON.stringify(st.radioChan), "the channels' traffic and the heard keys come back");
  for (const s of [st, ld]) { nextDay(s); listenDaily(s); }
  check(JSON.stringify(ld.parties.find((x) => x.id === p.id).heard) === JSON.stringify(p.heard), "the next day goes the same in both");
  // An old save: nothing tuned, no channels yet.
  delete ld.radioChan; delete p2.tuned; delete p2.heard;
  let ok = true;
  try { nextDay(ld); listenDaily(ld); } catch (e) { ok = false; console.log(e); }
  check(ok && p2.tuned == null && !p2.heard && ld.radioChan && ld.radioChan.traffic, "an old save loads untuned and listens from then on");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fail ? 1 : 0);
