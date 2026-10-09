// The map's right-click menu with a team selected (ui/teamsel.js selectedTeam): that team's actions for the tile
// clicked, picked from what the tile and the player's knowledge offer (ui/ui.js siteMissions: the last report, the
// markers, the groups you know), with a time estimate (travel + the job) and, when something cannot be done now, the
// reason in its tooltip. Nothing here is a new sim path: every item is a list of ordinary team orders (sim/orders.js:
// a move to the tile, then the job there; missions run through parties.js orderOptions/giveOrder on arrival), or a
// window the team panel opens anyway (Drop off / Load, ui/teaminv.js).
//
// Plain right-click replaces the team's plan (asking first when that drops orders under way: ui/confirm.js);
// Shift+right-click, or the menu's toggle, adds to the end of its queue. A team busy on site (a raid, a city crawl,
// a boat on the water) can only queue.
//
// teamTileMenu(state, ui, p, tile, { append }) → { p, tile, append, forced, head, items }: the model (tools/teamctxtest.js)
// teamCtxHtml(state, ui, menu)                 → the menu's team section
// runTeamAction(state, ui, d)                  → does it (d: { id, tile, key, mode, ok }); returns the message, null when it asked first
import { baseById, hub } from "../sim/world.js";
import { MISSIONS, partyTile, partyMembers, tileLabel, orderOptions, planPath, orderMove, carried, cargoRoom } from "../sim/parties.js";
import { queueOrder, startOrder, queueEstimate, queueEndTile, orderStatus, orderLabel, queueText, cancelMove, besideWater, repairInfo, FETCH_WATER_HOURS, SURVEY_HOURS } from "../sim/orders.js";
import { commandable, NO_RADIO } from "../sim/plans.js";
import { partyVehicle } from "../sim/vehicles.js";
import { HUNT, SNARE, gameAbundance, fishSpot, huntProblem, fishProblem, snareLine, snareProblem } from "../sim/hunting.js";
import { forageAbundance, forageProblem } from "../sim/foraging.js";
import { woodAbundance, woodProblem, fireLandOk } from "../sim/woodcutting.js";
import { CLAIM, canClaim, wellProblem, claimOwner } from "../sim/claims.js";
import { LISTEN } from "../sim/radiolisten.js";
import { networksAt, teamReceives } from "../sim/radio.js";
import { crossingsFrom, boatPlan, boatOrder } from "../sim/crossing.js";
import { setFire, fireLit } from "../sim/fieldheat.js";
import { sweepOpts } from "../sim/survey.js";
import { crawlTile } from "../sim/citycrawl.js";
import { transferProblem, loadFromBase } from "../sim/teaminv.js";
import { siteMissions } from "./ui.js";
import { ask } from "./confirm.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const r1 = (h) => Math.round(h * 10) / 10;
export const hrsText = (h) => (h == null ? "?" : h >= 48 ? `${Math.floor(h / 24)}d ${Math.round(h % 24)}h` : `${Math.max(0, Math.round(h))}h`);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export const RESUPPLY_DAYS = 3; // Resupply at your base: food and water for this many days a head
export const SWEEP = { radius: 3, hours: 12 }; // the menu's Survey (as the hub's menu always offered)
const LAND_HOURS = HUNT.defHours; // hunt, fish, forage, cut wood: 8 hours (the team panel offers other lengths)
// Missions the hub's knowledge does not list but the team's own options do (on the tile, or by who holds it).
const OWN_OPTIONS = ["outpost", "establish", "strikecamp", "drivehome"];

// Where a fresh order would start from: replacing, where the team is; queueing, where its queue leaves it.
const startTile = (state, p, append) => (append ? queueEndTile(state, p) : partyTile(p));
// A copy of the team standing on `tile` with `orders` queued (for queueEstimate, which then needs no path).
const standingAt = (p, tile, orders) => ({ ...p, phase: "waiting", task: null, mission: "move", dest: tile, path: [tile], idx: 0, progress: Math.min(0, p.progress || 0), orders });
// Busy on site: a raid or a city crawl under way, or out on the water. New orders can only wait in the queue.
const busyOnSite = (p) => p.phase === "engaged" || !!(p.phase === "task" && p.task && p.task.afloat);

