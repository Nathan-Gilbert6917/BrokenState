// Expedition panel (right sidebar) and the "Running orders" list on the map.
// The panel shows a team's people, gear, supplies, vehicle and order queue, with actions on the spot
// (camp, scavenge, look around, repair, treat, move, go home). Timed actions go through the order queue
// (sim/orders.js); buttons use data-action handlers in main.js.
import { SUPPLIES, SUPPLY_KEYS, SKILL_NAMES, TRAITS } from "../sim/data.js";
import { skill, gearEffect, baseById, hub } from "../sim/world.js";
import { MISSIONS, STANCES, partyMembers, partyCapacity, cargoLoad, tileLabel, partyTile, orderOptions } from "../sim/parties.js";
import { partyVehicle, tank } from "../sim/vehicles.js";
import { orderStatus, queueEstimate, queueEndTile, contactable, repairInfo, campHealPerHour, describeOrder, CAMP_HOURS, REPAIR_HOURS, SURVEY_HOURS } from "../sim/orders.js";
import { crossingsFrom, boatPlan, boatTip, gatherInfo, matsText } from "../sim/crossing.js";
import { fieldCraftOptions, craftQueue, craftName } from "../sim/crafting.js";
import { BUILDINGS } from "../sim/buildings.js";
import { shortName } from "./names.js";
import { fieldTreatInfo, partyMeds } from "../sim/medical.js";
import { EQUIP_SLOTS, SLOT_NAMES, ensureInv } from "../sim/inventory.js";
import { weather as wxNow, travelEffects } from "../sim/weather.js";
import { commandable, planStatus, conditionText, NO_RADIO } from "../sim/plans.js";
import { heatInfo } from "../sim/fieldheat.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n0 = (v) => Math.floor((v || 0) + 1e-9);
const bar = (v, color) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></i></div>`;
const first = (s) => esc(shortName(s)); // first name, with a last initial when two people share it
const hrs = (h) => (h == null ? "open-ended" : h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h`);

// ---------- orders given while paused ----------
// The game starts paused and giving an order never unpauses it: the order is armed and starts when the clock
// runs again. main.js notes in ui.armed which teams and jobs were touched during the pause.
const pausedNow = (state, ui) => !!ui && !!ui.started && ui.speed === 0 && !state.gameOver;
// True when the team's current order was given during this pause and has not begun yet.
export function startsWhenUnpaused(state, ui, p) {
  return pausedNow(state, ui) && !!ui.armed && ui.armed.parties.has(p.id) && (p.orderStart ?? p.departed) === state.hour &&
    (p.phase === "out" || p.phase === "back" || (p.phase === "task" && !!p.task && !p.task.done));
}
// Everything waiting for the unpause, as plain-text lines (the banner counts them and lists them in its tip).
export function armedList(state, ui) {
  const out = [];
  if (!pausedNow(state, ui) || !ui.armed) return out;
  for (const [id, queuedBefore] of ui.armed.parties) {
    const p = state.parties.find((x) => x.id === id);
    if (!p) continue;
    const who = partyMembers(state, p).map(shortName).join(", ") || "Team";
    if (startsWhenUnpaused(state, ui, p)) out.push(`${who}: ${orderStatus(state, p).label}`);
    for (const o of (p.orders || []).slice(queuedBefore)) out.push(`${who}: ${describeOrder(state, o)} (queued)`);
  }
  for (const b of state.bases) {
    for (const j of b.construction) if (ui.armed.builds.has(j.id) && !j.progress) out.push(`${b.name}: build ${BUILDINGS[j.type] ? BUILDINGS[j.type].name : j.type}`);
    for (const j of craftQueue(b)) if (ui.armed.crafts.has(j.id) && !j.progress) out.push(`${b.name}: craft ${craftName(j.recipe)}`);
  }
  return out;
}

