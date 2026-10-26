// The raid flow per point of interest (pois.js): which POI a scavenge / raid goes into, the dialogue that lets the
// player pick one, and the pick made for the headless paths.
//
// - A tile with POIs is raided one POI at a time. The dialogue (poiPickCard: a card with a choice per known POI; the
//   browser draws it richer, ui/poipick.js) lists only the known ones with the kind, the visit history ("been here
//   3d ago, 2 visits"), the picked-over band (Rich / Some / Little / Picked clean), the container note (what the
//   ledger holds: containers you opened, items you left there, looted by others since), whether another group is
//   raiding it right now, and the perceived threat ("threat unknown" without a survey or a visit; a word with skulls
//   that goes stale with the days). No POI known: "survey first", and the order is refused (scavengeProblem). City
//   and town centres have no POIs and go to the crawl as before; a bare city block (POIs of its own, and a crawl)
//   offers the crawl as one more choice.
// - The pick: p.poi, read by scavenge.js startScavenge (the raid map of that POI's building, buildingmaps.js SITES;
//   its pool, its visits) and cleared there. The site POI of a site with several buildings (a farm, a military base,
//   a mall: buildingmaps.js buildingOptions) is offered on the card as one choice per building and the street around
//   them, so one pick goes straight in: p.poiBuilding carries the building (an option id, or "street"). The autopilot,
//   a crew and a headless tool never see the card: the best known POI by value × what is left / the perceived threat
//   (pois.js bestKnownPoi) is picked for them, and a search that strips one moves on to the next (scavenge.js).
// - A temporary site (a wreck, a drop, a convoy: pois.js permanentSite false) is searched as before: the raid goes
//   to the site, not into the tile's POIs. So does a tile without POIs (open mountain, a bare road).
// - The building is always picked before the raid map is made (the user's request 2026-10-25: "When raiding a tile
//   and there is a street and buildings you can go to show the options before loading the raid map and not provide
//   the options when you load into the map"): a raid with buildings to choose from and none picked (raidBuildings: the
//   site POI picked with no building, a tile without POIs that has a farmhouse and a barn on it) asks on a card first
//   (buildingPickCard, the team driven by hand in the browser: buildingPickWanted), its pick in p.poiBuilding; for
//   everyone else (the autopilot, a team played on the map by the AI) the dice pick one (buildingPickFor, the battle
//   AI's own pick as it was made on the map). The battle screen no longer offers the buildings (combat.js createRaid).
import { LOCATIONS } from "./data.js";
import { hash01 } from "./skills.js"; // (call-time only) the building picked for a team that gets no card
import { partyTile, tileLabel, awaitOrders, giveOrder, PICKED_OVER } from "./parties.js";
import { crawlTile } from "./citycrawl.js";
import { SITES, TOWER_SITES, BUILDINGS, buildingOptions } from "./buildingmaps.js"; // the building a POI's kind opens; a site's choice of them
import { ledgerSummary } from "./poicont.js"; // what the containers there hold for you (the dialogue's note)
import { campText } from "./campsite.js"; // a campsite's state as last seen (abandoned, overrun, raiders)
import {
  poisOf, poiAt, knownPois, poiName, poiPool, poiBand, poiBandName, poiVisitText, poiThreatEstimate, poiThreatText, raidingNow,
  bestKnownPoi, poiScore, permanentSite, morePoisHidden, isSitePoi,
} from "./pois.js";
import { franchiseName } from "./shops.js"; // a franchise's name (a POI's poi.v)
import { layoutName } from "./buildvariants.js"; // a layout's name (a POI's poi.lay, issue #32)
import { poiWalkMins, walkText, startPoiWalk, startExitWalk, exitsOf } from "./poiwalk.js"; // the minutes on foot to each place, the walk there, and out to an edge
import { groundsBase, groundsRaid, raidCount, GROUNDS_LABEL } from "./campscout.js"; // your base here set up blind: the dead on its grounds (call-time only)

/** Does a raid on this tile go into one of its points of interest (not a site that stands for a while, not open ground)? @param {any} t */
export const poiTileRaid = (t) => !!t && poisOf(t).length > 0 && !(t.loc && !permanentSite(t));

