// The Diplomacy window's Coalition standing tab (sim/coalition.js): each member's standing toward you as a bar with its
// leave and hostile lines, its modifiers, its record of asks granted and refused and the fatigue that comes of it, its
// risk flags, how word reaches it (radio or envoy: commsBadge) and the land the coalition would keep without it; then the member-to-member grid, each cell's modifiers
// in its tip. Read only: answers come on the cards, Expel is on the Coalition tab.
import { allianceMembers, controlledLand, ALLIANCE } from "../sim/alliance.js";
import { standing, standingParts, pairStanding, pairParts, band, risks, recordOf, fatigue, landWithout, ensureBalance, BAL } from "../sim/coalition.js";
import { commsWith } from "../sim/envoys.js"; // radio or envoy

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const pct = (v) => `${Math.round((v || 0) * 100)}%`;
const sign = (v) => (v >= 0 ? `+${Math.round(v)}` : `−${Math.abs(Math.round(v))}`);
const swatch = (c) => `<span class="swatch" style="background:${c}"></span>`;
const at = (v) => Math.max(0, Math.min(100, (v + 100) / 2)); // −100..100 → a bar's 0..100%
const tone = (v) => (v < -20 ? "var(--danger)" : v < 20 ? "var(--muted)" : "var(--good)");
const RISK_CLASS = { leave: "danger", hostile: "danger", quit: "danger", grudge: "warn", uneasy: "muted" };
// How word reaches a member (sim/envoys.js): by radio (instant) or by envoy (in person, the answer when it is home).
export function commsBadge(state, f) {
  return commsWith(state, f) === "radio"
    ? `<span class="good small"${tip("A radio link both ways: their asks come at once and your answers reach them at once.")}>📻 by radio</span>`
    : `<span class="muted small"${tip("No radio link: their asks come by envoy (the card when it reaches your hub) and hear your answer when it gets home; your messages go by envoy (Diplomacy → Envoys).")}>✉ by envoy</span>`;
}

// A bar from −100 to 100: the standing, with ticks at the leave and hostile lines.
function standingBar(s, b) {
  const tick = (v, c, t) => `<i${tip(t)} style="position:absolute;left:${at(v)}%;top:-2px;bottom:-2px;width:2px;background:${c}"></i>`;
  return `<div class="bar" style="position:relative;min-width:9rem"><i style="width:${at(s)}%;background:${s < b.leave ? "var(--danger)" : s < b.leave + 8 ? "#ffd166" : "var(--good)"}"></i>${tick(b.leave, "#ffd166", `Leave line ${b.leave}`)}${tick(b.hostile, "var(--danger)", `Hostile line ${b.hostile}`)}</div>`;
}
const partsText = (parts) => parts.map((p) => `${p.label} ${sign(p.v)}${p.base ? "" : p.fading ? ` (fading, ~${p.fading} days)` : " (while it lasts)"}`).join("\n");
const partsList = (parts) => parts.filter((p) => !p.base).map((p) => `<span class="${p.v >= 0 ? "good" : "danger"}"${tip(p.fading ? `Fades in about ${p.fading} days` : "Lasts while it holds")}>${esc(p.label)} ${sign(p.v)}${p.fading ? "" : " ●"}</span>`).join(" · ");

