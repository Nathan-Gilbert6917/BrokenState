// Choices before a raid (sim/raidplan.js; docs/suggestions-5.md #23), a window over the battle screen (ui.js pickModal
// "raidplan"; the user's request 2026-10-18): behind it the site lies under the fog of war with nobody of yours on it
// (ui/combat.js view, ui/isoview.js: while the plan is open the team is not drawn and nothing is seen). The window: a
// small map of the site (all fog but its ways in until a scout has been round, then what the scout saw), the scout to
// send with the odds the sim rolls, waiting for night with its trade-off, Look at the map first (once a scout came
// back unseen: the window put aside, the site under the fog with the scout's marks; Back to the plan on the panel, or
// Esc), the side to go in from (going in: the team is placed there and the fight begins; one way in: Go in), and Leave
// (asks, then calls the raid off). Buttons: data-action="cb-plan" (ui/combat.js combatAction → planAction).
import { planOf, planOpen, scoutChoices, scoutText, nightTradeoff, sendScout, waitNight, enterFrom, callOff, unstage, refit, planParty, SCOUT, SIDES, NIGHT_FROM } from "../sim/raidplan.js";
import { campusBriefing } from "../sim/campus.js"; // a campus's buildings by row (issue #28)
import { CELL } from "../sim/combat.js";
import { mapSizeText, bigMapNote } from "../sim/battlesize.js"; // the map's size in the header, and what a big one brings
import { teamsTogether } from "../sim/teammeet.js"; // your other teams on the site's tile: goods handed across before going in
import { TEAMINV_ACTIONS } from "./teaminv.js"; // the team inventory window (every member and the cargo)
import { TEAMMEET_ACTIONS } from "./teammeet.js"; // Teams together (goods between your teams on one tile)
import { skill, hourOfDay } from "../sim/world.js";
import { STEALTH } from "../sim/stealth.js";
import { campSeen, STATE_WORD } from "../sim/campsite.js"; // a campsite's state: as last seen, or as the scout saw it

