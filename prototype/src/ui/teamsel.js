// "The selected team": the one team the map's right-click menu (ui/teamctx.js) gives orders to. Everything that asks
// which team is selected goes through selectedTeam, so every way of selecting one plugs in here and nowhere else.
//
// A team is selected when (first match wins):
//   ui.selParty   a team picked on the map (ui/mapselect.js: ui.mapSel / ui.selParty), while it is in contact
//                 (commandable, sim/plans.js); one out of contact falls through to the next
//   ui.expedition its team panel is open (a click on the team on the map, its row in the Teams tab, a card's
//                 "Team panel…", Locate in the Watching panel), in contact or not (the menu then says why not)
//   ui.moveParty  move mode is on for it (the team panel's Move…)
// Only your own teams count (not convoys, not another group's party), and only while they still exist.
import { commandable } from "../sim/plans.js";

/** @param {any} p */
const ownTeam = (p) => !!p && p.owner === "player" && p.kind !== "convoy";
/** @param {State} state @param {any} id */
const find = (state, id) => (id == null ? null : state.parties.find((q) => q.id === Number(id)) || null);

/**
 * The selected team, or null.
 * @param {State} state
 * @param {any} ui
 * @returns {Party | null}
 */
export function selectedTeam(state, ui) {
  if (!state || !ui || !state.parties) return null;
  const sel = find(state, ui.selParty);
  if (ownTeam(sel) && commandable(state, sel)) return sel;
  for (const id of [ui.expedition, ui.moveParty]) {
    const p = find(state, id);
    if (ownTeam(p)) return p;
  }
  return null;
}
