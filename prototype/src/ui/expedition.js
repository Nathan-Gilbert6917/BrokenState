// Expedition panel (right sidebar) and the "Running orders" list on the map.
// The panel shows a team's people, gear, supplies, vehicle and order queue, with actions on the spot
// (camp, scavenge, look around, repair, treat, move, go home). Timed actions go through the order queue
// (sim/orders.js); buttons use data-action handlers in main.js.
import { SUPPLIES, SUPPLY_KEYS, SKILL_NAMES, TRAITS } from "../sim/data.js";
import { skill, gearEffect, baseById, hub } from "../sim/world.js";
import { MISSIONS, STANCES, partyMembers, partyCapacity, cargoLoad, poolLoad, bodyLoad, partyLoad, partyPace, tileLabel, partyTile, orderOptions, carried, cargoRoom } from "../sim/parties.js";
import { partyVehicle, tank, isBike, vehicleLabel } from "../sim/vehicles.js";
import { bandName } from "../sim/load.js";
import { loadRows, carLine, paceLine, BANDS_HELP } from "./loadview.js";
import { orderStatus, queueEstimate, queueEndTile, contactable, repairInfo, campHealPerHour, describeOrder, CAMP_HOURS, REPAIR_HOURS, SURVEY_HOURS, besideWater, FETCH_WATER_HOURS } from "../sim/orders.js";
import { crossingsFrom, boatPlan, boatTip, gatherInfo, matsText } from "../sim/crossing.js";
import { fieldCraftOptions, craftQueue, craftName } from "../sim/crafting.js";
import { BUILDINGS } from "../sim/buildings.js";
import { shortName } from "./names.js";
import { fieldTreatInfo, partyMeds } from "../sim/medical.js";
import { conditionChips, isSick } from "./health.js"; // illness chips with days left and a Treat button (the team's meds)
import { EQUIP_SLOTS, SLOT_NAMES, ensureInv } from "../sim/inventory.js";
import { weather as wxNow, travelEffects, foodNeedFactor } from "../sim/weather.js";
import { commandable, planStatus, conditionText, NO_RADIO } from "../sim/plans.js";
import { listenBlock, teamRadioLine } from "./radiolisten.js"; // the team's receiver: Listen in, what it heard
import { heatInfo, rowsText } from "../sim/fieldheat.js";
import { fireButton } from "./hardcore.js";
import { HUNT, huntProblem, huntInfo, fishProblem, fishKit, expectFish, fishSpot, snareLine, snareProblem, expectSnare, meatIn, frozenAt, SNARE } from "../sim/hunting.js";
import { teamWormText, teamWaterHow, teamTabCount, WORM } from "../sim/worm.js";
import { teamWaterIn, teamRawIn } from "../sim/water.js"; // purified and un-purified water
import { gaugeRows, treatsRow, needsEffectText, teamNeedsBlock } from "./needs.js";
import { forageInfo, forageProblem, landFoodOptions, FORAGE } from "../sim/foraging.js";
import { woodInfo, woodProblem, WOOD } from "../sim/woodcutting.js";
import { canClaim, claimOwner, wellProblem, wellYield, CLAIM } from "../sim/claims.js"; // land claims and wells on them
import { statusIcons } from "./status.js"; // low mood, starving, thirsty, low health, infected, sick

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
  const home = baseById(state, p.homeBaseId) || hub(state) || { name: "no base (on the road)" }; // conquest.js exiles: no base left
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
      ${queueBlock(state, p, cmd, ui)}
      ${planBlock(state, p)}
      ${live ? heatBlock(state, p) : ""}
    </div>`;

  if (!cmd) {
    return head + status + teamRadioLine(state, p, true) + `<div class="card small muted"${tip(NO_RADIO)}>No radio contact. The team follows its ${p.plan && p.plan.active ? "plan" : "orders"} and reports when it checks in (a card), gets home, or comes into radio range (a station or a linked relay). New orders only then.${ui.xpMsg ? `<div class="result small">${esc(ui.xpMsg)}</div>` : ""}</div>` +
      `<h3>People</h3>${members.map((m) => memberCard(state, p, m, false)).join("")}`;
  }

  // Actions on the spot.
  const opts = orderOptions(state, p).filter((o) => o.mission !== "survey" && o.mission !== "sweep");
  const loot = state.tiles[tile].loot > 0.05;
  const rep = repairInfo(state, p);
  const camping = p.phase === "task" && p.task && p.task.type === "camp";
  const working = p.phase === "task" && p.task && !camping;
  // Land claims and wells (sim/claims.js), on the tile the order would run on.
  const claimAt = queueing ? queueEndTile(state, p) : tile;
  const claimWhy = state.bases.length ? canClaim(state, claimAt) : "No base yet: a claim must border land you hold.";
  const wellWhy = wellProblem(state, p, claimAt);
  const actions = `<div class="card small">
      <div class="spread"><b>Orders</b>${moving ? `<span class="muted">queued after the current one</span>` :
        `<button class="mini ${ui.xpQueue ? "active" : ""}" data-action="xp-queuemode"${tip("On: actions go to the end of the queue. Off: they start now (stopping work on the spot).")}>${ui.xpQueue ? "Queue mode: on" : "Queue mode: off"}</button>`}</div>
      ${p.phase === "engaged" ? `<div class="muted">Busy on site. New orders wait in the queue.</div>` : ""}
      <div class="row" style="margin-top:0.35rem;flex-wrap:wrap">
        ${btn(`data-action="xp-move" data-id="${p.id}"`, queueing ? "Queue move…" : "Move…", queueing ? "Click a tile on the map. The move is added to the end of the team's queue." : "Click a tile on the map. The team sets off for it (when the clock runs).")}
        ${moving && p.radioLive ? btn(`data-action="movemode" data-id="${p.id}"`, "Redirect…", "Change the current destination now (radio contact).") : ""}
        ${!hub(state) ? "" : ord("home", "", queueing ? "Queue: return home" : "Return home", queueing ? `Added to the end of the queue: after the orders before it the team heads back to ${home.name} with everything carried.` : `Head back to ${home.name} now with everything carried. This drops the rest of the queue.`)}
        ${camping ? btn(`data-action="xp-stop" data-id="${p.id}"`, "Break camp", "Pack up now. The next queued order starts.") : ""}
        ${working ? btn(`data-action="xp-stop" data-id="${p.id}"`, "Stop work", "Give up on the current job (nothing is used up).") : ""}
      </div>
      <div class="xpgrid">
        ${ord("mission", ` data-mission="scavenge"`, "Scavenge here", loot || queueing ? MISSIONS.scavenge.desc : "Nothing left worth searching on this tile.", !loot && !queueing)}
        ${ord("mission", ` data-mission="survey"`, `Look around (${SURVEY_HOURS}h)`, MISSIONS.survey.desc)}
        ${[[2, 12], [3, 24], [4, 48]].map(([r, h]) => ord("sweep", ` data-radius="${r}" data-hours="${h}"`, `Survey ${r} tiles, ${h}h`, `${MISSIONS.sweep.desc} From here: ${r} tiles around for ${h} hours, back here at the end.`)).join("")}
        ${CAMP_HOURS.map((h) => ord("camp", ` data-hours="${h ?? ""}"`, h ? `Camp ${h}h` : "Camp (until broken)", `Stop and rest${h ? ` for ${h} hours` : " until you break camp"}. The hurt heal a little each hour (infected wounds need meds); nobody travels, so no road events. Supplies keep draining.`)).join("")}
        ${besideWater(state, queueing ? queueEndTile(state, p) : tile) ? ord("water", "", `Fetch water (${FETCH_WATER_HOURS}h)`, `Fill every free container from the river or lake and carry it home (room for about ${Math.floor(cargoRoom(state, p) / SUPPLIES.water.weight)} water now; 1 kg each). Un-purified water for a base that runs short in summer: the base purifies it; on the way a filter, a lit camp fire or purification tablets make it safe to drink.`) : ""}
        ${ord("repair", "", `Repair vehicle (${REPAIR_HOURS}h)`, rep.ok ? `${REPAIR_HOURS} hours, 1 part: about +${rep.gain}% condition (best Mechanics ${rep.mech}).` : rep.reason, !rep.ok && !queueing)}
        ${ord("claim", "", `Claim this tile (${CLAIM.HOURS}h)`, claimWhy && !queueing ? `Claim this tile: ${claimWhy}` : `Raise a marker post here (${CLAIM.SCRAP} scrap carried): the tile counts as land the coalition holds, toward the 50% the alliance victory needs. Lost if a group founds or takes a base on or beside it, a hive rises there, or a hostile band camps on it over a day.`, !!claimWhy && !queueing)}
        ${claimOwner(state, claimAt) === "player" || queueing ? ord("well", "", `Dig a well (${CLAIM.WELL_HOURS}h)`, wellWhy && !queueing ? `Dig a well: ${wellWhy}` : `Dig a well on this claim (${CLAIM.WELL_SCRAP} scrap, ${CLAIM.WELL_PARTS} part carried): about ${wellYield(state, claimAt)} water a day here, hauled by the people at your base next to it (one well per ${CLAIM.WELL_PER_PEOPLE} people there counts). It holds 1,500–4,000 water and runs dry in time.`, !!wellWhy && !queueing) : ""}
        ${opts.filter((o) => o.mission !== "scavenge").map((o) => ord("mission", ` data-mission="${o.mission}"`, esc(o.label), o.disabled || o.desc, !!o.disabled && !queueing)).join("")}
      </div>
      ${landBlock(state, p, queueing ? queueEndTile(state, p) : tile, queueing)}
      ${craftBlock(state, p, queueing)}
      ${boatBlock(state, p, queueing ? queueEndTile(state, p) : tile, queueing)}
      ${listenBlock(state, p, queueing)}
      ${ui.xpMsg ? `<div class="result small" style="margin-top:0.4rem">${esc(ui.xpMsg)}</div>` : ""}
    </div>`;

  return head + status + actions +
    `<h3>People (${members.length})</h3>${teamNeedsBlock(state, p, true)}${members.map((m) => memberCard(state, p, m, true, queueing)).join("")}` +
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

// Food from the land (sim/hunting.js): hunt, fish and snares on the tile the team stands on (or where its queue ends).
function landBlock(state, p, at, queueing) {
  const t = state.tiles[at];
  if (!t || t.terrain === "water") return "";
  const members = partyMembers(state, p);
  const info = huntInfo(state, at, { members, ammo: carried(p, "ammo"), hours: HUNT.defHours, room: cargoRoom(state, p) });
  const hp = queueing ? "" : huntProblem(state, p, at);
  const fs = fishSpot(state, at);
  const fp = fs && !queueing ? fishProblem(state, p, at) : "";
  const kit = fishKit(members, p.cargo.gear);
  const fe = fs && kit.power ? expectFish(state, kit, at, HUNT.defHours, state.hour, cargoRoom(state, p)).rations : 0;
  const line = snareLine(state, at);
  const sp = queueing ? "" : snareProblem(state, p, at, line ? "check" : "set");
  const se = line ? expectSnare(state, at, line.check ?? line.set, state.hour) : null;
  const ord = (type, extra, label, hint, disabled) => btn(`data-action="xp-order" data-id="${p.id}" data-type="${type}"${extra}`, label, hint, disabled);
  const meat = meatIn(p.cargo);
  const hunts = [4, 8, 12].map((h) => ord("hunt", ` data-hours="${h}"`, `Hunt ${h}h`, hp ? `Hunt: ${hp}` : `Hunt ${h} hours here. Game: ${info.word}${info.est && h === HUNT.defHours ? `; about ${Math.round(info.est.rations)} food expected in ${h}h` : ""}. A rifle or a bow is best; firearms use ammo, and every shot adds Heat and can draw the dead (bows are silent). Fresh game weighs 1 kg a ration and spoils fast.`, !!hp)).join("");
  const fishBtns = fs ? [4, 8].map((h) => ord("fish", ` data-hours="${h}"`, `Fish ${h}h`, fp ? `Fish: ${fp}` : `Fish ${h} hours in ${fs.name}${fe && h === HUNT.defHours ? `: about ${Math.round(fe)} food expected` : ""}${frozenAt(state) ? " (ice fishing: half the catch)" : ""}. Quiet.`, !!fp)).join("") : "";
  const snareBtns = line
    ? ord("snare", ` data-mode="check"`, "Check snares (1h)", sp ? `Snares: ${sp}` : `Collect the catch (about ${Math.round(se.animals)} small game by now, if nothing got to it) and leave the line set.`, !!sp) +
      ord("snare", ` data-mode="lift"`, "Lift snares (1h)", sp ? `Snares: ${sp}` : "Collect the catch and take the line up (the snare wire comes back).", !!sp)
    : ord("snare", ` data-mode="set"`, `Set snares (${SNARE.setHours}h)`, sp ? `Snares: ${sp}` : `Lay a line of ${SNARE.count} snares here with snare wire (or ${SNARE.scrap} scrap of fence wire). Come back within 2–3 days to collect: about a rabbit a day in good country.`, !!sp);
  // Wild food (sim/foraging.js): forage here, with what it would bring.
  const fi = forageInfo(state, at, { members, hours: FORAGE.defHours, room: cargoRoom(state, p) });
  const fgp = queueing ? "" : forageProblem(state, p, at);
  const forageBtns = [4, 8, 12].map((h) => ord("forage", ` data-hours="${h}"`, `Forage ${h}h`, fgp ? `Forage: ${fgp}` : `Gather wild food here for ${h} hours: berries, nuts, mushrooms, greens, roots, apples (${fi.seasonKey}: ${fi.word})${fi.est && h === FORAGE.defHours ? `; about ${Math.round(fi.est.rations * 10) / 10} food expected in ${h}h` : ""}. Forest is best, farmland and old orchards good, towns little; summer and autumn plentiful, winter almost nothing. Quiet, but time on one spot builds Heat; now and then herbs (meds) or honey, rarely a bad mushroom.`, !!fgp)).join("");
  // Firewood (sim/woodcutting.js): cut wood here, with what it would bring (as far as the team can carry it).
  const wi = woodInfo(state, at, { members, spare: p.cargo.gear, hours: WOOD.defHours, room: cargoRoom(state, p) });
  const wp = queueing ? "" : woodProblem(state, p, at);
  const woodWood = carried(p, "wood");
  const woodBtns = [4, 8].map((h) => ord("wood", ` data-hours="${h}"`, `Cut wood ${h}h`, wp ? `Cut wood: ${wp}` : `Cut firewood here for ${h} hours (daylight only): wood ${wi.word}${wi.est && h === WOOD.defHours ? `; about ${Math.round(wi.est.wood)} firewood expected in ${h}h, as much as the team can carry (0.1 kg each: ${Math.round(wi.est.wood * SUPPLIES.wood.weight)} kg)${wi.est.all > wi.est.wood + 15 ? `: about ${Math.round(wi.est.all)} cut, the rest left` : ""}` : ""}. ${wi.tools ? `${wi.tools} with an axe or blade` : "No axe: deadfall by hand, far slower"}. The winter's heating: a base burns firewood before fuel. Loud (Heat), and axes slip now and then.`, !!wp)).join("");
  return `<div style="margin-top:0.5rem"><b${tip("Food and firewood from the land: forage (anyone), hunt (a rifle or a bow), fish (a rod or a net, on a river or lake shore), set snares, or cut wood (an axe helps). The land runs out of game when hunted hard and grows back over weeks; picked land grows back over a season, cut woods over seasons.")}>Land</b> <span class="muted">wild food ${fi.word} · game ${info.word} · wood ${wi.word}${fs ? ` · fish in ${fs.name}` : ""}${line ? " · your snares" : ""}${meat >= 1 ? ` · carrying ${Math.floor(meat)} fresh game` : ""}${woodWood >= 1 ? ` · carrying ${Math.floor(woodWood)} firewood` : ""}</span></div>
    ${teamWormText(state, p) ? `<div class="small danger"${tip("The worm (Help: The dead and the worm): its eggs die in the heat. Camp with the fire lit to boil the water and cook the game; a water filter carried cleans the water as it is drunk. Eaten raw or drunk unboiled, each day is a chance of catching it.")}>The worm: ${esc(teamWormText(state, p))}.</div>` : ""}
    ${lowFoodBlock(state, p, at, queueing)}
    <div class="row" style="margin-top:0.3rem;flex-wrap:wrap">${forageBtns}${hunts}${fishBtns}${snareBtns}${woodBtns}</div>`;
}

