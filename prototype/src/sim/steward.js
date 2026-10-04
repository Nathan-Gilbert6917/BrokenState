// Base stewards (suggestions-2 #7): hand one base, or parts of it, to the governor's logic (autopilot.js) while you
// keep everything else (teams, trips, cards, the other bases). Normal play, not a dev tool.
//
// base.steward = { on, style, areas: { roles, building, production, medical, food, defence }, day: { ... } }
// Every area is on by default; each can be switched off on its own:
//   roles       sets everyone's role every hour (autopilot planRoles), but only within the areas it has: a role in
//               an area that is off (farm = Farming & food, medic = Medical, guard = Defence, operate and craft =
//               Crafting & production, build = Building) is left as it is, and so are pinned people;
//   building    queues buildings (planBuilds), each kind only if its own area is on too (walls and barricades need
//               Defence, the hospital Medical, plots and stores Farming & food, stations Crafting & production);
//   production  hands out armory gear (equipFromArmory), queues crafts (planCrafts) and sets the stations' standing
//               orders (govOrders: the player's own orders stand);
//   medical     treats the hurt and sick with base meds and sets the meds reserve (planTreatment);
//   food        farmers and the food side of building (farm plots, stores, water);
//   defence     guards and the defence buildings.
// Pinned survivors (s.pinned) are never moved, re-equipped or given a station by a steward (or the autopilot).
// Taking over = switching it off: nothing is undone, everything stays as the steward left it. While the dev
// autopilot is on it runs the whole holdout and stewards do nothing.
// Once a day (STEWARD_LOG_HOUR) each steward writes one log line with what it did since the last one.
import { log, hourOfDay, atBase } from "./world.js";
import { BUILDINGS } from "./buildings.js";
import { CRAFTS, craftName } from "./crafting.js";
import { GOVERN_AREAS, PERSONALITIES, stewardRun, autopilotStats } from "./autopilot.js";

export const STEWARD_AREAS = {
  roles:      { name: "Roles", desc: "Sets everyone's role every hour by what the base needs (pinned people and roles in areas switched off are left alone)." },
  building:   { name: "Building", desc: "Queues buildings: beds, water, storage and the rest. Defence, medical, food and workshop buildings also need their own area on." },
  production: { name: "Crafting & production orders", desc: "Hands out armory gear, queues crafts and sets the stations' standing orders (your own orders stand)." },
  medical:    { name: "Medical", desc: "Treats the hurt and sick with this base's meds, staffs the hospital, sets the meds reserve." },
  food:       { name: "Farming & food", desc: "Farmers for the plots, and the food and water buildings (plots, stores, wells, preserving)." },
  defence:    { name: "Defence", desc: "Guards when raiders or hordes are near, a lookout at the hub, and walls, barricades and other defences." },
};
export const STEWARD_LOG_HOUR = 20;
const emptyDay = () => ({ roles: 0, builds: [], crafts: [], treated: 0, equipped: 0, orders: 0, hours: 0 });

export function stewardOf(base) {
  if (!base.steward) base.steward = { on: false, style: "balanced", areas: Object.fromEntries(GOVERN_AREAS.map((k) => [k, true])), day: emptyDay() };
  const s = base.steward;
  for (const k of GOVERN_AREAS) if (s.areas[k] === undefined) s.areas[k] = true;
  if (!s.day) s.day = emptyDay();
  return s;
}
export const stewardOn = (base) => !!(base && base.steward && base.steward.on);

