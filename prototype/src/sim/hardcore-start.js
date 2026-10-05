// Hardcore mode, your start (hardcore.js): the day Calder falls, three survivors on the road with whatever they grabbed
// as they fled, very low supplies and no hub.
//
// - Spawn: a random open land tile (no site on it), reasonably central, away from the outbreak (its origin, the city
//   where the first hive rises and the hives mapgen placed), the cities, the military sites and the other groups, with a town or a few sites within a
//   day or two's walk (somewhere to scavenge and to settle).
// - What they grabbed: each survivor fled with a bag (a school backpack, a sling bag, now and then a hiking pack) and a
//   few things in it, or with only their clothes and pockets (0–4 small things). Maybe a weapon from the house: a kitchen
//   knife, a bat, a crowbar, a pistol with a few rounds. The team's food and water (pooled, like any team's) come from
//   what they carried: 1–3 days' worth for three. Almost no ammo, no fuel, no vehicle.
// - The team is on the road (a state.parties entry, like the exiles in conquest.js): no base, no home to return to.
//   You are with them, so they always report and take orders (radio contact without a radio).
// - The first hub: Build outpost becomes Establish base, a staging camp the team brings materials to and then builds
//   up over a few days (staging.js STAGING.HARDCORE). It becomes the hub, empty: no buildings, no truck. Losing that
//   hub later is the normal game's exile (conquest.js): a new staging camp (a little cheaper), later outposts the
//   usual 15 scrap.
// Everything here runs only in a hardcore world (hardcore.js isHardcore).
import { GEAR, SUPPLY_KEYS } from "./data.js";
import { newId, makeSurvivor, applyCrew, assignStartingRoles, log, day, hub, addCard } from "./world.js";
import { newItem, packOf, POCKETS } from "./inventory.js";
import { sightRadius, partyMembers, partyTile, awaitOrders, weighTeam } from "./parties.js";
import { isHardcore } from "./hardcore.js";
import { hcOutbreakCity } from "./hardcore-outbreak.js";
import { STAGING, ESTABLISH_LABEL, needText } from "./staging.js";

export const HC_START = {
  CREW: 3,
  // Spawn: tiles from the outbreak origin, the hives, a city centre, a military site and a group's base (strict, then
  // relaxed if no tile qualifies); the share of the map kept clear of the edges; a town (or SITES_NEAR sites) within
  // TOWN_REACH tiles.
  // outbreakCity: from the centre of the city where the first hive rises (hardcore-outbreak.js hcOutbreakCity).
  SPAWN: { origin: [14, 9], hive: [8, 5], city: [6, 4], outbreakCity: [14, 10], military: [7, 4], group: [6, 4], edge: [0.2, 0.12], townReach: 8, sitesNear: 3, siteReach: 6, maxInfection: 0.35 },
  // What they grabbed. PACK: the chance someone fled with a bag; which bag (weights); how many things in it.
  PACK: 0.5,
  PACKS: { backpack: 5, slingbag: 3, hikingpack: 1 },
  PACK_ITEMS: [2, 5],
  POCKET_ITEMS: [0, 4],
  // A weapon from the house: the chance with a bag / with only pockets, and which (weights). A gun comes with a few rounds.
  WEAPON: { pack: 0.65, pockets: 0.4 },
  WEAPONS: { knife: 6, bat: 3, prybar: 1.5, pistol: 1.2, machete: 0.8, revolver: 0.5, huntrifle: 0.3 },
  ROUNDS: { pistol: [3, 12], revolver: [2, 6], huntrifle: [2, 5] },
  // Small things in pockets (weights; all GEAR keys with small: true) and more in a bag (any non-bulky item).
  POCKET_STUFF: { phone: 4, lighters: 3, flashlight: 2, photos: 3, chocolate: 2, candy: 2, smokes: 1.5, batteries: 1.5, bandagekit: 1, goldring: 0.8, watch: 0.6, tobacco: 0.5, tea: 0.4, cards: 0.6, harmonica: 0.3, monocular: 0.2, coins: 0.3 },
  PACK_STUFF: { flashlight: 3, bandagekit: 3, chocolate: 2, candy: 1.5, instcoffee: 1, novel: 1.2, toiletpaper: 1.2, soap: 1, candles: 1, batteries: 1.5, lighters: 1.5, photos: 1, whiskey: 0.6, vodka: 0.5, laptop: 0.4, magazines: 0.6, cards: 0.6, binoculars: 0.3, survivalbook: 0.3, medbook: 0.2, gardenbook: 0.2, fishrod: 0.3, snarewire: 0.3, stove: 0.15, waterfilter: 0.15 },
  // Food and water each one brings (a bag holds more), clamped for the team to 1–3 days for three (TEAM_MIN..TEAM_MAX).
  FOOD: { pack: [1, 3], pockets: [0, 1] },
  WATER: { pack: [1, 3], pockets: [0, 1] },
  TEAM_MIN: 3, TEAM_MAX: 9,
  MEDS: { pack: 0.35 }, // a bottle of pills in the bag
  // The first hub: a staging camp (staging.js STAGING.HARDCORE: what it takes and the days of work).
};