// Short of food (under 2 days): the best food from the land here and around (sim/foraging.js landFoodOptions), with
// what each would bring in 8 hours and the walk; a button for the best one on another tile goes there and does it.
const KIND_NAME = { forage: "Forage", hunt: "Hunt", fish: "Fish" };
function lowFoodBlock(state, p, at, queueing) {
  const members = partyMembers(state, p);
  if (!members.length) return "";
  const days = (carried(p, "food") + carried(p, "preserved")) / members.length;
  if (days >= 2) return "";
  const opts = landFoodOptions(state, p, { from: at, range: 2, walk: false, hours: FORAGE.defHours }).filter((o) => o.rations >= 1);
  const seen = new Set();
  const top = opts.filter((o) => { const k = `${o.kind}:${o.dist === 0}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 4);
  const rows = top.map((o) => `<div>${KIND_NAME[o.kind]} ${o.dist === 0 ? "here" : `${o.dist} tile${o.dist === 1 ? "" : "s"} ${o.dir}`} <span class="muted">(${esc(o.terrain)})</span>: ~${Math.round(o.rations)} food in ${o.hours}h${o.dist ? ` <button class="mini" data-action="ctxhunt" data-id="${p.id}" data-tile="${o.tile}" data-type="${o.kind}"${tip(`Go there (about ${Math.round(o.travel)}h) and ${o.kind} ${o.hours} hours.`)}>Go</button>` : ""}</div>`).join("");
  return `<div class="card small ${days < 1 ? "danger" : "warn"}" style="margin-top:0.3rem"${tip("Food for under 2 days. Food from the land around: what each would bring in 8 hours (an average: the season, the land, the team). Walking there costs time and food too.")}><b>Food for ${Math.round(days * 10) / 10} days.</b> ${top.length ? "Food from the land nearby:" : "Little to gather or hunt nearby: search farms, groceries and diners."}${rows}</div>`;
}

// Field crafting (sim/crafting.js): a timed order per recipe, made from what the team carries.
function craftBlock(state, p, queueing) {
  const opts = fieldCraftOptions(state, p);
  if (!opts.length) return "";
  const inText = (o) => o.inText || Object.entries(o.in).map(([k, q]) => `${q} ${k}`).join(" + ");
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

// The order queue. A move under way is the first line ("Now", ✕ cancels it: the team stops where it is). Queued
// orders can be removed, or reordered: drag a line onto another, or select one (click it) and use ▲ ▼ or the
// ↑ ↓ keys (main.js; Delete removes the selected one, Esc drops the selection).
function queueBlock(state, p, live, ui) {
  const q = queueEstimate(state, p);
  const moving = live && (p.phase === "out" || p.phase === "back");
  const working = live && p.phase === "task" && !!p.task && !p.task.afloat; // a boat on the water cannot be called back
  if (!q.length && !moving && !working) return live ? `<div class="muted" style="margin-top:0.3rem">Nothing queued. When this order is done the team reports in for the next one.</div>` : "";
  const total = q.every((x) => x.hours != null) ? q.reduce((s, x) => s + x.hours, 0) : null;
  const sel = ui && ui.qSel != null && ui.qSel < q.length ? ui.qSel : null;
  let now = "";
  if (moving || working) {
    // The order under way, with ✕: a move is cancelled (the team stops where it is), work on the spot is stopped
    // (a camp is broken). Either way the next queued order starts there, or the team waits for orders.
    const st = orderStatus(state, p);
    const next = q.length ? " The next queued order starts there." : " Then the team waits for orders.";
    const hint = moving ? `Cancel this ${p.phase === "back" ? "return home" : "move"}: the team stops on the tile it has reached.${next}` :
      p.task.type === "camp" ? `Break camp now.${next}` : `Stop this job now (nothing is used up).${next}`;
    now = `<li class="now"><div class="qrow"><span class="qlabel"${tip("The order under way. ✕ cancels it: the team stops where it is and goes on with the queue from there, or waits for orders.")}><b>Now:</b> ${esc(st.label)} <span class="muted">${st.left != null && st.left > 0 ? `${hrs(st.left)} left` : st.left == null && working ? "until you stop it" : ""}</span></span>` +
      `<span class="qbtns"><button class="mini" data-action="${moving ? "xp-cancelmove" : "xp-stop"}" data-id="${p.id}"${tip(hint)}>✕</button></span></div></li>`;
  }
  const rows = q.map((x, i) => {
    const label = `${esc(x.label)} <span class="muted">${x.hours != null ? `~${hrs(x.hours)}` : "time varies"}</span>`;
    if (!live) return `<li${i === 0 ? ' value="1"' : ""}><div class="qrow"><span class="qlabel">${label}</span></div></li>`;
    return `<li class="${sel === i ? "sel" : ""}"${i === 0 ? ' value="1"' : ""} draggable="true" data-qdrag="${i}" data-qdrop="${i}" data-id="${p.id}">
      <div class="qrow"><span class="qgrip"${tip("Drag onto another line to reorder the queue")}>⋮⋮</span>
      <span class="qlabel" data-action="xp-qsel" data-id="${p.id}" data-i="${i}"${tip(sel === i ? "Selected: ↑ ↓ move it in the queue, Delete removes it, Esc drops the selection. Click to unselect." : "Click to select, then ↑ ↓ move it in the queue (or drag the line).")}>${label}</span>
      <span class="qbtns"><button class="mini" data-action="xp-qmove" data-id="${p.id}" data-i="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""}${tip("Earlier in the queue")}>▲</button>` +
      `<button class="mini" data-action="xp-qmove" data-id="${p.id}" data-i="${i}" data-dir="1" ${i === q.length - 1 ? "disabled" : ""}${tip("Later in the queue")}>▼</button>` +
      `<button class="mini" data-action="xp-unqueue" data-id="${p.id}" data-i="${i}"${tip("Remove from the queue")}>✕</button></span></div></li>`;
  }).join("");
  return `<div style="margin-top:0.35rem"><b>Queue</b>${total != null && q.length ? ` <span class="muted">(+${hrs(total)} after the current order)</span>` : ""}</div>
    <ol class="xpqueue">${now}${rows}</ol>
    ${live && q.length ? `<div class="row">${p.phase === "waiting" ? `<button class="mini primary" data-action="xp-resume" data-id="${p.id}"${tip("Start the next queued order now")}>Start queue</button>` : ""}<button class="mini" data-action="xp-clearq" data-id="${p.id}"${tip("Drop every queued order (the current one carries on)")}>Clear queue</button></div>` : ""}`;
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
    <div class="spread"><b>${m.leader ? "★ " : ""}${esc(m.name)}${live ? statusIcons(state, m) : ""}</b><span>${inv}${treat}</span></div>
    ${live ? `<div class="row"><span class="muted" style="width:3.5rem">Health</span><div style="flex:1">${bar(m.health, m.health < 40 ? "var(--danger)" : "var(--good)")}</div><span style="width:2.2rem;text-align:right">${n0(m.health)}</span></div>
    ${gaugeRows(m, { label: "3.5rem" })}${needsEffectText(m) ? `<div class="warn">${esc(needsEffectText(m))}</div>` : ""}${treatsRow(state, m)}
    ${m.woundInfected ? `<div class="danger"${tip("Gets worse every hour away from a base. Treat with meds.")}>Infected wound</div>` : ""}
    ${isSick(m) ? `<div class="row" style="flex-wrap:wrap">${conditionChips(state, m)}</div>` : ""}
    ${heal ? `<div class="good">Resting: +${heal.toFixed(2)} health/h</div>` : ""}` : ""}
    <div>${top}${m.traits.map((t) => `<span class="chip trait"${tip(TRAITS[t]?.desc)}>${esc(TRAITS[t]?.name || t)}</span>`).join("")}</div>
    <div>${gear}</div>
  </div>`;
}

function suppliesBlock(state, p) {
  const cap = partyCapacity(state, p);
  const load = poolLoad(p);
  const packed = SUPPLY_KEYS.filter((k) => (p.supplies[k] || 0) >= 0.5 || (p.cargo.supplies[k] || 0) >= 0.5);
  // Days at the rate it eats on the move (more under a load, sim/load.js; food at today's cold, sim/weather.js).
  const n = Math.max(1, partyPace(state, p).eatMove);
  const daysOf = (k) => n0((k === "water" ? teamWaterIn(p) : (p.supplies[k] || 0) + (p.cargo.supplies[k] || 0) + (k === "food" ? (p.supplies.preserved || 0) + (p.cargo.supplies.preserved || 0) : 0)) / (n * (k === "food" ? foodNeedFactor(state) : 1))); // water: both kinds
  const t = partyLoad(state, p);
  const b = p.burden;
  const pace = b ? (p.vehicle ? b.ride : b.foot) : 1;
  return `<h3>Supplies and cargo</h3><div class="card small">
    <table class="t"><tr><th></th><th${tip("Packed at the start (used first on the road)")}>Packed</th><th${tip("Found on the way (carried home; food and water here are eaten when packed runs out)")}>Found</th></tr>
      ${packed.map((k) => `<tr><td>${SUPPLIES[k].name}</td><td>${n0(p.supplies[k])}</td><td>${n0(p.cargo.supplies[k])}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">Nothing carried</td></tr>`}
    </table>
    <div class="muted" style="margin-top:0.3rem">Food for ~${daysOf("food")} days, water for ~${daysOf("water")} days on the move · meds ${n0(partyMeds(p))}</div>
    ${teamWaterNote(state, p)}
    <div class="row" style="margin-top:0.3rem"><span class="muted" style="width:7rem"${tip(`Supplies and cargo (kg) against what the team can carry on top of what it wears${p.vehicle ? " (plus the vehicle)" : ""}. ${BANDS_HELP}`)}>Load ${n0(load)}/${n0(cap)} kg</span><div style="flex:1">${bar((load / Math.max(1, cap)) * 100, load > cap * 0.9 ? "var(--danger)" : "var(--info)")}</div></div>
    <div style="margin-top:0.3rem"${tip("The team is weighed when it sets off and each hour it waits: eating on the way does not lighten its pace until it stops, but anything picked up on the move counts at once.")}>${p.vehicle === true ? "" : `<div class="small">Pace from its load: ${pace < 1 ? `<span class="warn">−${Math.round((1 - pace) * 100)}%</span>` : "full"}${b && b.band >= 0 ? ` (worst band when weighed: ${bandName(b.band)})` : ""}</div>`}${paceLine(t)}${carLine(t, partyVehicle(state, p)?.name)}${t.mode === true ? "" : loadRows(t)}</div>
    ${p.cargo.gear.length ? `<div style="margin-top:0.3rem">${p.cargo.gear.map((g) => `<span class="chip">${esc(g.name)}</span>`).join("")}</div>` : ""}
    ${(p.cargo.bodies || []).length ? `<div style="margin-top:0.3rem">${p.cargo.bodies.map((x) => `<span class="chip off"${tip(`A body in the car: ${Math.round(bodyLoad(x))} kg of the load (the body and its things) until it is buried or burned at a base (Armory tab).${x.worm && !x.safe ? " The worm is in it." : ""}`)}>Body of ${esc(x.name.split(" ")[0])} · ${Math.round(bodyLoad(x))} kg</span>`).join("")}</div>` : ""}
  </div>`;
}

function vehicleBlock(state, p, v) {
  if (!v) return `<h3>Vehicle</h3><div class="card small muted">On foot.</div>`;
  if (isBike(v)) return `<h3>Vehicle</h3><div class="card small">
    <b>${esc(vehicleLabel(v))}</b>
    <div class="row"><span class="muted" style="width:5rem">Condition</span><div style="flex:1">${bar(v.condition, v.condition < 40 ? "var(--danger)" : "var(--good)")}</div><span style="width:2.5rem;text-align:right">${Math.round(v.condition)}%</span></div>
    <div class="muted">No fuel. Racks carry 15 kg a bike; riding takes 55% of the load's slow-down away. A part or a bit of scrap patches them on the road.</div>
  </div>`;
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
  // At a camp (sim/fieldheat.js campSite: camping, or at the staging camp): what the Heat is made of, and the fire.
  const camp = h.camp ? `<div class="row small muted" style="margin-top:0.2rem"${tip(h.text)}><span>Camp danger: ${esc(rowsText(h.rows || []))}</span>${fireButton(h.camp.fire, h.camp.kind === "staging" ? `data-camp="1"` : `data-team="${p.id}"`)}</div>` : "";
  return `<div class="row" style="margin-top:0.3rem"${tip(h.text)}><span class="muted" style="width:3.5rem">Heat</span><div style="flex:1">${bar(h.heat, color)}</div><span style="width:5.5rem;text-align:right" class="${h.heat >= 50 ? "warn" : ""}">${Math.round(h.heat)} · ${h.activity ? `${(h.chance * 100).toFixed(1)}%/h` : "falling"}</span></div>${camp}`;
}

// The plan the team left with (sim/plans.js): name, steps left and its "come home" rule.
function planBlock(state, p) {
  if (!p.plan) return "";
  const c = conditionText(p.plan.conditions);
  return `<div class="muted" style="margin-top:0.3rem"${tip("The plan set in the planner. Out of radio contact the team follows it and reports in with cards on finds (a horde, a rich site, low supplies) and when it ends; in contact you can change it any time.")}>Plan: ${esc(planStatus(state, p))}${c ? ` · comes home if ${esc(c)}` : ""}</div>`;
}

// The team's water (sim/water.js): purified and un-purified, and how it drinks the un-purified water now (sim/worm.js
// drinkHour): through a filter, boiled at the camp fire, a tablet dropped in, or as it is.
function teamWaterNote(state, p) {
  const raw = teamRawIn(p);
  if (!(raw >= 1)) return "";
  const how = teamWaterHow(state, p);
  const tabs = teamTabCount(state, p);
  const lit = p.phase === "task" && p.task && p.task.type === "camp" && p.campFire !== false;
  const text = how === "filter" ? "now: through the water filter carried (safe)" : how === "fire" ? "now: boiled at the camp fire (safe; no tablets used)" : how === "tabs" ? `now: purification tablets (${lit ? "the camp fire has nothing to burn" : "on the move"}; ${tabs} tablet${tabs === 1 ? "" : "s"} carried, one per ${WORM.TABS_WATER})` : `now: drunk as it is (${(p.wormEggs || 0) > 0 ? "it carries the worm's eggs" : "it can carry the worm"}: camp with the fire lit and firewood, or carry a filter or purification tablets)`;
  return `<div class="small ${how === "unsafe" ? "danger" : "muted"}"${tip("Purified water (bottled, boiled, filtered) is drunk first. Un-purified water (fetched from a river or lake, or a base's well water) can carry the worm and turn the stomach; it is made safe, in this order: a water filter carried; a lit camp fire with firewood carried or deadfall on the land (it also boils some into purified water each hour); purification tablets (one per " + WORM.TABS_WATER + " water: on the move, or at a camp whose fire cannot be kept going); otherwise it is drunk as it is.")}>Water: ${n0(carriedW(p))} purified, ${n0(raw)} un-purified: ${esc(text)}.</div>`;
}
const carriedW = (p) => Math.max(0, p.supplies.water || 0) + Math.max(0, (p.cargo && p.cargo.supplies.water) || 0);
