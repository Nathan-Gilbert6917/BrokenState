// The hand-crank radio and purification tablets (2026-10-06; src/sim/data.js handradio / puritabs):
// - the radio only listens (radio.js listeners): a base holding one or a team carrying one inside a radio network's
//   coverage (yours, or a group's own: radio.js radioNetworks) hears the airwaves scan's new voices and group news
//   without a station, but canRadioGroup stays false, a team carrying one out of your coverage is not commandable (it
//   gets the listening state, p.radioHear, only inside some network: no band beyond coverage any more, HEAR_EXTRA 0),
//   and nobody's coverage grows (Listen in and the channels' traffic: tools/radiolistentest.js);
// - the tablets make un-purified water safe on the road (worm.js, water.js): a team spends one per 10 un-purified water
//   drunk from infected sources (no worm roll on what they cover; none for purified water, none with a filter); bases
//   never use them (a team leaving packs a tube: packTablets); what a team packs at a base is not treated;
// - the hardcore prepper's kit has both; the loot tables hold both; the recipe; save/load.
// Usage: node tools/itemstest.js [seed]
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, hub, atBase, residents, log, day } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { newItem } from "../src/sim/inventory.js";
import { addBuilding, count } from "../src/sim/buildings.js";
import { partyMembers, partyTile } from "../src/sim/parties.js";
import { commandable, HAND_RADIO } from "../src/sim/plans.js";
import { canRadioGroup, canHearGroup, listeners, canListen, hasNetwork, radioScan, radioNodes, inCoverage, heardBy, HEAR_EXTRA, GROUP_REACH, baseListens, teamListens, networksAt, groupNetwork, netCovers } from "../src/sim/radio.js";
import { RADIO_RANGE } from "../src/sim/world.js";
import { news, ensureDiplo } from "../src/sim/diplomacy.js";
import { WORM, baseWater, wormDaily, drinkHour, addWormWater, packWater, packTablets, teamTabCount, baseTabCount, teamWormText, eggsAt } from "../src/sim/worm.js";
import { HC_START, roadTeam } from "../src/sim/hardcore-start.js";
import { SITE_FINDS, AREA_FINDS, ITEM_TAGS, fitsTags, SITE_TAGS } from "../src/sim/loot.js";
import { CRAFTS, durUnit } from "../src/sim/crafting.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { HEAT } from "../src/sim/upkeep.js";
import { groupsRadioHeader } from "../src/ui/tradewindow.js";
import { renderLeft } from "../src/ui/ui.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(t);
const t0 = Date.now();