// Why a scavenge cannot start on the tile (null when it can): on a POI tile a place has to be known.
export function scavengeProblem(state, p, tile = partyTile(p)) {
  const t = state.tiles[tile];
  if (!poiTileRaid(t)) return null;
  const known = knownPois(state, t, p);
  if (!known.length) return crawlTile(t) ? null : "Nothing known to search here: survey first (a Quick look or a Survey)."; // a bare city block: its crawl stands
  if (p && p.poi != null && p.poi !== "crawl" && !known.includes(p.poi)) return "That place is not known.";
  return null;
}
// Is every place known here picked over (the option's note)?
export function pickedOverAt(state, p, tile = partyTile(p)) {
  const t = state.tiles[tile];
  if (!poiTileRaid(t)) return !!(t && t.loc && !(t.loot > PICKED_OVER));
  const known = knownPois(state, t, p);
  return known.length > 0 && known.every((i) => poiPool(t, i) <= PICKED_OVER);
}
// Does the player pick the POI on a card before the raid? Only in the browser, driving the team by hand (the
// autopilot, a crew and the tools get the pick made for them). state.poiPickAlways: the tools test the card.
export function poiPickWanted(state, p, tile = partyTile(p)) {
  const t = state.tiles[tile];
  if (!poiTileRaid(t) || p.poi != null || p.owner !== "player" || p.crewRole != null || !knownPois(state, t, p).length) return false;
  return !!state.poiPickAlways || (typeof window !== "undefined" && !state.autopilot);
}
// The pick made for a team that gets none (the headless paths): the best known POI, or -1.
export const poiPickFor = (state, p, tile = partyTile(p), exclude = []) => bestKnownPoi(state, state.tiles[tile], p, exclude);

// The container note of POI i from its ledger (poicont.js ledgerSummary): "you opened 3 containers, left 5 items
// there, looted by others since your visit" ("" when the ledger has nothing to say).
export function poiContainerNote(state, t, i) {
  const L = ledgerSummary(state, t, i);
  const parts = [];
  if (L.opened) parts.push(`you opened ${L.opened} container${L.opened === 1 ? "" : "s"}`);
  if (L.left) parts.push(`left ${L.left} item${L.left === 1 ? "" : "s"} there`);
  if (L.others) parts.push("looted by others since your visit");
  else if (L.othersEver) parts.push("others have looted here");
  return parts.join(", ");
}
// What the dialogue shows of the known POIs on a tile, one row each (p: the team, whose own finds count).
export function poiRows(state, p, tile = partyTile(p)) {
  const t = state.tiles[tile];
  return knownPois(state, t, p).map((i) => {
    const poi = poiAt(t, i);
    const est = poiThreatEstimate(state, t, i);
    return {
      i, kind: poi.kind, name: poiName(t, i), site: isSitePoi(t, i), desc: LOCATIONS[poi.kind] ? LOCATIONS[poi.kind].desc || "" : "",
      pool: poiPool(t, i), band: poiBand(t, i), bandName: poiBandName(t, i), stripped: poiBand(t, i) === 3,
      visits: poiVisitText(state, t, i), threat: est, threatText: poiThreatText(state, t, i),
      cont: poiContainerNote(state, t, i), raiding: raidingNow(state, t, i), score: poiScore(state, t, i), camp: campText(state, t, i),
      buildings: isSitePoi(t, i) ? buildingOptions(t, state) : null, // the site's buildings and the street (null: one building, or none)
      mins: p ? poiWalkMins(state, p, i, tile) : 0, // poiwalk.js: from where the team stands, on foot or by its vehicle (0: it stands there)
      drive: !!(p && p.vehicle), // poiwalk.js walkPace: the minutes by vehicle
    };
  });
}
// A row as one line (the card's hint).
export const poiRowText = (r) => `${walkText(r.mins, r.drive ? { vehicle: true } : null)}; ${r.bandName.toLowerCase()}; ${r.visits}; ${r.threatText}${r.camp ? `; ${r.camp}` : ""}${r.cont ? `; ${r.cont}` : ""}${r.raiding ? "; being raided now by another group" : ""}`;

