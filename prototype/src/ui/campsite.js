// The camp's spot (the user's request 2026-10-22: "When you establish a base choose where in the 250 x 250 with a
// highlighted 10x10 to start ...", then "reduce to 5x5 with camp site in the middle ... when hovering to set site
// location say how long and what the yield will be"): a team of yours that
// has reached its tile to Set up camp, Establish base or Build outpost asks where on the tile's 250 × 250 map the camp
// goes (sim/staging.js askSite / pendingSite / pickSite). The window shows the tile's land from above (trees, bushes,
// rocks, fences, wrecks, the road, the river: sim/basemap.js siteLand), the 5 × 5 square under the mouse with how long
// the camp fire and its clearing take this team there and what the land gives (sim/staging.js siteSetup; red where it
// cannot go: sim/basemap.js siteProblem), and the one picked, the same. It holds the clock until it is answered.
//   siteModalUp(state, ui)  is the window showing (main.js blocked, ui/ui.js renderModal)
//   siteModal(state, ui)    its HTML
//   CS_ACTIONS              click handlers (main.js): cs-click picks the spot under the mouse, cs-ok sets up camp
//                           there, cs-auto lets the game pick (sim/basemap.js defaultSite)
//   siteHover(state, ui, e) main.js mousemove: the square follows the mouse (no redraw)
//   csKey                   Enter sets up camp on the spot picked, Esc lets the game pick
import { pendingSite, pickSite, autoSite, siteSetup, durText } from "../sim/staging.js";
import { siteLand, siteProblem, defaultSite, SITE_RANGE, BASE_GRID, GRID_MAX } from "../sim/basemap.js";
import { SITE } from "../sim/basescatter.js";
import { partyTile, tileLabel, teamName } from "../sim/parties.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const S = SITE.SIZE; // the square's side (5), the fire in its middle cell

function target(state, ui) {
  if (state.autopilot || state.combat || state.gameOver || !ui.started) return null;
  return pendingSite(state);
}
export const siteModalUp = (state, ui) => !!target(state, ui);

// The spot picked in the window (map coordinates of the fire), the game's own to start with.
function picked(state, ui, p) {
  if (ui.siteFor !== p.id || !Array.isArray(ui.siteSel)) { ui.siteFor = p.id; ui.siteSel = defaultSite(state, partyTile(p)); ui.siteMsg = ""; }
  return ui.siteSel;
}

// ---------- the picture of the land ----------
// One pixel a cell, the tile's land from above; the ground the camp cannot reach (too near the edge) darkened.
const COLOURS = {
  tree: [38, 74, 40], clump: [38, 74, 40], bush: [78, 112, 56], stump: [104, 84, 58], log: [112, 86, 56], fence: [122, 98, 70],
  hay: [186, 160, 84], rock: [128, 128, 122], boulder: [96, 96, 92], crate: [118, 96, 72], barrel: [96, 90, 84], wreck: [140, 72, 48], water: [58, 98, 142],
};
const FLOORS = { road: [70, 70, 72], gravel: [150, 146, 136] };
const GROUND = { forest: [92, 118, 70], plains: [124, 142, 84], farm: [134, 146, 86], hills: [122, 132, 92], mountain: [118, 118, 106], suburb: [118, 134, 92], city: [112, 116, 106] };
const pictures = new Map(); // tile → data URL
function landPicture(state, tile) {
  if (typeof document === "undefined") return "";
  const key = `${state.seed}|${tile}`;
  if (pictures.has(key)) return pictures.get(key);
  const land = siteLand(state, tile), N = BASE_GRID, G = GRID_MAX;
  const t = state.tiles[tile] || {};
  const ground = GROUND[t.loc && ["farm", "ranch", "barn"].includes(t.loc.type) ? "farm" : t.terrain] || GROUND.plains;
  const cv = document.createElement("canvas");
  cv.width = N; cv.height = N;
  const c = cv.getContext("2d");
  const img = c.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const mx = x - G, my = y - G, k = `${mx},${my}`;
    const p = land.pieces.get(k);
    let col = p ? COLOURS[p.k] || ground : FLOORS[land.floors.get(k)] || ground;
    if (!p && !land.floors.has(k) && (x * 7 + y * 13) % 11 === 0) col = col.map((v) => v - 8); // a little texture
    if (Math.abs(mx) > SITE_RANGE - SITE.LO || Math.abs(my) > SITE_RANGE - SITE.LO) col = col.map((v) => Math.round(v * 0.55));
    const i = (y * N + x) * 4;
    img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  const url = cv.toDataURL("image/png");
  if (pictures.size > 8) pictures.clear();
  pictures.set(key, url);
  return url;
}