function withNums(obj, patch, fn) {
  const keep = {};
  for (const k of Object.keys(patch)) { keep[k] = obj[k]; obj[k] = patch[k]; }
  try { return fn(); } finally { Object.assign(obj, keep); }
}
// A hub on ground at infection `inf`, no filter, no boiler, plenty of stores, everyone resting.
function world(inf = 0.8, s = seed) {
  const st = createWorld({ seed: s, factionCount: 7 });
  st.started = true; st.visitorsOff = true; st.noWanderers = true;
  const h = hub(st);
  for (const id of [h.tile, ...st.grid.neighbors(h.tile)]) { st.tiles[id].infection = inf; st.tiles[id].infBase = inf; }
  h.armory = h.armory.filter((it) => !(it && GEAR[it.key] && GEAR[it.key].water));
  for (const p of atBase(st, h.id)) { p.role = "rest"; p.station = null; p.traits = []; if (p.gear.tool && GEAR[p.gear.tool.key].water) p.gear.tool = null; p.worm = null; p.health = 100; }
  Object.assign(h.stock, { water: 300, meds: 40, scrap: 100, wood: 0, fuel: 0 }); setFood(h, 300);
  st.herds = []; st.hordes.length = 0;
  return { st, h };
}
// A hand-made team of `n` from the hub standing on `tile` (the rules under test read only these fields).
function team(st, h, tile, n = 2) {
  const members = atBase(st, h.id).slice(0, n);
  const p = { id: 90000 + st.parties.length, owner: "player", kind: "expedition", mission: "scavenge", members: members.map((s) => s.id), supplies: { water: 20, meds: 0 }, cargo: { supplies: {}, gear: [] }, path: [tile], idx: 0, progress: 0, phase: "waiting", stance: "normal", seen: new Map(), spotted: new Map(), sightNow: [], radioLive: false, dest: tile, departed: st.hour };
  setFood(p, 20); // 20 days of ration bars (tools/foodkit.js)
  for (const s of members) s.location = { kind: "party", partyId: p.id };
  st.parties.push(p);
  return { p, members };
}
const caught = (people) => people.filter((s) => s.worm).length;
const clearAll = (people) => { for (const s of people) s.worm = null; };
const tabsOf = (it) => (it ? (it.dur != null ? it.dur : GEAR[it.key].dur) : 0);
// Plain land tiles (no site, no base) more than `outside` tiles from the hub: one inside some group's network (and the
// hub outside that network), one outside every network (radio.js networksAt).
function radioSpots(st, h, outside) {
  const g = st.grid;
  const ok = (t) => t.terrain !== "water" && t.terrain !== "mountain" && !t.loc && !st.bases.some((b) => b.tile === t.id) && g.distance(h.tile, t.id) > outside;
  const inGroup = st.tiles.find((t) => ok(t) && networksAt(st, t.id).some((n) => n.kind === "group" && !netCovers(st, n, h.tile)));
  const silent = st.tiles.find((t) => ok(t) && networksAt(st, t.id).length === 0);
  const net = inGroup ? networksAt(st, inGroup.id).find((n) => n.kind === "group" && !netCovers(st, n, h.tile)) : null;
  return { inGroup, silent, f: net ? net.faction : null };
}

// ---------- 1. the items ----------
section("The items (data.js)");
{
  const r = GEAR.handradio, t = GEAR.puritabs;
  check(r && r.slot === "tool" && r.listen && r.small && r.weight <= 1 && r.cat === "electronics" && /needs no batteries/.test(r.desc) && /cannot call/.test(r.desc), "the hand-crank radio: a small tool, listen: true, light, needs no batteries, its text says it cannot call in");
  check(GEAR.pocketradio.throw === "pocketradio" && !GEAR.pocketradio.listen, "the pocket radio stays a thrown decoy, not a receiver");
  check(t && t.slot === "pack" && t.tabs && t.dur === 10 && t.small && t.weight <= 0.2 && t.cat === "medical" && /10 un-purified water/.test(t.desc) && /for the road/.test(t.desc), "purification tablets: a small pack item, a tube of 10 (dur counts tablets), light, medical");
  const tube = newItem("puritabs");
  check(tube.dur === 10 && durUnit("puritabs") === "tablets", "a new tube holds 10 tablets; the durability unit reads \"tablets\"");
  check(CRAFTS.puritabs && CRAFTS.puritabs.gear === "puritabs" && CRAFTS.puritabs.needs === "med_station" && CRAFTS.puritabs.in.meds >= 1 && CRAFTS.puritabs.skill === "medicine", `the recipe: a med station, ${JSON.stringify(CRAFTS.puritabs.in)}, Medicine ${CRAFTS.puritabs.min}`);
  check(!Object.values(CRAFTS).some((c) => c.gear === "handradio"), "no recipe for the radio: loot only");
  check(WORM.TABS_WATER === 10, "one tablet treats 10 water (WORM.TABS_WATER)");
}

