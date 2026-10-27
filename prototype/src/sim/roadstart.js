// The two questions "hardcore" used to answer (issue #79, the user's request 2026-10-27). A leaf module (no imports), so
// any module may read it without an import cycle.
// - isRoadStart: the run opens the day Calder falls, on the road with no hub (hardcore.js, hardcore-start.js and its
//   outbreak, groups and loot; state.hardcore holds that opening's data, its old name). Normal and Hardcore both do.
//   state.start is "road" or "hub"; a world without it (a headless tool's, createWorld's default) is a road start only
//   in Hardcore. Custom and Crashlanding start at a hub.
// - isHardcore: the hard rules on top (hardrules.js): Ironman, scarcity, escalation, fog of war.
export const isRoadStart = (state) => !!state && (state.start ? state.start === "road" : state.mode === "hardcore");
export const isHardcore = (state) => !!state && state.mode === "hardcore";
// The new-run screen's modes that open on the road ("normal" and "hardcore"; "custom" and "crash" open at a hub).
export const roadScreenMode = (mode) => mode === "normal" || mode === "hardcore";