// Does a plain (replacing) order drop something under way? The queue (a plan's steps are queued orders, sim/plans.js),
// a job on the spot that is not a camp, or a mission it is travelling to.
export function dropsPlan(state, p) {
  if ((p.orders || []).length) return true;
  if (p.phase === "task" && p.task && p.task.type !== "camp" && p.task.type !== "wait") return true;
  return p.phase === "out" && p.mission !== "move";
}

// The travel to the tile: { hours, why } (why: no route; hours 0 when the team is or will be there).
function travelTo(state, p, tile, append) {
  const from = startTile(state, p, append);
  if (from === tile) return { hours: 0, why: "" };
  const res = planPath(state, from, tile, p.vehicle);
  if (!res) return { hours: null, why: p.vehicle ? "The vehicle cannot get there. Leave it or pick another tile." : "No route there over land. Water in the way? Build a boat from the shore." };
  const move = { type: "move", tile };
  const est = append ? queueEstimate(state, { ...p, orders: [...(p.orders || []), move] }) : queueEstimate(state, standingAt(p, from, [move]));
  return { hours: est.length ? est[est.length - 1].hours : null, why: "" };
}
// Hours of the job itself on the tile (null: it varies, a raid or a battle).
function taskHours(state, p, tile, seq) {
  if (!seq.length) return 0;
  const est = queueEstimate(state, standingAt(p, tile, seq.map((o) => ({ ...o }))));
  return est.every((x) => x.hours != null) ? est.reduce((a, x) => a + x.hours, 0) : null;
}
// Queueing: hours before the new orders start (what the current order has left, then the queue).
function queueAhead(state, p) {
  const st = orderStatus(state, p);
  const q = queueEstimate(state, p);
  return (st.left || 0) + q.reduce((a, x) => a + (x.hours || 0), 0);
}

// ---------- the model ----------
/**
 * @param {State} state @param {any} ui @param {Party} p @param {number} tile
 * @param {{ append?: boolean }} [opts]
 */
