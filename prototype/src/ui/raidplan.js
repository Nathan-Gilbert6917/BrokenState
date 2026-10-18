// Choices before a raid (sim/raidplan.js; docs/suggestions-5.md #23): the scout to send with the odds the sim rolls (a
// scout back brings the picture of the site from outside with the ways in and what they saw), the side to come in from,
// and waiting for night with its trade-off. Offered until anyone acts or Go in: on the battle panel's card, or over the
// raid map as the dialogue at the start (planHtml { card: true }, ui/combat.js renderRaidCards; put aside: planChip).
// Buttons: data-action="cb-plan" (ui/combat.js combatAction → planAction; aside / back are the UI's own).
import { planOf, planOpen, scoutChoices, scoutText, nightTradeoff, setEntry, sendScout, waitNight, goIn, SCOUT, SIDES, NIGHT_FROM } from "../sim/raidplan.js";
import { CELL } from "../sim/combat.js";
import { skill, hourOfDay } from "../sim/world.js";
import { STEALTH } from "../sim/stealth.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (v) => `${Math.round(v * 100)}%`;
const first = (s) => String(s || "").split(" ")[0];
const SIDE_LABEL = { north: "North", east: "East", south: "South", west: "West" };
const hh = (h) => `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00`;

// ---------- the small map ----------
const PREVIEW = new WeakMap(); // battle → { key, url }
const PX = 4; // pixels a cell
function previewUrl(b) {
  if (typeof document === "undefined") return "";
  const R = b.raid;
  const key = `${b.rev}:${b.w}x${b.h}:${R ? R.zones.length : 0}:${Object.keys(b.ghosts || {}).length}`;
  const got = PREVIEW.get(b);
  if (got && got.key === key) return got.url;
  const cv = document.createElement("canvas");
  cv.width = b.w * PX; cv.height = b.h * PX;
  const g = cv.getContext("2d");
  const cells = b.floors ? b.floors[0].cells : b.cells;
  const memo = b.seenMemo && b.seenMemo[0];
  const known = (x, y) => !!(memo && typeof memo.cells === "string" && memo.cells.charCodeAt(y * b.w + x) === 49);
  // Under the roofs: what nobody has seen inside is one flat roof (the fog of war indoors).
  const roofs = R ? [...(R.plan ? R.plan.buildings || (R.plan.building ? [R.plan.building] : []) : []), ...R.areas.filter((a) => !a.outdoor && !(a.f > 0))] : []; // a street of houses: every house (sim/buildingmaps.js streetMap)
  const roofed = (x, y) => roofs.some((a) => x >= a.x0 && y >= a.y0 && x < a.x0 + a.w && y < a.y0 + a.h) && !known(x, y);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const c = cells[y * b.w + x];
    if (roofed(x, y)) { g.fillStyle = "#3a3431"; g.fillRect(x * PX, y * PX, PX, PX); continue; }
    const d = CELL[c.k];
    let col = c.f === "floor" ? "#5a554c" : c.f === "road" ? "#4b4b4f" : c.f === "rubble" ? "#4d4840" : c.f === "dirt" || c.f === "gravel" ? "#4f4a3a" : "#34432f";
    if (c.k === "water") col = "#1f3a52";
    else if (c.k === "wall" || c.k === "hivewall") col = "#1a1a1d";
    else if (c.k === "window" || c.k === "smashed") col = "#6d8798";
    else if (c.k === "tree") col = "#203a1f";
    else if (c.k === "vehicle") col = "#3f7fd6";
    else if (c.k === "car" || c.k === "truck") col = "#6a6460";
    else if (d && !d.walk && c.k !== "door") col = c.f === "floor" ? "#6f6656" : "#55584d";
    g.fillStyle = col;
    g.fillRect(x * PX, y * PX, PX, PX);
  }
  // What the team knows: the containers the scout saw, the locked doors in what it saw.
  if (R) {
    for (const c of R.containers) if ((c.f || 0) === 0 && memo && memo.boxes && memo.boxes[c.id]) { g.fillStyle = "#e0c25a"; g.fillRect(c.x * PX + 1, c.y * PX + 1, PX - 2, PX - 2); }
    for (const d of R.doors || []) if ((d.f || 0) === 0 && !d.lock.open && known(d.x, d.y)) { g.fillStyle = "#e08a3a"; g.fillRect(d.x * PX, d.y * PX, PX, PX); }
  }
  const sc = (R && R.scouted) || b.scouted;
  if (sc) { g.strokeStyle = "rgba(240,230,170,0.55)"; g.lineWidth = 1; g.beginPath(); g.arc((sc.x + 0.5) * PX, (sc.y + 0.5) * PX, sc.r * PX, 0, Math.PI * 2); g.stroke(); }
  // The ways in: the zones (the entry bright), the team where it starts.
  if (R) R.zones.forEach((z, i) => { g.strokeStyle = i === 0 ? "#7dff8a" : "rgba(125,255,138,0.5)"; g.lineWidth = i === 0 ? 2 : 1; g.strokeRect(z.x0 * PX + 1, z.y0 * PX + 1, z.w * PX - 2, z.h * PX - 2); });
  for (const u of b.units) if (u.side === "player" && !u.off && (u.f || 0) === 0) { g.fillStyle = "#9fd0ff"; g.beginPath(); g.arc((u.x + 0.5) * PX, (u.y + 0.5) * PX, PX * 0.6, 0, Math.PI * 2); g.fill(); }
  for (const [id, q] of Object.entries(b.ghosts || {})) {
    if ((q[3] || 0) !== 0) continue;
    const e = b.units.find((u) => u.id === Number(id));
    g.fillStyle = e && e.kind === "zombie" ? "#d8584a" : "#ff8c3a";
    g.beginPath(); g.arc((q[0] + 0.5) * PX, (q[1] + 0.5) * PX, PX * 0.7, 0, Math.PI * 2); g.fill();
  }
  const url = cv.toDataURL();
  PREVIEW.set(b, { key, url });
  return url;
}

