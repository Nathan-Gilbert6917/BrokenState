// Standing production orders (suggestions-2 #6, the RimWorld bill / Minecraft level emitter) for every workshop
// station and the drying racks, and repeating craft orders for the craft queue.
//
// Station orders (base.orders[stationId], the drying racks share base.orders.rack). A station without an order
// runs Forever, as before. Modes:
//   forever  run whenever the operator and the inputs are there;
//   until N  stop once the base holds N of the station's product (ammo, meds, parts, preserved food, fuel), start
//            again when it falls below N minus a margin of 10% (at least 1), so the operator does not flip every day;
//   keep N   keep at least N of one input (scrap, food, fuel …): the station stops when a day's work would take
//            that input below N;
//   off      never runs.
// When an order holds a station its operator idles there (the default), or switches to a fallback picked on the
// order: another role (farm, scavenge, build, guard, craft, rest, medic) or another free station. They come back by
// themselves as soon as the order wants work again (s.parked remembers where from). Pinned people idle instead.
// The fallback is a hand rule: while the dev autopilot or a base steward with the Roles area runs a base, the
// governor sets roles there (autopilot.js stationWorth reads the same orders and staffs only stations they want run).
// An order set in the UI is the player's (by: "player"); the governor and stewards only change their own ones.
//
// Craft orders (base.craftOrders): "keep N of item X (minimum quality Q) in the armory". Checked every hour: when the
// armory holds fewer than N items of X at Q or better (supplies such as dressings count the stock instead), one job
// is queued (materials paid then, as by hand), one at a time per order. Quality: the order only queues a job when
// someone at the base can make it at Q or better (crafting.craftQuality from their skill), and the job only moves
// while a crafter on the Craft role who reaches Q works it (crafting.craftJobStatus); and only items at Q or better
// count toward N. Both rules together: a low-skill crafter never turns out items that would not count (which would
// loop forever), and looted or worn-down items below Q do not stop new ones being made.
import { log, atBase, skill, newId } from "./world.js";
import { BUILDINGS, RECIPES, stations, recipeOutput } from "./buildings.js";
import { CRAFTS, craftQueue, canCraft, queueCraft, craftQuality, craftName, benchQuality, canAttempt, craftSkill } from "./crafting.js";
import { POWER_USERS, POWER_BOOST, STILL, isPowered, refreshPower } from "./power.js";
import { isManaged } from "./work.js";
import { stockHas } from "./water.js"; // a Keep-at-least order on water counts both kinds
import { supplyAmt } from "./rounds.js"; // "ammo": every round there, any calibre
import { reloadWork } from "./reloading.js"; // a reloading bench works its reloading orders whatever its station order holds

export const ORDER_MODES = {
  forever: { name: "Forever", desc: "Runs whenever the operator and the inputs are there." },
  until:   { name: "Until stock reaches N", desc: "Stops once the base holds N of the product; starts again when it falls 10% below." },
  keep:    { name: "Keep at least N of an input", desc: "Stops when a day's work would take the chosen input below N." },
  off:     { name: "Off", desc: "Never runs." },
};
export const FALLBACK_ROLES = ["farm", "scavenge", "build", "guard", "craft", "rest", "medic"];
export const QUALITY_STEPS = [0, 0.7, 0.8, 0.9, 1];
export const RACK = { id: "rack", type: "smoker" }; // the drying racks: one order for all of them (no operator)
const DEFAULT = { mode: "forever", n: 0, key: null, fallback: "idle" };
const r1 = (v) => Math.round(v * 10) / 10;

const recipeOf = (st) => (st.id === RACK.id ? null : BUILDINGS[st.type] && BUILDINGS[st.type].station);
// What a station makes and uses: the drying racks turn food into preserved food.
export function productKey(st) {
  if (st.id === RACK.id) return "preserved";
  const r = RECIPES[recipeOf(st)];
  return r ? Object.keys(r.out)[0] || null : null;
}
export function inputKeys(st) {
  if (st.id === RACK.id) return ["food"];
  const r = RECIPES[recipeOf(st)];
  return r ? Object.keys(r.in) : [];
}
const mainInput = (st) => {
  const r = st.id === RACK.id ? null : RECIPES[recipeOf(st)];
  return (r && r.main) || inputKeys(st)[0] || null;
};
export const untilMargin = (n) => Math.max(1, Math.round(n * 0.1));