const r1 = (v) => Math.round(v * 10) / 10;
const firstName = (s) => s.name.split(" ")[0];

// ---------- the contract with the other parts ----------
// The tile the player is at: the hub, else the team on the road (the first team of yours), else where you started.
export function playerTile(state) {
  const h = hub(state);
  if (h) return h.tile;
  if (state.bases.length) return state.bases[0].tile;
  const p = roadTeam(state) || state.parties.find((q) => q.owner === "player" && q.kind !== "convoy" && partyMembers(state, q).length);
  if (p) return partyTile(p);
  const hc = state.hardcore && state.hardcore.start;
  return hc ? hc.lastTile ?? hc.tile : state.originId;
}

// True while a hardcore run has not founded its first hub yet (later, a hub lost is the normal game's exile).
export const firstHubPending = (state) => isHardcore(state) && !!(state.hardcore && state.hardcore.start) && state.hardcore.start.foundedDay == null;
// The team on the road before the first hub (you are with it): the player team that carries the start's flag, else any.
export function roadTeam(state) {
  if (!firstHubPending(state)) return null;
  const mine = state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy" && partyMembers(state, p).length);
  return mine.find((p) => p.hcStart) || mine[0] || null;
}
// You are with this team (before the first hub): it always reports and takes orders, and you see what it sees.
export const withYou = (state, p) => firstHubPending(state) && !!p && p.owner === "player" && p.kind !== "convoy";

// ---------- founding the first hub ----------
// The first hub is a staging camp built up over days (staging.js: Establish base, the materials, the work). When it
// is done, staging.js has made the base (type "hub": there is none) and moved the people in; this marks the day.
// when: how long the camp took ("4 days after the camp went up").
export function hubFounded(state, base, when = "") {
  const hc = state.hardcore.start;
  hc.foundedDay = day(state);
  hc.foundedHour = state.hour;
  hc.hubTile = base.tile;
  base.name = base.name.replace(/ Outpost( \d+)?$/, " Holdout");
  if (state.bases.some((b) => b !== base && b.name === base.name)) base.name = `${base.name} ${base.id}`;
  base.hcFirst = true;
  assignStartingRoles(state); // jobs by skill, as a normal start does (world.js)
  const text = `Day ${day(state)}: the staging camp is done. ${base.name} is founded, your first hub${when ? `, ${when}` : ""}. It is bare: no buildings yet, a barricade of scrap and the camp's stores. Build farm plots, a well and beds before the cold.`;
  log(state, text, "good");
  addCard(state, { title: "A place of your own", text, choices: [{ label: "OK", resolve: () => "" }] });
}

// ---------- the spawn ----------
function spawnTile(state) {
  const g = state.grid, rng = state.rng, S = HC_START.SPAWN;
  const W = g.width, H = g.height;
  const hives = state.tiles.filter((t) => t.hive).map((t) => t.id);
  const groupBases = state.factions.flatMap((f) => f.bases || []);
  const within = (id, list, d) => list.some((x) => x != null && g.distance(id, x) <= d);
  const towns = state.tiles.filter((t) => t.loc && t.loc.type === "town").map((t) => t.id);
  const outbreakCity = hcOutbreakCity(state); // the first hive rises there (set up after the start)
  const sitesOk = (id) => {
    if (towns.some((x) => g.distance(id, x) <= S.townReach)) return true;
    return state.tiles.filter((t) => t.loc && t.loc.type !== "city" && g.distance(id, t.id) <= S.siteReach).length >= S.sitesNear;
  };
  const okFor = (strict) => (t) => {
    const i = strict ? 0 : 1;
    if (t.terrain === "water" || t.terrain === "mountain" || t.terrain === "city" || t.hive || t.loc) return false;
    const e = S.edge[i];
    if (t.x < W * e || t.x >= W * (1 - e) || t.y < H * e || t.y >= H * (1 - e)) return false;
    if (g.distance(t.id, state.originId) < S.origin[i] || within(t.id, hives, S.hive[i])) return false;
    if (outbreakCity != null && g.distance(t.id, outbreakCity) < S.outbreakCity[i]) return false;
    if (within(t.id, state.cityIds || [], S.city[i]) || g.neighbors(t.id).some((n) => state.tiles[n].terrain === "city")) return false;
    if (within(t.id, state.militaryIds || [], S.military[i]) || within(t.id, groupBases, S.group[i])) return false;
    if ((t.infection || 0) > S.maxInfection * (strict ? 1 : 1.5)) return false;
    return sitesOk(t.id);
  };
  for (const strict of [true, false]) {
    const cands = state.tiles.filter(okFor(strict));
    if (cands.length) return rng.pick(cands);
  }
  const land = state.tiles.filter((t) => t.terrain !== "water" && t.terrain !== "mountain" && !t.hive);
  return rng.pick(land);
}

