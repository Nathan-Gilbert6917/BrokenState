// A camp inside a POI on the raid map (sim/poicamp.js, issue #70): the survivor's orders, the 5 × 5 picked on the map
// (the camp site picker's green / red ghost, the fire in the middle cell), the setup's progress, the "safe" countdown
// over the camp and in the raid's top strip, Settle in, and build mode (its Build list, the build's ghost, the sites'
// progress). ui/combat.js calls:
//   poiCampButtons(state, b, u, btn)              the selected survivor's orders (unitOrders)
//   poiCampCbAct(state, b, u, v, d, cui, act)     a button's order (combatAction "cb-act"): true when handled
//   poiCampClick(state, b, u, c, cui, act)        a map click in "campSetup" or "campBuild" mode: true when handled
//   poiCampGhost(state, b, cui)                   the 5 × 5 or the build under the mouse, the camp and its sites (ui/isoview.js H.ghost)
//   poiCampChip(state, b)                         the top strip's camp line (renderRaidTop)
//   poiCampPanel(state, b, cui)                   build mode's Build list over the bar (unitOrders extra)
//   poiCampHover(state, b, cui, h)                the hover line in those modes
import {
  POICAMP, poiRaid, setupProblem, workProblem, squareCells, squareSupplies, safeText, settleProblem, buildModeProblem, buildPlaceProblem, sitesNear,
  siteCells, buildWorkProblem, poiCampProblem, setupTotal, buildCheck,
} from "../sim/poicamp.js";
import { buildMenu, FOOT, dimsOf } from "../sim/basemap.js";
import { BUILDINGS } from "../sim/buildings.js";
import { keyWord } from "../sim/water.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const NO_AP = "No actions left this turn.";
const campOf = (b) => (b && b.poiCamp) || null;
const baseOf = (state, b) => { const R = campOf(b); return R && R.done ? state.bases.find((x) => x.id === R.baseId) || null : null; };
const needWords = (o) => Object.entries(o).map(([k, n]) => `${n} ${keyWord(k)}`).join(" and ");