// The square's place on the picture, in percent (left, top, size).
const boxStyle = ([x, y]) => `left:${((x + SITE.LO + GRID_MAX) / BASE_GRID) * 100}%;top:${((y + SITE.LO + GRID_MAX) / BASE_GRID) * 100}%;width:${(S / BASE_GRID) * 100}%;height:${(S / BASE_GRID) * 100}%`;
const dotStyle = ([x, y]) => `left:${((x + GRID_MAX) / BASE_GRID) * 100}%;top:${((y + GRID_MAX) / BASE_GRID) * 100}%;width:${(1 / BASE_GRID) * 100}%;height:${(1 / BASE_GRID) * 100}%`;
// What the spot takes and gives this team: "4 h 30 min (the fire 1 and 8 work-hours clearing 3 trees and a bush, for 2 people) · gives +375 wood".
function setupWords(state, p, tile, at) {
  const s = siteSetup(state, p, tile, at);
  const clear = s.n ? `${s.clear} work-hour${s.clear === 1 ? "" : "s"} clearing ${s.n} thing${s.n === 1 ? "" : "s"}` : "nothing to clear";
  const fire = Math.round((s.work - s.clear) * 10) / 10;
  // The axe's difference (sim/basescatter.js SITE.NO_TOOL_WOOD): the same spot with or without a cutting tool.
  const o = siteSetup(state, p, tile, at, !s.tool), differs = o.hours !== s.hours || (o.get.wood || 0) !== (s.get.wood || 0);
  const axe = !differs ? "" : s.tool ? ` Without the team's axe, saw or machete: ${durText(o.hours)}, ${o.get.wood || 0} wood.` : ` No axe, saw or machete on the team: the trees are cleared the slow way for a quarter of their wood (with one: ${durText(o.hours)}, ${o.get.wood || 0} wood).`;
  return { s, text: `${durText(s.hours)} to set up (the camp fire, ${fire} work-hour${fire === 1 ? "" : "s"}, and ${clear}, shared by ${s.workers} ${s.workers === 1 ? "person" : "people"})`, gives: getWords(s.get) || "nothing worth keeping", axe };
}
const placeWords = ([x, y]) => (x || y ? `${[x ? `${Math.abs(x)} ${x > 0 ? "east" : "west"}` : "", y ? `${Math.abs(y)} ${y > 0 ? "south" : "north"}` : ""].filter(Boolean).join(" and ")} of the middle` : "in the middle of the map");
const getWords = (get) => Object.entries(get).filter(([, v]) => v > 0).map(([k, v]) => `+${v} ${k === "carparts" ? `car part${v === 1 ? "" : "s"}` : k === "metalsheet" ? `metal sheet${v === 1 ? "" : "s"}` : k}`).join(", ");