// ---------- what they grabbed ----------
const pickW = (rng, table) => rng.weighted(Object.keys(table), (k) => table[k]);
// One survivor's flight: their bag (or none), weapon, things, and what they add to the team's food, water, ammo, meds.
export function rollGrab(state, s) {
  const rng = state.rng, C = HC_START;
  const bag = rng.chance(C.PACK);
  const got = { bag: null, weapon: null, items: [], food: 0, water: 0, ammo: 0, meds: 0 };
  if (bag) {
    const pk = newItem(pickW(rng, C.PACKS), Math.round(rng.range(0.7, 1) * 100) / 100);
    s.gear.backpack = pk;
    got.bag = pk;
  }
  if (rng.chance(bag ? C.WEAPON.pack : C.WEAPON.pockets)) {
    let w = pickW(rng, C.WEAPONS);
    if (!bag && !GEAR[w].small && rng.chance(0.5)) w = "knife"; // running with only pockets: more often a knife than a rifle
    s.gear.weapon = newItem(w, Math.round(rng.range(0.6, 1) * 100) / 100);
    got.weapon = s.gear.weapon;
    const rr = C.ROUNDS[w];
    if (rr) got.ammo += rng.int(rr[0], rr[1]);
  }
  // Pockets first (small things), then the bag.
  const nPockets = Math.min(POCKETS, rng.int(C.POCKET_ITEMS[0], C.POCKET_ITEMS[1]));
  for (let i = 0; i < nPockets; i++) {
    const key = pickW(rng, C.POCKET_STUFF);
    const item = newItem(key, 1);
    const at = s.pockets.indexOf(null);
    if (at < 0) break;
    s.pockets[at] = item;
    got.items.push(item);
  }
  if (bag) {
    const n = rng.int(C.PACK_ITEMS[0], C.PACK_ITEMS[1]);
    for (let i = 0; i < n; i++) {
      const key = pickW(rng, C.PACK_STUFF);
      const item = newItem(key, 1);
      // A tool goes in the off hand if it is free (a flashlight, a bandage kit), else in the bag.
      if (GEAR[key].slot === "tool" && !s.gear.tool) s.gear.tool = item;
      else {
        const at = packOf(s).indexOf(null);
        if (at < 0) break;
        packOf(s)[at] = item;
      }
      got.items.push(item);
    }
    if (rng.chance(C.MEDS.pack)) got.meds += 1;
  }
  const f = bag ? C.FOOD.pack : C.FOOD.pockets, w = bag ? C.WATER.pack : C.WATER.pockets;
  got.food += rng.int(f[0], f[1]);
  got.water += rng.int(w[0], w[1]);
  return got;
}

// "a, b and c", with repeats counted ("family photos (2)").
function listOf(items) {
  const counts = new Map();
  for (const it of items) counts.set(it.name.toLowerCase(), (counts.get(it.name.toLowerCase()) || 0) + 1);
  const words = [...counts].map(([w, n]) => (n > 1 ? `${w} (${n})` : w));
  return words.length <= 1 ? words : [`${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`];
}
function grabLine(s, got) {
  const things = listOf(got.items);
  const who = firstName(s);
  const weapon = got.weapon ? `${/^[aeiou]/i.test(got.weapon.name) ? "an" : "a"} ${got.weapon.name.toLowerCase()}${got.ammo ? ` (${got.ammo} rounds)` : ""}` : "";
  if (got.bag) return `${who} grabbed a ${got.bag.name.toLowerCase()}${things.length ? ` with ${things.join(", ")}` : ""}${weapon ? `, and ${weapon}` : ""}.`;
  return `${who} ran with only the clothes on their back${things.length ? ` and ${things.join(", ")} in their pockets` : " and empty pockets"}${weapon ? `, and ${weapon}` : ""}.`;
}

