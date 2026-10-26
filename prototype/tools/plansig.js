// The plan signature (issue #32 of the interiors epic #7): what makes two buildings of a type different plans, shared by
// tools/varianttest.js (every type) and the owners' own variant tests (tools/industryvarianttest.js, #37):
//   roles  the set of room roles;
//   adj    the role pairs with a door between them (every floor);
//   ent    the ways in: the front door and every exit with a zone of its own (a map of several buildings: its zones);
//   shape  the footprint's class (spec.foot: small, medium, large, wide, huge, tower...; "multi": several buildings on
//          one map, a street's or a compound's);
// and, beyond the key, st (the storeys built, 3 and more as one) and corridor (a corridor or a hall: corridor or open
// plan), which tools/varianttest.js weighs when it compares two layouts. Not a test itself (no "test" in the name).
/** @param {any} m an assemble'd (or streetMap'd) map @param {string | null} [foot] its spec's footprint class */
export function planSignature(m, foot = null) {
  const rooms = m.rooms.filter((a) => !a.outdoor);
  const roles = [...new Set(rooms.map((a) => a.role))].sort();
  const byDoor = new Map();
  for (const a of rooms) for (const d of a.doors || []) { const k = `${a.f || 0}:${d[0]},${d[1]}`; const l = byDoor.get(k) || []; l.push(a.role); byDoor.set(k, l); }
  const adj = new Set();
  for (const l of byDoor.values()) if (l.length >= 2) adj.add([...l].sort().join("-"));
  const multi = !!(m.plan && (m.plan.street || m.plan.compound));
  const ent = multi ? (m.zones || []).length : 1 + (m.exits || []).filter((e) => e.zone >= 0).length;
  const shape = multi ? "multi" : foot || "";
  const g = { roles: roles.join(","), adj: [...adj].sort().join(","), ent, shape, st: Math.min(3, m.storeys || 1), corridor: roles.includes("corridor") || roles.includes("hall") };
  return { ...g, key: `${g.roles}|${g.adj}|${g.ent}|${g.shape}` };
}