// One line per team: what it is doing, time left, and how much is queued.
function statusLine(state, ui, p) {
  const st = orderStatus(state, p);
  const live = contactable(p);
  // Out of radio contact a team runs its plan by itself (sim/plans.js).
  const onPlan = p.plan && p.plan.active && !p.radioLive && p.phase !== "waiting" ? " · following its plan (no radio)" : "";
  if (startsWhenUnpaused(state, ui, p)) return { text: `${esc(st.label)} · starts when unpaused`, pct: null, cls: "armed" };
  if (!live) {
    // A one-way move (no way back planned) arrives and waits; other trips come home.
    if (p.etaBack == null && p.etaOut != null) {
      const at = (p.planStart ?? p.departed) + p.etaOut;
      return { text: `${esc(st.label)} · no contact (${at > state.hour ? "arrives" : "should have arrived"} around day ${Math.floor(at / 24) + 1}, ${at % 24}:00)${onPlan}`, pct: null, cls: "muted" };
    }
    const back = Math.floor((p.departed + p.plannedHours) / 24) + 1;
    return { text: `${esc(st.label)} · no contact (back around day ${back})${onPlan}`, pct: null, cls: "muted" };
  }
  const left = st.left == null ? (p.phase === "task" ? "until you stop it" : "") : st.left > 0 ? `${hrs(st.left)} left` : "";
  return { text: `${esc(st.label)}${left ? ` · ${left}` : ""}${onPlan}`, pct: st.pct, cls: p.phase === "waiting" ? "warn" : "" };
}

// ---------- running orders (map overlay) ----------
export function renderRunningOrders(state, ui) {
  const mine = state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy");
  if (!mine.length) return "";
  if (ui.ordersCollapsed) return `<button class="mini" data-action="xp-orderstoggle"${tip("Show the running orders of your teams")}>Orders (${mine.length}) ▸</button>`;
  return `<div class="spread"><b>Running orders</b><button class="mini" data-action="xp-orderstoggle"${tip("Hide this list")}>▾</button></div>
    ${mine.map((p) => {
      const s = statusLine(state, ui, p);
      const q = (p.orders || []).length;
      return `<div class="ro ${ui.expedition === p.id ? "on" : ""}" data-action="xp-open" data-id="${p.id}"${tip("Open the team panel")}>
        <div class="spread"><span>${partyMembers(state, p).map(first).join(", ")}</span>${q ? `<span class="muted">+${q} queued</span>` : ""}</div>
        <div class="small ${s.cls}">${s.text}</div>
        ${s.pct != null && p.phase !== "waiting" ? bar(s.pct * 100, "var(--accent)") : ""}
      </div>`;
    }).join("")}`;
}