// The camp's line: what the scout saw now, else what a survey or a visit saw, else unknown.
function campLine(state, b, scouted) {
  const C = b.raid.camp;
  const tents = C.tents.length;
  if (scouted) return `The scout saw the camp: ${STATE_WORD[C.state] || C.state}, ${tents} tent${tents === 1 ? "" : "s"} round ${C.lit ? "a lit fire" : "a cold fire"}${C.slept ? `, ${C.slept} of them asleep in the tents` : ""}.`;
  const s = campSeen(state, b.tileId, C.poi);
  return s ? `The camp: ${s.text}. ${tents} tent${tents === 1 ? "" : "s"}.` : `The camp: who is there is unknown (no survey). ${b.night && C.lit ? "A fire burns in the clearing." : ""}`;
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const pct = (v) => `${Math.round(v * 100)}%`;
const first = (s) => String(s || "").split(" ")[0];
const SIDE_LABEL = { north: "North", east: "East", south: "South", west: "West" };
const hh = (h) => `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00`;

// The window's own state (not saved: a load opens the window again): the window put aside to look at the map, the
// Leave question, and a kit window (the team inventory, Teams together) open over the plan. Reset when the plan is
// gone (planUp).
export const planUI = { map: false, leave: false, battle: null, kit: false };
// The plan's window is up: a battle with its plan open, not put aside to look at the map, no kit window over it. ui:
// main.js's screen state (ui.inv, ui.meet); a kit window just closed has the battle made again with the kit as it is
// now (sim/raidplan.js refit).
export function planUp(state, ui = null) {
  const b = state.combat;
  if (!b || b.over || !planOpen(b)) { planUI.map = planUI.leave = planUI.kit = false; planUI.battle = null; return false; }
  if (planUI.battle !== b.setup) { planUI.map = planUI.leave = planUI.kit = false; planUI.battle = b.setup; } // a new raid: the window up
  if (ui) {
    const open = kitUp(state, ui);
    if (planUI.kit && !open) { planUI.kit = false; refit(state); if (!state.combat || state.combat.over || !planOpen(state.combat)) return false; }
    if (open) return false;
  }
  return !planUI.map;
}
// A kit window open over the plan (ui.js pickModal shows it while the battle waits at its plan).
export function kitUp(state, ui) {
  if (!state.combat || !planOpen(state.combat)) return false;
  return !!((ui.inv && ui.inv.team != null) || ui.meet);
}
// Esc while the plan is open (main.js closeTopLayer): the Leave question first, then the map back to the window.
export function planEsc(state) {
  const b = state.combat;
  if (!b || b.over || !planOpen(b)) return false;
  if (planUI.leave) { planUI.leave = false; return true; }
  if (planUI.map) { planUI.map = false; return true; }
  return false;
}

// ---------- the small map ----------
const PREVIEW = new WeakMap(); // battle → { key, url }
const PX = 4; // pixels a cell
const FOG = "#1b1d22";
function previewUrl(b) {
  if (typeof document === "undefined") return "";
  const R = b.raid;
  const P = planOf(b);
  const scouted = !!(P && P.scout && P.scout.ok);
  const key = `${b.rev}:${b.w}x${b.h}:${R ? R.zones.length : 0}:${Object.keys(b.ghosts || {}).length}:${scouted ? 1 : 0}`;
  const got = PREVIEW.get(b);
  if (got && got.key === key) return got.url;
  const cv = document.createElement("canvas");
  cv.width = b.w * PX; cv.height = b.h * PX;
  const g = cv.getContext("2d");
  const cells = b.floors ? b.floors[0].cells : b.cells;
  const memo = b.seenMemo && b.seenMemo[0];
  const sc = (R && R.scouted) || b.scouted;
  const memoKnown = (x, y) => !!(memo && typeof memo.cells === "string" && memo.cells.charCodeAt(y * b.w + x) === 49);
  // What the team knows: nothing before a scout (the fog over the whole site); after one, what lay within the scout's
  // reach (the fog's memory on a raid map; the circle on a base's).
  const known = (x, y) => scouted && (memoKnown(x, y) || (sc && Math.hypot(x - sc.x, y - sc.y) <= sc.r));
  // Under the roofs: what nobody has seen inside is one flat roof (the fog of war indoors).
  const B = R && R.plan ? R.plan.building : null;
  const roofs = R ? [...(B ? B.parts || [B] : []), ...R.areas.filter((a) => !a.outdoor && !(a.f > 0))] : []; // a shaped building (sim/buildingmaps.js, issue #23): its parts, not its bounding box (a courtyard is open ground)
  const roofed = (x, y) => roofs.some((a) => x >= a.x0 && y >= a.y0 && x < a.x0 + a.w && y < a.y0 + a.h) && !memoKnown(x, y);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    if (!known(x, y)) { g.fillStyle = FOG; g.fillRect(x * PX, y * PX, PX, PX); continue; }
    const c = cells[y * b.w + x];
    if (roofed(x, y)) { g.fillStyle = "#3a3431"; g.fillRect(x * PX, y * PX, PX, PX); continue; }
    const d = CELL[c.k];
    let col = c.f === "floor" ? "#5a554c" : c.f === "road" ? "#4b4b4f" : c.f === "rubble" ? "#4d4840" : c.f === "dirt" || c.f === "gravel" ? "#4f4a3a" : "#34432f";
    if (c.k === "water") col = "#1f3a52";
    else if (c.k === "wall" || c.k === "hivewall") col = "#1a1a1d";
    else if (c.k === "window" || c.k === "smashed") col = "#6d8798";
    else if (c.k === "tree") col = "#203a1f";
    else if (c.k === "vehicle") col = "#4b4b4f"; // the team's car is not there yet (placed when the team goes in)
    else if (c.k === "car" || c.k === "truck") col = "#6a6460";
    else if (d && !d.walk && c.k !== "door") col = c.f === "floor" ? "#6f6656" : "#55584d";
    g.fillStyle = col;
    g.fillRect(x * PX, y * PX, PX, PX);
  }
  // What the scout saw: the containers, the locked doors in what it saw.
  if (R && scouted) {
    for (const c of R.containers) if ((c.f || 0) === 0 && memo && memo.boxes && memo.boxes[c.id]) { g.fillStyle = "#e0c25a"; g.fillRect(c.x * PX + 1, c.y * PX + 1, PX - 2, PX - 2); }
    for (const d of R.doors || []) if ((d.f || 0) === 0 && !d.lock.open && memoKnown(d.x, d.y)) { g.fillStyle = "#e08a3a"; g.fillRect(d.x * PX, d.y * PX, PX, PX); }
  }
  if (sc && scouted) { g.strokeStyle = "rgba(240,230,170,0.55)"; g.lineWidth = 1; g.beginPath(); g.arc((sc.x + 0.5) * PX, (sc.y + 0.5) * PX, sc.r * PX, 0, Math.PI * 2); g.stroke(); }
  // The ways in (all alike: the team is not on any of them yet); on a base, the team's side.
  if (R) for (const z of R.zones) { g.strokeStyle = "#7dff8a"; g.lineWidth = 1.5; g.strokeRect(z.x0 * PX + 1, z.y0 * PX + 1, z.w * PX - 2, z.h * PX - 2); }
  else { g.strokeStyle = "#7dff8a"; g.lineWidth = 2; const left = b.evacSide !== "right"; g.beginPath(); g.moveTo(left ? 1 : cv.width - 1, 0); g.lineTo(left ? 1 : cv.width - 1, cv.height); g.stroke(); }
  if (scouted) for (const [id, q] of Object.entries(b.ghosts || {})) {
    if ((q[3] || 0) !== 0) continue;
    const e = b.units.find((u) => u.id === Number(id));
    g.fillStyle = e && e.kind === "zombie" ? "#d8584a" : "#ff8c3a";
    g.beginPath(); g.arc((q[0] + 0.5) * PX, (q[1] + 0.5) * PX, PX * 0.7, 0, Math.PI * 2); g.fill();
  }
  const url = cv.toDataURL();
  PREVIEW.set(b, { key, url });
  return url;
}

