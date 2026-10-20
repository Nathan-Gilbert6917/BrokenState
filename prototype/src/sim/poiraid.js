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
import { LOCATIONS } from "./data.js";
import { partyTile, tileLabel, awaitOrders, giveOrder, PICKED_OVER } from "./parties.js";
import { crawlTile } from "./citycrawl.js";
import { SITES, BUILDINGS, buildingOptions } from "./buildingmaps.js"; // the building a POI's kind opens; a site's choice of them
import { ledgerSummary } from "./poicont.js"; // what the containers there hold for you (the dialogue's note)
import { campText } from "./campsite.js"; // a campsite's state as last seen (abandoned, overrun, raiders)
import {
  poisOf, poiAt, knownPois, poiName, poiPool, poiBand, poiBandName, poiVisitText, poiThreatEstimate, poiThreatText, raidingNow,
  bestKnownPoi, poiScore, permanentSite, morePoisHidden, isSitePoi,
} from "./pois.js";

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
      buildings: isSitePoi(t, i) ? buildingOptions(t) : null, // the site's buildings and the street (null: one building, or none)
    };
  });
}
// A row as one line (the card's hint).
export const poiRowText = (r) => `${r.bandName.toLowerCase()}; ${r.visits}; ${r.threatText}${r.camp ? `; ${r.camp}` : ""}${r.cont ? `; ${r.cont}` : ""}${r.raiding ? "; being raided now by another group" : ""}`;

// The dialogue: a card with a choice per known POI (the browser draws it with ui/poipick.js). Picking one sets p.poi
// and gives the scavenge order again; "Not now" leaves the team waiting with its queue on hold.
export function poiPickCard(state, p) {
  const tile = partyTile(p);
  const t = state.tiles[tile];
  const rows = poiRows(state, p, tile);
  const more = morePoisHidden(state, t, p);
  const go = (st, pick, building = null) => {
    if (!st.parties.includes(p)) return "";
    p.poi = pick;
    if (building) p.poiBuilding = building; else delete p.poiBuilding;
    const res = giveOrder(st, p, "scavenge");
    return st.combat || (st.engagement && st.engagement.partyId === p.id) || (st.cards || []).some((c) => c.partyId === p.id) ? "" : res; // its own screen or card: no result box on top
  };
  return {
    title: `Scavenge ${tileLabel(state, tile)}: which place?`,
    text: `${rows.length === 1 ? "One place is known here" : `${rows.length} places are known here`}${more ? ", possibly more unknown" : ""}. The team goes into one at a time; the rest wait for another order.`,
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
      { label: "Not now", hint: "The team waits here for another order (its queue on hold).", cancel: true, ai: () => -2, resolve: (st) => { if (st.parties.includes(p)) awaitOrders(st, p, "The team waits.", { hold: true }); return ""; } },
    ],
  };
}

// The raid's setup for POI i of a tile (scavenge.js startScavenge → combat.js createRaid): the building its kind
// opens (buildingmaps.js SITES; its own layout per POI: the option id carries the index), the kind for the street
// map's areas when it has no building, and for the site POI the building picked on the card (building: an option id
// of buildingmaps.js buildingOptions, or "street"); without one (a pick made for you) the battle screen still offers
// the site's buildings.
export function poiRaidSetup(state, t, i, building = null) {
  const poi = poiAt(t, i);
  if (!poi) return { poi: null, choose: true };
  if (isSitePoi(t, i)) {
    const opts = building ? buildingOptions(t) : null;
    if (opts && opts.some((o) => o.id === building)) return { poi: i, kind: poi.kind, choose: false, building };
    return { poi: i, kind: poi.kind, choose: true }; // the site's buildings, chosen on the battle screen
  }
  return { poi: i, kind: poi.kind, choose: false, place: poiPlace(t, i) };
}
// The building a POI opens: { id, key, name } for buildingmaps.js raidBuilding (setup.raid.place), or null (the
// street map with the kind's area set). The option id carries the POI's index, so two houses on one tile get their
// own layouts (buildingmaps.js specSeed hashes the tile and the id).
export function poiPlace(t, i) {
  const poi = poiAt(t, i);
  if (!poi) return null;
  const entry = SITES[poi.kind];
  const list = entry ? (Array.isArray(entry) ? entry : entry.list) : null;
  if (!list || !list.length) return null;
  const [key, name] = Array.isArray(list[0]) ? list[0] : [list[0], null];
  return { id: `poi${i}:${key}`, key, name: name || (BUILDINGS[key] ? BUILDINGS[key].name : LOCATIONS[poi.kind].name) };
}

// The tile's scavenge text for the panels: "3 places known, possibly more unknown" ("" off a POI tile).
export function poiRaidSummary(state, tile, p = null) {
  const t = state.tiles[tile];
  if (!poiTileRaid(t)) return "";
  const n = knownPois(state, t, p).length;
  return `${n ? `${n} place${n === 1 ? "" : "s"} known` : "no place known"}${morePoisHidden(state, t, p) ? ", possibly more unknown" : ""}`;
}
