// People on the move in the wider state: neutral survivors trying to get by (recruitable, or left to survive alone or
// die), aggressive survivors who attack like raiders, and military squads fighting the dead. They are met on the road
// and while exploring, more often in towns and cities.
// STUB until the encounters work lands: nobody is out there yet.

// Who is inside a building being explored (sim/buildingmaps.js asks when it builds the map).
// tile: the State Map tile; plan: the generated building ({ type, rooms, exits, ... }).
// Returns groups to place: [{ side: "neutral" | "hostile" | "military", people: [{ kit, weapon, ... }], room?, aware? }]
export function interiorOccupants(state, tile, plan) {
  return [];
}