// ---------- the card ----------
// The side panel's card (a battle with the panel), or with { card: true } the dialogue over the raid map at the start
// (ui/combat.js renderRaidCards; the user's request 2026-10-18): the questions "Send a scout first?" and "Which side do
// you start from?", Go in, and "Look at the map first" (cb-plan aside: the card folds to a chip in the top strip until
// it is opened again or anyone acts). The picture of the site from above is the scout's: before a scout is sent there is
// none (only the sides on offer); a scout back shows the site's outside (the roofs, streets, yards and ways in) and,
// unseen, what they saw inside the circle.
export function planHtml(state, b, { card = false } = {}) {
  if (!planOpen(b)) return "";
  const P = planOf(b);
  const R = b.raid;
  const btn = (v, label, tip, on = true, extra = "", cls = "") => `<button class="${cls}" data-action="cb-plan" data-v="${v}" ${extra} ${on ? "" : "disabled"} data-tip="${esc(tip)}">${label}</button>`;
  const go = btn("go", "Go in", `Into ${b.place} from the ${P.side}${P.scout ? "" : ", unscouted"}${b.night ? ", in the dark" : ""}. (Acting with anyone does the same.)`, true, "", "primary mini");
  const aside = card ? btn("aside", "Look at the map first", "Put this aside and look around the map (turn, zoom, pan). The chip at the top brings it back; acting with anyone goes in as things are.", true, "", "mini") : "";
  let html = `<div class="small cbmsg cbconfirm rplan${card ? " cbcard" : ""}"><div class="spread"><span><b class="good">Before you go in</b> <span class="muted">· ${esc(b.place)} · ${hh(hourOfDay(state))}${b.night ? ", night" : ", day"}${P.hours ? ` · ${P.hours} h spent` : ""}</span></span><span class="row" style="gap:0.25rem">${aside}${go}</span></div>
    <div class="muted" style="margin:0.15rem 0 0.3rem">Send a scout first, pick the side to come in from, or wait for the dark. Acting with anyone (or Go in) goes in as things are.</div>`;
  // The site from above: the scout's picture (none before one is sent).
  const url = P.scout ? previewUrl(b) : "";
  if (url) html += `<img class="rplanmap" src="${url}" alt="The site from outside" style="display:block;margin:0 auto;height:8.5rem;width:auto;max-width:100%;object-fit:contain;image-rendering:pixelated;border:1px solid var(--line);border-radius:4px" data-tip="${esc(`The site from outside, as the scout saw it: the roofs, the streets and yards, green the ways in and out (bright: where the team comes in, blue: the team and its vehicle). ${P.scout.ok ? "Unseen, they also marked the dead (red) and their people (orange) where they stood, and the containers (yellow) and locked doors (dark orange) within the circle." : "Seen, they got no closer: the inside is unknown."}`)}">`;
  else html += `<div class="rplan-nomap small" data-tip="A scout who goes round the site brings back its picture from outside: the buildings and their roofs, the streets and yards, the ways in. Unseen, they mark who stands where and what is within reach of the middle.">No picture of the site yet: send a scout to see it from outside.</div>`;
  // The scout.
  if (P.scout) html += `<div style="margin-top:0.35rem" class="${P.scout.ok ? "good" : "danger"}">${esc(scoutText(P.scout))}</div>`;
  else {
    const list = scoutChoices(state, b);
    const humans = b.units.some((u) => u.side === "enemy" && u.kind === "human" && !u.dead);
    html += `<div class="rplan-q" data-tip="${esc(`One of the team goes round the site first (${SCOUT.HOURS} hour on the clock) and brings back its picture from outside. Their notice range: 8 tiles less a tile for every 4 points of the scout's Stealth (at least 3; the dead at most 5; at night ×${STEALTH.NIGHT_DETECT}). The scout's look: ${SCOUT.DAY_LOOK} tiles by day + binoculars or a spotting scope 3, a monocular or a thermal 2; at night the dark's sight (${b.night ? `${(list[0] || {}).look ?? "?"}` : "4–7"} tiles) or ${SCOUT.NVG_LOOK} with night vision. Odds: ${pct(SCOUT.BASE)} + ${pct(SCOUT.PER_TILE)} a tile the look beats their notice + ${pct(SCOUT.PER_SKILL)} a point of Scouting (${pct(SCOUT.MIN)}–${pct(SCOUT.MAX)}). Unseen: within ${SCOUT.REACH}× the look of the site's middle, their positions, the rooms, containers and locked doors are marked, and how many they are. Seen: ${humans ? "every one of their people starts alerted, " : ""}the dead near the middle wake, Heat +${SCOUT.FAIL_HEAT}, and ${pct(SCOUT.WOUND)} of the time the scout comes back hurt (${SCOUT.HURT[0]}–${SCOUT.HURT[1]}).`)}">Send a scout first? <span class="muted">(${SCOUT.HOURS} h; the odds of staying unseen)</span></div>
      <div class="row" style="gap:0.25rem;flex-wrap:wrap">${list.map((c, i) => btn("scout", `${esc(first(c.name))} <b>${pct(c.odds)}</b>${i === 0 ? " ★" : ""}`,
        `${c.name}: Stealth ${skill(c.s, "stealth")}, Scouting ${skill(c.s, "scouting")}. They notice at ${c.notice} tiles; ${first(c.name)} looks from ${c.look}${c.optic ? ` (optics +${c.optic})` : ""}${b.night && c.nvg ? " (night vision)" : ""}: ${pct(SCOUT.BASE)} + ${pct(SCOUT.PER_TILE)} × ${c.look - c.notice} + ${pct(SCOUT.PER_SKILL)} × ${skill(c.s, "scouting")} = ${pct(c.odds)}. Unseen: marks what is within ${c.reach} tiles of the middle.`,
        true, `data-id="${c.id}"`, "mini")).join("")}<span class="muted small">· or go in unscouted</span></div>`;
  }
  // Entry side.
  if (R) {
    html += `<div class="rplan-q">Which side do you start from?</div><div class="row" style="gap:0.25rem;flex-wrap:wrap">${SIDES.map((s) => {
      const has = P.sides.includes(s);
      const z = has ? R.zones.find((q) => q.side === s) : null;
      const tip = !has ? `No way in from the ${s} on this map.` : P.side === s ? `The team comes in from the ${s}${z && z.name ? ` (${z.name.toLowerCase()})` : ""}: it starts here${R.hasVehicle ? " with the vehicle" : ""}.` : `Circle round and come in from the ${s}${z && z.name ? ` (${z.name.toLowerCase()})` : ""}: the team${R.hasVehicle ? " and the vehicle" : ""} start at that zone, the enemy further from it. No time lost.`;
      return btn("side", SIDE_LABEL[s], tip, has && P.side !== s, `data-k="${s}"`, `mini ${P.side === s ? "active" : ""}`);
    }).join("")}</div>`;
  } else html += `<div class="muted" style="margin-top:0.35rem">One way in here: the ${esc(P.side)} side, where the team stands.</div>`;
  // The night.
  const T = nightTradeoff(state, b);
  if (P.night) html += `<div style="margin-top:0.35rem" class="muted">Waited ${P.night.hours} h for the dark (${hh(P.night.from)} → ${hh(P.night.to)}).</div>`;
  else if (b.night) html += `<div style="margin-top:0.35rem" class="muted">It is night: they notice at ${T.notice[1]} tiles, not ${T.notice[0]}; your people see ${T.dark[0]}–${T.dark[1]} tiles ahead in the dark (${T.nvgSight} with night vision: ${T.nvg} of ${T.team} have it).</div>`;
  else {
    const n = T.hours;
    html += `<div style="margin-top:0.35rem">${btn("night", `Wait for night <span class="muted">(${n} h, to ${hh(NIGHT_FROM)})</span>`,
      `The team holds out of sight until ${hh(NIGHT_FROM)}: the clock runs ${n} hours (they eat and drink, the world moves on), then the same site in the dark.`, true, "", "mini")}
      <div class="small"><span class="good">Stealth up:</span> noticed at ${T.notice[1]} tiles, not ${T.notice[0]} (×${STEALTH.NIGHT_DETECT}); the dead see ${T.dead}${T.heat != null ? `; Heat starts at 0, not ${T.heat}` : ""}. <span class="danger">Sight down:</span> ${T.dark[0]}–${T.dark[1]} tiles ahead in the dark (night vision ${T.nvgSight}: ${T.nvg} of ${T.team} have it); a light on is a beam that gives you away.</div></div>`;
  }
  if (card) html += `<div class="spread" style="margin-top:0.45rem"><span class="muted small">Ready?</span>${go}</div>`;
  html += `</div>`;
  return html;
}

// The chip in the raid's top strip while the dialogue is put aside (ui/combat.js renderRaidTop).
export const planChip = (b) => (planOpen(b) ? `<button class="mini" data-action="cb-plan" data-v="back" data-tip="The choices before you go in: a scout, the side, the night. Acting with anyone goes in as things are.">▸ Before you go in</button>` : "");

// cb-plan: d.v side (d.k) | scout (d.id) | night | go. Returns the message for the panel ("" when done).
export function planAction(state, d) {
  const b = state.combat;
  if (!planOpen(b)) return "Nothing to plan now.";
  if (d.v === "side") return setEntry(state, d.k);
  if (d.v === "scout") return sendScout(state, d.id != null ? Number(d.id) : null);
  if (d.v === "night") return waitNight(state);
  if (d.v === "go") return goIn(state);
  return "";
}