// ---------- expedition panel ----------
export function renderExpedition(state, ui, p) {
  const members = partyMembers(state, p);
  const v = partyVehicle(state, p);
  // Radio rule (sim/plans.js): orders only in radio contact, or while answering one of the team's cards (which
  // also tells you where it is and how it is doing).
  const cmd = commandable(state, p);
  const live = contactable(p) || cmd;
  const s = statusLine(state, ui, p);
  const tile = partyTile(p);
  const home = baseById(state, p.homeBaseId) || hub(state);
  const moving = p.phase === "out" || p.phase === "back";
  // Waiting or working on the spot: actions run now (switching jobs) unless queue mode is on. Moving: queued.
  const queueing = moving || p.phase === "engaged" || !!ui.xpQueue;
  const btn = (attrs, label, hint, disabled) => `<button class="mini" ${attrs} ${disabled ? "disabled" : ""}${tip(hint)}>${label}</button>`;
  const ord = (type, extra, label, hint, disabled) => btn(`data-action="xp-order" data-id="${p.id}" data-type="${type}"${extra}`, label, hint, disabled);

  const head = `<div class="spread"><h2 style="margin:0">Team: ${members.map(first).join(", ")}</h2><button class="mini" data-action="xp-close"${tip("Back to the tile view (Esc)")}>✕</button></div>
    <div class="small muted">${esc(MISSIONS[p.mission]?.name || "Team")} · ${v ? esc(v.name) : "on foot"} · ${STANCES[p.stance]?.name || ""} · home ${esc(home.name)}</div>`;

  const status = `<div class="card small" style="margin-top:0.5rem">
      <div class="spread"><b>Now</b>${live ? `<button class="mini" data-action="center" data-tile="${tile}"${tip("Center the map on this team")}>Locate</button>` : ""}</div>
      <div class="${s.cls}">${s.text}</div>
      ${s.pct != null && p.phase !== "waiting" ? bar(s.pct * 100, "var(--accent)") : ""}
      ${live ? `<div class="muted">At ${esc(tileLabel(state, tile))}${p.phase === "out" || p.phase === "back" ? ` → ${esc(tileLabel(state, p.path[p.path.length - 1]))}` : ""}</div>` : ""}
      ${live ? weatherLine(state, p, v) : ""}
      ${queueBlock(state, p, cmd)}
      ${planBlock(state, p)}
      ${live ? heatBlock(state, p) : ""}
    </div>`;

  if (!cmd) {
    return head + status + `<div class="card small muted"${tip(NO_RADIO)}>No radio contact. The team follows its ${p.plan && p.plan.active ? "plan" : "orders"} and reports when it checks in (a card), gets home, or comes into radio range (a station or a linked relay). New orders only then.${ui.xpMsg ? `<div class="result small">${esc(ui.xpMsg)}</div>` : ""}</div>` +
      `<h3>People</h3>${members.map((m) => memberCard(state, p, m, false)).join("")}`;
  }

  // Actions on the spot.
  const opts = orderOptions(state, p).filter((o) => o.mission !== "survey");
  const loot = state.tiles[tile].loot > 0.05;
  const rep = repairInfo(state, p);
  const camping = p.phase === "task" && p.task && p.task.type === "camp";
  const working = p.phase === "task" && p.task && !camping;
  const actions = `<div class="card small">
      <div class="spread"><b>Orders</b>${moving ? `<span class="muted">queued after the current one</span>` :
        `<button class="mini ${ui.xpQueue ? "active" : ""}" data-action="xp-queuemode"${tip("On: actions go to the end of the queue. Off: they start now (stopping work on the spot).")}>${ui.xpQueue ? "Queue mode: on" : "Queue mode: off"}</button>`}</div>
      ${p.phase === "engaged" ? `<div class="muted">Busy on site. New orders wait in the queue.</div>` : ""}
      <div class="row" style="margin-top:0.35rem;flex-wrap:wrap">
        ${btn(`data-action="xp-move" data-id="${p.id}"`, queueing ? "Queue move…" : "Move…", queueing ? "Click a tile on the map. The move is added to the end of the team's queue." : "Click a tile on the map. The team sets off for it (when the clock runs).")}
        ${moving && p.radioLive ? btn(`data-action="movemode" data-id="${p.id}"`, "Redirect…", "Change the current destination now (radio contact).") : ""}
        ${ord("home", "", queueing ? "Queue: return home" : "Return home", queueing ? `Added to the end of the queue: after the orders before it the team heads back to ${home.name} with everything carried.` : `Head back to ${home.name} now with everything carried. This drops the rest of the queue.`)}
        ${camping ? btn(`data-action="xp-stop" data-id="${p.id}"`, "Break camp", "Pack up now. The next queued order starts.") : ""}
        ${working ? btn(`data-action="xp-stop" data-id="${p.id}"`, "Stop work", "Give up on the current job (nothing is used up).") : ""}
      </div>
      <div class="xpgrid">
        ${ord("mission", ` data-mission="scavenge"`, "Scavenge here", loot || queueing ? MISSIONS.scavenge.desc : "Nothing left worth searching on this tile.", !loot && !queueing)}
        ${ord("mission", ` data-mission="survey"`, `Look around (${SURVEY_HOURS}h)`, MISSIONS.survey.desc)}
        ${CAMP_HOURS.map((h) => ord("camp", ` data-hours="${h ?? ""}"`, h ? `Camp ${h}h` : "Camp (until broken)", `Stop and rest${h ? ` for ${h} hours` : " until you break camp"}. The hurt heal a little each hour (infected wounds need meds); nobody travels, so no road events. Supplies keep draining.`)).join("")}
        ${ord("repair", "", `Repair vehicle (${REPAIR_HOURS}h)`, rep.ok ? `${REPAIR_HOURS} hours, 1 part: about +${rep.gain}% condition (best Mechanics ${rep.mech}).` : rep.reason, !rep.ok && !queueing)}
        ${opts.filter((o) => o.mission !== "scavenge").map((o) => ord("mission", ` data-mission="${o.mission}"`, esc(o.label), o.disabled || o.desc, !!o.disabled && !queueing)).join("")}
      </div>
      ${craftBlock(state, p, queueing)}
      ${boatBlock(state, p, queueing ? queueEndTile(state, p) : tile, queueing)}
      ${ui.xpMsg ? `<div class="result small" style="margin-top:0.4rem">${esc(ui.xpMsg)}</div>` : ""}
    </div>`;

  return head + status + actions +
    `<h3>People (${members.length})</h3>${members.map((m) => memberCard(state, p, m, true, queueing)).join("")}` +
    suppliesBlock(state, p) + vehicleBlock(state, p, v);
}

