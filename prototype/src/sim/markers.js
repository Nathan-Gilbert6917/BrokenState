// @ts-check
// Map markers: what the player knows about points of interest, and when it was last seen.
// Teams spot things as they travel (a perception roll); like all intel, it reaches you
// when they get home, or right away over the radio.
import { skill, isNight } from "./world.js";
import { anyPerk } from "./skills.js";
import { teamTraitFx } from "./traits.js"; // Keen Eye
import { spotTrucks, unopenedTrucks } from "./miltrucks.js";

export const MARKER_TYPES = {
  vehicle: { name: "Abandoned vehicle", glyph: "🚚", desc: "One of your vehicles left behind. Bring fuel to get it running again." },
  death:   { name: "Death site",        glyph: "✝",  desc: "Where your people fell. Their gear stays until scavengers strip it." },
  cache:   { name: "Supply cache",      glyph: "📦", desc: "A hidden stash someone left behind. Investigate to collect it." },
  car:     { name: "Wrecked car",       glyph: "🚗", desc: "Could be restored with parts and fuel, or stripped." },
  camp:    { name: "Abandoned camp",    glyph: "⛺", desc: "Someone lived here. Supplies, and maybe notes about the area." },
  nomadcamp: { name: "Nomad camp",     glyph: "🔥", desc: "Where a band of nomads (nomads.js) was camped when your people last saw it. They move on every few days. A team can be sent to attack a camp you know of." },
  miltruck: { name: "Army truck",       glyph: "🪖", desc: "A military truck left on the road (miltrucks.js): rifles, ammunition and armour in the back, and its crew still about it. Scavenge the tile to search it." },
};

export const LAYERS = {
  pois:      { name: "Locations",        desc: "Towns, sites and the places on the tiles, with their names" },
  territory: { name: "Territory",        desc: "Land held by you and known groups" },
  teams:     { name: "Teams and convoys", desc: "Your teams, plus raiders and convoys you can see" },
  workers:   { name: "Base workers",     desc: "Your bases' people out on their jobs (wood, hunting, fishing, foraging, scavenging, water): walking out, at work, bringing the load home; the groups' people by their bases you can see" },
  hordes:    { name: "Hordes and hives", desc: "Live hordes, last-seen hordes, known hives with their land and red-skull ring, and hives being built" },
  deaths:    { name: "Death sites",      desc: "Where your people died, with what is left" },
  vehicles:  { name: "Vehicles",         desc: "Abandoned vehicles you know about" },
  finds:     { name: "Spotted finds",    desc: "Caches, wrecks and camps your teams noticed" },
  infection: { name: "Infection",        desc: "Red overlay showing infection level" },
  weather:   { name: "Weather",          desc: "Season wash; rain and fog on the tiles seen live" },
  known:     { name: "Known area",       desc: "Hatched where your people searched for hidden places" },
  coalition: { name: "Coalition land",   desc: "Land you and the coalition's members hold (goal: 50%)" },
  towersight: { name: "Tower sight",     desc: "Rings round your manned watch towers: what they see" }, // sim/fieldworks.js
  radio:     { name: "Radio coverage",   desc: "How far your radios and your allies' reach, in tiles" }, // sim/radio.js, sim/radioallies.js; the help has the long version
};
export const LAYER_OF = { vehicle: "vehicles", death: "deaths", cache: "finds", car: "finds", camp: "finds", miltruck: "finds", nomadcamp: "finds" };

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
    // A death site with nothing left on it (the person carried nothing): no marker.
    if (s.type === "death" && s.info && s.info.items === 0 && !state.deathSites.some((d) => d.tile === s.tile && d.items.length)) {
      if (cur && cur.hour <= s.hour) state.markers.splice(state.markers.indexOf(cur), 1);
      continue;
    }
    // A find one of your teams has taken since (only your teams take them: parties.js investigate) is not put back
    // by an older sighting: an old report re-added a restored wreck, and the governor kept walking to it.
    const find = s.type === "cache" || s.type === "car" || s.type === "camp";
    const gone = find && state.tiles[s.tile].hidden && state.tiles[s.tile].hidden.taken && !(s.info && s.info.emptied);
    if (gone) {
      if (cur && !(cur.info && cur.info.emptied)) cur.info = { ...(cur.info || {}), emptied: true };
      continue;
    }
    if (!cur) {
      state.markers.push({ ...s });
      added++;
    } else if (cur.hour <= s.hour) Object.assign(cur, s);
    if (find) state.tiles[s.tile].hidden.known = true;
  }
  return added;
}