export function siteModal(state, ui) {
  const p = target(state, ui);
  if (!p) return "";
  const tile = partyTile(p), at = picked(state, ui, p);
  const why = ui.siteMsg || siteProblem(state, tile, at);
  const w = why ? null : setupWords(state, p, tile, at);
  const url = landPicture(state, tile);
  const what = p.mission === "outpost" ? "the outpost camp" : p.mission === "establish" ? "your new home" : "the camp";
  return `<div class="box campsitebox">
    <h1>Where does ${esc(what)} go?</h1>
    <div class="text small">${esc(teamName(state, p))} is at ${esc(tileLabel(state, tile))}. Its map is ${BASE_GRID} × ${BASE_GRID} cells, the same for every base: click where the camp goes. The team builds its camp fire in the middle of the ${S} × ${S} square and clears the square while it sets up (the time by what stands there, shared by the team), and what the land there gives (wood from the trees, scrap from crates and wrecks) goes into its stores; everything else you build round it, clearing more as you need it (the build map). The darkened edge is too near the map's edge for the camp's yard and a wall round it.</div>
    <div class="campsite-map" data-action="cs-click" style="position:relative;margin:0.6rem auto 0;width:min(100%, 500px);aspect-ratio:1;cursor:crosshair;background:#5c6e44"${tip("Click to pick the spot: the square is the camp's clearing, its fire in the middle")}>
      ${url ? `<img src="${url}" alt="The tile's land" draggable="false" style="position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;pointer-events:none">` : ""}
      <div class="campsite-pick${why ? " bad" : ""}" style="position:absolute;${boxStyle(at)};box-sizing:border-box;border:2px solid ${why ? "#e05040" : "#ffd84a"};background:${why ? "rgba(224,80,64,0.25)" : "rgba(255,216,74,0.3)"};pointer-events:none"></div>
      <div style="position:absolute;${dotStyle(at)};background:#ff8a2a;box-shadow:0 0 3px #ffb060;pointer-events:none"></div>
      <div id="cs-hover" style="position:absolute;display:none;box-sizing:border-box;border:2px dashed #fff;pointer-events:none"></div>
    </div>
    <div id="cs-hoverinfo" class="small muted" style="margin-top:0.4rem;min-height:1.2em">Hover the map: how long the camp takes there and what it gives.</div>
    <div class="small" style="margin-top:0.3rem"><b>Picked:</b> the fire ${esc(placeWords(at))}.
      ${why ? `<span class="danger">${esc(why)}</span>` : `${esc(w.text)}; gives ${esc(w.gives)}.<span class="muted">${esc(w.axe)}</span>`}</div>
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end">
      <button data-action="cs-auto"${tip("Let the game pick: the middle of the map, or the nearest open spot to it")}>Let the game pick</button>
      <button class="primary" data-action="cs-ok" ${why ? "disabled" : ""}${tip("Set up camp with its fire in the middle of the square")}>Set up camp here</button>
    </div>
  </div>`;
}

// The cell under the mouse on the picture (map coordinates), held within the camp's reach.
function cellAt(el, e) {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const clamp = (v) => Math.max(-SITE_RANGE, Math.min(SITE_RANGE, v));
  return [clamp(Math.floor(((e.clientX - r.left) / r.width) * BASE_GRID) - GRID_MAX), clamp(Math.floor(((e.clientY - r.top) / r.height) * BASE_GRID) - GRID_MAX)];
}
function finish(state, ui) {
  ui.siteFor = null; ui.siteSel = null; ui.siteMsg = "";
}
export const CS_ACTIONS = {
  "cs-click": (state, ui, d, e) => {
    const el = e && e.target && e.target.closest ? e.target.closest(".campsite-map") : null;
    const at = el ? cellAt(el, e) : null;
    if (at) { ui.siteSel = at; ui.siteMsg = ""; }
  },
  "cs-ok": (state, ui) => {
    const p = target(state, ui);
    if (!p) return;
    const why = pickSite(state, p, picked(state, ui, p));
    if (why) { ui.siteMsg = why; return; }
    finish(state, ui);
  },
  "cs-auto": (state, ui) => {
    const p = target(state, ui);
    if (p) autoSite(state, p);
    finish(state, ui);
  },
};
// The square follows the mouse over the picture (main.js mousemove; no redraw): white where it can go, red where not.
export function siteHover(state, ui, e) {
  const el = e.target && e.target.closest ? e.target.closest(".campsite-map") : null;
  const box = typeof document !== "undefined" ? document.getElementById("cs-hover") : null;
  if (!box) return;
  const info = document.getElementById("cs-hoverinfo");
  const p = el ? target(state, ui) : null;
  const at = p ? cellAt(el, e) : null;
  if (!at) { box.style.display = "none"; return; }
  if (box.dataset.at === String(at)) return; // the same cell: nothing new to say
  box.dataset.at = String(at);
  const why = siteProblem(state, partyTile(p), at);
  box.setAttribute("style", `position:absolute;${boxStyle(at)};box-sizing:border-box;border:2px dashed ${why ? "#e05040" : "#fff"};pointer-events:none`);
  if (!info) return;
  const w = why ? null : setupWords(state, p, partyTile(p), at);
  info.className = `small ${why ? "danger" : ""}`;
  info.textContent = why ? `Here: ${why}.` : `Here: ${w.text}; gives ${w.gives}.${w.axe}`;
}
// Enter sets up camp on the spot picked, Esc lets the game pick. True when the key was used.
export function csKey(state, ui, e) {
  if (!siteModalUp(state, ui)) return false;
  if (e.code === "Enter" || e.code === "NumpadEnter") { CS_ACTIONS["cs-ok"](state, ui); return true; }
  if (e.code === "Escape") { CS_ACTIONS["cs-auto"](state, ui); return true; }
  return false;
}