// ---------- the orders ----------
export function poiCampButtons(state, b, u, btn) {
  if (!poiRaid(b)) return;
  const R = campOf(b) || {};
  const ap = u.ap > 0;
  if (!R.at && !R.done) {
    const why = poiCampProblem(state, b.tileId, b.setup.raid.poi);
    btn("campSetup", POICAMP.LABEL, `Pick a ${POICAMP.SIZE} × ${POICAMP.SIZE} on seen ground, the camp fire in its middle cell (green where it can go): every cell seen, open floor or ground on one floor, no hostile in it, and ${needWords(squareSupplies(state, b, [u.x, u.y]).need)} carried by the people standing in it (only theirs counts). They are taken when the work starts. Then anyone inside works on it with their actions (${setupTotal()} in all; more workers, faster). The base is yours the moment it is done; Settle in after ${POICAMP.SAFE_TURNS} turns with no hostile in sight.`, ap && !why, "", { why: why || (ap ? "" : NO_AP), ap: 0 });
  }
  if (R.at && !R.done) {
    const why = workProblem(b, u);
    btn("campWork", `${POICAMP.WORK} (${R.work}/${R.total})`, `Spend ${u.name.split(" ")[0]}'s actions left on the camp, from inside its ${POICAMP.SIZE} × ${POICAMP.SIZE}. Everyone inside can work on it the same turn; a turn with nobody working leaves it where it is, and a hostile inside stops it until it is killed or pushed out.`, !why, "", { why, ap: "all" });
  }
  if (R.done) {
    const base = baseOf(state, b);
    const sw = settleProblem(state, b);
    btn("settleIn", POICAMP.SETTLE, `End the raid: everyone still on the map moves into ${base ? base.name : "the camp"} as its people, what they carry into its stores, and its build map opens. Only once no hostile has been seen for ${POICAMP.SAFE_TURNS} turns in a row (${safeText(b)}).`, !sw, "", { why: sw, ap: 0 });
    const bw = buildModeProblem(state, b);
    btn("buildMode", R.build ? "Close build mode" : POICAMP.BUILD, R.build ? "Close the Build list." : `Build up the camp on its own map while no hostile is in sight: pick a build, place it on seen, cleared ground (no dead seen there); it is a site your people work on with their actions (more workers, faster). Materials from the camp's stores, then your people on the map. Unfinished sites go to the camp's construction queue when the raid ends.`, R.build || !bw, "", { why: bw, ap: 0, on: !!R.build });
    const near = sitesNear(b, u);
    if (near.length) {
      const s = near[0], why = buildWorkProblem(state, b, u, s);
      btn("buildWork", `Build ${BUILDINGS[s.type].name.toLowerCase()} (${s.work}/${s.total})`, `Spend ${u.name.split(" ")[0]}'s actions left on the site next to them. Its materials (${needWords(s.cost) || "none"}) are taken when the work starts.`, !why, "", { why, ap: "all" });
    }
  }
}
const ORDER = new Set(["campSetup", "campWork", "settleIn", "buildMode", "buildWork", "campBuildPick", "campBuildRot", "campBuildClose"]);
export function poiCampCbAct(state, b, u, v, d, cui, act) {
  if (!ORDER.has(v)) return false;
  if (v === "campSetup") { cui.mode = cui.mode === "campSetup" ? "move" : "campSetup"; cui.msg = cui.mode === "campSetup" ? `Click the camp fire's cell: the ${POICAMP.SIZE} × ${POICAMP.SIZE} round it is the camp.` : ""; return true; }
  if (v === "campWork") { act(state, { type: "campWork", unit: u.id }); return true; }
  if (v === "buildWork") { act(state, { type: "buildWork", unit: u.id }); return true; }
  if (v === "settleIn") { act(state, { type: "settleIn" }); return true; }
  if (v === "buildMode") { const R = campOf(b); act(state, { type: "buildMode", on: !(R && R.build) }); if (!(R && R.build) && cui.mode === "campBuild") cui.mode = "move"; return true; }
  if (v === "campBuildPick") { cui.campBuild = d.k || null; cui.campRot = 0; cui.mode = d.k ? "campBuild" : "move"; cui.msg = d.k ? `Click where the ${BUILDINGS[d.k].name.toLowerCase()} goes (R turns it).` : ""; return true; }
  if (v === "campBuildRot") { cui.campRot = ((cui.campRot || 0) + 1) & 3; return true; }
  if (v === "campBuildClose") { cui.campBuild = null; cui.mode = "move"; return true; }
  return false;
}
// The build's top-left for the cell under the mouse (its middle there).
function buildAt(type, rot, x, y) {
  const f = FOOT[type];
  const [w, h] = dimsOf(f, rot || 0);
  return [x - Math.floor(w / 2), y - Math.floor(h / 2), w, h];
}
export function poiCampClick(state, b, u, c, cui, act) {
  if (!poiRaid(b)) return false;
  if (cui.mode === "campSetup" && u) {
    act(state, { type: "campSetup", unit: u.id, x: c.x, y: c.y });
    if (!cui.msg) cui.mode = "move";
    return true;
  }
  if (cui.mode === "campBuild" && cui.campBuild) {
    const [x0, y0] = buildAt(cui.campBuild, cui.campRot, c.x, c.y);
    act(state, { type: "campBuild", build: cui.campBuild, x: x0, y: y0, r: cui.campRot || 0 });
    if (!cui.msg) { cui.mode = "move"; cui.campBuild = null; }
    return true;
  }
  return false;
}

// ---------- on the map ----------
export function poiCampGhost(state, b, cui) {
  if (!poiRaid(b)) return null;
  const R = campOf(b);
  const h = cui.hover;
  const out = { cells: [], doors: [], ok: true, picked: null, pickedAt: null, label: "" };
  let any = false;
  if (R && R.at && (R.f || 0) === (b.floor || 0)) {
    out.picked = squareCells(R.at[0], R.at[1]);
    out.pickedAt = R.at;
    out.label = R.done ? safeText(b) : `Setting up camp ${Math.round((100 * R.work) / R.total)}% (${R.work}/${R.total})`;
    any = true;
    for (const s of R.sites || []) { out.doors.push(...siteCells(b, s)); }
  }
  if (h && cui.mode === "campSetup") {
    const u = b.units.find((x) => x.id === cui.sel);
    out.cells = squareCells(h.x, h.y).filter(([x, y]) => x >= 0 && y >= 0 && x < b.w && y < b.h);
    out.ok = !setupProblem(state, b, null, h.x, h.y) && (!u || Math.abs(u.x - h.x) <= POICAMP.HALF && Math.abs(u.y - h.y) <= POICAMP.HALF);
    any = true;
  } else if (h && cui.mode === "campBuild" && cui.campBuild && FOOT[cui.campBuild]) {
    const [x0, y0, w, hh] = buildAt(cui.campBuild, cui.campRot, h.x, h.y);
    for (let y = y0; y < y0 + hh; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < b.w && y < b.h) out.cells.push([x, y]);
    out.ok = !buildPlaceProblem(state, b, cui.campBuild, x0, y0, cui.campRot || 0);
    any = true;
  }
  return any ? out : null;
}
export function poiCampHover(state, b, cui, h) {
  if (!poiRaid(b) || !h) return "";
  if (cui.mode === "campSetup") {
    const u = b.units.find((x) => x.id === cui.sel);
    const why = setupProblem(state, b, u && u.side === "player" ? u : null, h.x, h.y);
    const sup = squareSupplies(state, b, [h.x, h.y]);
    const list = Object.keys(sup.need).map((k) => `${keyWord(k)} ${sup.have[k]}/${sup.need[k]}`).join(", ");
    return `${why ? `<span class="danger">Here: ${esc(why)}</span>` : `<b>Camp here:</b> <span class="good">it can go here</span>`}<br>In the 5 × 5: ${esc(list)} (${sup.people.length} of yours inside).${Object.keys(sup.short).length ? ` <span class="danger">Short ${esc(needWords(sup.short))}.</span>` : ""}`;
  }
  if (cui.mode === "campBuild" && cui.campBuild) {
    const [x0, y0] = buildAt(cui.campBuild, cui.campRot, h.x, h.y);
    const why = buildPlaceProblem(state, b, cui.campBuild, x0, y0, cui.campRot || 0);
    return why ? `<span class="danger">${esc(BUILDINGS[cui.campBuild].name)} here: ${esc(why)}</span>` : `<b>${esc(BUILDINGS[cui.campBuild].name)}</b> <span class="good">can go here</span>: click to stake out its site.`;
  }
  return "";
}