export function teamTileMenu(state, ui, p, tile, { append = false } = {}) {
  const t = state.tiles[tile];
  const forced = busyOnSite(p);
  if (forced) append = true;
  const cmd = commandable(state, p);
  const from = startTile(state, p, append);
  const here = from === tile;
  const water = t.terrain === "water" && !t.bridge;
  const base = state.bases.find((b) => b.tile === tile) || null;
  const v = partyVehicle(state, p);
  const travel = water ? { hours: null, why: "" } : travelTo(state, p, tile, append);
  const ahead = append && !(p.phase === "waiting" && !(p.orders || []).length) ? queueAhead(state, p) : 0;
  /** @type {any[]} */
  const items = [];
  // An item: seq, the orders on the tile; move: go there first (the travel above); special: done at once in the UI.
  const add = (group, key, label, seq, { why = "", hint = "", move = true, special = null, task, open = false } = {}) => {
    const needMove = move && !here && !special;
    const disabled = (!cmd ? NO_RADIO : "") || (needMove ? travel.why : "") || why || null;
    const job = task !== undefined ? task : special ? 0 : taskHours(state, p, move ? tile : from, seq); // go home: from where the team is
    items.push({ group, key, label, seq, move: needMove, special, hint, disabled, travel: needMove ? travel.hours : 0, task: job, open, ahead });
  };

  // Go
  if (!water) {
    add("Go", "move", base ? `Move here (${base.name})` : "Move here", [], { why: here ? (append ? "The team will already be there." : "The team is already here.") : "", hint: base ? `Travel to ${base.name}. Arriving at a base of yours, the team is asked whether to enter it.` : "Travel there and wait for orders." });
    add("Go", "survey", here ? `Look around (${SURVEY_HOURS}h)` : `Move and look around (${SURVEY_HOURS}h)`, [{ type: "mission", mission: "survey" }], { hint: MISSIONS.survey.desc });
    add("Go", "sweep", `Survey ${SWEEP.radius} tiles around (${SWEEP.hours}h)`, [{ type: "sweep", ...sweepOpts(SWEEP) }], { hint: MISSIONS.sweep.desc });
  }
  // A boat across the water from where the team stands (the land across, or the water tile itself).
  if (p.kind !== "convoy") {
    for (const c of crossingsFrom(state, from)) {
      if (c.tile !== tile && c.water !== tile) continue;
      for (const m of v ? ["raft", "leave"] : ["raft"]) {
        const plan = boatPlan(state, p, from, c.tile, m);
        const o = boatOrder(state, p, from, c.tile, m);
        const short = !plan.ok && append && Object.keys(plan.missing).length && plan.crossing; // queued: gather or bring the scrap first
        add("Go", `cross:${m}:${c.tile}`, `Boat across to ${tileLabel(state, c.tile)}${v ? (m === "raft" ? ", raft the vehicle" : ", leave the vehicle") : ""} (${plan.mats.scrap} scrap)`, o.error ? [] : [o],
          { move: false, why: o.error || (plan.ok || short ? "" : plan.reason), task: plan.hours, hint: `Build a one-use boat on this shore and cross: ${plan.build}h building, ${plan.cross}h on the water, ${Math.round(plan.risk * 100)}% risk of a mishap.${plan.ok ? "" : ` ${plan.reason}`}` });
      }
    }
  }

  // Your own base
  if (base) {
    const enter = orderOptions(state, p, tile).find((o) => o.mission === "enter");
    if (enter) add("Base", "mission:enter", enter.label, [{ type: "mission", mission: "enter" }], { why: enter.disabled || "", hint: enter.desc, task: 0 });
    const at = partyTile(p) === tile;
    const notHere = at ? "" : `Only while the team stands on ${base.name}: move it here first.`;
    const why = notHere || transferProblem(state, p, base);
    add("Base", "drop", `Drop off at ${base.name}…`, [], { special: "drop", why, hint: `Pick what goes from the team (its people's kit, the cargo, the supplies) into ${base.name}'s armory and stores.` });
    add("Base", "load", `Load from ${base.name}…`, [], { special: "load", why, hint: `Pick what the team takes from ${base.name}'s armory and stores.` });
    const want = resupplyWants(state, p, base);
    add("Base", "resupply", `Resupply: ${RESUPPLY_DAYS} days of food and water`, [], { special: "resupply", why: why || want.why, hint: `Top the team's packed food and water up to ${RESUPPLY_DAYS} days for ${partyMembers(state, p).length} from ${base.name}'s stores${want.text ? `: ${want.text}` : ""}. As much as the team can carry.` });
  }

  // What the site offers, as far as you know (not on your own base: that is the Base group above).
  let theirs = false; // another group's base you know of: no camping, foraging or claiming on their doorstep
  if (!water && !base) {
    const opts = orderOptions(state, p, tile);
    const optOf = (m) => opts.find((o) => o.mission === m) || null;
    const listed = new Set();
    const live = state.live.has(tile) || partyTile(p) === tile;
    for (const [m, label0] of siteMissions(state, tile)) {
      if (m === "outpost" || listed.has(m)) continue;
      const own = optOf(m);
      let label = label0;
      if (m === "scavenge") label = crawlTile(t) ? "City crawl: go in block by block" : t.loc ? "Scavenge / raid the site" : label0;
      if (m === "trade") { label = "Trade visit / talk"; theirs = true; }
      if (live && own && m === "getvehicle") label = own.label; // a found car to repair, or cargo to take
      listed.add(m);
      add("Site", `mission:${m}`, label, [{ type: "mission", mission: m }], { why: own && own.disabled ? own.disabled : "", hint: m === "scavenge" && crawlTile(t) ? "Go into the city block by block: each block a street of buildings to raid; noise raises the Alert, lying low lets it fade." : MISSIONS[m]?.desc });
    }
    for (const o of opts) {
      if (listed.has(o.mission)) continue;
      if (!OWN_OPTIONS.includes(o.mission) && !(live && !["survey", "sweep", "caravan", "enter"].includes(o.mission))) continue;
      listed.add(o.mission);
      add("Site", `mission:${o.mission}`, o.label, [{ type: "mission", mission: o.mission }], { why: o.disabled || "", hint: o.desc });
    }
  }

  // Food, firewood and water from the land
  if (!water && !theirs) {
    const job = (type, extra = {}) => [{ type, hours: LAND_HOURS, ...extra }];
    if (forageAbundance(state, tile) >= 0.05) add("Land", "forage", `Forage ${LAND_HOURS}h`, job("forage"), { why: cap(forageProblem(state, p, tile)), hint: "Wild food: berries, nuts, mushrooms, greens, roots. Quiet; best in forest, summer and autumn." });
    if (gameAbundance(state, tile) >= 0.08) add("Land", "hunt", `Hunt ${LAND_HOURS}h`, job("hunt"), { why: cap(huntProblem(state, p, tile)), hint: "A rifle or a bow is best; shots add Heat and can draw the dead. Fresh game is heavy and spoils fast." });
    const line = snareLine(state, tile);
    if (line) {
      add("Land", "snare:check", `Check snares (${SNARE.checkHours}h)`, [{ type: "snare", mode: "check" }], { why: cap(snareProblem(state, p, tile, "check")), hint: "Collect the catch and leave the line set." });
      add("Land", "snare:lift", `Lift snares (${SNARE.checkHours}h)`, [{ type: "snare", mode: "lift" }], { why: cap(snareProblem(state, p, tile, "lift")), hint: "Collect the catch and take the line up." });
    } else if (gameAbundance(state, tile) >= 0.08) add("Land", "snare:set", `Set snares (${SNARE.setHours}h)`, [{ type: "snare", mode: "set" }], { why: cap(snareProblem(state, p, tile, "set")), hint: `Lay a line of ${SNARE.count} snares (snare wire or ${SNARE.scrap} scrap); come back within 2–3 days to collect.` });
    const fs = fishSpot(state, tile);
    if (fs) add("Land", "fish", `Fish ${LAND_HOURS}h`, job("fish"), { why: cap(fishProblem(state, p, tile)), hint: `Fish in ${fs.name}. Quiet. Needs a rod, a net or a spear.` });
    if (woodAbundance(state, tile) >= 0.1) add("Land", "wood", `Cut firewood ${LAND_HOURS}h`, job("wood"), { why: cap(woodProblem(state, p, tile)), hint: "Firewood for the winter (daylight only). Loud: Heat; an axe makes it far quicker." });
    if (besideWater(state, tile)) {
      const room = Math.floor(cargoRoom(state, p));
      add("Land", "water", `Fetch water (${FETCH_WATER_HOURS}h)`, [{ type: "water" }], { why: room < 1 ? "No room left to carry any water." : "", hint: `Fill every free container from the river or lake (room for about ${room}): un-purified water to boil, filter or bring home.` });
    }
  }

  // Camp
  if (!water && !base && !theirs) {
    const camping = p.phase === "task" && p.task && p.task.type === "camp" && partyTile(p) === tile;
    const lit = fireLit(p);
    const burn = fireLandOk(state, tile) || carried(p, "wood") >= 1;
    const noFire = burn ? "" : "Nothing to burn on this bare ground and no firewood carried.";
    for (const h of [8, 24, null]) add("Camp", `camp:${h ?? 0}`, h ? `Camp here ${h}h` : "Camp here until told", [{ type: "camp", hours: h }], { open: !h, hint: `Stop and rest${h ? ` for ${h} hours` : " until you break camp"}: the hurt heal a little, nobody travels. ${lit ? "The camp fire is lit (it warms, boils water and cooks, but its light carries)." : "No camp fire (the team's fire is set out)."}` });
    if (camping) add("Camp", lit ? "fireout" : "fire", lit ? "Put the camp fire out" : "Light a camp fire", [], { special: lit ? "fireout" : "fire", why: lit ? "" : noFire, hint: lit ? "Darker and quieter, but cold food, unboiled water and cold nights." : "Warmth, hot food and boiled water, better spirits; its light and smoke carry, most at night." });
    else add("Camp", "campfire", "Make camp with a fire (8h)", [{ type: "camp", hours: 8, fire: true }], { why: noFire, hint: "Camp 8 hours with the fire lit: warmth, hot food and boiled water (the worm's eggs die), better spirits; its light and smoke carry, most at night." });
  }

  // The team's own gear and land you hold
  if (!water) {
    const vrep = v && !v.destroyed && v.condition < 100 && here;
    if (vrep) { const r = repairInfo(state, p); add("Team", "repair", `Field repair: ${v.name} (${r.hours}h)`, [{ type: "repair" }], { why: r.ok ? "" : r.reason, hint: `${r.hours} hours, 1 part: about +${r.gain}% condition (best Mechanics ${r.mech}).` }); }
    if (teamReceives(state, p)) {
      const nets = networksAt(state, tile);
      if (nets.length) for (const n of nets) add("Team", `listen:${n.id}`, `Listen in: ${n.name} (${LISTEN.HOURS}h)`, [{ type: "listen", net: n.id }], { hint: n.kind === "player" ? "Your own network: your teams' reports and the news." : `Tune the team's receiver to ${n.name}'s channel and catch up on its last few days.` });
      else add("Team", "listen", `Listen in (${LISTEN.HOURS}h)`, [], { why: "Static: no radio network reaches this spot.", task: LISTEN.HOURS });
    }
    if (state.bases.length && !base) {
      const cw = canClaim(state, tile);
      const mine = claimOwner(state, tile) === "player";
      const hopeless = /base there|hive stands|base already|held by/.test(cw);
      if (!mine && !hopeless) add("Team", "claim", `Claim this tile (${CLAIM.HOURS}h, ${CLAIM.SCRAP} scrap)`, [{ type: "claim" }], { why: cw || (carried(p, "scrap") < CLAIM.SCRAP ? `Needs ${CLAIM.SCRAP} scrap carried for the marker post (have ${Math.floor(carried(p, "scrap"))}).` : ""), hint: "Raise a marker post: the tile counts as land the coalition holds, toward the 50% the alliance victory needs." });
      if (mine) add("Team", "well", `Dig a well (${CLAIM.WELL_HOURS}h)`, [{ type: "well" }], { why: wellProblem(state, p, tile), hint: `Dig a well on this claim (${CLAIM.WELL_SCRAP} scrap, ${CLAIM.WELL_PARTS} part carried): the people at your base next to it haul its water.` });
    }
  }
  const home = baseById(state, p.homeBaseId) || hub(state);
  if (home) add("Team", "home", `Go home (${home.name})`, [{ type: "home" }], { move: false, why: partyTile(p) === home.tile && p.phase !== "out" && !append ? "The team is at home." : "", hint: `Head back to ${home.name} with everything carried.` });

  const travelText = water ? "" : here ? (append ? "where its queue ends" : "here") : travel.hours == null ? "no route" : `~${hrsText(travel.hours)} away`;
  const head = {
    name: `Team: ${partyMembers(state, p).map((s) => s.name.split(" ")[0]).join(", ")}`,
    situation: [v ? v.name : "on foot", cmd ? orderLabel(state, p) : "out of radio contact", travelText].filter(Boolean).join(" · "),
    tile: tileLabel(state, tile),
    water,
  };
  return { p, tile, append, forced, cmd, head, items };
}

