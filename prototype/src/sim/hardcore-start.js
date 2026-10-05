// Hardcore mode, your start (hardcore.js): three survivors on the road, no hub.
// STUB until the start work lands: a bare placeholder hub with three survivors, so hardcore worlds can be created
// and ticked by the outbreak and groups work in the meantime.
import { newId, makeSurvivor } from "./world.js";

export function setupHardcoreStart(state, crew) {
  const towns = state.tiles.filter((t) => t.loc && t.loc.type === "town");
  const tile = state.rng.pick(towns);
  state.bases.push({
    id: newId(), tile: tile.id, type: "hub", name: `${tile.loc.name} Camp`,
    stock: { food: 10, water: 10, fuel: 0, meds: 0, ammo: 6, parts: 0, scrap: 0 },
    radio: false, watchtower: false, buildings: [], construction: [], armory: [],
  });
  for (let i = 0; i < 3; i++) {
    const s = makeSurvivor(state);
    s.location = { kind: "base", baseId: state.bases[0].id };
    state.survivors.push(s);
  }
  state.survivors[0].leader = true;
}
export function hardcoreStartDaily(state) {}