function memberRow(state, f, land) {
  const s = standing(state, f), b = band(state, f), r = recordOf(state, f), x = fatigue(state, f);
  const flags = risks(state, f);
  const without = landWithout(state, f);
  const parts = standingParts(state, f);
  return `<div class="card small">
    <div class="spread"><b>${swatch(f.color)}${esc(f.name)}</b> ${commsBadge(state, f)}<span${tip(partsText(parts))} style="color:${tone(s)}">standing <b>${Math.round(s)}</b></span></div>
    <div class="row" style="gap:0.5rem;align-items:center">${standingBar(s, b)}<span class="muted"${tip(`By their kind (${f.type}) and their own temper: under ${b.leave} they may leave, a little likelier each day; under ${b.floor} they leave at once; leaving under ${b.hostile} they turn hostile${f.type === "raider" || f.type === "expansionist" || f.type === "zealot" ? " and declare war" : ""}. Another member under ${b.grudge} with them and they demand its expulsion.`)}>leaves under ${b.leave} · hostile under ${b.hostile}</span></div>
    <div>Goodwill ${Math.round(f.goodwill)}${partsList(parts) ? ` · ${partsList(parts)}` : ""}</div>
    <div${tip(`Asks granted and refused (all time). The recent count fades ${Math.round((1 - BAL.TALLY_FADE) * 100)}% a day; each refusal over the grants with them makes the next refusal land harder (+${Math.round(BAL.FAT.OWN * 100)}%) and deepens "Requests ignored" day by day.`)}>Record: <b class="good">${r.nAcc}</b> granted · <b class="${r.nRef > r.nAcc ? "danger" : ""}">${r.nRef}</b> refused${x > 1.01 ? ` · <span class="danger">refusals land ×${x.toFixed(1)}</span>` : ""}</div>
    ${flags.length ? `<div>${flags.map((k) => `<span class="${RISK_CLASS[k.kind] || ""}">⚠ ${esc(k.text)}</span>`).join(" · ")}</div>` : ""}
    <div class="muted"${tip(`The coalition holds ${pct(land.pct)} of the land; the victory needs over ${pct(ALLIANCE.LAND_NEEDED)} and no group outside the coalition.`)}>If they leave: land ${pct(without)}${without <= ALLIANCE.LAND_NEEDED && land.pct > ALLIANCE.LAND_NEEDED ? ` <span class="danger">(under the ${pct(ALLIANCE.LAND_NEEDED)} needed)</span>` : ""}, and a group outside the coalition.</div>
  </div>`;
}

function pairGrid(state, ms) {
  if (ms.length < 2) return `<div class="muted small">With two members or more, how they feel about each other shows here.</div>`;
  const cell = (a, b) => {
    if (a === b) return `<td class="muted">—</td>`;
    const p = pairStanding(state, a, b), g = band(state, a).grudge;
    return `<td style="color:${tone(p)}"${tip(`${a.name} → ${b.name}\n${partsText(pairParts(state, a, b))}${p < g ? `\n${a.name} want ${b.name} out (under ${g})` : ""}`)}>${Math.round(p)}${p < g ? " ⚠" : ""}</td>`;
  };
  return `<table class="t small"><tr><th></th>${ms.map((f) => `<th${tip(f.name)}>${swatch(f.color)}</th>`).join("")}</tr>
    ${ms.map((a) => `<tr><td>${swatch(a.color)}${esc(a.name)}</td>${ms.map((b) => cell(a, b)).join("")}</tr>`).join("")}</table>`;
}

export function coalitionStandingTab(state) {
  const ms = allianceMembers(state);
  const B = ensureBalance(state);
  const land = controlledLand(state);
  const all = B.all;
  return `<h3${tip("Standing is goodwill plus what each member remembers (● lasts while it holds; the rest fades). Every few days a member asks something; granting costs goods or people, refusing costs standing, harder the more you refuse.")}>Coalition standing</h3>
    ${ms.length ? `<div class="small">The coalition: <b class="good">${all.nAcc}</b> asks granted, <b class="${all.nRef > all.nAcc ? "danger" : ""}">${all.nRef}</b> refused · ${B.stats.left} member${B.stats.left === 1 ? "" : "s"} walked out${B.stats.hostile ? ` (${B.stats.hostile} in anger)` : ""}${B.stats.expelled ? ` · ${B.stats.expelled} expelled` : ""} · land ${pct(land.pct)} of the ${pct(ALLIANCE.LAND_NEEDED)}+ needed</div>
      ${ms.map((f) => memberRow(state, f, land)).join("")}
      <h4${tip("How each member feels about each other one: their relations plus border friction, trade, a common enemy, incidents and your rulings. Under a member's grudge line (⚠) it demands the other's expulsion.")}>Between members</h4>
      ${pairGrid(state, ms)}` : `<div class="muted small">No members yet. Once a group joins, its standing, its asks and how it gets on with the others show here.</div>`}`;
}