// Resupply: what the team lacks of RESUPPLY_DAYS days of food and water, and what the base has of it.
function resupplyWants(state, p, base) {
  const n = partyMembers(state, p).length;
  const need = (k) => Math.max(0, Math.ceil(n * RESUPPLY_DAYS - carried(p, k)));
  const food = Math.min(need("food"), Math.floor(base.stock.food || 0)), water = Math.min(need("water"), Math.floor(base.stock.water || 0));
  if (!need("food") && !need("water")) return { food, water, why: `The team already carries ${RESUPPLY_DAYS} days of food and water.`, text: "" };
  if (!food && !water) return { food, water, why: `${base.name} has no food or water to spare.`, text: "" };
  return { food, water, why: "", text: [food ? `${food} food` : "", water ? `${water} water` : ""].filter(Boolean).join(", ") };
}

// ---------- the menu ----------
// The hours of an item: travel + the job ("on site" when the job has no fixed time), after the queue when queueing.
export function itemHours(it) {
  const job = it.open ? "until told" : it.task == null ? "on site" : it.task ? hrsText(it.task) : "";
  const parts = [it.move && it.travel != null ? `${hrsText(it.travel)} travel` : "", job].filter(Boolean);
  if (!parts.length) return "";
  return `${it.ahead ? `after ${hrsText(it.ahead)}: ` : ""}${parts.join(" + ")}`;
}
const GROUP_TIP = {
  Go: "Travel, look, survey, cross water",
  Base: "Your base: move in, drop off, load, resupply",
  Site: "What you know is here: from the live view, the last report, markers and the groups you know",
  Land: "Food, firewood and water from the land",
  Camp: "Rest on the spot",
  Team: "The team's own gear and the land you hold",
};
/** @param {State} state @param {any} ui @param {ReturnType<typeof teamTileMenu>} m */
export function teamCtxHtml(state, ui, m) {
  const mode = m.append ? "append" : "replace";
  const toggle = !m.cmd
    ? `<div class="tcmode small warn"${tip(NO_RADIO)}>No radio contact: no new orders now</div>`
    : m.forced
    ? `<div class="tcmode small muted"${tip("Busy on site (a raid, a city crawl, a boat on the water): new orders wait in its queue.")}>Busy on site: adds to the queue</div>`
    : `<button class="tcmode mini${m.append ? " active" : ""}" data-action="tc-mode"${tip("Replace: the team drops its plan and does this (it asks first when that drops orders under way). Add to queue: after what it is doing and its queue. Shift+right-click opens the menu in queue mode.")}>${m.append ? "Adding to the queue ⇄" : "Replacing its plan ⇄"}</button>`;
  let group = "";
  const rows = m.items.map((it) => {
    const g = it.group !== group ? `<div class="tcgroup small muted"${tip(GROUP_TIP[it.group] || "")}>${esc(it.group)}</div>` : "";
    group = it.group;
    const h = itemHours(it);
    const why = it.disabled ? `${it.label}: ${it.disabled}` : [it.hint, it.move ? `First the team travels to ${m.head.tile}${it.travel != null ? ` (~${hrsText(it.travel)})` : ""}.` : ""].filter(Boolean).join(" ");
    return `${g}<button class="tcitem" data-action="tc-do" data-id="${m.p.id}" data-tile="${m.tile}" data-key="${esc(it.key)}" data-mode="${mode}" ${it.disabled ? "disabled" : ""}${tip(why)}><span>${esc(it.label)}</span>${h ? `<span class="tch">${esc(h)}</span>` : ""}</button>`;
  }).join("");
  const none = m.head.water && !m.items.some((it) => it.group === "Go") ? `<div class="small muted" style="padding:0.3rem 0.5rem">Open water: teams cross it by boat from a shore next to it</div>` : "";
  return `<div class="tchead"><div class="head">${esc(m.head.name)}</div><div class="small muted">${esc(m.head.situation)}</div><div class="small">→ ${esc(m.head.tile)}</div>${toggle}</div>${rows}${none}`;
}

