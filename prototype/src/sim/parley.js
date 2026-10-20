// Calling out in a raid (the user's request 2026-10-20): the other people on a raid's map - a neutral or friendly
// third side (thirdside.js), a hostile group's pod (side "enemy") - are groups you can talk to, and that talk to you.
//   their call  - a group that sees your people may call out first (by its stance: friendly and neutral groups most
//                 of the time, hostile ones sometimes, instead of opening fire); the card says what they said.
//   Call out    - a unit of yours that can see one of theirs (combat.js canSee) shouts to their group, whatever its
//                 stance (combatAct {type:"callout"}, 1 action, a little noise); the card offers: hold your fire
//                 (a truce), both walk away (evac), trade, join us, what do you know, attack them, never mind.
//   the odds    - by the group's hostility (0 friendly .. 100 hostile) and the Speech of the unit who spoke.
//   treachery   - some hostile groups claim to be friendly: they take the truce and turn on you when it suits them.
//   aggression  - either side can break a truce at any time: hit one of theirs and the group fights (thirdside.js).
// THIS FILE IS THE CONTRACT the UI is written against (ui/combat.js, ui/isoview.js, ui/battlebar.js): keep the
// exported names and the shapes they return.

export const PARLEY = {
  SHOUT: 6, // the noise of a shout (tiles), heard by the dead and the unaware
};

// The group a unit belongs to, as seen by your people: null for your own, the dead, or anyone with no group.
// Returns { key, name, stance, shown, hostility, active, truce, leaving, standoff, label, color }:
//   stance    - "friendly" | "neutral" | "hostile": what the group really is
//   shown     - the stance your people see (a treacherous group shows "friendly" until it turns)
//   hostility - 0..100, as shown
//   active    - true when the group is actively hostile: it shoots your people on sight now
//   label     - the indicator's word: "Hostile" | "Unaware" | "Standoff" | "Truce" | "Peaceful" | "Leaving"
//   color     - the indicator's colour (red when active)
export function parleyStatus(b, u) {
  if (!b || !u || u.side === "player" || u.kind !== "human") return null;
  const active = u.side === "enemy" && !!u.aware;
  return { key: u.side === "third" ? `t${u.tgroup}` : `p${u.pod}`, name: u.side === "third" ? "the survivors" : "the raiders", stance: u.side === "third" ? "neutral" : "hostile", shown: u.side === "third" ? "neutral" : "hostile", hostility: u.side === "third" ? 40 : 80, active, truce: false, leaving: false, standoff: false, label: active ? "Hostile" : u.side === "third" ? "Peaceful" : "Unaware", color: active ? "#ff8f85" : "#e9d98f" };
}

// Every group your people have seen on this map (for the raid's top strip): [{ ...parleyStatus, count, seen }].
export function parleyGroupsSeen(b) {
  return [];
}

// Why unit u (yours) cannot call out to unit t now: "" when it can. (Needs an action, sight of t, a person in a group.)
export function callOutRefusal(state, b, u, t) {
  return "Not yet.";
}

// The units u can call out to now: one per group, the nearest it can see.
export function callOutTargets(state, b, u) {
  return [];
}