export function perceptionChance(state, members) {
  const scout = Math.max(0, ...members.map((m) => skill(m, "scouting")));
  let c = 0.12 + scout * 0.03;
  c += teamTraitFx(members, "keeneye", "notice"); // Keen Eye, the team's best tier (traits.js)
  if (anyPerk(members, "spotter")) c += 0.15; // Spotter (skills.js)
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
    // An Army truck on the road (miltrucks.js: its own dice).
    const truck = spotTrucks(state, p, id, chance);
    if (truck && !p.spotted?.has(truck.key)) { spot(p, truck); found.push(truck); }
    // Your own dead and vehicles are easy to recognise.
    for (const d of state.deathSites) {
      if (d.tile !== id || !d.items.length) continue;
      spot(p, deathMark(state, d));
    }
    for (const v of state.vehicles) {
      if (v.loc.kind !== "abandoned" || v.loc.tile !== id) continue;
      spot(p, vehicleMark(state, v));
    }
  }
  return found;
}

// Marker entries for a death site and for an abandoned vehicle (cargo left inside is noted on the label).
// A site with no names is cargo a team had to drop (parties.js shedOverload): nobody died there.
// A body that got up and walked off (carriers.js walkOff) is noted: the grave stays, the things do not.
// Cargo left behind (carry.js: put on the ground) names what is there: "Cargo left behind: 20 un-purified water, Machete".
const cargoWhat = (d) => { const l = (d.items || []).slice(0, 4).map((it) => (it.kind === "gear" ? (it.cartKg != null ? `${it.name} (${it.cartKg} kg)` : it.name) : `${Math.round(it.qty * 10) / 10} ${it.fresh ? "fresh game" : String(it.name).toLowerCase()}`)); return l.length ? `: ${l.join(", ")}${d.items.length > 4 ? ` and ${d.items.length - 4} more` : ""}` : ""; };
export const deathLabel = (d) => (!d.names.length && d.abandoned ? `Abandoned cart${cargoWhat(d)}` : d.names.length ? `Death site: ${d.names.join(", ")}${d.walked && d.walked.length ? ` (${d.walked.map((n) => `${n.split(" ")[0]}'s body is gone: they rose and walked`).join("; ")})` : ""}` : `Cargo left behind${cargoWhat(d)}`);
const deathMark = (state, d) => ({ key: `death:${d.tile}`, type: "death", tile: d.tile, hour: state.hour, label: deathLabel(d), info: { items: d.items.length } });
const hasCargo = (v) => !!(v.cargo && (v.cargo.gear.length || Object.values(v.cargo.supplies).some((q) => q >= 1)));
const vehicleMark = (state, v, note = v.found ? (v.found.repair ? "found, needs repair" : "found") : "") => ({ // found: on a map (foundcars.js)
  key: `vehicle:${v.id}`, type: "vehicle", tile: v.loc.tile, hour: state.hour,
  label: `${v.name}${note || hasCargo(v) ? ` (${[note, hasCargo(v) ? "cargo inside" : ""].filter(Boolean).join(", ")})` : ""}`,
  info: { vehicleId: v.id, fuel: Math.round(v.fuel), condition: Math.round(v.condition) },
});

// Put straight on the map (not through a team's report): where a whole team was lost, so that what it carried
// and its vehicle can be recovered (parties.js wipeParty).
export const markDeathSite = (state, d) => upsert(state, deathMark(state, d));
export const markAbandonedVehicle = (state, v, note) => upsert(state, vehicleMark(state, v, note));

// Death sites with nothing left on them are removed, with their markers (a site only matters while there is
// something to recover). Runs every hour with the live-marker update.
export function clearEmptyDeathSites(state) {
  for (let i = state.deathSites.length - 1; i >= 0; i--) {
    const d = state.deathSites[i];
    if (d.items.length || (d.walked && d.walked.length)) continue; // walked: the grave stays as a note (carriers.js)
    state.deathSites.splice(i, 1);
    if (state.deathSites.some((o) => o.tile === d.tile)) continue;
    const m = state.markers.findIndex((x) => x.key === `death:${d.tile}`);
    if (m >= 0) state.markers.splice(m, 1);
  }
}

// Tiles in live view keep their markers current.
export function updateLiveMarkers(state) {
  clearEmptyDeathSites(state);
  for (const id of state.live) {
    const t = state.tiles[id];
    for (const d of state.deathSites) if (d.tile === id) upsert(state, deathMark(state, d));
    for (const v of state.vehicles) if (v.loc.kind === "abandoned" && v.loc.tile === id) upsert(state, vehicleMark(state, v));
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
    if (m.type === "miltruck") return unopenedTrucks(state, m.tile).length > 0; // miltrucks.js: searched or taken since
    return true;
  });
}

function upsert(state, e) {
  const cur = state.markers.find((m) => m.key === e.key);
  if (cur) Object.assign(cur, e);
  else state.markers.push(e);
}