// The dialogue: a card with a choice per known POI (the browser draws it with ui/poipick.js), each with its minutes on
// foot from where the team stands (poiwalk.js). Picking one starts the walk there (5–20 minutes on the clock, which
// stays stopped until the player runs it) and the raid when the team gets there (p.poi set, the scavenge order given
// again); the place it already stands at goes in at once. "Not now" leaves the team waiting with its queue on hold.
export function poiPickCard(state, p) {
  const tile = partyTile(p);
  const t = state.tiles[tile];
  const rows = poiRows(state, p, tile);
  const more = morePoisHidden(state, t, p);
  const go = (st, pick, building = null) => {
    if (!st.parties.includes(p)) return "";
    if (typeof pick === "number") { const walk = startPoiWalk(st, p, pick, building); if (walk) return walk; } // poiwalk.js: on foot to the place first
    p.poi = pick;
    if (building) p.poiBuilding = building; else delete p.poiBuilding;
    const res = giveOrder(st, p, "scavenge");
    return st.combat || (st.engagement && st.engagement.partyId === p.id) || (st.cards || []).some((c) => c.partyId === p.id) ? "" : res; // its own screen or card: no result box on top
  };
  return {
    title: `Scavenge ${tileLabel(state, tile)}: which place?`,
    text: `${rows.length === 1 ? "One place is known here" : `${rows.length} places are known here`}${more ? ", possibly more unknown" : ""}. The team goes into one at a time; the rest wait for another order. The minutes are on foot from where the team stands: it walks there, then goes in.`,
    partyId: p.id,
    isOrders: true, // one card per team: a newer orders card replaces it
    poiPick: { tile },
    choices: [
      ...rows.flatMap((r) => {
        const ai = () => (r.stripped ? -1 : 1 + r.score * 3 - (r.raiding ? 2 : 0));
        if (!r.buildings) return [{ label: `${r.name}: ${r.bandName}`, hint: poiRowText(r), poi: r.i, order: true, ai, resolve: (st) => go(st, r.i) }];
        // A site with several buildings: one choice each (the street around them last), the place's line on each.
        return r.buildings.map((o) => ({
          label: `${r.name}: ${o.id === "street" ? "the street" : o.name} (${r.bandName})`, hint: `${o.hint} ${poiRowText(r)}`, poi: r.i, building: o.id, order: true,
          ai: () => ai() - (o.id === "street" ? 0.1 : 0), resolve: (st) => go(st, r.i, o.id),
        }));
      }),
      ...(crawlTile(t) ? [{ label: "Go in block by block (city crawl)", hint: "The block's street of buildings instead of one place: noise raises the Alert, lying low lets it fade.", crawl: true, order: true, ai: () => 0.5, resolve: (st) => go(st, "crawl") }] : []),
      // Your base here went up blind (campscout.js, the user's request 2026-10-23): its grounds' dead raided instead
      // of waiting for them to come at the camp.
      ...(groundsBase(state, tile) ? [{ label: `${GROUNDS_LABEL} (${groundsBase(state, tile).grounds.known ? `${groundsBase(state, tile).grounds.dead} left` : "how many: ?"})`, hint: `The team goes out onto ${groundsBase(state, tile).name}'s grounds and fights the dead out there on the tile's map (about ${raidCount(groundsBase(state, tile))} of them this time): every one killed is one fewer to come at the camp.`, grounds: true, order: true, ai: () => -1, resolve: (st) => { if (!st.parties.includes(p)) return ""; const res = groundsRaid(st, p); return st.combat ? "" : res; } }] : []),
      // Leaving (poiwalk.js): a side of the tile (its arrow on the tile map, ui/poimap.js), or any tile picked on the State
      // Map (main.js move mode with leavePick: the side its way leaves by). The walk out to that edge comes first.
      ...exitsOf(state, p, tile).map((x) => ({
        label: `Leave toward ${tileLabel(state, x.via)}`, hint: x.mins ? `The team walks to this edge of the tile (${x.mins} min from where it stands), then on to ${tileLabel(state, x.via)}.` : `The team stands on this edge: it sets off for ${tileLabel(state, x.via)} at once.`,
        exit: x.via, mins: x.mins, order: true, ai: () => -3, resolve: (st) => (st.parties.includes(p) ? startExitWalk(st, p, x.via, x.via) : ""),
      })),
      { label: "Leave for another tile…", hint: "Pick the tile on the map: the team first walks from where it stands to the edge of this tile on the side its way leaves by (the minutes over the ground here), then on.", leavePick: true, uiAction: { type: "move", partyId: p.id }, ai: () => -3, resolve: () => "" },
      { label: "Not now", hint: "The team waits here for another order (its queue on hold).", cancel: true, ai: () => -2, resolve: (st) => { if (st.parties.includes(p)) awaitOrders(st, p, "The team waits.", { hold: true }); return ""; } },
    ],
  };
}

