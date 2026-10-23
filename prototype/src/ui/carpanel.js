// Battle screen pieces for cars found on the map (sim/foundcars.js): under the unit's action buttons, one row for the
// car next to it with what can be done (get in, keys, hotwire, inspect, siphon, claim; set off or silence its alarm)
// and the odds; the hover line for a car's cells; the throw's line over one (a window broken, its alarm set off). ui/
// combat.js calls these; the "car-act" handler is registered in main.js (CAR_ACTIONS). The buttons are plain .mini
// buttons: the pad's ring reaches them as any other (ui/padnav.js), A presses them.
import { combatAct } from "../sim/combat.js";
import { carsNear, carRecord, carOptions, verdictText, isOpen, canStart, repairOf, runs } from "../sim/foundcars.js";
import { ALARM, throwBreakChance } from "../sim/caralarms.js"; // car alarms (2026-10-23): set off to pull the dead away, by hand or a throw through the window
import { THROWABLES } from "../sim/stealth.js";
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
  const button = (op, label, tipText, show = true) => {
    const x = o[op];
    if (!x || !show) return "";
    const ok = can && x.ok && u.ap >= (x.ap || 1);
    return `<button class="mini" data-action="car-act" data-u="${u.id}" data-c="${rec.id}" data-o="${op}" ${ok ? "" : "disabled"} data-tip="${esc(x.ok ? tipText : x.why || tipText)}">${label}</button>`;
  };
  const status = rec.claimed ? "yours" : !isOpen(b, rec) ? "locked" : !rec.open ? "closed" : rec.inspected ? (runs(rec) ? "runs" : repairOf(rec) ? "fixable" : "scrap") : "not inspected";
  const start = rec.mil ? "start switch" : rec.keys ? "keys found" : rec.hot ? "hotwired" : rec.keys === false ? "no keys" : "";
  const force = o.force ? (o.force.glass ? `Break glass ${pct(o.force.chance)} (2 actions, loud)` : o.force.crowbar ? `Force ${pct(o.force.chance)} (loud)` : `Smash ${pct(o.force.chance)} (2 actions, loud)`) : "";
  // Its alarm (sim/caralarms.js): armed, the odds a smashed window, a pried door or the wires under the dash set it off
  // (the option's own when the sim gives one, else the table's); a label's "· alarm 40%" and the tip's sentence.
  const armed = rec.alarm === "armed";
  const risk = (x, k) => (armed && x ? x.alarm ?? ALARM[k] ?? 0 : 0);
  const forceRisk = o.force ? risk(o.force, o.force.crowbar ? "FORCE" : "SMASH") : 0, hotRisk = risk(o.hotwire, "HOTWIRE");
  const riskLabel = (v) => (v > 0 ? ` · alarm ${pct(v)}` : ""), riskTip = (v) => (v > 0 ? ` ${pct(v)} to set off its alarm.` : "");
  return `<div class="small" style="margin-top:0.3rem">🚗 <b>${esc(rec.name)}</b> <span class="muted">${status}${start ? ` · ${start}` : ""}</span>
    ${alarmLine(rec)}
    ${rec.inspected ? `<div class="small muted">${esc(verdictText(rec))}</div>` : ""}
    <div class="row" style="flex-wrap:wrap;gap:0.25rem;margin-top:0.15rem">
      ${button("enter", "Get in (1 action)", "Open the door: it is not locked.")}
      ${o.pick ? button("pick", `Pick${o.pick.makeshift ? " (makeshift)" : ""} ${pct(o.pick.chance)} (1 action)`, o.pick.makeshift ? `Pick the door lock with a bent wire (makeshift picks): 1 action a try, Heat +1; every try snaps one pick in two (${o.pick.left} left).` : "Pick the door lock with lockpicks: 1 action a try, Heat +1.") : ""}
      ${o.force ? button("force", force + riskLabel(forceRisk), (o.force.glass ? "No pry bar: smash a window and reach in (both actions, Heat +10, breaking glass wakes everything within 11 tiles)." : "Jimmy the door with a pry bar (1 action, Heat +6, wakes everything within 8 tiles).") + riskTip(forceRisk)) : ""}
      ${button("keys", `Look for keys ${o.keys ? pct(o.keys.chance) : ""}`, "The sun visor, the glovebox, the pockets of the dead lying near it (1 action, once).")}
      ${button("hotwire", `Hotwire ${o.hotwire ? pct(o.hotwire.chance) : ""}${riskLabel(hotRisk)}`, `Mechanics: pull the wires under the dash (1 action a try, Heat +1 on a raid; older cars are easier).${riskTip(hotRisk)}`)}
      ${button("inspect", "Inspect (1 action)", "Engine, tyres, battery, fuel: does it run, can it be fixed, or is it scrap?")}
      ${button("siphon", `Siphon ${rec.inspected ? rec.cond.fuel : "?"} fuel`, "Take the fuel in its tank (1 action): into your vehicle, then the team's cans.")}
      ${button("alarm", "Set off the alarm (1 action)", `Bang on the door and rock it on its springs (1 action): it whoops for ${ALARM.TURNS} turns, heard ${ALARM.RADIUS} tiles off, and the dead within that go to the car, away from you (Heat +${ALARM.HEAT} on a raid, +${ALARM.TURN_HEAT} each turn it rings). Whoever does it stands next to the noise: walk away. From afar: throw a bottle or an empty magazine through its window.`, armed)}
      ${button("silence", "Silence the alarm (1 action)", "From inside: reach under the dash and yank the alarm's wires (1 action). The dead already on their way still come to look.", rec.alarm === "ringing")}
      ${button("claim", o.claim && o.claim.fix ? "Claim (needs repair)" : "Claim it", o.claim && o.claim.fix ? `Mark it as yours: it stays parked here until a team repairs it (${o.claim.fix.what.join(", ")}: ${o.claim.fix.parts} parts${o.claim.fix.scrap ? `, ${o.claim.fix.scrap} scrap` : ""}, Mechanics ${o.claim.fix.mech}+, ${o.claim.fix.hours}h).` : `It runs${canStart(rec) ? "" : " (once you can start it)"}: it joins the team after the fight if the team has no vehicle, else it stays parked here (marked on the map).`)}
    </div></div>`;
}