// The order on a station (never creates one).
export function stationOrder(base, st) {
  const o = base && base.orders && st ? base.orders[st.id] : null;
  return o ? { ...DEFAULT, ...o, key: o.key || mainInput(st) } : { ...DEFAULT, key: mainInput(st) };
}
export const hasOrder = (base, st) => !!(base && base.orders && st && base.orders[st.id]);

// Sets (patches) a station's order. by: "player" (UI) or "ai" (the governor / a steward). Returns a message.
export function setStationOrder(state, base, stId, patch, by = "player") {
  const st = stId === RACK.id || stId === "rack" ? RACK : stations(base).find((x) => x.id === Number(stId));
  if (!st) return "That station is gone.";
  base.orders = base.orders || {};
  const cur = stationOrder(base, st);
  const next = { ...cur, ...patch, by };
  if (!ORDER_MODES[next.mode]) next.mode = "forever";
  if (next.mode === "until" && !productKey(st)) next.mode = "forever"; // a generator makes nothing to count
  next.n = Math.max(0, Math.min(99999, Math.floor(Number(next.n) || 0)));
  if (!inputKeys(st).includes(next.key)) next.key = mainInput(st);
  if (!validFallback(base, st, next.fallback)) next.fallback = "idle";
  if (patch.mode !== undefined || patch.n !== undefined || patch.key !== undefined) next.paused = false;
  base.orders[st.id] = next;
  return `${stationName(base, st)}: ${orderText(base, st)}.`;
}
// Back to the default (Forever, or whatever the steward sets).
export function clearStationOrder(state, base, stId) {
  if (base.orders) delete base.orders[stId === "rack" ? "rack" : Number(stId)];
  return "Order cleared: the station runs Forever (or as its steward decides).";
}
function validFallback(base, st, fb) {
  if (!fb || fb === "idle") return true;
  if (FALLBACK_ROLES.includes(fb)) return true;
  if (/^st:\d+$/.test(fb)) return stations(base).some((x) => x.id === Number(fb.slice(3)) && x.id !== st.id);
  return false;
}
export const stationName = (base, st) => (st.id === RACK.id ? "Drying racks" : BUILDINGS[st.type].name);

// Inputs and outputs of a station today: power (power.js) boosts the machine shop and the kitchen, and the still
// uses yesterday's spoiled food (base.mash, storage.js) before fresh food. op: the operator (skill bonuses), or null.
export function stationIO(state, base, st, op = null) {
  const recipe = recipeOf(st);
  const r = RECIPES[recipe];
  const inp = { ...r.in };
  const out = op ? recipeOutput(op, recipe, base, state) : { ...r.out };
  const powered = !!POWER_USERS[st.type] && isPowered(base, st);
  const boost = powered && POWER_BOOST[st.type];
  if (boost) {
    for (const k of Object.keys(inp)) inp[k] = Math.round(inp[k] * boost.in);
    for (const k of Object.keys(out)) out[k] = Math.round(out[k] * boost.out);
  }
  let mash = 0;
  if (recipe === "still") {
    mash = Math.floor(Math.max(0, Math.min(STILL.mash, inp.food, base.mash || 0)) * 10) / 10;
    inp.food = r1(inp.food - mash);
  }
  return { in: inp, out, powered, mash };
}

// Why an order holds a station now ("" = it may run). Pure: reads the hysteresis flag (o.paused) but never sets it.
export function orderHold(state, base, st) {
  if (!hasOrder(base, st)) return "";
  const o = stationOrder(base, st);
  if (o.mode === "off") return "Order: off";
  if (o.mode === "until") {
    const k = productKey(st);
    const have = Math.floor(supplyAmt(base.stock, k) + 1e-9);
    const resume = o.n - untilMargin(o.n);
    if (o.paused ? have >= resume : have >= o.n) return `Order met: ${have} of ${o.n} ${k} (starts again below ${Math.max(0, resume)})`;
    return "";
  }
  if (o.mode === "keep") {
    const k = o.key;
    const use = st.id === RACK.id ? 0 : (stationIO(state, base, st).in[k] || 0);
    const have = stockHas(base.stock, k);
    if (have - use < o.n) return `Keeps ${o.n} ${k} (${Math.floor(have)} here)`;
  }
  return "";
}
// The hysteresis flag of an until order follows the hold.
function tickOrder(state, base, st) {
  if (!hasOrder(base, st)) return;
  const o = base.orders[st.id];
  if (o.mode !== "until") { o.paused = false; return; }
  o.paused = !!orderHold(state, base, st);
}