// The buildings a raid there chooses from (buildingmaps.js buildingOptions: one per building and the street last), or
// null with nothing to choose: POI i of the tile (the site POI only), or with i null the tile itself (a tile without
// POIs: the buildings its terrain or its site stands for, buildingmaps.js siteBuildings).
export function raidBuildings(state, t, i = null) {
  if (!t || (i != null && !isSitePoi(t, i))) return null;
  return buildingOptions(t, state);
}
// Does the team pick the building on a card before the raid map is made? A team driven by hand in the browser, its
// raid played on the map (not by the numbers: state.autoCombat), with buildings to choose from and none picked yet:
// the place picked on the POI card (p.poi, the site POI with no building) or a tile without POIs. A city or a town
// without a place picked goes to the crawl instead (scavenge.js startScavenge).
export function buildingPickWanted(state, p, tile = partyTile(p)) {
  const t = state.tiles[tile];
  if (!t || p.owner !== "player" || p.crewRole != null || p.poiBuilding || state.autoCombat || state.autopilot || typeof window === "undefined") return false;
  if (poiTileRaid(t)) return typeof p.poi === "number" && !!raidBuildings(state, t, p.poi);
  return !crawlTile(t) && !!raidBuildings(state, t);
}
// The building picked for a team that gets no card (the autopilot, the AI): its own dice by the tile and the hour
// (the battle AI's pick as it was made on the map), an option id or "street".
export const buildingPickFor = (state, tile, opts) => opts[Math.floor(hash01(state.seed, "autobuilding", tile, state.hour) * opts.length) % opts.length].id;
// The card (buildingPickWanted): one choice per building (its size, rooms, what it likely holds, its map) and the
// street, then Not now. Picking one gives the scavenge order again with the pick (p.poiBuilding; p.poi: the place
// picked on the POI card, poi), so the raid map is made for it and opens inside it.
export function buildingPickCard(state, p, poi = null) {
  const tile = partyTile(p);
  const t = state.tiles[tile];
  const opts = raidBuildings(state, t, poi) || [];
  const place = poi != null ? poiName(t, poi) : tileLabel(state, tile);
  const names = opts.filter((o) => o.id !== "street").map((o) => o.name);
  const go = (st, id) => {
    if (!st.parties.includes(p)) return "";
    if (poi != null) p.poi = poi; else delete p.poi;
    p.poiBuilding = id;
    const res = giveOrder(st, p, "scavenge");
    return st.combat || (st.engagement && st.engagement.partyId === p.id) || (st.cards || []).some((c) => c.partyId === p.id) ? "" : res; // its own screen or card: no result box on top
  };
  const mapWords = (o) => (o.map ? ` The map: ${o.map.replace(/\+$/, "")} tiles${/\+$/.test(o.map) ? " at least (the floor plan and the grounds round it)" : ""}.` : "");
  return {
    title: `Scavenge ${place}: where do you go in?`,
    text: `Several buildings stand here (${names.join(", ")}). Each has its own map: rooms, doors, windows and its own ways out. Or search the street: the ground round them, small buildings and cars. The raid map is made for the one you pick.`,
    partyId: p.id,
    isOrders: true, // one card per team: a newer orders card replaces it
    choices: [
      ...opts.map((o) => ({
        label: o.id === "street" ? `The street${o.map ? ` (${o.map})` : ""}` : `${o.name}${o.size || o.map ? ` (${[o.size, o.map].filter(Boolean).join(", ")})` : ""}`,
        hint: o.id === "street" ? `${o.hint}${mapWords(o)}` : `${o.name}${o.size ? ` (${o.size}, ${o.rooms} rooms)` : ""}. ${o.hint}${mapWords(o)}`,
        building: o.id, order: true, ai: () => (o.id === "street" ? 0.9 : 1), resolve: (st) => go(st, o.id),
      })),
      { label: "Not now", hint: "The team waits here for another order (its queue on hold).", cancel: true, ai: () => -2, resolve: (st) => { if (st.parties.includes(p)) awaitOrders(st, p, "The team waits.", { hold: true }); return ""; } },
    ],
  };
}

