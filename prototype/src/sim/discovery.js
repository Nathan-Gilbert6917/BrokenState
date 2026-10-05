// Which sites the player knows about (hidden sites).
//
// Before the fall everyone knew where the towns, the cities, the malls, the hospitals and the gas stations were:
// those are on the map from day 1. A hunting lodge at the end of a logging track, a farmstead in the hills or the
// wreck of a helicopter are not: they stay off the map until your people find them. The rule is in data.js
// (LOCATIONS[type].known):
//   "public"  known wherever it stands (towns, cities and their shops, landmarks, the airport, Guard bases, truck stops)
//   "road"    known when it stands on a road or next to one (within 1 tile), hidden otherwise (farms, barns, ranches,
//             cabins, lodges, campgrounds, ranger stations, radio towers, quarries)
//   "secret"  always hidden until found (crash sites, wrecks, supply drops)
// A hidden site is discovered once the player has any intel on its tile (state.knowledge[tile], or the tile in view
// now): seen by a base, a watchtower or a team (a team out of radio range brings it home), or reported (radio news,
// an explorer's map, intel bought or given as a job reward, a prisoner questioned, a coalition member's report).
// Knowledge is never taken away, so once found it stays on the map, and it is saved with the rest of the state.
// Until then the map does not draw it (no icon, name or skulls), tooltips and the tile panel show bare ground, it is
// not offered as a target (planner, right-click, plan presets, crews, the autopilot) and text names the ground
// instead (tileLabel). The timelapse replay (chronicle.js) is a god view: it shows every site.
//
// state.foundSites: the hidden sites already announced (tile ids, in order), so each discovery gets one log line;
// worked out from the knowledge for a save made before this existed. Nothing here uses random numbers.
import { LOCATIONS } from "./data.js";
import { log } from "./world.js";
import { teamName, partyTile } from "./parties.js";

// ---------- classification (static: the tiles and roads never change) ----------
const roadMemo = new WeakMap(); // tiles array -> Uint8Array (1 near a road, 2 not)
export function nearRoad(state, id) {
  let m = roadMemo.get(state.tiles);
  if (!m) roadMemo.set(state.tiles, (m = new Uint8Array(state.tiles.length)));
  if (!m[id]) {
    const t = state.tiles[id];
    m[id] = t.road || state.grid.neighbors(id).some((n) => state.tiles[n] && state.tiles[n].road) ? 1 : 2;
  }
  return m[id] === 1;
}

// A site everyone knew about before the fall (on the map from the start).
export function isPublicSite(state, id) {
  const t = state.tiles[id];
  if (!t || !t.loc) return false;
  const def = LOCATIONS[t.loc.type];
  const k = def ? def.known || "public" : "public";
  if (t.loc.crash != null) return false; // a wreck is never on a pre-war map
  return k === "public" || (k === "road" && nearRoad(state, id));
}

// The tiles with a hidden site (not crash wrecks: they come and go, crashes.js puts them on the map when found).
const hiddenMemo = new WeakMap();
export function hiddenSites(state) {
  let list = hiddenMemo.get(state.tiles);
  if (!list) {
    list = [];
    for (const t of state.tiles) if (t.loc && t.loc.crash == null && !isPublicSite(state, t.id)) list.push(t.id);
    hiddenMemo.set(state.tiles, list);
  }
  return list;
}

// ---------- what the player knows ----------
// Does the player know there is a site on this tile? The timelapse replay shows every site.
export function siteKnown(state, id) {
  const t = state.tiles[id];
  if (!t || !t.loc) return false;
  if (state.timelapse || isPublicSite(state, id)) return true;
  return !!(state.knowledge && state.knowledge[id]) || !!(state.live && state.live.has(id));
}
// Known to the hub's map or to team p (a team out of radio range knows what it has seen; p null: the hub only).
export const siteKnownTo = (state, id, p = null) => siteKnown(state, id) || !!(p && p.seen && p.seen.has(id));
// Known to the hub or any of your teams: a site that text may name (parties.js tileLabel).
export function siteNamed(state, id) {
  if (siteKnown(state, id)) return true;
  for (const q of state.parties || []) if (q.owner === "player" && q.seen && q.seen.has(id)) return true;
  return false;
}
// The site as the player may see it, or null.
export const knownLoc = (state, id) => (siteKnown(state, id) ? state.tiles[id].loc : null);

