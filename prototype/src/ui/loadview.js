// Load panels (sim/load.js): each person's load and band, a car's fill and fuel, a team's pace and rations.
// Used by the trip planner (ui.js), the team panel (expedition.js) and the inventory screen (inventory.js).
import { LOAD_BANDS, bandName, BIKE_EASE } from "../sim/load.js";
import { FUEL_FULL, OVERLOAD_MAX } from "../sim/vehicles.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const kg = (x) => `${Math.round(x * 10) / 10} kg`;
const pct = (x) => (Math.round(Math.abs(x - 1) * 100) === 0 ? "normal" : `${x > 1 ? "+" : "−"}${Math.round(Math.abs(x - 1) * 100)}%`);
const BAND_CLASS = ["on", "", "trait", "off"]; // chip colors: Light green, Medium plain, Heavy amber, Overloaded red

export const BANDS_HELP = `Load bands (the same for everyone, by felt load): ${LOAD_BANDS.map((b, i) => `${b.name} ${i < LOAD_BANDS.length - 1 ? `≤ ${b.upTo} kg` : `above ${LOAD_BANDS[i - 1].upTo} kg`} (pace ${b.slow ? `−${Math.round(b.slow * 100)}%` : "full"}, food and water ${b.eat ? `+${Math.round(b.eat * 100)}%` : "normal"})`).join(" · ")}. Felt load: × 0.88 with an assault pack, × 1.2 with a Bad Back. Scouting takes 2.5% a point off the slow-down and the extra rations (half at Scouting 20). The team moves at its slowest member's pace; the extra rations count only on the move. A car takes all of it away; on bikes the racks carry 15 kg each and riding takes ${Math.round(BIKE_EASE * 100)}% of the rest away.`;

export const bandChip = (i, extra = "") => `<span class="chip ${BAND_CLASS[i] || ""}"${tip(i >= 0 ? `${LOAD_BANDS[i].name}: ${LOAD_BANDS[i].slow ? `−${Math.round(LOAD_BANDS[i].slow * 100)}% pace` : "full pace"}, ${LOAD_BANDS[i].eat ? `+${Math.round(LOAD_BANDS[i].eat * 100)}% food and water` : "normal rations"} on the move, before Scouting and bikes.` : "")}>${bandName(i)}${extra}</span>`;

// One row per person: load / max, band, pace and rations (as they would be on foot, or on bikes).
export function loadRows(t, { title = "" } = {}) {
  if (!t || !t.people.length) return "";
  const riding = t.mode === "bike";
  return `<table class="t small loadt">${title ? `<tr><th colspan="5" style="text-align:left">${esc(title)}</th></tr>` : ""}
    ${t.people.map((x) => `<tr${tip(`${x.name}: carries ${kg(x.load)} of a ${kg(x.max)} max (felt ${kg(x.felt)}). ${x.ease ? `Scouting takes ${Math.round(x.ease * 100)}% off the effect. ` : ""}${riding ? `On a bike: ${Math.round(BIKE_EASE * 100)}% of the effect is taken away. ` : ""}Pace ${pct(x.speed)}, rations ${pct(x.eat)} on the move.`)}>
      <td>${esc(String(x.name).split(" ")[0])}</td><td class="${x.load > x.max + 1e-6 ? "danger" : ""}">${Math.round(x.load)}/${Math.round(x.max)} kg</td>
      <td>${bandChip(x.band)}</td><td class="muted">pace ${pct(x.speed)}</td><td class="muted">rations ${pct(x.eat)}</td></tr>`).join("")}</table>`;
}

// A car's load line: riders + gear + cargo against its payload, and the fuel multiplier.
export function carLine(t, name = "the car") {
  if (!t || t.mode !== true) return "";
  const p = Math.round(t.fill * 100);
  const cls = t.fill > 1 ? "danger" : t.fill > FUEL_FULL.from ? "warn" : "";
  return `<div class="small ${cls}"${tip(`Everything in ${name}: the riders (80 kg each), what they wear, the supplies and the cargo: ${kg(t.vehicleLoad)} of its ${t.payload} kg payload. Fuel per tile ×1 up to ${Math.round(FUEL_FULL.from * 100)}% full, ×${FUEL_FULL.atFull} at 100%, up to ×${FUEL_FULL.atMax} at ${Math.round(OVERLOAD_MAX * 100)}% (the most it takes). Past 100% it is overloaded: 15% slower, wears and breaks down 1.5× as much. The riders feel none of the load.`)}>Vehicle load ${p}% · fuel ×${t.fuelMult.toFixed(2)}${t.fill > 1 ? " · overloaded: slower, more wear" : ""}</div>`;
}

// The team's pace and rations from its load: on foot, bikes or a car.
export function paceLine(t) {
  if (!t || !t.people.length) return "";
  if (t.mode === true) return `<div class="small muted">In the car: nobody feels their load (normal pace and rations).</div>`;
  const side = t.mode === "bike" ? t.ride : t.foot;
  const worst = Math.max(...t.people.map((x) => x.band));
  const eat = side.people.reduce((a, x) => a + x.eat, 0) / side.people.length;
  const cls = worst >= 3 ? "danger" : worst >= 2 ? "warn" : "";
  return `<div class="small ${cls}">${t.mode === "bike" ? `On bikes (racks ${kg(t.onRack || 0)} of ${kg(t.rack || 0)}): ` : "On foot: "}pace ${pct(side.speed)} (slowest), food and water ${pct(eat)} on the move${worst >= 2 ? ` · ${bandName(worst)}: ${worst >= 3 ? "drop something or take a vehicle" : "slower and hungrier"}` : ""}</div>`;
}

// Warning lines for the planner (empty when everyone is Light or Medium).
export function loadWarnings(t) {
  if (!t || t.mode === true) return [];
  const heavy = t.people.filter((x) => x.band >= 2);
  if (!heavy.length) return [];
  return [`Load: ${heavy.map((x) => `${String(x.name).split(" ")[0]} ${bandName(x.band)} (${Math.round(x.load)} kg)`).join(", ")}. The team moves at ${pct((t.mode === "bike" ? t.ride : t.foot).speed)} pace and eats more on the way. Pack lighter, leave heavy armor, or take bikes or a vehicle.`];
}