// ---------- doing it ----------
/** @param {State} state @param {Party} p */
function dropOrdersCards(state, p) {
  for (let i = state.cards.length - 1; i >= 0; i--) if (state.cards[i].isOrders && state.cards[i].partyId === p.id) state.cards.splice(i, 1);
}
// Queue: a move to the tile (unless the queue ends there), then the job. Each order starts at once if the team waits.
function appendOrders(state, p, tile, it) {
  const msgs = [];
  if (it.move && queueEndTile(state, p) !== tile) {
    msgs.push(queueOrder(state, p, { type: "move", tile }));
    if (p.phase === "waiting" && partyTile(p) !== tile) return msgs.join(" "); // the move could not start
  }
  for (const o of it.seq) msgs.push(queueOrder(state, p, { ...o }));
  return msgs.filter(Boolean).join(" ");
}
// Replace: the queue is dropped; the team goes there (or stops here) and does it.
function replaceOrders(state, p, tile, it) {
  p.orders = [];
  const here = partyTile(p) === tile;
  if (!it.move || here) {
    // Passing through the tile: stop here first (not to go home, which turns the team round anyway).
    if (here && it.seq.length && it.seq[0].type !== "home" && (p.phase === "out" || p.phase === "back")) cancelMove(state, p);
    if (!it.seq.length) return here ? "The team is already here." : "";
    const [first, ...rest] = it.seq;
    const msgs = [startOrder(state, p, { ...first })];
    for (const o of rest) msgs.push(queueOrder(state, p, { ...o }));
    return msgs.filter(Boolean).join(" ");
  }
  const msg = orderMove(state, p, tile);
  if (!(p.phase === "out" && p.dest === tile)) return msg;
  dropOrdersCards(state, p);
  const msgs = [msg];
  for (const o of it.seq) msgs.push(queueOrder(state, p, { ...o }));
  return msgs.filter(Boolean).join(" ");
}