// Today's weather and what it does to this team's pace (sim/weather.js); the ETAs above already include it.
function weatherLine(state, p, v) {
  const w = wxNow(state), fx = travelEffects(state);
  const [road, off] = v ? [fx.vehRoad, fx.vehOff] : [fx.footRoad, fx.footOff];
  const pct = (f) => `${f >= 1 ? "+" : "−"}${Math.abs(Math.round((f - 1) * 100))}%`;
  const pace = road > 1.005 || off > 1.005 ? `${v ? "driving" : "on foot"}: roads ${pct(road)}, off-road ${pct(off)}` : "normal pace";
  const extra = [fx.sight ? "sight −1 tile" : "", fx.injury ? "injury risk" : ""].filter(Boolean).join(", ");
  return `<div class="${w.severe ? "warn" : "muted"}"${tip(fx.lines.join(" · "))}>${w.icon} ${esc(w.name)} ${Math.round(w.temp)}°C · ${pace}${extra ? ` · ${extra}` : ""}</div>`;
}

// Field crafting (sim/crafting.js): a timed order per recipe, made from what the team carries.
function craftBlock(state, p, queueing) {
  const opts = fieldCraftOptions(state, p);
  if (!opts.length) return "";
  const inText = (o) => Object.entries(o.in).map(([k, q]) => `${q} ${k}`).join(" + ");
  return `<div style="margin-top:0.5rem"><b${tip("Make simple things on the road from the supplies the team carries. Takes time on the spot; the team does not travel meanwhile.")}>Craft</b></div>
    <div class="row" style="margin-top:0.3rem;flex-wrap:wrap">${opts.map((o) =>
      btn(`data-action="xp-order" data-id="${p.id}" data-type="craft" data-recipe="${o.key}"`, `${esc(o.name)} (${o.hours}h)`,
        `${o.out}. Uses ${inText(o)}; ${o.hours}h; needs ${SKILL_NAMES[o.skill] || o.skill} ${o.min}+.${o.ok ? "" : ` ${o.reason}.`}`, !o.ok && !queueing)).join("")}</div>`;
}