const btn = (v, label, tip, on = true, extra = "", cls = "") => `<button class="${cls}" data-action="cb-plan" data-v="${v}" ${extra} ${on ? "" : "disabled"} data-tip="${esc(tip)}">${label}</button>`;
const what = (b, P) => (b.raid ? "raid" : P.kind === "rescue" ? "rescue" : "assault");

// ---------- the window ----------
export function planModalHtml(state) {
  const b = state.combat;
  if (!planUp(state)) return "";
  const P = planOf(b);
  const R = b.raid;
  const scouted = !!(P.scout && P.scout.ok);
  const big = R && R.big ? bigMapNote(b.w, b.h) : ""; // Heat and containers: a raid map's with the big-map scales (sim/battlesize.js raidBig; a base assault or a rescue has neither, nor an older save's map)
  let html = `<div class="box rplanbox"><div class="spread"><h1>Before you go in</h1><span class="muted"${tip(big)}>${esc(b.place)} · ${esc(mapSizeText(b.w, b.h))} · ${hh(hourOfDay(state))}${b.night ? ", night" : ", day"}${P.hours ? ` · ${P.hours} h spent` : ""}</span></div>
    ${big ? `<div class="small muted" style="margin-bottom:0.3rem">${esc(big)}</div>` : ""}
    <div class="small muted" style="margin-bottom:0.5rem">Nobody is on the map yet. Send a scout first, ${b.night ? "" : "wait for night, "}then pick the side to go in from${P.sides.length > 1 ? "" : " (one way in here)"}; or leave. You can go in with or without a scout: a scout only tells you more.</div>`;
  const url = previewUrl(b);
  if (url) html += `<img class="rplanmap" src="${url}" alt="The site" style="display:block;margin:0 auto;height:9.5rem;width:auto;max-width:100%;object-fit:contain;image-rendering:pixelated;border:1px solid var(--line);border-radius:4px" data-tip="${esc(`The site from above, under the fog of war. Green: the ways in and out${R ? " (north at the top)" : ""}. ${scouted ? "What the scout saw: the dead (red) and their people (orange) where they stood, the containers (yellow) and locked doors (dark orange) within the circle." : "Send a scout to see who is where."}`)}">`;
  // A campus (sim/campus.js): its buildings by row with the nearest way in, its links: where to head for.
  if (R && R.plan && R.plan.campus) html += `<div style="margin-top:0.5rem" class="small" data-tip="${esc("A college campus: its buildings in rows north to south round the quads, each its own floors, rooms and containers; some joined by a walkway, a corridor or a bridge between upper floors. The number after a building: its storeys. Pick the side to go in from by the building you head for.")}">${campusBriefing(b).map((l) => `<div>${esc(l)}</div>`).join("")}</div>`;
  // A campsite (sim/campsite.js): who is at the camp as last seen; a scout come back unseen saw it as it is now.
  if (R && R.camp && R.camp.poi != null) html += `<div style="margin-top:0.5rem" class="small" data-tip="${esc("A campsite: its tents round a fire. Abandoned: a few of the dead about, the best loot left. Overrun: a pack of the dead among the tents. An active raider camp: a band round a lit fire, some asleep in the tents at night (noise wakes them). Tents can be taken down (Take down, 2 actions a go) and carried off.")}">${esc(campLine(state, b, scouted))}</div>`;
  // The scout.
  if (P.scout) html += `<div style="margin-top:0.5rem" class="${P.scout.ok ? "good" : "danger"}">${esc(scoutText(P.scout))}</div>`;
  else {
    const list = scoutChoices(state, b);
    const humans = b.units.some((u) => u.side === "enemy" && u.kind === "human" && !u.dead);
    html += `<div style="margin-top:0.5rem" data-tip="${esc(`One of the team goes round the site first (${SCOUT.HOURS} hour on the clock). Their notice range: 8 tiles less a tile for every 4 points of the scout's Stealth (at least 3; the dead at most 5; at night ×${STEALTH.NIGHT_DETECT}). The scout's look: ${SCOUT.DAY_LOOK} tiles by day + binoculars or a spotting scope 3, a monocular or a thermal 2; at night the dark's sight (${b.night ? `${(list[0] || {}).look ?? "?"}` : "4–7"} tiles) or ${SCOUT.NVG_LOOK} with night vision. Odds: ${pct(SCOUT.BASE)} + ${pct(SCOUT.PER_TILE)} a tile the look beats their notice + ${pct(SCOUT.PER_SKILL)} a point of Scouting (${pct(SCOUT.MIN)}–${pct(SCOUT.MAX)}). Unseen: within ${SCOUT.REACH}× the look of the site's middle, their positions, the rooms, containers and locked doors are marked, and how many they are. Seen: ${humans ? "every one of their people starts alerted, " : ""}the dead near the middle wake, Heat +${SCOUT.FAIL_HEAT}, and ${pct(SCOUT.WOUND)} of the time the scout comes back hurt (${SCOUT.HURT[0]}–${SCOUT.HURT[1]}).`)}">Send a scout first <span class="muted">(${SCOUT.HOURS} h; odds unseen):</span></div>
      <div class="row" style="gap:0.25rem;flex-wrap:wrap">${list.map((c, i) => btn("scout", `${esc(first(c.name))} <b>${pct(c.odds)}</b>${i === 0 ? " ★" : ""}`,
        `${c.name}: Stealth ${skill(c.s, "stealth")}, Scouting ${skill(c.s, "scouting")}. They notice at ${c.notice} tiles; ${first(c.name)} looks from ${c.look}${c.optic ? ` (optics +${c.optic})` : ""}${b.night && c.nvg ? " (night vision)" : ""}: ${pct(SCOUT.BASE)} + ${pct(SCOUT.PER_TILE)} × ${c.look - c.notice} + ${pct(SCOUT.PER_SKILL)} × ${skill(c.s, "scouting")} = ${pct(c.odds)}. Unseen: marks what is within ${c.reach} tiles of the middle.`,
        true, `data-id="${c.id}"`, "mini")).join("")}</div>`;
  }
  // The night.
  const T = nightTradeoff(state, b);
  if (P.night) html += `<div style="margin-top:0.5rem" class="muted">Waited ${P.night.hours} h for the dark (${hh(P.night.from)} → ${hh(P.night.to)}).</div>`;
  else if (b.night) html += `<div style="margin-top:0.5rem" class="muted">It is night: they notice at ${T.notice[1]} tiles, not ${T.notice[0]}; your people see ${T.dark[0]}–${T.dark[1]} tiles ahead in the dark (${T.nvgSight} with night vision: ${T.nvg} of ${T.team} have it).</div>`;
  else {
    const n = T.hours;
    html += `<div style="margin-top:0.5rem">${btn("night", `Wait for night <span class="muted">(${n} h, to ${hh(NIGHT_FROM)})</span>`,
      `The team holds out of sight until ${hh(NIGHT_FROM)}: the clock runs ${n} hours (they eat and drink, the world moves on), then the same site in the dark.`, true, "", "mini")}
      <div class="small"><span class="good">Stealth up:</span> noticed at ${T.notice[1]} tiles, not ${T.notice[0]} (×${STEALTH.NIGHT_DETECT}); the dead see ${T.dead}${T.heat != null ? `; Heat starts at 0, not ${T.heat}` : ""}. <span class="danger">Sight down:</span> ${T.dark[0]}–${T.dark[1]} tiles ahead in the dark (night vision ${T.nvgSight}: ${T.nvg} of ${T.team} have it); a light on is a beam that gives you away.</div></div>`;
  }
  // Look at the map first: once a scout has been round and come back unseen (there is nothing to look at otherwise).
  if (scouted) html += `<div style="margin-top:0.5rem">${btn("map", "🗺 Look at the map first", "Put this window aside and look over the site under the fog of war with the scout's marks on it (pan and zoom as in a fight). Back to the plan on the panel, or Esc, brings the window back. Nobody is on the map until you go in.", true, "", "")}</div>`;
  else if (P.scout) html += `<div style="margin-top:0.5rem" class="small muted">The scout was seen and saw nothing to show: the site is still under the fog.</div>`;
  // The kit: every member's inventory and the cargo, and goods to and from your other teams on this tile.
  const party = planParty(state, b);
  if (party) {
    const others = teamsTogether(state, party);
    html += `<div class="row" style="gap:0.25rem;flex-wrap:wrap;margin-top:0.5rem">${btn("inv", "🎒 Team inventory", "Every member's kit (worn, held, pockets, rig, pack) and the team's cargo (its vehicles' load) side by side: move things between members, and between a member and the cargo. The team takes the field with what each one wears and holds when you go in.", true, "", "mini")}${others.length ? btn("meet", `Teams together <span class="muted">(${others.length} other${others.length === 1 ? "" : "s"} here)</span>`, `Your other team${others.length === 1 ? "" : "s"} on this tile (${others.map((q) => q.name || `team ${q.id}`).join(", ")}): hand goods across, cargo to cargo or onto a member, before going in.`, true, "", "mini") : ""}</div>`;
  }
  // Going in: the side (a raid map), or the one way in.
  html += `<div style="margin-top:0.6rem;border-top:1px solid var(--line);padding-top:0.5rem">`;
  if (R && P.sides.length > 1) {
    html += `<div>Go in from:</div><div class="row" style="gap:0.25rem;flex-wrap:wrap">${SIDES.map((s) => {
      const has = P.sides.includes(s);
      const z = has ? R.zones.find((q) => q.side === s) : null;
      const tip = !has ? `No way in from the ${s} on this map.` : `Go in from the ${s}${z && z.name ? ` (${z.name.toLowerCase()})` : ""}: the team${R.hasVehicle ? " and the vehicle" : ""} are placed at that zone, the enemy further from it, and the ${what(b, P)} begins. No time lost.`;
      return btn("enter", SIDE_LABEL[s], tip, has, `data-k="${s}"`, `primary`);
    }).join("")}</div>`;
  } else html += `<div class="row" style="gap:0.5rem;align-items:center">${btn("enter", "Go in", `Into ${b.place} from the ${P.side}${P.scout ? "" : ", unscouted"}${b.night ? ", in the dark" : ""}: the team is placed there and the ${what(b, P)} begins.`, true, "", "primary")}<span class="small muted">One way in here: the ${esc(P.side)} side.</span></div>`;
  // Leave: a question first.
  if (planUI.leave) html += `<div class="small cbmsg" style="margin-top:0.6rem"><b class="danger">Call the ${what(b, P)} off?</b> The team turns back without going in: nobody is hurt and nothing is searched${P.hours ? `; the ${P.hours} h spent ${P.hours === 1 ? "is" : "are"} gone` : ""}${P.scout && !P.scout.ok ? "; they know you were here" : ""}.
    <div class="row" style="gap:0.5rem;margin-top:0.35rem">${btn("leaveYes", "Call it off", "Turn back now. The team waits for orders on the map.", true, "", "danger")}${btn("leaveNo", "Stay", "Back to the plan.", true, "", "")}</div></div>`;
  else html += `<div class="row" style="gap:0.5rem;margin-top:0.6rem;justify-content:flex-end">${btn("leave", "Leave", `Call the ${what(b, P)} off: the team turns back without going in (asks first).`, true, "", "")}</div>`;
  html += `</div></div>`;
  return html;
}