// The drying racks: the most food they may take today under their order (Infinity = no limit).
export function rackLimit(state, base, fresh = base.stock.food || 0) {
  if (!hasOrder(base, RACK)) return Infinity;
  const o = stationOrder(base, RACK);
  if (o.mode === "off") return 0;
  if (o.mode === "until") return orderHold(state, base, RACK) ? 0 : Infinity;
  if (o.mode === "keep") return Math.max(0, fresh - o.n);
  return Infinity;
}

// One line for the UI.
export function orderText(base, st) {
  const o = stationOrder(base, st);
  if (o.mode === "until") return `until ${o.n} ${productKey(st)}`;
  if (o.mode === "keep") return `keep at least ${o.n} ${o.key}`;
  return o.mode === "off" ? "off" : "forever";
}

// ---------- hourly ----------
// Does an AI set the roles at this base (the dev autopilot, or a steward with the Roles area)?
const aiRoles = (state, base) => !!state.autopilot || !!(base.steward && base.steward.on && base.steward.areas && base.steward.areas.roles !== false);

export function productionHour(state) {
  for (const base of state.bases) {
    for (const st of stations(base)) tickOrder(state, base, st);
    tickOrder(state, base, RACK);
    refreshPower(state, base);
    if (!aiRoles(state, base)) fallbackHour(state, base);
    craftOrdersHour(state, base);
  }
}

const first = (s) => s.name.split(" ")[0];
const roleName = (k) => ({ farm: "farming", scavenge: "scavenging", build: "building", guard: "guard duty", craft: "crafting", rest: "rest", medic: "the medics" }[k] || k);

// Operators of a station whose order holds it go to the order's fallback; they come back when it wants work again.
function fallbackHour(state, base) {
  const list = stations(base);
  const people = atBase(state, base.id);
  for (const st of list) {
    const o = stationOrder(base, st);
    if (!o.fallback || o.fallback === "idle") continue;
    const hold = orderHold(state, base, st);
    if (!hold) continue;
    const op = people.find((s) => s.role === "operate" && s.station === st.id);
    if (!op || op.pinned || isManaged(state, op)) continue; // work priorities (work.js) move them by themselves
    if (st.type === "reload_bench" && reloadWork(state, base, op)) continue; // reloading.js: a reloading order to work
    let as, where;
    if (o.fallback.startsWith("st:")) {
      const other = list.find((x) => x.id === Number(o.fallback.slice(3)));
      if (!other || other.id === st.id || people.some((s) => s.role === "operate" && s.station === other.id) || orderHold(state, base, other)) continue; // nowhere to go: idles
      op.station = other.id;
      as = `st:${other.id}`;
      where = `the ${BUILDINGS[other.type].name.toLowerCase()}`;
    } else {
      op.role = o.fallback;
      op.station = null;
      as = o.fallback;
      where = roleName(o.fallback);
    }
    op.parked = { from: st.id, as, base: base.id };
    log(state, `${base.name}: ${BUILDINGS[st.type].name} — ${hold.replace(/ \(starts.*$/, "")}. ${first(op)} switches to ${where} until it is needed again.`, "info");
  }
  for (const s of people) {
    if (!s.parked) continue;
    const p = s.parked;
    const st = list.find((x) => x.id === p.from);
    const still = p.base === base.id && (p.as.startsWith("st:") ? s.role === "operate" && s.station === Number(p.as.slice(3)) : s.role === p.as);
    if (!st || !still) { s.parked = null; continue; } // the station is gone, or the player moved them
    if (orderHold(state, base, st) && !(st.type === "reload_bench" && reloadWork(state, base, s))) continue; // reloading.js: back for a reloading order too
    if (people.some((x) => x !== s && x.role === "operate" && x.station === st.id)) { s.parked = null; continue; } // someone else took it
    s.role = "operate";
    s.station = st.id;
    s.parked = null;
    log(state, `${base.name}: the ${BUILDINGS[st.type].name.toLowerCase()} has work again. ${first(s)} is back on it.`, "info");
  }
}