// Boat crossings from the shore the team stands on (or will stand on when its queue gets there):
// cost breakdown by load, one button per crossing (and per vehicle choice), and gathering materials.
function boatBlock(state, p, from, queueing) {
  const cs = crossingsFrom(state, from);
  if (!cs.length || p.phase === "task" && p.task?.afloat) return "";
  const v = partyVehicle(state, p);
  const modes = v ? ["raft", "leave"] : ["raft"];
  const plans = modes.map((m) => boatPlan(state, p, from, cs[0].tile, m));
  const f1 = (h) => (Math.round(h * 10) / 10).toString();
  const rows = (pl) => pl.lines.map(([what, sc, pa, h]) => `<tr><td>${esc(what)}</td><td>${sc}</td><td>${pa || ""}</td><td>${f1(h)}h</td></tr>`).join("");
  const g = gatherInfo(state, p, from);
  const pl = plans[0];
  const btns = cs.flatMap((c) => modes.map((m) => {
    const plan = boatPlan(state, p, from, c.tile, m);
    const label = `Boat → ${esc(tileLabel(state, c.tile))}${v ? (m === "raft" ? " (raft vehicle)" : " (leave vehicle)") : ""} · ${plan.hours}h`;
    return `<button class="mini" data-action="xp-cross" data-id="${p.id}" data-tile="${c.tile}" data-mode="${m}" ${plan.ok || (queueing && Object.keys(plan.missing).length) ? "" : "disabled"}${tip(boatTip(state, plan, c.tile))}>${label}</button>`;
  })).join("");
  return `<div style="margin-top:0.5rem"><b${tip("Water blocks travel. From a shore the team can build a one-use boat and cross one water tile to the land straight across. Bigger loads need a bigger boat.")}>Boat crossing</b>${queueing && from !== partyTile(p) ? ` <span class="muted">from ${esc(tileLabel(state, from))} (end of queue)</span>` : ""}</div>
    <table class="t small"><tr><th></th><th${tip("Scrap used (from packed supplies and cargo)")}>Scrap</th><th>Parts</th><th${tip("Build hours before the Mechanics cut")}>Time</th></tr>${rows(pl)}
      <tr><td${tip(`-${Math.round(pl.cut * 100)}% build time (best Mechanics ${pl.mech}, 5% a point, up to 50%)`)}>Mechanics ${pl.mech}</td><td></td><td></td><td>-${Math.round(pl.cut * 100)}%</td></tr>
      <tr><td><b>Total</b></td><td><b>${pl.mats.scrap}</b></td><td><b>${pl.mats.parts || ""}</b></td><td><b>${pl.build}h + ${pl.cross}h</b></td></tr></table>
    ${v ? `<div class="muted">Leaving the ${esc(v.name)} on the shore instead: ${matsText(plans[1].mats)}, ${plans[1].build}h + ${plans[1].cross}h.</div>` : ""}
    <div class="${Object.keys(pl.missing).length ? "warn" : "muted"}">Carried: ${pl.have.scrap} scrap, ${pl.have.parts} parts${Object.keys(pl.missing).length ? ` · short ${matsText(pl.missing)}` : ""} · ${Math.round(pl.risk * 100)}% mishap risk</div>
    <div class="row" style="margin-top:0.3rem;flex-wrap:wrap">${btns}
      ${btn(`data-action="xp-order" data-id="${p.id}" data-type="gather"`, `Gather materials (${g.hours}h)`, `Search the shore for driftwood, fencing and barrels: ${g.min}–${g.max} scrap (better with Scavenging, in forest or built-up areas). Room for ${g.room} more in the cargo.`, g.room <= 0 && !queueing)}</div>`;
}
const btn = (attrs, label, hint, disabled) => `<button class="mini" ${attrs} ${disabled ? "disabled" : ""}${tip(hint)}>${label}</button>`;

