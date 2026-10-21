// Orders to allies in a raid (the user's request 2026-10-21): one of your people may tell an allied survivor (parley.js
// "Fight with us": u.ally, a third-side unit) within ALLY_ORDER.RANGE tiles what to do: attack a target, move to a
// cell (any cell, the fog of war too: you do not see what they see), push to a cell and fight what is there, overwatch
// a cone, hold, follow, cover you, retreat (try to get off the map), or act on their own again. They may ignore it.
// When your team evacuates, every ally is told to retreat.
// THIS FILE IS THE CONTRACT the UI is written against (ui/combat.js, ui/isoview.js, ui/battlebar.js): keep the
// exported names and the shapes they return.

export const ALLY_ORDER = {
  RANGE: 5, // tiles between the one giving the order and the ally
};

// The orders, in menu order. need: what the order needs picked on the map ("unit" an enemy your side sees, "cell"
// any cell, fog or not, "face" a cell to face (the cone), null nothing).
export const ALLY_ORDERS = [
  { kind: "attack", label: "Attack", need: "unit", tip: "Go after this target" },
  { kind: "move", label: "Move", need: "cell", tip: "Go to this spot and hold it" },
  { kind: "push", label: "Push to", need: "cell", tip: "Advance to this spot and fight whatever is there" },
  { kind: "overwatch", label: "Overwatch", need: "face", tip: "Hold and fire on what moves in this cone" },
  { kind: "hold", label: "Hold", need: null, tip: "Stay where you are" },
  { kind: "follow", label: "Follow me", need: null, tip: "Stay close to the one who gave the order" },
  { kind: "cover", label: "Cover me", need: null, tip: "Stay close and shoot what threatens the one who gave the order" },
  { kind: "retreat", label: "Retreat", need: null, tip: "Get off the map by the nearest way out" },
  { kind: "free", label: "Own call", need: null, tip: "Fight as you see fit" },
];

// The allies unit u (yours) can give an order to now: active allies within RANGE, the same floor.
export function allyOrderTargets(state, b, u) {
  return [];
}

// Why u cannot give this order to ally a: "" when it can. order = { kind, target?, x?, y?, face?: [x, y], group? }
// (group: the order goes to every ally of a's group within RANGE of u).
export function allyOrderRefusal(state, b, u, a, order) {
  return "Not yet.";
}

// The chance a heeds this order from u (0..1).
export function allyOdds(state, b, u, a, order) {
  return 0;
}

// An ally's order as your people know it, for the map: null, or { kind, label, icon, x, y, targetId, face: [x, y] |
// null, by: unit id, since: turn, heeded: bool }. x, y: where it goes (move, push, retreat's way out), else null.
export function allyOrderOf(b, a) {
  return null;
}

// Every ally with an order your people gave and know of (for the map's markers and cones):
// [{ allyId, ...allyOrderOf(b, ally), from: [x, y] }].
export function allyOrdersShown(b) {
  return [];
}