// ---------- the top strip and build mode's list ----------
export function poiCampChip(state, b) {
  const R = campOf(b);
  if (!poiRaid(b) || !R || !R.at) return "";
  if (!R.done) return `<span class="warn"${tip(`The camp's setup: ${R.work} of ${R.total} actions. Anyone inside its ${POICAMP.SIZE} × ${POICAMP.SIZE} works on it with their actions; a hostile inside stops it.`)}>⛺ Camp ${R.work}/${R.total}</span>`;
  const s = safeText(b), ok = R.safe === 0;
  const settle = !settleProblem(state, b) ? ` <button class="mini primary" data-action="cb-act" data-v="settleIn"${tip("Settle in: the raid ends, everyone still on the map moves into the camp")}>${POICAMP.SETTLE}</button>` : "";
  return `<span class="${ok ? "good" : R.safe === POICAMP.SAFE_TURNS && /Not safe/.test(s) ? "danger" : "warn"}"${tip(`The camp stands. Settle in once no hostile has been in sight of any of yours, nor inside the camp's ${POICAMP.SIZE} × ${POICAMP.SIZE}, for ${POICAMP.SAFE_TURNS} turns in a row; a sighting starts it again.`)}>⛺ ${esc(s)}</span>${settle}${R.build ? ` <span class="good"${tip("Build mode is open: pick a build over the orders bar")}>🔨 Build mode</span>` : ""}`;
}
// A build the list offers: one the camp could build, or short only of materials (they come from the people on the map too).
const buildable = (state, b, r) => r.ok || !!buildCheck(state, b, r.type).ok;
export function poiCampPanel(state, b, cui) {
  const R = campOf(b), base = baseOf(state, b);
  if (!poiRaid(b) || !R || !R.build || !base) return "";
  const rows = buildMenu(state, base).filter((r) => !r.furniture && FOOT[r.type]);
  const groups = new Map();
  for (const r of rows) { if (!groups.has(r.group)) groups.set(r.group, []); groups.get(r.group).push(r); }
  let html = `<div class="small cbmsg cbammo"${tip("The camp's Build list on its own map: fittings in the building's rooms, crop plots and small builds in the yard, nothing past the map's edge. Greyed: why not.")}><b>🔨 Build</b> `;
  for (const [g, list] of groups) html += `<span class="muted">${esc(g)}:</span> ${list.map((r) => `<button class="mini${cui.campBuild === r.type ? " active" : ""}" data-action="cb-act" data-v="campBuildPick" data-k="${esc(r.type)}" ${buildable(state, b, r) ? "" : "disabled"}${tip(`${r.name} (${r.w} × ${r.h}): ${needWords(r.cost) || "no materials"}, ${r.hours} work-hours.${r.ok ? "" : ` ${r.why}`}`)}>${esc(r.name)}</button>`).join(" ")} `;
  if (cui.campBuild) html += `<button class="mini" data-action="cb-act" data-v="campBuildRot"${tip("Turn it")}>↻</button> `;
  html += `<button class="mini" data-action="cb-act" data-v="buildMode"${tip("Close build mode")}>✕</button></div>`;
  return html;
}