// ---------- discovery log ----------
function foundSet(state) {
  if (!state.foundSites) state.foundSites = hiddenSites(state).filter((id) => siteKnown(state, id)); // a save from before
  let memo = foundMemo.get(state.foundSites);
  if (!memo || memo.n !== state.foundSites.length) {
    memo = { set: new Set(state.foundSites), n: state.foundSites.length };
    foundMemo.set(state.foundSites, memo);
  }
  return memo;
}
const foundMemo = new WeakMap();

const article = (s) => (/^[aeiou]/i.test(s) ? "an " : "a ") + s;
// Where it lies, as the people who found it would put it.
function whereText(state, id) {
  const t = state.tiles[id];
  if (nearRoad(state, id)) return "just off the road";
  return { forest: "deep in the woods", hills: "back in the hills", mountain: "up in the mountains", plains: "out past the fields", suburb: "behind the houses" }[t.terrain] || "off the road";
}
const siteText = (state, id) => `${article(LOCATIONS[state.tiles[id].loc.type].name.toLowerCase())} ${whereText(state, id)}`;

// Hidden sites among ids that the player now knows and has not been told about: one log line for them.
// how: { party } a team's report (found: it is there now), { base } seen from a base, null news from elsewhere.
export function noteFinds(state, ids, how = null) {
  if (!state.knowledge || !state.tiles) return [];
  const memo = foundSet(state);
  const hidden = hiddenSet(state);
  const fresh = [];
  for (const id of ids) {
    if (!hidden.has(id) || memo.set.has(id) || !siteKnown(state, id)) continue;
    memo.set.add(id);
    state.foundSites.push(id);
    memo.n = state.foundSites.length;
    fresh.push(id);
  }
  if (fresh.length) announce(state, fresh, how);
  return fresh;
}
const hiddenSetMemo = new WeakMap();
function hiddenSet(state) {
  let s = hiddenSetMemo.get(state.tiles);
  if (!s) hiddenSetMemo.set(state.tiles, (s = new Set(hiddenSites(state))));
  return s;
}
// Every hour: anything reported by other means (radio, maps, intel, prisoners, the coalition) since the last look.
export function discoveryHour(state) {
  noteFinds(state, hiddenSites(state), null);
}

// One log line for a batch of finds. (The first look at a run, the hub's view on day 1 or a save from before foundSites,
// is taken quietly by foundSet.)
function announce(state, ids, how) {
  const names = ids.map((id) => state.tiles[id].loc.name);
  const p = how && how.party;
  if (p) {
    const here = state.parties.includes(p) ? partyTile(p) : null; // home already: it brought the news back
    const close = here != null && ids.every((id) => state.grid.distance(here, id) <= 4);
    const who = teamName(state, p);
    if (ids.length === 1) log(state, `🧭 ${who} ${close ? "found" : "brought word of"} ${siteText(state, ids[0])}: ${names[0]}. It is on the map now.`, "good");
    else log(state, `🧭 ${who} ${close ? "found" : "brought word of"} ${ids.length} places off the map: ${ids.map((id, i) => `${names[i]} (${LOCATIONS[state.tiles[id].loc.type].name.toLowerCase()})`).join(", ")}.`, "good");
    return;
  }
  if (how && how.base) {
    const who = `Lookouts at ${how.base.name}`;
    if (ids.length === 1) log(state, `🧭 ${who} spotted ${siteText(state, ids[0])}: ${names[0]}. It is on the map now.`, "good");
    else log(state, `🧭 ${who} spotted ${ids.length} places off the map: ${names.join(", ")}.`, "good");
    return;
  }
  if (ids.length === 1) log(state, `🧭 Word reached you of ${siteText(state, ids[0])}: ${names[0]}. It is on the map now.`, "good");
  else log(state, `🧭 Reports mapped ${ids.length} places nobody knew of: ${names.slice(0, 6).join(", ")}${ids.length > 6 ? ` and ${ids.length - 6} more` : ""}.`, "good");
}