function queueBlock(state, p, live) {
  const q = queueEstimate(state, p);
  if (!q.length) return live ? `<div class="muted" style="margin-top:0.3rem">Nothing queued. When this order is done the team reports in for the next one.</div>` : "";
  const total = q.every((x) => x.hours != null) ? q.reduce((s, x) => s + x.hours, 0) : null;
  return `<div style="margin-top:0.35rem"><b>Queue</b>${total != null ? ` <span class="muted">(+${hrs(total)} after the current order)</span>` : ""}</div>
    <ol class="xpqueue">${q.map((x, i) => `<li><span>${esc(x.label)} <span class="muted">${x.hours != null ? `~${hrs(x.hours)}` : "time varies"}</span></span>${live ? `<button class="mini" data-action="xp-unqueue" data-id="${p.id}" data-i="${i}"${tip("Remove from the queue")}>✕</button>` : ""}</li>`).join("")}</ol>
    ${live ? `<div class="row">${p.phase === "waiting" ? `<button class="mini primary" data-action="xp-resume" data-id="${p.id}"${tip("Start the next queued order now")}>Start queue</button>` : ""}<button class="mini" data-action="xp-clearq" data-id="${p.id}"${tip("Drop every queued order (the current one carries on)")}>Clear queue</button></div>` : ""}`;
}

function memberCard(state, p, m, live, queueing) {
  const top = Object.entries(m.skills).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => `<span class="chip">${SKILL_NAMES[k]} ${skill(m, k)}</span>`).join("");
  ensureInv(m);
  const gear = EQUIP_SLOTS.map((slot) => {
    const g = m.gear[slot];
    if (!g) return "";
    const eff = gearEffect(m, g);
    return `<span class="chip ${eff.usable ? "" : "off"}"${tip(`${SLOT_NAMES[slot]}: ${g.name}${eff.gap > 0 ? ` (skill gap ${eff.gap}${eff.usable ? ", weaker" : ", unusable"})` : ""}`)}>${esc(g.name)}</span>`;
  }).join("") || `<span class="muted">No gear</span>`;
  // Inventory (ui/inventory.js): swap gear between teammates and the team's cargo, fill pockets and packs.
  const inv = live ? `<button class="mini" data-action="inv-open" data-id="${m.id}"${tip("Paper-doll inventory: move items between this person, teammates and the team's cargo")}>Inventory</button>` : "";
  let treat = "";
  if (live) {
    const info = fieldTreatInfo(state, p, m);
    treat = `<button class="mini" data-action="xp-order" data-id="${p.id}" data-type="treat" data-sid="${m.id}" ${info.ok || (queueing && m.health < 100) ? "" : "disabled"}${tip(info.ok ? `${info.hours}h, ${info.cost} med${info.cost === 1 ? "" : "s"}: about +${info.heal} health${info.cureChance ? `, ${Math.round(info.cureChance * 100)}% to clean the infection` : ""}${info.medic ? ` (${info.medic.name.split(" ")[0]} treats)` : ""}.` : info.reason)}>Treat</button>`;
  }
  const heal = live && p.phase === "task" && p.task?.type === "camp" ? campHealPerHour(state, p, m) : 0;
  return `<div class="card small">
    <div class="spread"><b>${m.leader ? "★ " : ""}${esc(m.name)}</b><span>${inv}${treat}</span></div>
    ${live ? `<div class="row"><span class="muted" style="width:3.5rem">Health</span><div style="flex:1">${bar(m.health, m.health < 40 ? "var(--danger)" : "var(--good)")}</div><span style="width:2.2rem;text-align:right">${n0(m.health)}</span></div>
    ${m.woundInfected ? `<div class="danger"${tip("Gets worse every hour away from a base. Treat with meds.")}>Infected wound</div>` : ""}
    ${heal ? `<div class="good">Resting: +${heal.toFixed(2)} health/h</div>` : ""}` : ""}
    <div>${top}${m.traits.map((t) => `<span class="chip trait"${tip(TRAITS[t]?.desc)}>${esc(TRAITS[t]?.name || t)}</span>`).join("")}</div>
    <div>${gear}</div>
  </div>`;
}

