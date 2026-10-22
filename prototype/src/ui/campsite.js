// The camp's spot (the user's requests 2026-10-22: "When you establish a base choose where in the 250 x 250 with a
// highlighted 10x10 to start ...", then "reduce to 5x5 with camp site in the middle ... when hovering to set site
// location say how long and what the yield will be", and "keep the isometric view just have a isometric highlight of
// the 5x5 area"): a team of yours that has reached its tile to Set up camp, Establish base or Build outpost asks where
// on the tile's 250 × 250 map the camp goes (sim/staging.js askSite / pendingSite / pickSite). The tile's whole map
// opens in the isometric view (sim/basemap.js openSiteView: its land, nothing built), the 5 × 5 under the mouse drawn
// on the ground green where the camp can go and red where not, the one picked in gold (siteGhostAt); the hover line
// and this panel say how long the camp fire and the clearing take this team there and what the land gives, the axe's
// difference too (sim/staging.js siteSetup). The view holds the clock (a battle screen) until it is answered.
//   siteViewDue(state, ui)          main.js tidyUi: a team waiting for its spot and nothing else on screen: open the view
//   sitePanel(state, b, cui, prev)  the view's side panel (ui/combat.js)
//   siteHoverText(state, b, h)      the hover line (ui/combat.js previewText)
//   siteKey(state, e, confirm)      Enter sets up camp on the spot picked, Esc lets the game pick
//   CS_ACTIONS                      cs-ok sets up camp on the spot picked, cs-auto lets the game pick (sim/basemap.js defaultSite)
import { pendingSite, pickSite, autoSite, siteSetup, durText } from "../sim/staging.js";
import { siteProblem, openSiteView, BASE_GRID } from "../sim/basemap.js";
import { SITE } from "../sim/basescatter.js";
import { tileLabel, teamName } from "../sim/parties.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const S = SITE.SIZE; // the square's side (5), the fire in its middle cell

// The team the open view is for (its spot not answered yet), or null.
function viewTeam(state) {
  const b = state.combat;
  if (!b || !b.site) return null;
  const p = pendingSite(state);
  return p && p.id === b.site.partyId ? p : null;
}
// main.js tidyUi: a team of yours waiting for its spot, nothing else on screen: the view opens (the clock waits under
// it). A view whose team is no longer waiting (gone, answered) closes.
export function siteViewDue(state, ui) {
  const b = state.combat;
  if (b && b.site) { if (!viewTeam(state)) state.combat = null; return; }
  if (b || state.autopilot || state.gameOver || !ui.started) return;
  const p = pendingSite(state);
  if (p) openSiteView(state, p);
}

const placeWords = ([x, y]) => (x || y ? `${[x ? `${Math.abs(x)} ${x > 0 ? "east" : "west"}` : "", y ? `${Math.abs(y)} ${y > 0 ? "south" : "north"}` : ""].filter(Boolean).join(" and ")} of the map's middle` : "in the middle of the map");
const getWords = (get) => Object.entries(get).filter(([, v]) => v > 0).map(([k, v]) => `+${v} ${k === "carparts" ? `car part${v === 1 ? "" : "s"}` : k === "metalsheet" ? `metal sheet${v === 1 ? "" : "s"}` : k}`).join(", ");
// What the spot takes and gives this team: "4 h 30 min to set up (the camp fire, 1 work-hour, and 8 work-hours clearing
// 3 things, shared by 2 people)", "+375 wood", and what an axe changes.
export function setupWords(state, p, tile, at) {
  const s = siteSetup(state, p, tile, at);
  const clear = s.n ? `${s.clear} work-hour${s.clear === 1 ? "" : "s"} clearing ${s.n} thing${s.n === 1 ? "" : "s"}` : "nothing to clear";
  const fire = Math.round((s.work - s.clear) * 10) / 10;
  // The axe's difference (sim/basescatter.js SITE.NO_TOOL_WOOD): the same spot with or without a cutting tool.
  const o = siteSetup(state, p, tile, at, !s.tool), differs = o.hours !== s.hours || (o.get.wood || 0) !== (s.get.wood || 0);
  const axe = !differs ? "" : s.tool ? `Without the team's axe, saw or machete: ${durText(o.hours)}, ${o.get.wood || 0} wood.` : `No axe, saw or machete on the team: the trees are cleared the slow way for a quarter of their wood (with one: ${durText(o.hours)}, ${o.get.wood || 0} wood).`;
  return { s, time: durText(s.hours), text: `${durText(s.hours)} to set up (the camp fire, ${fire} work-hour${fire === 1 ? "" : "s"}, and ${clear}, shared by ${s.workers} ${s.workers === 1 ? "person" : "people"})`, gives: getWords(s.get) || "nothing worth keeping", axe };
}