// ---------- craft orders ----------
export const craftOrders = (base) => base.craftOrders || (base.craftOrders = []);

export function addCraftOrder(state, base, recipe, n = 2, minQ = 0) {
  if (!CRAFTS[recipe]) return "Unknown recipe.";
  const list = craftOrders(base);
  if (list.some((o) => o.recipe === recipe)) return `There is already an order for ${craftName(recipe)}.`;
  list.push({ id: newId(), recipe, n: Math.max(1, Math.floor(n)), minQ: QUALITY_STEPS.includes(minQ) ? minQ : 0, on: true });
  return `Craft order: keep ${Math.max(1, Math.floor(n))} ${craftName(recipe)} at ${base.name}.`;
}
export function setCraftOrder(state, base, id, patch) {
  const o = craftOrders(base).find((x) => x.id === Number(id));
  if (!o) return "That order is gone.";
  if (patch.n !== undefined) o.n = Math.max(0, Math.min(99, Math.floor(Number(patch.n) || 0)));
  if (patch.minQ !== undefined) { const q = Number(patch.minQ); o.minQ = QUALITY_STEPS.includes(q) ? q : 0; }
  if (patch.on !== undefined) o.on = !!patch.on;
  return "";
}
export function removeCraftOrder(state, base, id) {
  const list = craftOrders(base);
  const i = list.findIndex((x) => x.id === Number(id));
  if (i < 0) return "That order is gone.";
  const o = list.splice(i, 1)[0];
  return `Craft order for ${craftName(o.recipe)} removed (jobs already queued stay in the queue).`;
}

// What counts toward an order: items of the recipe in the armory at minQ or better, or the stock of a supply.
export function craftOrderHave(base, o) {
  const r = CRAFTS[o.recipe];
  if (r.supplies) { const k = Object.keys(r.supplies)[0]; return Math.floor(supplyAmt(base.stock, k) + 1e-9); }
  return base.armory.filter((it) => it && it.key === r.gear && (it.quality ?? 1) + 1e-9 >= (o.minQ || 0)).length;
}
// The best expected quality anyone at the base (not in a hospital bed) would make it at.
export function bestQuality(state, base, recipe) {
  const r = CRAFTS[recipe];
  const able = atBase(state, base.id).filter((s) => !s.inBed && canAttempt(s, r));
  if (!able.length) return null;
  return benchQuality(craftQuality(Math.max(...able.map(craftSkill)), r, false, state), base); // expected condition, with the bench here (the roll spreads around it: crafting.js)
}
// { have, queued, need, ready, reason } for one order.
export function craftOrderStatus(state, base, o) {
  const r = CRAFTS[o.recipe];
  const have = craftOrderHave(base, o);
  const queued = craftQueue(base).filter((j) => j.orderId === o.id).length;
  const need = Math.max(0, o.n - have - queued);
  let reason = "";
  if (!o.on) reason = "Paused";
  else if (have >= o.n) reason = `Stocked: ${have} of ${o.n}`;
  else if (queued) reason = "a job is in the craft queue";
  else {
    const q = bestQuality(state, base, o.recipe);
    const chk = canCraft(state, base, o.recipe);
    if (r.gear && o.minQ && q != null && q + 1e-9 < o.minQ) reason = `Nobody here makes it at ${Math.round(o.minQ * 100)}% (best ${Math.round(q * 100)}%)`;
    else if (!chk.ok) reason = chk.reason;
  }
  return { have, queued, need, ready: o.on && need > 0 && !queued && !reason, reason };
}

function craftOrdersHour(state, base) {
  if (!base.craftOrders || !base.craftOrders.length) return;
  for (const o of base.craftOrders) {
    const cs = craftOrderStatus(state, base, o);
    if (!cs.ready) continue;
    const q = craftQueue(base);
    const before = q.length;
    queueCraft(state, base, o.recipe);
    if (q.length > before) {
      const job = q[q.length - 1];
      job.orderId = o.id;
      if (CRAFTS[o.recipe].gear && o.minQ) job.minQ = o.minQ;
    }
  }
}