// The raid's setup for POI i of a tile (scavenge.js startScavenge → combat.js createRaid): the building its kind
// opens (buildingmaps.js SITES; its own layout per POI: the option id carries the index), the kind for the street
// map's areas when it has no building, and for the site POI the building picked on the card (building: an option id
// of buildingmaps.js buildingOptions, or "street"); without one (choose: a pick still to make) scavenge.js
// startScavenge picks one before the map is made (buildingPickFor).
export function poiRaidSetup(state, t, i, building = null) {
  const poi = poiAt(t, i);
  if (!poi) return { poi: null, choose: true };
  if (isSitePoi(t, i)) {
    const opts = building ? buildingOptions(t) : null;
    if (opts && opts.some((o) => o.id === building)) return { poi: i, kind: poi.kind, choose: false, building };
    return { poi: i, kind: poi.kind, choose: true }; // the site's buildings: one picked before the map (scavenge.js startScavenge)
  }
  return { poi: i, kind: poi.kind, choose: false, place: poiPlace(t, i) };
}
// The building a POI opens: { id, key, name } for buildingmaps.js raidBuilding (setup.raid.place), or null (the
// street map with the kind's area set). The option id carries the POI's index, so two houses on one tile get their
// own layouts (buildingmaps.js specSeed hashes the tile and the id).
export function poiPlace(t, i) {
  const poi = poiAt(t, i);
  if (!poi) return null;
  const entry = poi.extra === "place" && TOWER_SITES[poi.kind] ? TOWER_SITES[poi.kind] : SITES[poi.kind]; // a new world's radio tower (issue #54): the tower compound
  const list = entry ? (Array.isArray(entry) ? entry : entry.list) : null;
  if (!list || !list.length) return null;
  const [key0, name] = Array.isArray(list[0]) ? list[0] : [list[0], null];
  // A new save's shed or farm stand (issue #62, farmplans.js): its own type when its layout is one of that type's (an
  // older save's POI has no layout of them: the machine shed's or the corner shop's building, as it was).
  const key = (poi.kind === "shed" || poi.kind === "farmstand") && poi.lay && layoutName(poi.kind, poi.lay) ? poi.kind : key0;
  // shops.js: a franchise's name and layout (variant; a POI saved before franchises keeps its old building)
  // buildvariants.js: a POI's layout (poi.lay, issue #32: its plan and its name)
  return { id: `poi${i}:${key}`, key, name: poi.v ? franchiseName(poi.kind, poi.v) : poi.lay && layoutName(key, poi.lay) ? layoutName(key, poi.lay) : name || (BUILDINGS[key] ? BUILDINGS[key].name : LOCATIONS[poi.kind].name), ...(poi.v ? { variant: poi.v, kind: poi.kind } : {}), ...(poi.lay ? { layout: poi.lay } : {}), ...(poi.hv ? { plan: poi.hv } : {}) }; // hv: a hotel's variant (issue #38)
}

// The tile's scavenge text for the panels: "3 places known, possibly more unknown" ("" off a POI tile).
export function poiRaidSummary(state, tile, p = null) {
  const t = state.tiles[tile];
  if (!poiTileRaid(t)) return "";
  const n = knownPois(state, t, p).length;
  return `${n ? `${n} place${n === 1 ? "" : "s"} known` : "no place known"}${morePoisHidden(state, t, p) ? ", possibly more unknown" : ""}`;
}