// ---------- setup (hardcore.js hardcoreCreate) ----------
export function setupHardcoreStart(state, crew) {
  state.hardcore = state.hardcore || {};
  const tile = spawnTile(state);
  const people = [];
  for (let i = 0; i < HC_START.CREW; i++) {
    const s = makeSurvivor(state, i === 0 ? 1.3 : 1);
    state.survivors.push(s);
    people.push(s);
  }
  people[0].leader = true;
  if (crew) applyCrew(state, crew);
  if (!people.some((s) => s.leader)) people[0].leader = true; // the crew's leader was one of the six of a normal start
  // What each one grabbed.
  const sup = {};
  for (const k of SUPPLY_KEYS) sup[k] = 0;
  const lines = [];
  for (const s of people) {
    const got = rollGrab(state, s);
    sup.food += got.food;
    sup.water += got.water;
    sup.ammo += got.ammo;
    sup.meds += got.meds;
    lines.push(grabLine(s, got));
  }
  sup.food = Math.max(HC_START.TEAM_MIN, Math.min(HC_START.TEAM_MAX, sup.food));
  sup.water = Math.max(HC_START.TEAM_MIN, Math.min(HC_START.TEAM_MAX, sup.water));
  const p = {
    id: newId(), owner: "player", kind: "expedition", mission: "move", teamMission: "flee", dest: tile.id, homeBaseId: null,
    members: people.map((s) => s.id), stance: "normal", vehicle: false, vehicleId: null, supplies: sup, cargo: { supplies: {}, gear: [] },
    path: [tile.id], idx: 0, progress: 0, phase: "waiting", seen: new Map(), spotted: new Map(), sightNow: [], radioLive: true,
    departed: state.hour, plannedHours: 0, eventsSeen: 0, orders: [], orderStart: state.hour,
    planPath: [tile.id], planStart: state.hour, planVehicle: false, planFuel: 0, etaOut: 0, etaBack: null,
    exile: true, hcStart: true,
  };
  for (const s of people) { s.location = { kind: "party", partyId: p.id }; s.role = "scavenge"; s.station = null; }
  state.parties.push(p);
  p.sightNow = state.grid.within(tile.id, sightRadius(state, p));
  state.hardcore.start = { tile: tile.id, lastTile: tile.id, foundedDay: null, grabbed: lines };
  // The run opens on the team's orders card: what they grabbed, and what the first hub takes.
  weighTeam(state, p);
  const intro = `Calder is falling. ${lines.join(" ")} Between you: ${Math.floor(sup.food)} food, ${Math.floor(sup.water)} water${sup.ammo ? `, ${Math.floor(sup.ammo)} rounds` : ""}${sup.meds ? `, ${Math.floor(sup.meds)} meds` : ""}. Find food and water first, then pick a good spot and give the order ${ESTABLISH_LABEL}: a staging camp you bring ${needText(STAGING.HARDCORE.needs)} to, then build up into your hub over a few days.`;
  awaitOrders(state, p, intro, { title: "The day Calder fell" });
  return p;
}

// Once a day (hardcore.js hardcoreDaily): where the team is, for playerTile once nobody is left on the road.
export function hardcoreStartDaily(state) {
  const hc = state.hardcore && state.hardcore.start;
  if (!hc || hc.foundedDay != null) return;
  const p = roadTeam(state);
  if (p) hc.lastTile = partyTile(p);
  hc.daysOnRoad = day(state) - 1;
}

// Tiles near the team worth founding on (the autopilot and the tile panel hint): open or a farm, not owned, not a hive,
// low infection, water beside or near, sites around. Best first.
export function hubSites(state, from, radius = 6) {
  const g = state.grid;
  const out = [];
  for (const id of g.within(from, radius)) {
    const t = state.tiles[id];
    if (t.terrain === "water" || t.terrain === "mountain" || t.terrain === "city" || t.hive) continue;
    if (t.owner != null && t.owner !== "player") continue;
    if (state.factions.some((f) => f.alive && f.bases.includes(id)) || state.bases.some((b) => b.tile === id)) continue;
    const water = g.within(id, 1).some((n) => state.tiles[n].terrain === "water") ? 3 : g.within(id, 3).some((n) => state.tiles[n].terrain === "water") ? 1 : 0;
    const sites = g.within(id, 4).filter((n) => state.tiles[n].loc && state.tiles[n].loc.type !== "city").length;
    const kind = t.loc ? ({ farm: 2.5, ranch: 2, town: 1.5, church: 1.5, school: 1.2, motel: 1, barn: 1, feedstore: 1, prison: 1.5, cabin: 1, lodge: 1, ranger: 1 }[t.loc.type] ?? 0.5) : 0;
    const danger = (t.infection || 0) * 8 + (g.within(id, 3).some((n) => state.tiles[n].hive) ? 6 : 0);
    const sc = water + Math.min(4, sites * 0.6) + kind - danger - g.distance(from, id) * 0.35;
    out.push({ id, sc: r1(sc), water, sites });
  }
  return out.sort((a, b) => b.sc - a.sc || a.id - b.id);
}
