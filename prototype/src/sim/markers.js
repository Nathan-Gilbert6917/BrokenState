// Map markers: what the player knows about points of interest, and when it was last seen.
// Teams spot things as they travel (a perception roll); like all intel, it reaches you
// when they get home, or right away over the radio.
import { skill, isNight } from "./world.js";

export const MARKER_TYPES = {
  vehicle: { name: "Abandoned vehicle", glyph: "🚚", desc: "One of your vehicles left behind. Bring fuel to get it running again." },
  death:   { name: "Death site",        glyph: "✝",  desc: "Where your people fell. Their gear stays until scavengers strip it." },
  cache:   { name: "Supply cache",      glyph: "📦", desc: "A hidden stash someone left behind. Investigate to collect it." },
  car:     { name: "Wrecked car",       glyph: "🚗", desc: "Could be restored with parts and fuel, or stripped." },
  camp:    { name: "Abandoned camp",    glyph: "⛺", desc: "Someone lived here. Supplies, and maybe notes about the area." },
};

export const LAYERS = {
  pois:      { name: "Locations",        desc: "Towns, sites and their names" },
  territory: { name: "Territory",        desc: "Land held by you and known groups" },
  teams:     { name: "Teams and convoys", desc: "Your teams, plus raiders and convoys you can see" },
  hordes:    { name: "Hordes and nests", desc: "Live hordes, last-seen hordes and known nests" },
  deaths:    { name: "Death sites",      desc: "Where your people died, with what is left" },
  vehicles:  { name: "Vehicles",         desc: "Abandoned vehicles you know about" },
  finds:     { name: "Spotted finds",    desc: "Caches, wrecks and camps your teams noticed" },
  infection: { name: "Infection",        desc: "Red overlay showing infection level" },
};
export const LAYER_OF = { vehicle: "vehicles", death: "deaths", cache: "finds", car: "finds", camp: "finds" };

export function spot(p, entry) {
  if (!p.spotted) p.spotted = new Map();
  p.spotted.set(entry.key, entry);
}

export function mergeSpots(state, spotted) {
  if (!spotted) return 0;
  let added = 0;
  for (const [key, s] of spotted) {
    const cur = state.markers.find((m) => m.key === key);
    if (s.remove) {
      // The team dealt with it (recovered the vehicle, emptied the site): clear the marker.
      if (cur && cur.hour <= s.hour) state.markers.splice(state.markers.indexOf(cur), 1);
      continue;
    }
    if (!cur) {
      state.markers.push({ ...s });
      added++;
    } else if (cur.hour <= s.hour) Object.assign(cur, s);
    if (s.type === "cache" || s.type === "car" || s.type === "camp") state.tiles[s.tile].hidden.known = true;
  }
  return added;
}

export function perceptionChance(state, members) {
  const scout = Math.max(0, ...members.map((m) => skill(m, "scouting")));
  let c = 0.12 + scout * 0.03;
  if (members.some((m) => m.traits.includes("keeneye"))) c += 0.15;
  if (isNight(state)) c *= 0.6;
  return Math.min(0.9, c);
}

// What a team notices around a tile. Bonus is added for a deliberate survey.
export function perceive(state, p, members, tiles, bonus = 0) {
  const chance = Math.min(0.95, perceptionChance(state, members) + bonus);
  const found = [];
  for (const id of tiles) {
    const t = state.tiles[id];
    if (t.hidden && !t.hidden.taken && !p.spotted?.has(`${t.hidden.type}:${id}`) && state.rng.chance(chance)) {
      const e = { key: `${t.hidden.type}:${id}`, type: t.hidden.type, tile: id, hour: state.hour, label: MARKER_TYPES[t.hidden.type].name };
      spot(p, e);
      found.push(e);
    }
    // Your own dead and vehicles are easy to recognise.
    for (const d of state.deathSites) {
      if (d.tile !== id) continue;
      spot(p, { key: `death:${id}`, type: "death", tile: id, hour: state.hour, label: `Death site: ${d.names.join(", ")}`, info: { items: d.items.length } });
    }
    for (const v of state.vehicles) {
      if (v.loc.kind !== "abandoned" || v.loc.tile !== id) continue;
      spot(p, { key: `vehicle:${v.id}`, type: "vehicle", tile: id, hour: state.hour, label: v.name, info: { vehicleId: v.id, fuel: Math.round(v.fuel), condition: Math.round(v.condition) } });
    }
  }
  return found;
}

// Tiles in live view keep their markers current.
export function updateLiveMarkers(state) {
  for (const id of state.live) {
    const t = state.tiles[id];
    for (const d of state.deathSites) if (d.tile === id) upsert(state, { key: `death:${id}`, type: "death", tile: id, hour: state.hour, label: `Death site: ${d.names.join(", ")}`, info: { items: d.items.length } });
    for (const v of state.vehicles) if (v.loc.kind === "abandoned" && v.loc.tile === id) upsert(state, { key: `vehicle:${v.id}`, type: "vehicle", tile: id, hour: state.hour, label: v.name, info: { vehicleId: v.id, fuel: Math.round(v.fuel), condition: Math.round(v.condition) } });
    if (t.hidden && t.hidden.known && t.hidden.taken) {
      const m = state.markers.find((m) => m.key === `${t.hidden.type}:${id}`);
      if (m) m.info = { ...(m.info || {}), emptied: true };
    }
  }
  // Markers for things that are gone, seen live: drop them.
  state.markers = state.markers.filter((m) => {
    if (!state.live.has(m.tile)) return true;
    if (m.type === "death") return state.deathSites.some((d) => d.tile === m.tile);
    if (m.type === "vehicle") return state.vehicles.some((v) => v.id === m.info?.vehicleId && v.loc.kind === "abandoned");
    return true;
  });
}

function upsert(state, e) {
  const cur = state.markers.find((m) => m.key === e.key);
  if (cur) Object.assign(cur, e);
  else state.markers.push(e);
}
