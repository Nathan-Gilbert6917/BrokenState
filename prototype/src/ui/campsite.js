// The camp's spot (the user's requests 2026-10-22: "When you establish a base choose where in the 250 x 250 with a
// highlighted 10x10 to start ...", then "reduce to 5x5 with camp site in the middle ... when hovering to set site
// location say how long and what the yield will be", and "keep the isometric view just have a isometric highlight of
// the 5x5 area"): a team of yours that has reached its tile to Set up camp, Establish base or Build outpost asks where
// on the tile's 500 × 500 map the camp goes (sim/staging.js askSite / pendingSite / pickSite). The tile's whole map
// opens in the isometric view (sim/basemap.js openSiteView: its land, nothing built), the 5 × 5 under the mouse drawn
// on the ground green where the camp can go and red where not, the one picked in gold (siteGhostAt); the hover line
// and this panel say how long the camp fire and the clearing take this team there and what the land gives, the axe's
// difference too (sim/staging.js siteSetup). The view holds the clock (a battle screen) until it is answered.
// What the spot is like (the user's words 2026-10-23: "add valuable information to setting up camp. Update let the
// game pick"): the panel and the hover line read the one set of facts (sim/siteinfo.js siteInfo): the setup's time and
// yield, the ground (level, a hill dug down, a hollow filled in) and the lie of the land round it (looking down on it,
// or overlooked), sight lines, room to grow, wood near for the fires, the river and the road, the places on the tile
// the team knows of, the dead to clear first and their kinds; good green, bad red. The game's own spot (Let the game
// pick: sim/siteinfo.js bestSite, weighed on the same facts) says why it was picked when it is the one shown.
//   siteFacts(info)                 the panel's rows of facts (a .kv grid)
//   siteFactLine(info)              the hover line's facts, short
//   siteViewDue(state, ui)          main.js tidyUi: a team waiting for its spot and nothing else on screen: open the view
//   sitePanel(state, b, cui, prev)  the view's side panel (ui/combat.js)
//   siteHoverText(state, b, h)      the hover line (ui/combat.js previewText)
//   siteKey(state, e, confirm)      Enter sets up camp on the spot picked, Esc lets the game pick
//   CS_ACTIONS                      cs-ok sets up camp on the spot picked, cs-auto lets the game pick (sim/basemap.js defaultSite)
import { pendingSite, pickSite, autoSite, durText, levelWords } from "../sim/staging.js";
import { siteProblem, openSiteView, defaultSite, BASE_GRID, GRID } from "../sim/basemap.js";
import { SITE } from "../sim/basescatter.js";
import { siteInfo, pickWords, SITE_INFO } from "../sim/siteinfo.js"; // the spot's facts (the dead to clear first among them: sim/siteclear.js siteThreat)
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
const getWords = (get) => Object.entries(get).filter(([, v]) => v > 0).map(([k, v]) => `+${v} ${k === "carparts" ? `car part${v === 1 ? "" : "s"}` : k === "metalsheet" ? `metal sheet${v === 1 ? "" : "s"}` : k === "buildmat" ? "building materials" : k}`).join(", ");
const pct = (v) => `${Math.round(v * 100)}%`;
const num = (v) => Math.round(v).toLocaleString("en-US");
const hrs = (h) => { const v = h >= 10 ? Math.round(h) : h; return `${v} work-hour${v === 1 ? "" : "s"}`; };
const cells = (d) => `${d} cell${d === 1 ? "" : "s"}`;
// What the spot takes and gives this team: "4 h 30 min to set up (the camp fire, 1 work-hour, and 8 work-hours clearing
// 3 things, shared by 2 people)", the ground's levelling to the camp's level named as such ("12 work-hours digging 12
// cells down level", not "clearing 12 things": the user's report 2026-10-23), "+375 wood", and what an axe changes
// (sim/siteinfo.js siteInfo: setup, other).
export function setupWords(state, p, tile, at, info = siteInfo(state, p, tile, at)) {
  const s = info.setup, o = info.other, d = s.dig || { hours: 0, up: 0, down: 0 }, rest = s.n - d.up - d.down;
  const level = levelWords(d);
  const clear = [level ? `${hrs(d.hours)} ${level}` : "", rest > 0 ? `${hrs(Math.round((s.clear - d.hours) * 10) / 10)} clearing ${rest} thing${rest === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ") || "nothing to clear";
  const fire = Math.round((s.work - s.clear) * 10) / 10;
  // The axe's difference (sim/basescatter.js SITE.NO_TOOL_WOOD): the same spot with or without a cutting tool.
  const axe = !o ? "" : s.tool ? `Without the team's axe, saw or machete: ${durText(o.hours)}, ${o.wood} wood.` : `No axe, saw or machete on the team: the trees are cleared the slow way for a quarter of their wood (with one: ${durText(o.hours)}, ${o.wood} wood).`;
  return { s, time: durText(s.hours), text: `${durText(s.hours)} to set up (the camp fire, ${fire} work-hour${fire === 1 ? "" : "s"}, and ${clear}, shared by ${s.workers} ${s.workers === 1 ? "person" : "people"})`, gives: getWords(s.get) || "nothing worth keeping", axe };
}

// ---------- the facts, as words (sim/siteinfo.js siteInfo) ----------
// Each: [label, text, tone ("good" | "danger" | "warn" | ""), tip, short (the hover line's, "": left out)].
function factList(f) {
  const out = [];
  const G = f.ground, lv = (n) => `${n} level${n === 1 ? "" : "s"}`;
  // The camp stands at its 5 × 5's own level (sim/basescatter.js siteLevel; the user's request 2026-10-23: on a hill, up
  // on it): hi and lo are from that level; at: the level over the plain's.
  const at = G.at || 0, where = at > 0 ? `on a hill, ${lv(at)} up` : at < 0 ? `down in a hollow, ${lv(-at)}` : "";
  const fix = [G.hi > 0 ? `higher ground (up to ${lv(G.hi)}) dug down` : "", G.lo < 0 ? `lower ground (${lv(-G.lo)}) filled in` : ""].filter(Boolean).join(" and ");
  out.push(["Ground", G.level ? (where ? `Level, ${where}: the camp stands on it` : "Level") : `Uneven: ${fix} to the camp's level${where ? `, ${where}` : ""} (${hrs(G.dig)} of the setup)`, G.level ? "good" : "warn",
    "The camp stands on level ground at its square's own level (on a hill, up on it; in a hollow, down in it): the setup digs down what is higher and fills in what is lower (part of the setup's time)", G.level ? (at > 0 ? "a level hilltop" : at < 0 ? "level, in a hollow" : "level") : "levelled"]);
  const L = f.lie;
  out.push(["Round it", L.kind === "high" ? `Looks down on it (${pct(L.lower)} lower): good to hold` : L.kind === "low" ? `Overlooked: ${pct(L.higher)} of it higher` : L.kind === "flat" ? "Flat all round" : `Uneven (${pct(L.higher)} higher, ${pct(L.lower)} lower)`,
    L.kind === "high" ? "good" : L.kind === "low" ? "danger" : "", "The ground 4 to 10 cells out against the camp once it stands level: lower ground is easier to hold; higher ground gives whoever comes the height and hides them", L.kind === "high" ? "looks down on it" : L.kind === "low" ? "overlooked" : L.kind === "flat" ? "flat round" : "uneven round"]);
  out.push(["Sight", `${pct(f.sight)} open within ${SITE_INFO.SIGHT} cells${f.sight < 0.6 ? ": cover for the dead to come up unseen" : ""}`, f.sight >= 0.85 ? "good" : f.sight < 0.6 ? "danger" : "warn",
    "Trees, buildings, wrecks, rock and higher ground near the camp hide what comes at it", `sight ${pct(f.sight)}`]);
  const R2 = SITE_INFO.ROOM * 2, Y = f.yard * 2;
  // The yard grows with the base, never past the map's edge (a hub's to 180 × 180, an outpost's to 100 × 100).
  const edge = f.yard < GRID.outpost.cap;
  out.push(["Room", `${pct(f.room)} open in the ${R2} × ${R2} round it${f.room < 1 && f.roomClear ? ` (the rest ${hrs(f.roomClear)} to clear)` : ""}; ${f.yard >= GRID.hub.cap ? `room to grow into a base (${Y} × ${Y})` : edge ? `near the edge: a yard of ${Y} × ${Y} at most` : `a base's yard grows to ${Y} × ${Y} here`}`, f.room >= 0.8 && !edge ? "good" : f.room < 0.55 || edge ? "danger" : "",
    "Open ground round the fire for tents and buildings; the yard grows with the base, never past the map's edge", `room ${pct(f.room)}${edge ? ", near the edge" : ""}`]);
  out.push(["Wood", f.wood ? `About ${num(f.wood)} standing within ${SITE_INFO.WOOD} cells${f.trees ? ` (${f.trees} tree${f.trees === 1 ? "" : "s"})` : ""}` : `None within ${SITE_INFO.WOOD} cells`, f.wood >= 1200 ? "good" : f.wood < 300 ? "danger" : "",
    "Trees, logs, stumps and bushes near the camp, felled on the base map for the fires and building", `wood ${f.wood >= 1000 ? `${Math.round(f.wood / 100) / 10}k` : num(f.wood)}`]);
  const w = f.waterTile;
  const tileWater = w ? `${w.kind === "river" ? "a river" : "a lake"} ${w.dist <= 1 ? "beside the tile: its people haul it" : `${w.dist} tiles off`}` : "none near the tile: every drop carried in";
  out.push(["Water", f.water != null ? `The river ${cells(f.water)} off` : `No river on this map; ${tileWater}`, f.water != null && f.water <= 30 ? "good" : !w ? "danger" : "",
    `On the tile: ${tileWater}`, f.water != null ? `river ${f.water}` : w ? "" : "no water"]);
  out.push(["Road", f.road == null ? "None on this map" : f.road ? `${cells(f.road)} off` : "Through or beside the camp's 5 × 5", f.road != null && f.road <= 10 ? "good" : "", "A road or a street: the way in for vehicles", f.road == null ? "" : f.road ? `road ${f.road}` : "by the road"]);
  const pl = (f.places || []).slice(0, 3);
  out.push(["Places", pl.length ? pl.map((q) => `${q.name} ${q.d < 4 ? "right here" : `${cells(q.d)}${q.dir ? ` ${q.dir}` : ""}`}`).join("; ") : "None known on this tile", "",
    "The places on this tile your people know of: raided from the camp, the nearer the shorter the walk", pl.length ? `${pl[0].name} ${pl[0].d < 4 ? "here" : `${pl[0].d}${pl[0].dir ? ` ${pl[0].dir.replace(/[a-z]+/g, (m) => m[0].toUpperCase()).replace("-", "")}` : ""}`}` : ""]);
  return out;
}
/** The panel's rows of facts (a .kv grid; good green, bad red). @param {any} info sim/siteinfo.js siteInfo */
export function siteFacts(info) {
  if (!info || !info.ok) return "";
  return `<div class="kv small" style="margin-top:0.35rem">${factList(info).map(([k, v, tone, t]) => `<div${tip(t)}>${esc(k)}</div><div${tone ? ` class="${tone}"` : ""}>${esc(v)}</div>`).join("")}</div>`;
}
/** The hover line's facts, short ("level · overlooked · sight 84% · room 78% · wood 1.9k · river 40 · Gas station 30 NE"). @param {any} info */
export function siteFactLine(info) {
  if (!info || !info.ok) return "";
  return factList(info).filter((x) => x[4]).map(([, , tone, , short]) => (tone ? `<span class="${tone}">${esc(short)}</span>` : esc(short))).join(" · ");
}
// "The game picked this spot because …" (sim/siteinfo.js pickWords), on its own spot.
const pickLine = (info) => (info && info.ok && info.picked ? `<div class="small warn" style="margin-top:0.3rem"${tip("Let the game pick weighs every spot in reach: the setup's time, the lie of the land, sight lines, room to grow, wood, the river and the road")}>${esc(pickWords(info))}</div>` : "");

// The hover line: the 5 × 5 under the mouse, how long and what it gives (or why not), and what it is like.
export function siteHoverText(state, b, h) {
  const p = viewTeam(state);
  if (!p || !h) return "";
  const F = b.deployPlan && b.deployPlan.fort;
  const at = [h.x - F.ox, h.y - F.oy];
  const info = siteInfo(state, p, b.site.tile, at);
  if (!info.ok) return `<span class="danger">Here: ${esc(info.why)}.</span>`;
  const w = setupWords(state, p, b.site.tile, at, info);
  return `<b>Here:</b> ${esc(w.text)}; gives <b>${esc(w.gives)}</b>.${w.axe ? ` <span class="muted">${esc(w.axe)}</span>` : ""}<br>${siteFactLine(info)}${info.picked ? ` <span class="warn">· the game's pick</span>` : ""} <span class="muted">Click to pick it.</span>`;
}

// The dead to clear first (sim/siteclear.js siteThreat, sim/siteinfo.js dead): a town's, a city's or an infected tile's spot.
function deadCard(info) {
  const th = info.dead;
  if (!th.count) return `<div class="card small" style="margin-top:0.4rem;flex:none"><b>The dead</b>: <span class="good">${th.place === "land" ? "few about, none in the way" : "none in the way"}</span>: the team sets up camp at once.</div>`;
  return `<div class="card small" style="margin-top:0.4rem;flex:none"><b class="danger">The dead: about ${th.count} here</b> (${th.place === "city" ? "a city" : th.place === "town" ? "a town" : "infected land"}${th.kinds ? `; among them ${esc(th.kinds)}` : ""}). The team clears them first: a fight round the spot, your people from the west, none drawn in. Win and the camp goes up; pull back and the spot stays theirs. <span class="muted">The same anywhere on this tile.</span></div>`;
}
// The side panel: what this is, the spot picked with its time, yield and facts, Set up camp here, Let the game pick.
export function sitePanel(state, b, cui, preview = "") {
  const p = viewTeam(state);
  if (!p) return "";
  const tile = b.site.tile, at = b.site.sel;
  const info = at ? siteInfo(state, p, tile, at) : { ok: false, why: "Click where the camp goes" };
  const why = info.ok ? "" : info.why;
  const w = why ? null : setupWords(state, p, tile, at, info);
  const what = p.mission === "outpost" ? "the outpost camp" : p.mission === "establish" ? "your new home" : "the camp";
  const dead = info.ok ? info : siteInfo(state, p, tile, defaultSite(state, tile));
  return `<div class="cbhead"><div class="cbtitle">Where does ${esc(what)} go?</div>
    <div class="small muted">${esc(teamName(state, p))} is at ${esc(tileLabel(state, tile))}: its whole map, ${BASE_GRID} × ${BASE_GRID}. The square under the mouse is the camp's ${S} × ${S}, its fire in the middle: green where it can go, red where not (the tinted ground is too near the edge). The team builds the fire and clears the square, what it gives into the camp's stores. The clock waits.</div></div>
    <div style="flex:none">${preview}</div>
    ${cui && cui.msg ? `<div class="small danger" style="margin-top:0.3rem">${esc(cui.msg)}</div>` : ""}
    <div class="card small" style="margin-top:0.4rem;flex:none"><div class="spread"><b>Camp site picked</b><span class="muted">${at ? esc(placeWords(at)) : ""}</span></div>
      ${why ? `<div class="danger">${esc(why)}</div>` : `<div><b>${esc(w.time)}</b> to set up: ${esc(w.text.replace(/^.*? to set up \(/, "").replace(/\)$/, ""))}.</div><div>Gives <b>${esc(w.gives)}</b>.</div>${w.axe ? `<div class="muted">${esc(w.axe)}</div>` : ""}${siteFacts(info)}${pickLine(info)}`}
    </div>
    ${dead.ok ? deadCard(dead) : ""}
    <div class="cbfoot"><button data-action="cs-auto"${tip("Let the game pick: the best spot in reach by the setup's time, the lie of the land, sight lines, room to grow, wood, the river and the road (Esc)")}>Let the game pick <span class="key">Esc</span></button><button class="primary" data-action="cs-ok" ${why ? "disabled" : ""}${tip("Set up camp with its fire in the middle of the gold square (Enter)")}>Set up camp here <span class="key">Enter</span></button></div>`;
}

// The view closes first: a spot with the dead about it opens their fight at once (sim/siteclear.js clearSiteFirst).
export const CS_ACTIONS = {
  "cs-ok": (state) => {
    const p = viewTeam(state), b = state.combat;
    if (!p || !b.site.sel || siteProblem(state, b.site.tile, b.site.sel)) return;
    state.combat = null;
    pickSite(state, p, b.site.sel);
  },
  "cs-auto": (state) => {
    const p = viewTeam(state);
    state.combat = null;
    if (p) autoSite(state, p);
  },
};
// Enter sets up camp on the spot picked, Esc lets the game pick. True when the key was used.
export function siteKey(state, e, confirm) {
  if (!state.combat || !state.combat.site) return false;
  if (confirm || e.code === "Enter" || e.code === "NumpadEnter") { CS_ACTIONS["cs-ok"](state); return true; }
  if (e.code === "Escape") { CS_ACTIONS["cs-auto"](state); return true; }
  return false;
}