// ---------- 2. loot tables ----------
section("Loot tables (loot.js): both found where they belong");
{
  const sitesWith = (key) => Object.entries(SITE_FINDS).filter(([, f]) => f.items[key] > 0).map(([t]) => t);
  const areasWith = (key) => Object.entries(AREA_FINDS).filter(([, f]) => f.items[key] > 0).map(([t]) => t);
  const tabSites = sitesWith("puritabs"), radioSites = sitesWith("handradio");
  check(["pharmacy", "clinic", "hospital", "campground", "truckstop"].every((t) => tabSites.includes(t)), `tablets at pharmacies, clinics, hospitals, campgrounds and truck stops (${tabSites.join(", ")})`);
  check(["campground", "truckstop", "ranger"].every((t) => radioSites.includes(t)) && radioSites.length >= 5, `hand-crank radios at camping and travel places (${radioSites.join(", ")})`);
  check(areasWith("puritabs").includes("pharmacy") && areasWith("puritabs").includes("campsite") && areasWith("handradio").includes("campsite"), `raid containers too (tablets: ${areasWith("puritabs").join(", ")}; radios: ${areasWith("handradio").join(", ")})`);
  check(ITEM_TAGS.handradio && ITEM_TAGS.puritabs && [...tabSites, ...radioSites].every((t) => fitsTags(tabSites.includes(t) ? "puritabs" : "handradio", SITE_TAGS[t])), "both have theme tags and fit every site that holds them");
  const kit = HC_START.PREPPER.KIT;
  check(kit.includes("handradio") && kit.includes("puritabs") && kit.includes("waterfilter"), `the hardcore prepper's kit has the radio, the tablets and still the water filter (${kit.join(", ")})`);
}