function suppliesBlock(state, p) {
  const cap = partyCapacity(state, p);
  const load = cargoLoad(p.cargo);
  const packed = SUPPLY_KEYS.filter((k) => (p.supplies[k] || 0) >= 0.5 || (p.cargo.supplies[k] || 0) >= 0.5);
  const n = partyMembers(state, p).length || 1;
  const daysOf = (k) => n0(((p.supplies[k] || 0) + (p.cargo.supplies[k] || 0) + (k === "food" ? (p.supplies.preserved || 0) + (p.cargo.supplies.preserved || 0) : 0)) / n);
  return `<h3>Supplies and cargo</h3><div class="card small">
    <table class="t"><tr><th></th><th${tip("Packed at the start (used first on the road)")}>Packed</th><th${tip("Found on the way (carried home; food and water here are eaten when packed runs out)")}>Found</th></tr>
      ${packed.map((k) => `<tr><td>${SUPPLIES[k].name}</td><td>${n0(p.supplies[k])}</td><td>${n0(p.cargo.supplies[k])}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">Nothing carried</td></tr>`}
    </table>
    <div class="muted" style="margin-top:0.3rem">Food for ~${daysOf("food")} days, water for ~${daysOf("water")} days · meds ${n0(partyMeds(p))}</div>
    <div class="row" style="margin-top:0.3rem"><span class="muted" style="width:5.5rem"${tip("Found cargo against carry space (people + vehicle)")}>Load ${n0(load)}/${cap}</span><div style="flex:1">${bar((load / Math.max(1, cap)) * 100, load > cap * 0.9 ? "var(--danger)" : "var(--info)")}</div></div>
    ${p.cargo.gear.length ? `<div style="margin-top:0.3rem">${p.cargo.gear.map((g) => `<span class="chip">${esc(g.name)}</span>`).join("")}</div>` : ""}
  </div>`;
}

function vehicleBlock(state, p, v) {
  if (!v) return `<h3>Vehicle</h3><div class="card small muted">On foot.</div>`;
  return `<h3>Vehicle</h3><div class="card small">
    <b>${esc(v.name)}</b>
    <div class="row"><span class="muted" style="width:5rem">Condition</span><div style="flex:1">${bar(v.condition, v.condition < 40 ? "var(--danger)" : "var(--good)")}</div><span style="width:2.5rem;text-align:right">${Math.round(v.condition)}%</span></div>
    <div class="row"><span class="muted" style="width:5rem">Tank</span><div style="flex:1">${bar((v.fuel / tank(v)) * 100, "var(--accent)")}</div><span style="width:2.5rem;text-align:right">${n0(v.fuel)}/${tank(v)}</span></div>
    <div class="muted">Fuel cans ${n0(p.supplies.fuel)} · parts ${n0((p.supplies.parts || 0) + (p.cargo.supplies.parts || 0))} · worn vehicles break down more</div>
  </div>`;
}

// Heat (sim/fieldheat.js): a bar and what it means for a team standing still.
export function heatBlock(state, p) {
  const h = heatInfo(state, p);
  if (h.heat < 1 && !h.activity) return "";
  const color = h.heat < 25 ? "var(--good)" : h.heat < 50 ? "var(--accent)" : h.heat < 75 ? "#e0a84f" : "var(--danger)";
  return `<div class="row" style="margin-top:0.3rem"${tip(h.text)}><span class="muted" style="width:3.5rem">Heat</span><div style="flex:1">${bar(h.heat, color)}</div><span style="width:5.5rem;text-align:right" class="${h.heat >= 50 ? "warn" : ""}">${Math.round(h.heat)} · ${h.activity ? `${(h.chance * 100).toFixed(1)}%/h` : "falling"}</span></div>`;
}

// The plan the team left with (sim/plans.js): name, steps left and its "come home" rule.
function planBlock(state, p) {
  if (!p.plan) return "";
  const c = conditionText(p.plan.conditions);
  return `<div class="muted" style="margin-top:0.3rem"${tip("The plan set in the planner. Out of radio contact the team follows it and reports in with cards on finds (a horde, a rich site, low supplies) and when it ends; in contact you can change it any time.")}>Plan: ${esc(planStatus(state, p))}${c ? ` · comes home if ${esc(c)}` : ""}</div>`;
}