export function setSteward(state, base, on) {
  const s = stewardOf(base);
  if (!!on === s.on) return "";
  s.on = !!on;
  s.day = emptyDay();
  const msg = on
    ? `A steward now runs ${base.name} (${areaList(s)}). Pinned people are left alone; switch it off any time to take over.`
    : `You take over ${base.name} from the steward. Everything stays as it is.`;
  log(state, `🧭 ${msg}`, "info");
  return msg;
}
export function setStewardArea(state, base, key, on) {
  if (!STEWARD_AREAS[key]) return "";
  const s = stewardOf(base);
  s.areas[key] = !!on;
  return `${base.name} steward: ${STEWARD_AREAS[key].name} ${on ? "handed over" : "back to you"}.`;
}
export function setStewardStyle(state, base, style) {
  if (!PERSONALITIES[style]) return "";
  stewardOf(base).style = style;
  return `${base.name} steward: ${PERSONALITIES[style].name} style.`;
}
export function setPinned(state, s, on) {
  if (!s) return "";
  s.pinned = !!on;
  if (on) s.parked = null; // production.js: a pinned operator is not moved to a fallback either
  return `${s.name} is ${on ? "pinned: stewards will not change their role, station or gear" : "no longer pinned"}.`;
}
const areaList = (s) => {
  const on = GOVERN_AREAS.filter((k) => s.areas[k]);
  return on.length === GOVERN_AREAS.length ? "all areas" : on.length ? on.map((k) => STEWARD_AREAS[k].name).join(", ") : "no areas";
};

// Hourly, from world.js tickHour (after the autopilot would run): every base with a steward on.
export function stewardHour(state) {
  if (state.autopilot || state.gameOver) return;
  for (const base of [...state.bases]) {
    if (!stewardOn(base)) continue;
    const s = stewardOf(base);
    try {
      runOne(state, base, s);
    } catch (e) {
      if (typeof window === "undefined") throw e; // headless tools should see the crash
      console.error("Steward error:", e);
      s.on = false;
      log(state, `🧭 The steward of ${base.name} stopped after an error (${e.message}). You have control there.`, "danger");
    }
    if (hourOfDay(state) === STEWARD_LOG_HOUR && state.bases.includes(base)) dailyLine(state, base, s);
  }
}

function runOne(state, base, s) {
  const before = autopilotStats(state);
  const builds = new Set(base.construction.map((j) => j.id));
  const crafts = new Set((base.crafting || []).map((j) => j.id));
  const changed = stewardRun(state, base, s.areas, s.style);
  const after = autopilotStats(state);
  const d = s.day;
  d.hours++;
  d.roles += changed || 0;
  d.treated += after.treated - before.treated;
  d.equipped += after.equipped - before.equipped;
  d.orders += (after.orders || 0) - (before.orders || 0);
  for (const j of base.construction) if (!builds.has(j.id)) d.builds.push(BUILDINGS[j.type].name);
  for (const j of base.crafting || []) if (!crafts.has(j.id) && j.orderId == null && CRAFTS[j.recipe]) d.crafts.push(craftName(j.recipe));
}

const listOf = (arr) => {
  const c = {};
  for (const x of arr) c[x] = (c[x] || 0) + 1;
  return Object.entries(c).map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(", ");
};
// The day's line: what it did, and the roles as they stand.
export function stewardSummary(state, base) {
  const s = stewardOf(base);
  const d = s.day;
  const bits = [];
  if (d.roles) bits.push(`${d.roles} role change${d.roles === 1 ? "" : "s"}`);
  if (d.builds.length) bits.push(`queued ${listOf(d.builds)}`);
  if (d.crafts.length) bits.push(`crafting ${listOf(d.crafts)}`);
  if (d.treated) bits.push(`${d.treated} treatment${d.treated === 1 ? "" : "s"}`);
  if (d.equipped) bits.push(`${d.equipped} item${d.equipped === 1 ? "" : "s"} handed out`);
  if (d.orders) bits.push(`${d.orders} station order${d.orders === 1 ? "" : "s"} set`);
  const counts = {};
  for (const p of atBase(state, base.id)) counts[p.role] = (counts[p.role] || 0) + 1;
  const roles = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${n} ${r}`).join(", ");
  const pinned = atBase(state, base.id).filter((p) => p.pinned).length;
  return `${bits.length ? bits.join("; ") : "no changes"}${roles ? ` · now ${roles}` : ""}${pinned ? ` · ${pinned} pinned` : ""}`;
}
function dailyLine(state, base, s) {
  log(state, `🧭 Steward of ${base.name} today: ${stewardSummary(state, base)}.`, "info");
  s.last = stewardSummary(state, base);
  s.day = emptyDay();
}
