// The watch list: people, teams, hordes, other groups and bases the player pinned (📌) to the Watching panel on the
// map (ui/watch.js shows their live status). Kept in state.watch, so it is saved with the campaign; an older save
// starts with an empty list. Each entry keeps the name it had when pinned (shown once the thing is gone) and, for a
// horde, where and how big it was when last seen, so an out-of-sight horde shows that rather than its true place.
// Nothing in the simulation reads it.
export const WATCH_KINDS = ["person", "team", "horde", "group", "base"];
export const WATCH_MAX = 16;

export const watchList = (state) => {
  const w = state.watch || (state.watch = { items: [], collapsed: false, notesOpen: true });
  if (!Array.isArray(w.items)) w.items = [];
  return w;
};
export const watchItem = (state, kind, id) => watchList(state).items.find((x) => x.kind === kind && x.id === Number(id)) || null;
export const isWatched = (state, kind, id) => !!(state.watch && state.watch.items && state.watch.items.some((x) => x.kind === kind && x.id === Number(id)));

// Pins (or, when already pinned, unpins) a thing. Returns true when it is watched now, false when unpinned, or a
// string saying why it could not be pinned.
export function toggleWatch(state, kind, id, name = "") {
  if (!WATCH_KINDS.includes(kind)) return "Unknown kind.";
  const w = watchList(state);
  const i = w.items.findIndex((x) => x.kind === kind && x.id === Number(id));
  if (i >= 0) { w.items.splice(i, 1); return false; }
  if (w.items.length >= WATCH_MAX) return `The watch list holds ${WATCH_MAX}: unpin something first.`;
  w.items.push({ kind, id: Number(id), name: String(name || ""), added: state.hour });
  w.collapsed = false; // show what was just pinned
  return true;
}
export function unwatch(state, kind, id) {
  const w = watchList(state);
  const i = w.items.findIndex((x) => x.kind === kind && x.id === Number(id));
  if (i >= 0) w.items.splice(i, 1);
  return i >= 0;
}