// The hover line: the 5 × 5 under the mouse, how long and what it gives (or why not).
export function siteHoverText(state, b, h) {
  const p = viewTeam(state);
  if (!p || !h) return "";
  const F = b.deployPlan && b.deployPlan.fort;
  const at = [h.x - F.ox, h.y - F.oy];
  const why = siteProblem(state, b.site.tile, at);
  if (why) return `<span class="danger">Here: ${esc(why)}.</span>`;
  const w = setupWords(state, p, b.site.tile, at);
  return `<b>Here:</b> ${esc(w.text)}; gives <b>${esc(w.gives)}</b>.${w.axe ? ` <span class="muted">${esc(w.axe)}</span>` : ""} <span class="muted">Click to pick it.</span>`;
}

// The side panel: what this is, the spot picked with its time and yield, Set up camp here, Let the game pick.
export function sitePanel(state, b, cui, preview = "") {
  const p = viewTeam(state);
  if (!p) return "";
  const tile = b.site.tile, at = b.site.sel;
  const why = at ? siteProblem(state, tile, at) : "Click where the camp goes";
  const w = why ? null : setupWords(state, p, tile, at);
  const what = p.mission === "outpost" ? "the outpost camp" : p.mission === "establish" ? "your new home" : "the camp";
  return `<div class="cbhead"><div class="cbtitle">Where does ${esc(what)} go?</div>
    <div class="small muted">${esc(teamName(state, p))} is at ${esc(tileLabel(state, tile))}: its whole map, ${BASE_GRID} × ${BASE_GRID}, the same for every base. The square under the mouse is the camp's ${S} × ${S}, its fire in the middle: green where it can go, red where not. The team builds the fire and clears the square while it sets up (the time by what stands there, shared by the team), and what the land there gives goes into the camp's stores; the rest you clear as you build. The tinted ground is too near the map's edge. The clock waits.</div></div>
    <div class="card small" style="margin-top:0.4rem"><div class="spread"><b>Camp site</b><span class="muted">${at ? esc(placeWords(at)) : ""}</span></div>
      ${why ? `<div class="danger">${esc(why)}</div>` : `<div><b>${esc(w.time)}</b> to set up: ${esc(w.text.replace(/^.*? to set up \(/, "").replace(/\)$/, ""))}.</div><div>Gives <b>${esc(w.gives)}</b>.</div>${w.axe ? `<div class="muted">${esc(w.axe)}</div>` : ""}`}
    </div>
    ${cui && cui.msg ? `<div class="small danger" style="margin-top:0.3rem">${esc(cui.msg)}</div>` : ""}
    ${preview}
    <div class="cbfoot"><button data-action="cs-auto"${tip("Let the game pick: the middle of the map, or the nearest open spot to it (Esc)")}>Let the game pick <span class="key">Esc</span></button><button class="primary" data-action="cs-ok" ${why ? "disabled" : ""}${tip("Set up camp with its fire in the middle of the gold square (Enter)")}>Set up camp here <span class="key">Enter</span></button></div>`;
}

export const CS_ACTIONS = {
  "cs-ok": (state) => {
    const p = viewTeam(state), b = state.combat;
    if (!p || !b.site.sel) return;
    const why = pickSite(state, p, b.site.sel);
    if (why) return;
    state.combat = null;
  },
  "cs-auto": (state) => {
    const p = viewTeam(state);
    if (p) autoSite(state, p);
    state.combat = null;
  },
};
// Enter sets up camp on the spot picked, Esc lets the game pick. True when the key was used.
export function siteKey(state, e, confirm) {
  if (!state.combat || !state.combat.site) return false;
  if (confirm || e.code === "Enter" || e.code === "NumpadEnter") { CS_ACTIONS["cs-ok"](state); return true; }
  if (e.code === "Escape") { CS_ACTIONS["cs-auto"](state); return true; }
  return false;
}