// The alarm's line in the car's row (sim/caralarms.js rec.alarm): seen from next to it, as the panel is.
function alarmLine(rec) {
  const a = rec.alarm;
  if (a === "ringing") return `<div class="small danger"><b>ALARM RINGING — ${rec.alarmLeft ?? "?"} turn${rec.alarmLeft === 1 ? "" : "s"}</b>${rec.glass ? " · a window broken" : ""}</div>`;
  const glass = rec.glass ? " · a window broken" : "";
  if (a === "armed") return `<div class="small warn">A red light blinks on the dash: it has an alarm${glass}</div>`;
  if (a === "off") return `<div class="small muted">Alarm dead${glass}</div>`;
  return `<div class="small muted">No alarm${glass}</div>`;
}
// The throw's line over a car (ui/combat.js, throw mode with a lure in hand: a bottle, an empty magazine...): the odds
// it goes through a window (sim/caralarms.js throwBreakChance), and that the alarm goes off if it has one. "" when the
// cell is not a found car's or what is thrown is not a small, non-explosive thing.
export function carThrowPreview(b, key, x, y) {
  const T = THROWABLES[key], c = b && b.cells && x >= 0 && y >= 0 && x < b.w && y < b.h ? b.cells[y * b.w + x] : null;
  if (!T || T.fx || T.self || !c || !c.car || c.car.escort || (c.k !== "car" && c.k !== "truck")) return ""; // escort: a convoy's own vehicle (caralarms.js carIdAt)
  const rec = b.cars && b.cars[c.car.id];
  if (c.car.wrecked || c.k === "truck" || (rec && (rec.alarm === "ringing" || rec.model === "boxtruck"))) return ""; // a burnt-out shell: nothing to break; a ringing one: already going
  if (c.car.mil || (rec && rec.mil)) return `<span class="muted">Armoured glass: a throw will not break it.</span>`;
  if (rec && rec.glass) return `<span class="muted">It goes in through the broken window: the alarm stays quiet.</span>`;
  const p = throwBreakChance(key);
  if (!(p > 0)) return "";
  return `<span class="warn">Through the window: ${pct(p)} to break it; sets off the alarm if it has one.</span>`;
}

// Hover text over a car's cells ("" when there is none).
export function carPreview(state, b, x, y) {
  const c = b.cells[y * b.w + x];
  if (!c || !c.car || (c.k !== "car" && c.k !== "truck")) return "";
  const rec = b.cars && b.cars[c.car.id];
  const name = rec ? rec.name : c.car.mil ? `${c.car.mil.cond === "burnt" ? "Burned-out " : c.car.mil.cond === "wrecked" ? "Wrecked " : ""}${{ cargo: "Army cargo truck", humvee: "Humvee", mrap: "MRAP" }[c.car.mil.kind] || "Army truck"}` : c.k === "truck" ? "Burnt-out truck" : "Car";
  const ring = rec && rec.alarm === "ringing" ? ` · <span class="danger">ALARM RINGING (${rec.alarmLeft ?? "?"} turn${rec.alarmLeft === 1 ? "" : "s"})</span>` : ""; // heard from anywhere: the dead are going to it
  return `<b>${esc(name)}</b> · ${c.k === "truck" ? "full" : "half"} cover${ring}<br><span class="muted">${rec && rec.inspected ? esc(verdictText(rec)) : "Stand next to it: get in, look for the keys or hotwire it, inspect it, and claim it if it runs."}</span>`;
}

export const CAR_ACTIONS = {
  "car-act": (state, ui, d) => {
    if (!state.combat) return;
    const err = combatAct(state, { type: "car", unit: Number(d.u), car: Number(d.c), op: d.o });
    cui.msg = err || "";
  },
};
