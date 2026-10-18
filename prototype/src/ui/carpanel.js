// Battle screen pieces for cars found on the map (sim/foundcars.js): under the unit's action buttons, one row for the
// car next to it with what can be done (get in, keys, hotwire, inspect, siphon, claim) and the odds; the hover line
// for a car's cells. ui/combat.js calls these; the "car-act" handler is registered in main.js (CAR_ACTIONS).
import { combatAct } from "../sim/combat.js";
import { carsNear, carRecord, carOptions, verdictText, isOpen, canStart, repairOf, runs } from "../sim/foundcars.js";
import { cui } from "./combat.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (v) => `${Math.round(v * 100)}%`;

export function carPanel(state, b, u) {
  if (!u || u.aboard) return "";
  const ids = carsNear(b, u);
  if (!ids.length) return "";
  const rec = carRecord(state, b, ids[0]);
  if (!rec) return "";
  const o = carOptions(state, b, u, rec);
  const can = b.phase === "player" && !b.over && u.ap > 0;
  const button = (op, label, tipText) => {
    const x = o[op];
    if (!x) return "";
    const ok = can && x.ok && u.ap >= (x.ap || 1);
    return `<button class="mini" data-action="car-act" data-u="${u.id}" data-c="${rec.id}" data-o="${op}" ${ok ? "" : "disabled"} data-tip="${esc(x.ok ? tipText : x.why || tipText)}">${label}</button>`;
  };
  const status = rec.claimed ? "yours" : !isOpen(b, rec) ? "locked" : !rec.open ? "closed" : rec.inspected ? (runs(rec) ? "runs" : repairOf(rec) ? "fixable" : "scrap") : "not inspected";
  const start = rec.mil ? "start switch" : rec.keys ? "keys found" : rec.hot ? "hotwired" : rec.keys === false ? "no keys" : "";
  const force = o.force ? (o.force.glass ? `Break glass ${pct(o.force.chance)} (2 actions, loud)` : o.force.crowbar ? `Force ${pct(o.force.chance)} (loud)` : `Smash ${pct(o.force.chance)} (2 actions, loud)`) : "";
  return `<div class="small" style="margin-top:0.3rem">🚗 <b>${esc(rec.name)}</b> <span class="muted">${status}${start ? ` · ${start}` : ""}</span>
    ${rec.inspected ? `<div class="small muted">${esc(verdictText(rec))}</div>` : ""}
    <div class="row" style="flex-wrap:wrap;gap:0.25rem;margin-top:0.15rem">
      ${button("enter", "Get in (1 action)", "Open the door: it is not locked.")}
      ${o.pick ? button("pick", `Pick${o.pick.makeshift ? " (makeshift)" : ""} ${pct(o.pick.chance)} (1 action)`, o.pick.makeshift ? `Pick the door lock with a bent wire (makeshift picks): 1 action a try, Heat +1; every try snaps one pick in two (${o.pick.left} left).` : "Pick the door lock with lockpicks: 1 action a try, Heat +1.") : ""}
      ${o.force ? button("force", force, o.force.glass ? "No pry bar: smash a window and reach in (both actions, Heat +10, breaking glass wakes everything within 11 tiles)." : "Jimmy the door with a pry bar (1 action, Heat +6, wakes everything within 8 tiles).") : ""}
      ${button("keys", `Look for keys ${o.keys ? pct(o.keys.chance) : ""}`, "The sun visor, the glovebox, the pockets of the dead lying near it (1 action, once).")}
      ${button("hotwire", `Hotwire ${o.hotwire ? pct(o.hotwire.chance) : ""}`, "Mechanics: pull the wires under the dash (1 action a try, Heat +1 on a raid; older cars are easier).")}
      ${button("inspect", "Inspect (1 action)", "Engine, tyres, battery, fuel: does it run, can it be fixed, or is it scrap?")}
      ${button("siphon", `Siphon ${rec.inspected ? rec.cond.fuel : "?"} fuel`, "Take the fuel in its tank (1 action): into your vehicle, then the team's cans.")}
      ${button("claim", o.claim && o.claim.fix ? "Claim (needs repair)" : "Claim it", o.claim && o.claim.fix ? `Mark it as yours: it stays parked here until a team repairs it (${o.claim.fix.what.join(", ")}: ${o.claim.fix.parts} parts${o.claim.fix.scrap ? `, ${o.claim.fix.scrap} scrap` : ""}, Mechanics ${o.claim.fix.mech}+, ${o.claim.fix.hours}h).` : `It runs${canStart(rec) ? "" : " (once you can start it)"}: it joins the team after the fight if the team has no vehicle, else it stays parked here (marked on the map).`)}
    </div></div>`;
}

// Hover text over a car's cells ("" when there is none).
export function carPreview(state, b, x, y) {
  const c = b.cells[y * b.w + x];
  if (!c || !c.car || (c.k !== "car" && c.k !== "truck")) return "";
  const rec = b.cars && b.cars[c.car.id];
  const name = rec ? rec.name : c.car.mil ? `${c.car.mil.cond === "burnt" ? "Burned-out " : c.car.mil.cond === "wrecked" ? "Wrecked " : ""}${{ cargo: "Army cargo truck", humvee: "Humvee", mrap: "MRAP" }[c.car.mil.kind] || "Army truck"}` : c.k === "truck" ? "Burnt-out truck" : "Car";
  return `<b>${esc(name)}</b> · ${c.k === "truck" ? "full" : "half"} cover<br><span class="muted">${rec && rec.inspected ? esc(verdictText(rec)) : "Stand next to it: get in, look for the keys or hotwire it, inspect it, and claim it if it runs."}</span>`;
}

export const CAR_ACTIONS = {
  "car-act": (state, ui, d) => {
    if (!state.combat) return;
    const err = combatAct(state, { type: "car", unit: Number(d.u), car: Number(d.c), op: d.o });
    cui.msg = err || "";
  },
};