// ---------- 3. the hand-crank radio at a base ----------
section("Hand-crank radio at a base: hears the scan and the news inside a group's network, calls nobody, no coverage");
{
  const { st, h } = world(0.3);
  h.radio = false;
  const g = st.grid;
  // The hub inside the nearest group's network (a base of theirs moved in when it is not).
  const f0 = st.factions.filter((f) => f.alive && f.bases.length).sort((a, b) => g.distance(h.tile, a.bases[0]) - g.distance(h.tile, b.bases[0]))[0];
  if (!netCovers(st, groupNetwork(st, f0), h.tile)) { const t = st.tiles.find((x) => g.distance(h.tile, x.id) === 4 && x.terrain !== "water" && !x.loc); f0.bases.push(t.id); }
  const near = st.factions.filter((f) => f.alive && f.bases.length && netCovers(st, groupNetwork(st, f), h.tile));
  const far = st.factions.filter((f) => f.alive && f.bases.length && !netCovers(st, groupNetwork(st, f), h.tile) && f.bases.every((b) => g.distance(h.tile, b) > RADIO_RANGE + GROUP_REACH));
  check(!hasNetwork(st) && !canListen(st) && listeners(st).length === 0, "no station, nothing to listen with: silence");
  check(radioScan(st) === "You need a radio station (or a hand-crank radio) first.", "the scan needs something to hear with");
  h.armory.push(newItem("handradio"));
  check(baseListens(st, h) && listeners(st).length === 1 && listeners(st)[0].base === h && canListen(st) && !hasNetwork(st), "a hand-crank radio in the armory listens; it is no network");
  check(radioNodes(st).length === 0 && !inCoverage(st, h.tile), "it adds no transmitter and no coverage");
  check(st.factions.every((f) => !canRadioGroup(st, f)), "no group can be called");
  check(near.length > 0 && near.every((f) => canHearGroup(st, f)) && far.every((f) => !canHearGroup(st, f)), `groups whose own network covers the hub are heard (${near.length}: ${near.map((f) => f.name).join(", ")}), the others not (${far.length})`);
  for (const f of st.factions) f.known = false;
  st.radioScanDay = -1;
  const text = radioScan(st);
  check(near.every((f) => f.known && f.heard) && far.every((f) => !f.known) && /New voices on the radio/.test(text) && /on their own channel: within earshot, not within call/.test(text), `the scan hears them: "${text.slice(0, 90)}…"`);
  check(near.every((f) => st.knowledge[f.bases[0]]), "their bases are on the map");
  check(st.factions.every((f) => !canRadioGroup(st, f)), "heard, still not callable");
  // Group news on the air (diplomacy.js news): logged when heard and one of them is known.
  const d = ensureDiplo(st);
  const before = st.log.length;
  news(st, "Test news: two groups made peace.", "info", [near[0]]);
  check(d.news[0].heard && st.log.length === before + 1 && /Test news/.test(st.log[0].text), "group news involving a known group is heard and logged");
  h.armory.length = 0;
  news(st, "Test news 2.", "info", [near[0]]);
  check(!d.news[0].heard && st.log.length === before + 1, "without the radio (and no station) the same news goes unheard");
  // The Groups tab's radio header renders with the radio and without a station.
  h.armory.push(newItem("handradio"));
  st.radioScanDay = -1; // not scanned today
  const html = groupsRadioHeader(st);
  check(/hand-crank radio listens \(hearing only\)/.test(html) && /rd-scan" (?!disabled)/.test(html) && !/undefined|NaN/.test(html), "the Groups tab says a hand-crank radio listens and offers the scan");
  // A listener hears a tile within a station's range of it (visitors.js sight): heardBy.
  const tileNear = st.tiles.find((t) => g.distance(h.tile, t.id) === RADIO_RANGE && t.terrain !== "water");
  const tileFar = st.tiles.find((t) => g.distance(h.tile, t.id) === RADIO_RANGE + 1 && t.terrain !== "water");
  check(tileNear && heardBy(st, tileNear.id) && tileFar && !heardBy(st, tileFar.id), `a tile ${RADIO_RANGE} tiles from the radio is within earshot, ${RADIO_RANGE + 1} is not`);
}

// ---------- 4. a team carrying one ----------
section("A team carrying one out of coverage: listening inside a group's network only (no band past coverage)");
{
  const { st, h } = world(0.3);
  h.radio = true; // a station at the hub: coverage RADIO_RANGE
  const g = st.grid;
  const range = radioNodes(st).find((n) => n.base === h).range;
  check(HEAR_EXTRA === 0, "no listening band beyond a network's coverage (HEAR_EXTRA 0)");
  const pick = (dist) => st.tiles.find((t) => g.distance(h.tile, t.id) === dist && t.terrain !== "water" && t.terrain !== "mountain" && !t.loc && !st.bases.some((b) => b.tile === t.id));
  const inside = pick(range - 2);
  const { inGroup: band, silent: beyond, f: f0 } = radioSpots(st, h, range + 1);
  check(inside && band && beyond && f0, `tiles found: in coverage (${range - 2}), in ${f0 && f0.name}'s network out of your coverage, outside every network`);
  const A = team(st, h, band.id, 2), B = team(st, h, beyond.id, 1), C = team(st, h, inside.id, 1), D = team(st, h, band.id, 1); // five of the hub's six
  check([A, B, C, D].every((t) => t.members.length >= 1), "every team has someone on it");
  A.members[0].pockets[0] = newItem("handradio");
  B.members[0].pockets[0] = newItem("handradio");
  C.p.cargo.gear.push(newItem("handradio"));
  check(teamListens(st, A.p) && teamListens(st, B.p) && teamListens(st, C.p) && !teamListens(st, D.p), "a radio in a pocket or the cargo makes a team a listener; D has none");
  check(listeners(st).length === 2 && listeners(st).every((l) => l.party === A.p || l.party === C.p) && radioNodes(st).length === 1 && !inCoverage(st, band.id), "listeners on the air: A (a group's network) and C (yours); B hears nothing; the hub's station is not one; coverage is still the one station");
  // Just past your coverage (where the old band was) and in no group's network: nothing.
  const edge = st.tiles.find((t) => g.distance(h.tile, t.id) === range + 2 && t.terrain !== "water" && !t.loc && networksAt(st, t.id).length === 0);
  if (edge) check(!inCoverage(st, edge.id), `a tile ${range + 2} tiles out (the old band) in no group's network: silence`);
  log(st, "Test alarm: a horde is coming.", "danger");
  for (const t of [A, B, C, D]) t.p.lastConflict = st.hour;
  tickHour(st);
  for (const c of [...st.cards]) if (!c.isOrders) st.cards.splice(st.cards.indexOf(c), 1);
  check(A.p.radioHear === true && A.p.radioLive === false && !commandable(st, A.p), "A (radio, in a group's network): listening, not live, not commandable");
  check(!(A.p.heard && A.p.heard.some((x) => /Test alarm/.test(x.text))), "A does not pick up your station's news out past your coverage (no band)");
  check(B.p.radioHear === false && !B.p.radioLive && !commandable(st, B.p) && !B.p.heard, "B (radio, outside every network): hears nothing, not in contact");
  check(C.p.radioLive === true && C.p.radioHear === false && commandable(st, C.p), "C (radio, in coverage): live as any team there, two-way (the radio changes nothing)");
  check(D.p.radioHear === false && !D.p.radioLive && !commandable(st, D.p), "D (no radio, in the network): out of contact, no listening state");
  check(!inCoverage(st, band.id) && !inCoverage(st, beyond.id), "the teams' radios gave nobody coverage");
  // The team card says so.
  const ui = { tab: "teams", moveParty: null, expedition: null, selected: null, hover: null };
  let html = "";
  try { html = renderLeft(st, ui) || ""; } catch (e) { html = `ERR ${e.message}`; }
  check(typeof html === "string" && !/^ERR/.test(html) && html.includes(HAND_RADIO), `the Teams tab shows "${HAND_RADIO}" for A${/^ERR/.test(html) ? ` (${html})` : ""}`);
  // The radio drops out of the pocket: the state goes with it.
  A.members[0].pockets[0] = null;
  A.p.lastConflict = st.hour;
  tickHour(st);
  check(A.p.radioHear === false, "without the radio the listening state ends");
}

// ---------- 5. tablets on the road ----------
section("Purification tablets on the road: one per 10 un-purified water drunk, no worm roll on what they cover");
{
  const { st, h } = world(0.9);
  const tile = st.grid.neighbors(h.tile)[0];
  const { p, members } = team(st, h, tile, 2);
  p.supplies.water = 0; p.supplies.rawwater = 20;
  addWormWater(st, p, 20, 1);
  check(p.wormEggs === 1 && p.supplies.rawwater === 20, "the team carries 20 un-purified water with eggs");
  // drinkHour runs after the hour's water left the supplies: `drink` leaves `have` − q un-purified water, all of it with
  // eggs, and drinks q of it un-purified (every unit drunk is unsafe).
  const drink = (q, have = 20) => { p.wormEggs = 1; p.supplies.water = 0; p.supplies.rawwater = have - q; drinkHour(st, p, members, q, q); };
  // Without tablets: WATER pinned (24: sure within the hour), eggs 1, every unit drunk has eggs: someone catches it within a few drinks.
  let n = withNums(WORM, { WATER: 24 }, () => { for (let i = 0; i < 12 && caught(members) === 0; i++) drink(1); return caught(members); });
  check(n > 0, `without tablets they catch it (${n} of 2 within 12 drinks of water with eggs)`);
  clearAll(members);
  const tube = newItem("puritabs");
  members[1].pockets[2] = tube;
  check(teamTabCount(st, p) === 10, "a tube of 10 in a pocket counts for the team");
  const used0 = st.log.length;
  n = withNums(WORM, { WATER: 1 }, () => { drink(5); return caught(members); });
  check(n === 0 && tube.dur === 9 && p.tabWater === 5, `5 water drunk: a tablet opened (9 left), 5 of its 10 water kept for the next drink, nobody caught it (tabWater ${p.tabWater})`);
  check(st.log.length === used0 + 1 && /dropped a purification tablet into the un-purified water \(9 left\)/.test(st.log[0].text), `logged: "${st.log[0].text}"`);
  n = withNums(WORM, { WATER: 1 }, () => { drink(5); return caught(members); });
  check(n === 0 && tube.dur === 9 && p.tabWater === 0, "5 more: the rest of that tablet, no new one");
  n = withNums(WORM, { WATER: 1 }, () => { drink(5); return caught(members); });
  check(n === 0 && tube.dur === 8 && p.tabWater === 5, "5 more: the second tablet");
  p.supplies.rawwater = 20; p.wormEggs = 1;
  check(/dropping a tablet in it: 8 purification tablets carried, one per 10 water/.test(teamWormText(st, p)), `the team panel: "${teamWormText(st, p)}"`);
  // The whole tube: 100 water. Nobody catches it; the tube is gone when the last tablet is used.
  n = withNums(WORM, { WATER: 1 }, () => { for (let i = 0; i < 17; i++) drink(5); return caught(members); });
  check(n === 0 && teamTabCount(st, p) === 0 && members[1].pockets[2] === null && p.tabWater === 0 && p.tabsUsed === 10, `100 water drunk on the tube: 10 tablets used, the empty tube gone from the pocket, nobody caught it (tabsUsed ${p.tabsUsed}, tabWater ${p.tabWater})`);
  check(/the last of them/.test(st.log[0].text), `the last tablet's line: "${st.log[0].text}"`);
  n = withNums(WORM, { WATER: 24 }, () => { for (let i = 0; i < 12 && caught(members) === 0; i++) drink(1); return caught(members); });
  check(n > 0, "with the tube empty the dice are back");
  clearAll(members);
  // A tube in the cargo works too, and a part-used one is treated at face value: its last tablet covers 10 of 15.
  const half = newItem("puritabs"); half.dur = 1;
  p.cargo.gear.push(half);
  n = withNums(WORM, { WATER: 0 }, () => { drink(15); return caught(members); });
  check(p.cargo.gear.length === 0 && p.tabWater === 0 && n === 0, "a last tablet in the cargo covers 10 of 15 water and the empty tube is gone from the cargo (the 5 left over are rolled: WATER pinned to 0 here)");
  // Purified water drunk needs nothing: no tablet for it.
  p.cargo.gear.push(newItem("puritabs"));
  p.wormEggs = 1; p.supplies.rawwater = 10; p.supplies.water = 5;
  drinkHour(st, p, members, 5, 0);
  check(teamTabCount(st, p) === 10, "purified water drunk: no tablet used");
  // A water filter carried makes the tablets moot (it strains what is drunk).
  p.cargo.gear.push(newItem("waterfilter"));
  n = withNums(WORM, { WATER: 1 }, () => { drink(5); return caught(members); });
  check(n === 0 && teamTabCount(st, p) === 10, "with a water filter carried the water is clean and no tablet is used");
}

// ---------- 6. tablets at a base ----------
section("Purification tablets at a base: never used (they are for the road)");
{
  const { st, h } = world(0.9);
  const people = residents(st, h.id);
  const N = people.length;
  Object.assign(h.stock, { water: 0, rawwater: 300 });
  let w = baseWater(st, h);
  check(!w.safe && w.eggs > 0.5 && w.ground === 1 && w.rawShare === 1, `no boiler, no filter, only un-purified water: unsafe (${w.why})`);
  h.armory.push(newItem("puritabs"), newItem("puritabs"));
  w = baseWater(st, h);
  check(!w.safe && !/tablet/.test(w.why) && baseTabCount(st, h) === 20, `two tubes in the armory change nothing (${w.why})`);
  // The day's drinking was all un-purified (economy.js baseDaily records it): rolled, and no tablet opened.
  h.drank = { day: day(st), pure: 0, raw: N };
  const n = withNums(WORM, { WATER: 1 }, () => { wormDaily(st); return caught(people); });
  check(n > 0 && baseTabCount(st, h) === 20 && !(h.tabsUsed > 0), `a day drinking un-purified water at WATER 100%: ${n} of ${N} caught it, all 20 tablets still in the armory`);
  check(!st.log.some((l) => /Purification tablets kept the water safe/.test(l.text)), "no tablet line in the log");
  // What a team packs here: un-purified water carries the base's eggs; a team leaving can pack a tube (packTablets).
  clearAll(people);
  const tile = st.grid.neighbors(h.tile)[0];
  const { p } = team(st, h, tile, 1);
  p.supplies = { food: 5, water: 0, rawwater: 10 };
  packWater(st, p, h);
  check(p.wormEggs > 0.5, `un-purified water packed here carries the eggs (${p.wormEggs}): the team needs its own way to purify it`);
  const t = packTablets(st, h, p);
  check(t && p.cargo.gear.includes(t) && baseTabCount(st, h) === 10 && teamTabCount(st, p) === 10, "packTablets moves one tube from the armory into the team's cargo");
  check(packTablets(st, h, p) === null && baseTabCount(st, h) === 10, "a team that carries tablets takes no second tube");
}

// ---------- 7. the hardcore prepper ----------
section("The hardcore prepper fled with both");
{
  let found = 0, tried = 0;
  for (let s = 1; s < 400 && found < 4; s++) {
    const st = createWorld({ seed: s, factionCount: 7, mode: "hardcore" });
    tried++;
    if (st.hardcore.start.prepper == null) continue;
    found++;
    const p = roadTeam(st);
    const pr = st.survivors.find((x) => x.id === st.hardcore.start.prepper);
    const onThem = [pr.gear.tool, pr.gear.weapon, ...(pr.pockets || []), ...((pr.gear.backpack && pr.gear.backpack.contents) || [])].filter(Boolean);
    check(onThem.some((it) => it.key === "handradio") && onThem.some((it) => it.key === "puritabs" && tabsOf(it) === 10) && pr.gear.tool && pr.gear.tool.key === "waterfilter", `seed ${s}: the prepper carries a hand-crank radio, a full tube of tablets and the water filter in hand`);
    check(teamListens(st, p) && teamTabCount(st, p) === 10, `seed ${s}: the road team listens and has 10 tablets`);
    const line = st.log.find((l) => /was a prepper/.test(l.text));
    check(!!line && /a hand-crank radio/.test(line.text) && /purification tablets/.test(line.text), `seed ${s}: day 1's log names them ("…${line && line.text.slice(-80)}")`);
  }
  check(found >= 3, `${found} prepper starts in ${tried} seeds`);
}

// ---------- 8. save and load ----------
section("Save and load");
{
  const { st, h } = world(0.9);
  h.radio = true;
  h.armory.push(newItem("puritabs"), newItem("handradio"));
  const tube = h.armory.find((it) => it.key === "puritabs"); tube.dur = 7;
  h.tabWater = 3;
  const g = st.grid;
  const range = radioNodes(st).find((n) => n.base === h).range;
  const band = radioSpots(st, h, range + 1).inGroup; // in a group's network, out of your coverage
  const { p, members } = team(st, h, band.id, 1);
  members[0].pockets[0] = newItem("handradio");
  const t2 = newItem("puritabs"); t2.dur = 4; p.cargo.gear.push(t2);
  p.tabWater = 6; p.tabsUsed = 2;
  p.heard = [{ day: 0, net: 1, name: "Test", text: "Test line 2." }];
  p.lastConflict = st.hour;
  tickHour(st);
  for (let i = st.cards.length - 1; i >= 0; i--) st.cards.splice(i, 1);
  check(p.radioHear === true && p.heard && p.heard.length > 0, "before the save: the team listens and heard a line");
  const ld = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const h2 = hub(ld), p2 = ld.parties.find((x) => x.id === p.id);
  check(h2.armory.some((it) => it.key === "puritabs" && it.dur === 7) && h2.armory.some((it) => it.key === "handradio") && h2.tabWater === 3, "the base's tube (7 left), radio and the rest of the open tablet come back");
  check(p2 && p2.radioHear === true && JSON.stringify(p2.heard) === JSON.stringify(p.heard) && p2.tabWater === 6 && p2.tabsUsed === 2 && p2.cargo.gear.some((it) => it.key === "puritabs" && it.dur === 4), "the team's listening state, heard lines, tablets and the open tablet's water come back");
  check(baseWater(ld, h2).tabs === undefined || baseWater(ld, h2).why === baseWater(st, h).why, `the loaded base reads its water the same (${baseWater(ld, h2).why})`);
  check(teamListens(ld, p2) && teamTabCount(ld, p2) === 4, "and the loaded team listens with 4 tablets");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fail ? 1 : 0);