/**
 * Carry out a menu item. d: { id, tile, key, mode: "append" | "replace", ok }. Returns the message ("" for a window
 * opened), or null when the confirmation box went up (its Yes calls this again with d.ok = "1").
 * @param {State} state @param {any} ui @param {any} d @param {Record<string, Function>} [acts] the action table (Drop off / Load open the team inventory)
 */
export function runTeamAction(state, ui, d, acts = {}) {
  const p = state.parties.find((q) => q.id === Number(d.id));
  if (!p) return "That team is gone.";
  const tile = Number(d.tile);
  const m = teamTileMenu(state, ui, p, tile, { append: d.mode === "append" });
  const it = m.items.find((x) => x.key === d.key);
  if (!it) return "That is not possible there any more.";
  if (it.disabled) return `${it.label}: ${it.disabled}`;
  if (it.special === "drop" || it.special === "load") {
    if (acts["ti-open"]) acts["ti-open"]({ id: p.id, tab: it.special });
    return "";
  }
  if (it.special === "resupply") {
    const base = state.bases.find((b) => b.tile === tile);
    const want = base ? resupplyWants(state, p, base) : null;
    if (!base || !want || want.why) return want ? want.why : "No base here.";
    return loadFromBase(state, p, { supplies: { food: want.food, water: want.water } }, "cargo").text;
  }
  if (it.special === "fire" || it.special === "fireout") return setFire(state, p, it.special === "fire");
  if (m.append) return appendOrders(state, p, tile, it);
  if (dropsPlan(state, p) && ask(ui, d, "tc-do", {
    kind: "replaceorders",
    title: `Replace the orders of ${partyMembers(state, p).map((s) => s.name.split(" ")[0]).join(", ")}?`,
    text: `${it.label} instead of: ${[orderLabel(state, p), queueText(state, p)].filter(Boolean).join(" → ")}. Those are dropped. Shift+right-click (or the menu's toggle) adds to the end of the queue instead.`,
    yes: "Replace",
  })) return null;
  return replaceOrders(state, p, tile, it);
}

// For the tools: the item list in short ({ key, label, disabled, hours }).
export const menuSummary = (m) => m.items.map((it) => ({ key: it.key, label: it.label, disabled: it.disabled, hours: itemHours(it), r1: r1(it.travel || 0) }));