// The chip in a raid's top strip while the window is put aside (ui/combat.js renderRaidTop): the way back.
export const planChip = (b) => (planOpen(b) && !b.over && planUI.map ? `<button class="mini" data-action="cb-plan" data-v="back" data-tip="Back to the Before you go in window (Esc does too): the scout, the night, the kit, the side to go in from, or leave.">▸ Back to the plan</button>` : "");
// The card at the top of the battle panel (or over the map on a raid) while the window is put aside (Look at the map first): the way back.
export function planAsideHtml(state, b) {
  if (!planOpen(b) || b.over || !planUI.map) return "";
  const P = planOf(b);
  return `<div class="small cbmsg cbconfirm rplan"><div class="spread"><span><b class="good">Looking at the site</b> <span class="muted">· before going in</span></span>${btn("back", "Back to the plan", "Bring the Before you go in window back (Esc does too): the scout, the night, the side to go in from, or leave.", true, "", "primary mini")}</div>
    <div class="muted" style="margin-top:0.15rem">${P.scout && P.scout.ok ? "What the scout saw is marked under the fog: the dead and their people where they stood, the rooms and containers within reach." : "The site under the fog of war."} Nobody of yours is on the map until you go in.</div></div>`;
}

// cb-plan: d.v scout (d.id) | night | map | back | enter (d.k side, or none) | leave | leaveYes | leaveNo | inv | meet.
// ui: main.js's screen state (the kit windows open on it). Returns the message for the panel ("" when done).
export function planAction(state, d, ui = null) {
  const b = state.combat;
  if (!planOpen(b)) return "Nothing to plan now.";
  if (d.v === "inv" || d.v === "meet") {
    const p = planParty(state, b);
    if (!p || !ui) return "The team is not here to sort.";
    unstage(state); // the loads staged at the start back to the team first
    planUI.kit = true; planUI.leave = false;
    if (d.v === "inv") TEAMINV_ACTIONS["ti-open"](state, ui, { id: p.id, tab: "team" });
    else TEAMMEET_ACTIONS["tm-open"](state, ui, { tile: b.tileId, a: p.id, tab: "goods" });
    return "";
  }
  if (d.v === "scout") return sendScout(state, d.id != null ? Number(d.id) : null);
  if (d.v === "night") return waitNight(state);
  if (d.v === "map") { planUI.map = true; planUI.leave = false; return ""; }
  if (d.v === "back") { planUI.map = false; return ""; }
  if (d.v === "enter") { planUI.leave = false; return enterFrom(state, d.k || null); }
  if (d.v === "leave") { planUI.leave = true; planUI.map = false; return ""; }
  if (d.v === "leaveNo") { planUI.leave = false; return ""; }
  if (d.v === "leaveYes") { planUI.leave = false; return callOff(state); }
  // The older buttons (side, go): going in from that side, or as things stand.
  if (d.v === "side") return enterFrom(state, d.k || null);
  if (d.v === "go") return enterFrom(state, null);
  return "";
}
