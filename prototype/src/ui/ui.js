// DOM panels and modals. Every user action goes through the action dispatcher in main.js.
// Any element with data-tip="..." shows a hover description.
import { TERRAIN, LOCATIONS, SITE_ZONES, DANGER_NAMES, siteDanger, SUPPLIES, SUPPLY_KEYS, GEAR, SKILLS, SKILL_NAMES, TRAITS, FACTION_TYPES } from "../sim/data.js";
import {
  day, hourOfDay, isNight, hub, alive, atBase, skill, combatPower, factionById, survivorById, baseById, gearEffect, RADIO_RANGE,
} from "../sim/world.js";
import * as Parties from "../sim/parties.js";
import * as Medical from "../sim/medical.js";
import * as Trade from "../sim/trade.js";
import { worthTier } from "../sim/valuation.js";
import {
  MISSIONS, STANCES, estimateTrip, partyMembers, partyCapacity, cargoLoad, tileLabel, partyTile, orderOptions, teamName, carryCapacity, supplyLoad,
} from "../sim/parties.js";
import { attitude, baseDefense } from "../sim/factions.js";
import { baseHeat, hordeScore } from "../sim/hordes.js";
import { holdLimit, wallTier } from "../sim/defences.js";
import { hiveDanger, hiveTracker } from "../sim/hives.js";
import { HIVE, BOSS_NAMES } from "../sim/hiveconst.js";
import { ROLES, ESCORTS, supplyLine, farmOutput, scavengeOutput, foodForecast } from "../sim/economy.js";
import { baseFarming, foodCellHtml, waterCellHtml, foodLine, waterLine, storeCellHtml } from "./farming.js";
import { conditionChips, conditionTreatRow, illnessCard, isSick, bedChip, healPerDayText, nextTreatLine } from "./health.js";
import { APPROACHES, heatStage, foundLoad, engagementParty } from "../sim/scavenge.js";
import { tradeContext, tradeTotals, sellPrice, buyPrice, canRadio } from "../sim/trade.js";
import {
  BUILDINGS, RECIPES, stations, stationStatus, canBuild, buildRate, buildingSummary, farmSlots, baseBeds, count,
} from "../sim/buildings.js";
import { VEHICLE_TYPES, tank, vehiclesAtBase, carsAtBase, bikesAtBase, partyVehicle, canRepair, partyFuel, isBike, isCar, travelMode, vehicleLabel, RIDER_KG } from "../sim/vehicles.js";
import { teamLoad, wornLoad, maxLoad } from "../sim/load.js";
import { loadRows, carLine, paceLine, loadWarnings, BANDS_HELP } from "./loadview.js";
import { MARKER_TYPES, LAYERS } from "../sim/markers.js";
import { ageText, liveSet, mapLoc } from "./render.js";
import { lootBand, LOOT_BANDS } from "../sim/aiscav.js";
import { conflictView, captivesOf, isCaptive } from "../sim/conflicts.js";
import { AT_DEST, supplyRuns, supplyRunById, jobParty, jobName, linesText, supplyStatus, supplyEstimate, escortFor } from "../sim/supply.js";
import { newRunScreen, zombieLookModal, appearanceEditor } from "./newgame.js";
import { survivorURL, spriteImg } from "./sprites.js";
import { renderExpedition, startsWhenUnpaused } from "./expedition.js";
import { shortName } from "./names.js";
import { orderStatus, contactable } from "../sim/orders.js";
import { planSection, planAutofill, planEstimate } from "./plan.js";
import { commandable, NO_RADIO } from "../sim/plans.js";
import { season as wxSeason, weather as wxNow, weatherReport, SEASON_DAYS } from "../sim/weather.js";
import { activeHospital, patients, healRatePerHour, hospitalTypes, nextHospitalType, isHurt, treatAtBaseInfo, fieldTreatInfo, partyMeds } from "../sim/medical.js";
import { CRAFTS, craftName, craftQueue, crafters, craftRate, canCraft, craftJobStatus, craftOutputText, craftQuality, hasWorkshop, itemDur, durUnit, MAX_CRAFT_QUEUE, craftInText } from "../sim/crafting.js";
import { orderCell, racksCard, powerCard, craftOrdersCard, stewardCard, pinButton } from "./production.js";
import { EQUIP_SLOTS, SLOT_NAMES, ensureInv, personPlace, armorPower } from "../sim/inventory.js";
import { inventoryModal } from "./inventory.js";
import { tradeWindow, radioModal, caravanPlanModal, groupsRadioHeader, caravanLines } from "./tradewindow.js";
import { recruitModal, crowdingRow, moodRiskChip } from "./people.js";
import { skillsBlock, skillTree, studyBlock } from "./skills.js";
import { relChip, moodTipAttr, relationsSection, memorialModal, memorialButton } from "./relations.js";
import { diaryModal } from "./diary.js";
import { rosterModal } from "./roster.js";
import { groupsDiploHeader, groupCardExtras, diplomacyModal, plannerJobNote } from "./diplomacy.js";
import { ALLIANCE, goalsProgress } from "../sim/alliance.js";
import { occupiedAt, occupiedText, assaultWarning, assaultForce } from "../sim/conquest.js";
import { repairsTab, blueprintsCard, keyRingCard, lockLine } from "./explore.js";
import { prisonTab } from "./prisoners.js";
import { settingsModal } from "./settings.js";
import { swatch } from "./help.js";
import { outsidersSection } from "./visitors.js";
import { workTab, roleSelect as workRoleSelect, taskChip } from "./work.js";
import { huntInfo, gameWord, fishKit, expectFish, fishLevel, snareLine, expectSnare, bestHuntWeapon, hunterMult, HUNT, frozenAt, meatAt, gameAbundance } from "../sim/hunting.js";
import { roleOf, isManaged, taskLabel, taskWhy, priorityCount } from "../sim/work.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n0 = (v) => Math.floor((v || 0) + 1e-9);
const n1 = (v) => (Math.round((v || 0) * 10) / 10).toString();
const bar = (v, color) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></i></div>`;
const attColor = (a) => ({ Hostile: "var(--danger)", Neutral: "var(--muted)", Friendly: "var(--good)", Allied: "var(--accent)" }[a]);
const clock = (state) => `${String(hourOfDay(state)).padStart(2, "0")}:00`;
const first = (s) => esc(shortName(s)); // first name, with a last initial when two people share it (names.js)
// Short skill labels for crew lists (whole words, never cut mid-word).
const SKILL_SHORT = { scouting: "Scout", stealth: "Stealth", shooting: "Shoot", scavenging: "Scav", speech: "Speech", medicine: "Med", mechanics: "Mech", farming: "Farm", leadership: "Lead" };
const bedTag = (s) => (s.inBed ? ` <span class="muted"${tip("In a hospital bed: does not work while admitted (Medical tab)")}>(in bed)</span>` : "");
// Whether you know how someone is right now: at a base or on a convoy yes; on a team only while it is in contact
// (waiting, working on the spot, or in radio range); captives no.
function inContact(state, s) {
  const k = s.location && s.location.kind;
  if (k === "base" || k === "route") return true;
  if (k !== "party") return false;
  const p = state.parties.find((x) => x.id === s.location.partyId);
  return !!p && (p.kind === "convoy" || contactable(p));
}
// The role drop-down: work roles (priorities) and fixed jobs (Manual), with what they do now (ui/work.js).
const roleSelect = (state, s, extra = "") => `${workRoleSelect(state, s, extra)}${taskChip(state, s)}`;

// ---------- top bar ----------
// The top bar in pieces (the slots in index.html): the clock and the stock change with the hour, the buttons only
// when you press them, so each piece is redrawn only when its own text changes (main.js).
export function topbarParts(state, ui) {
  const h = hub(state);
  const speeds = [[0, "⏸", "Pause (Space). Orders you give while paused start when you unpause."], [0.5, "0.5×", "Slow: an hour takes 40 seconds, a day 16 minutes (1)"], [1, "1×", "Normal: an hour takes 20 seconds, a day 8 minutes (2)"], [2, "2×", "Fast: an hour takes 10 seconds, a day 4 minutes (3)"], [3, "3×", "Fastest: an hour takes about 7 seconds, a day 2 minutes 40 seconds (4)"]];
  return {
    clock: `Day ${day(state)} · ${clock(state)} ${isNight(state) ? "🌙" : "☀"}${weatherChip(state)}`,
    speed: speeds.map(([s, l, t]) => `<button data-action="speed" data-speed="${s}" class="${ui.speed === s ? "active" : ""}"${tip(t)}>${l}</button>`).join("") +
      (ui.speed > 3 ? `<button data-action="speed" data-speed="1" class="active"${tip("Dev fast forward is running. Click to go back to 1×.")}>${ui.speed}× dev</button>` : ""),
    // Food and water also show days left (economy.js outlook; the tooltip has the details).
    // Jars go in the preserved food's tooltip (storage.js), not a slot of their own.
    stock: !h ? `<span class="danger"${tip("You have no base left: your people are a team on the road. Build an outpost (it becomes your hub) or take a base back (Assault their base).")}>No base: on the road</span>` : SUPPLY_KEYS.filter((k) => k !== "jars").map((k) => { const ln = k === "food" ? foodLine(state, h) : k === "water" ? waterLine(state, h) : null; const extra = k === "preserved" ? ` Jarred, dried and canned food and dry grain: barely spoils, needs no cellar room, eaten once the fresh food is gone. Empty jars: ${n0(h.stock.jars)}.` : ""; return `<span${tip(`${SUPPLIES[k].name} at ${h.name}. Weight ${SUPPLIES[k].weight} each; what it fetches depends on who you trade with.${extra}${ln ? ` ${ln.tip}` : ""}`)}><b>${k === "preserved" ? "Preserved" : SUPPLIES[k].name}</b>${n0(h.stock[k])}${ln ? ` <span class="small ${ln.cls}">${k === "food" ? esc(ln.short.split(" · ")[0]) : esc(ln.short.split(" · ")[0])}</span>` : ""}</span>`; }).join(""),
    people: `<span${tip("Survivors alive across all bases and teams")}>👥 ${alive(state).length}</span>`,
    tools: `UI
      <select data-action="uiscale"${tip("Interface size. Larger is easier to read from the couch.")}>${[0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2].map((v) => `<option value="${v}" ${ui.scale === v ? "selected" : ""}>${Math.round(v * 100)}%</option>`).join("")}</select>
      <button data-action="zlook-open"${tip("Zombie look: palette, gore, variants (battle sprites)")}>Zombies</button>
      <button data-action="dev-toggle" class="${ui.dev ? "active" : ""}"${tip("Dev tools: reveal the map, autopilot, fast forward, frame rate, and a tracker of groups and zombie hotzones (\` key)")}>Dev</button>
      <button data-action="dy-open"${tip("Diary: the whole run day by day, with filters and search (J)")}>📖 Diary</button>
      <button data-action="ro-toggle"${tip("Roster: everyone in one table, sortable, with roles you can change for many at once (R)")}>👥 Roster</button>
      <button data-action="help"${tip("How the game works, and the keys")}>Help</button>
      <button data-action="set-open"${tip("Menu: save, load, save and exit, new campaign, options (Esc)")}>⚙ Menu</button>`,
  };
}
// The planner's weather note: hours the weather adds to the trip compared with fair weather.
function weatherEta(est) {
  const out = est.weatherOut || 0, all = out + (est.weatherBack || 0);
  if (!out && !all) return "";
  const sg = (h) => `${h > 0 ? "+" : "−"}${Math.abs(h)}h`;
  return ` <span class="${out > 0 ? "warn" : "muted"}"${tip(`Weather (mud, snow, storms, fog) changes this trip by ${sg(out)} on the way out and ${sg(all)} over the round trip, compared with fair weather. The estimate already includes it.`)}>${sg(out)} weather</span>`;
}

// Season and weather next to the clock; hover for effects and the forecast (weather.js).
function weatherChip(state) {
  const se = wxSeason(state), w = wxNow(state);
  return `<span class="wx" data-tip-pre${tip(weatherReport(state))}>${se.icon} ${se.name} ${se.dayOfSeason}/${SEASON_DAYS} · ${w.icon} ${Math.round(w.temp)}°C${w.severe ? " ⚠" : ""}</span>`;
}
// The whole bar as one string (tools and tests).
export function renderTopbar(state, ui) {
  const p = topbarParts(state, ui);
  return `<span class="title">BROKEN STATE</span><span class="clock">${p.clock}</span><span class="speed row">${p.speed}</span><span class="stock">${p.stock}</span>${p.people}<span class="row small" style="margin-left:auto">${p.tools}</span>`;
}

// ---------- left panel ----------
export function renderLeft(state, ui) {
  const waiting = state.parties.filter((p) => p.owner === "player" && p.phase === "waiting").length;
  const tabs = [["bases", "Bases", "Your hub and outposts (B)"], ["people", "People", "Everyone, their roles and health (P; R for the full roster table)"], ["groups", "Groups", "Other survivor groups and trade routes (G)"], ["teams", `Teams${waiting ? ` (${waiting}!)` : ""}`, "Teams in the field and their orders (T; Tab or N jumps to the next team waiting)"]];
  const head = `<div class="tabs">${tabs.map(([k, l, t]) => `<button data-action="tab" data-tab="${k}" class="${ui.tab === k ? "active" : ""}"${tip(t)}>${l}</button>`).join("")}</div>`;
  if (ui.tab === "people") return head + renderPeople(state);
  if (ui.tab === "groups") return head + renderGroups(state);
  if (ui.tab === "teams") return head + renderTeams(state, ui);
  return head + renderBases(state);
}

// Food per day at a base from everything that is known: farms, what the scavengers bring in, what running
// workshop stations use up, and what everyone living there eats.
function foodPerDay(state, b) {
  const farm = farmOutput(state, b);
  const scav = scavengeOutput(state, b).food || 0;
  const eat = farm - foodForecast(state, b); // mouths (the sim's own count)
  let used = 0;
  for (const st of stations(b)) {
    const ss = stationStatus(state, b, st);
    if (ss.running) used += ((ss.in || RECIPES[ss.recipe].in).food || 0) - (ss.out.preserved || 0); // the kitchen jars food: only its loss counts
  }
  const total = farm + scav - used - eat;
  return { total, text: `Farms +${n1(farm)}${scav >= 0.05 ? `, scavenging +${n1(scav)}` : ""}${used ? `, workshops -${n1(used)}` : ""}, eating -${n1(eat)}. Loot brought home by teams and convoys comes on top.` };
}
const foodCell = (f) => `<div class="${f.total < 0 ? "danger" : "good"}"${tip(f.text)}>${f.total >= 0 ? "+" : ""}${n1(f.total)}</div>`;

function renderBases(state) {
  return state.bases.map((b) => {
    const people = atBase(state, b.id);
    const fc = foodPerDay(state, b);
    const job = b.construction[0];
    const rate = buildRate(state, b);
    const line = b.type === "outpost" ? (b.supplyLine || supplyLine(state, b)) : null;
    return `<div class="card">
      <div class="spread"><h2 style="margin:0">${esc(b.name)}</h2><span class="muted small">${b.type === "hub" ? "Main hub" : "Outpost"}</span></div>
      <div class="kv small" style="margin-top:0.4rem">
        <div>People</div><div>${people.length} / ${baseBeds(b)} beds</div>
        <div${tip("Walls, guards and everyone else at the base. Ammo shortages cut it by 30%.")}>Defense</div><div>${Math.round(baseDefense(state, b))}</div>
        ${holdRow(state, b)}
        <div${tip("Noise and light that draw hordes. Workshop operators add 3 each.")}>Heat</div><div>${baseHeat(state, b)}</div>
        <div${tip("Days of food left at today's rate without harvests, and the next harvest (crops ripen in batches)")}>Food</div>${foodCellHtml(state, b)}
        <div${tip("Water per day (in minus out), stock and capacity, days left")}>Water</div>${waterCellHtml(state, b)}
        <div>Building</div><div>${job ? `${BUILDINGS[job.type].name}: ${rate > 0 ? `${Math.ceil((job.hours - job.progress) / rate)}h left` : "paused, no builders"}` : "<span class='muted'>Nothing queued</span>"}</div>
        ${supplySummary(state, b)}
        ${caravanLines(state, b)}
        ${line ? `<div${tip("Share of outpost surplus that reaches the hub, and how long backup takes")}>Supply line</div><div class="${line.strength < 0.6 ? "danger" : "good"}">${Math.round(line.strength * 100)}% · ETA ${isFinite(line.hours) ? line.hours + "h" : "cut off"}</div>` : ""}
      </div>
      <div class="row" style="margin-top:0.5rem"><button class="primary" data-action="openbase" data-id="${b.id}"${tip("Workshops, buildings, construction, armory and vehicles")}>Manage</button><button data-action="center" data-tile="${b.tile}"${tip("Center the map here")}>Locate</button></div>
    </div>`;
  }).join("") + `<div class="small muted">Found outposts by sending a team with 15 scrap and choosing Build outpost.</div>`;
}

// "Can this base hold against a horde of N?" (sim/defences.js): the biggest horde its walls, guards and defence
// buildings stop, and the same with a Wallbreaker leading it.
function holdRow(state, b) {
  const lim = holdLimit(state, b), boss = holdLimit(state, b, 1);
  return `<div${tip(`Against hordes: the walls (tier ${wallTier(b)} of 3) hold back about 15 + 18 per point of wall strength, guards on duty add 2 per point of their combat power, and barricades, a trench, a reinforced gate and floodlights add to that (spike pits thin a horde first). A bigger horde breaks in and the best 8 here fight it on the base map. A ${BOSS_NAMES.horde} cuts the limit to 60% and smashes a defence. Man the defences on a horde warning to put everyone on the walls.`)}>Holds a horde of</div><div>up to ~${lim} <span class="muted">(${boss} with a ${BOSS_NAMES.horde})</span></div>`;
}

function supplySummary(state, b) {
  const runs = supplyRuns(state).filter((j) => j.originId === b.id || j.destId === b.id);
  if (!runs.length) return "";
  const out = runs.filter((j) => jobParty(state, j)).length;
  const stuck = runs.filter((j) => supplyStatus(state, j).key === "blocked").length;
  return `<div${tip("Supply-run jobs from or to this base. Manage them in the Supply runs tab.")}>Supply runs</div><div>${runs.length} job${runs.length === 1 ? "" : "s"}${out ? ` · ${out} on the road` : ""}${stuck ? ` · <span class="danger">${stuck} blocked</span>` : ""}</div>`;
}

function personCard(state, s) {
  const atB = s.location.kind === "base";
  const topSkills = Object.entries(s.skills).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => `<span class="chip">${SKILL_NAMES[k]} ${skill(s, k)}</span>`).join("");
  // Health and mood are only shown for people you are in touch with (the team panel follows the same rule).
  const known = inContact(state, s);
  return `<div class="card surv" data-action="survivor" data-id="${s.id}"${tip("Click for skills, traits and gear")}>
    <div class="spread"><b>${spriteImg(survivorURL(s, state.seed), 1.6)}${s.leader ? "★ " : ""}${esc(s.name)}</b>${atB ? roleSelect(state, s) : ""}</div>
    ${isCaptive(s) ? captiveLine(state, s) : ""}
    ${known ? `<div class="row small"><span style="width:3.5rem" class="muted">Health</span><div style="flex:1">${bar(s.health, s.health < 40 ? "var(--danger)" : "var(--good)")}</div><span style="width:2rem">${n0(s.health)}</span></div>
    ${isHurt(s) && (s.woundInfected || treatButton(state, s)) ? `<div class="row small">${s.woundInfected ? `<span class="chip off"${tip("Heals at half speed at a base and gets worse on the road. Treat with meds.")}>Infected wound</span>` : ""}${treatButton(state, s)}</div>` : ""}
    ${isSick(s) ? `<div class="small">${conditionChips(state, s)}</div>` : ""}
    <div class="row small"${moodTipAttr(state, s)}><span style="width:3.5rem" class="muted">Mood</span><div style="flex:1">${bar(s.mood, "var(--info)")}</div><span style="width:2rem">${n0(s.mood)}</span></div>${moodRiskChip(s) || relChip(state, s) ? `<div class="small">${moodRiskChip(s)}${relChip(state, s)}</div>` : ""}` :
    isCaptive(s) ? "" : s.location.kind === "errand" ? `<div class="small muted">Away on a personal errand: back around day ${s.location.until}.</div>` : `<div class="small muted"${tip("Teams report when they get home, wait for orders, or come into radio range of a radio station.")}>No contact: health and mood unknown until the team reports in.</div>`}
    <div>${topSkills}${s.traits.map((t) => `<span class="chip trait"${tip(TRAITS[t].desc)}>${TRAITS[t].name}</span>`).join("")}</div>
  </div>`;
}

function captiveLine(state, s) {
  const f = factionById(state, s.location.factionId);
  const days = Math.floor((state.hour - s.location.since) / 24);
  return `<div class="small danger"${tip("Get them back: send a team with the Rescue mission to that base, pay a ransom during a trade visit, or raise goodwill until they let them go. The longer they are held, the likelier they escape, change sides, or (with zealots) die.")}>Held by ${esc(f ? f.name : "unknown captors")} at ${esc(tileLabel(state, s.location.tile))} · ${days ? `${days} day${days === 1 ? "" : "s"}` : "since today"}</div>`;
}

function renderPeople(state) {
  const groups = [];
  for (const b of state.bases) {
    const ppl = atBase(state, b.id);
    if (ppl.length) groups.push([b.name, ppl]);
  }
  const away = alive(state).filter((s) => s.location.kind === "party");
  if (away.length) groups.push(["Away on teams", away]);
  const routes = alive(state).filter((s) => s.location.kind === "route");
  if (routes.length) groups.push(["Convoy escorts", routes]);
  const errands = alive(state).filter((s) => s.location.kind === "errand"); // hubevents.js: away a few days
  if (errands.length) groups.push(["Away on personal errands", errands]);
  const held = alive(state).filter(isCaptive);
  if (held.length) groups.push(["Held captive", held]);
  return groups.map(([name, ppl]) => `<h3>${esc(name)} (${ppl.length})</h3>${ppl.map((s) => personCard(state, s)).join("")}`).join("");
}

function renderGroups(state) {
  const known = state.factions.filter((f) => f.known);
  const unknown = state.factions.filter((f) => !f.known && f.alive).length;
  const routes = state.routes.filter((r) => r.active);
  return `${groupsRadioHeader(state)}${groupsDiploHeader(state)}
    ${known.length ? known.map((f) => {
      const a = attitude(f);
      const route = routes.find((r) => r.factionId === f.id);
      return `<div class="card">
        <div class="spread"><b><span class="swatch" style="background:${f.color}"></span>${esc(f.name)}</b>${f.alive ? `<span style="color:${attColor(a)}">${a}</span>` : `<span class="muted">Collapsed</span>`}</div>
        <div class="small muted">${FACTION_TYPES[f.type].label} · about ${f.alive ? Math.round(f.pop / 5) * 5 || f.pop : 0} people · ${f.bases.length} base${f.bases.length === 1 ? "" : "s"}${f.pact ? ` · ${f.pact === "trade" ? "Trade pact" : "Non-aggression pact"}` : ""}</div>
        <div class="row small"><span class="muted" style="width:4.5rem"${tip("-100 to 100. Hostile at -40 or below, friendly at 20+, allied at 70+.")}>Goodwill</span><div style="flex:1">${bar((f.goodwill + 100) / 2, attColor(a))}</div><span>${Math.round(f.goodwill)}</span></div>
        ${f.lootedGear.length ? `<div class="small danger">Seen carrying: ${f.lootedGear.slice(-3).map(esc).join(", ")}</div>` : ""}
        ${groupCardExtras(state, f)}
        ${f.alive ? `<div class="row" style="margin-top:0.35rem">
          <button data-action="center" data-tile="${f.bases[0]}"${tip("Center the map on their main base")}>Locate</button>
          ${canRadio(state, f) ? `<button data-action="rd-open" data-id="${f.id}"${tip("Radio panel: greet, ask for news, ask for a trade caravan, make a deal, call for help, pacts")}>Radio…</button>` : ""}${f.heard ? `<span class="small muted"${tip("You found them by scanning the airwaves")}>heard on the radio</span>` : ""}
          ${f.pact === "trade" && !route ? `<button data-action="routesetup" data-id="${f.id}"${tip("Recurring convoys with an escort you choose")}>Set up trade route</button>` : ""}
        </div>` : ""}
      </div>`;
    }).join("") : `<div class="muted small">You have not found any other groups yet. Send recon teams out.</div>`}
    ${unknown ? `<div class="muted small" style="margin-top:0.5rem">${unknown} group${unknown === 1 ? " is" : "s are"} still out there, unknown.</div>` : ""}
    ${outsidersSection(state)}
    <h3>Trade routes</h3>
    ${routes.length ? routes.map((r) => {
      const f = factionById(state, r.factionId);
      const out = state.parties.some((p) => p.routeId === r.id);
      return `<div class="card small">
        <div class="spread"><b>${esc(f.name)}</b><button data-action="cancelroute" data-id="${r.id}"${tip("Stop the route; escorts return to the hub")}>End route</button></div>
        Send ${r.sendQty} ${r.sendKey} → get ${r.recvQty} ${r.recvKey}, every ${r.interval} days<br>
        ${ESCORTS[r.escort].name} escort: ${r.escortIds.map((id) => survivorById(state, id)).filter((s) => s && s.alive).map(first).join(", ")}<br>
        <span class="muted">${out ? "Convoy on the road" : `Next convoy day ${r.nextDay}`}</span>
      </div>`;
    }).join("") : `<div class="muted small">Sign a trade pact during a trade visit, then set up a route here.</div>`}`;
}

function renderTeams(state, ui) {
  const mine = state.parties.filter((p) => p.owner === "player");
  if (!mine.length) return `<div class="muted small">No teams out. Select a tile on the map and choose an action, or right-click a tile.</div>`;
  return mine.map((p) => {
    const members = partyMembers(state, p);
    const v = partyVehicle(state, p);
    const back = Math.floor((p.departed + p.plannedHours) / 24) + 1;
    // A one-way trip (move, recon, outpost) arrives and stays; other trips come home.
    const oneWay = p.etaBack == null && p.etaOut != null ? (p.planStart ?? p.departed) + p.etaOut : null;
    const noContact = oneWay != null ? `No contact. ${oneWay > state.hour ? "Arrives" : "Should have arrived"} around day ${Math.floor(oneWay / 24) + 1}, ${String(oneWay % 24).padStart(2, "0")}:00.` : `No contact. Expected back around day ${back}.`;
    const armed = startsWhenUnpaused(state, ui, p);
    const waiting = p.phase === "waiting";
    const canOrder = waiting || p.radioLive || p.phase === "task";
    const ost = p.kind !== "convoy" && canOrder ? orderStatus(state, p) : null;
    const sjob = p.routeKind === "supply" ? supplyRunById(state, p.supplyJobId) : null;
    const status = p.routeKind === "supply" ? `<span class="good">${p.phase === "holding" ? `Supply convoy holding at ${esc(baseById(state, p.destBaseId)?.name || "a base")}` : `Supply run (tracked) · ${p.phase === "back" ? "heading home" : `to ${esc(baseById(state, p.destBaseId)?.name || "a base")}`}`}</span>` :
      p.kind === "convoy" ? `<span class="good">Convoy (tracked)</span>` :
      waiting ? `<span class="warn">Waiting for orders at ${esc(tileLabel(state, partyTile(p)))}</span>` :
      armed ? `<span class="armed">${esc(ost ? ost.label : "Order given")} · starts when unpaused</span>` :
      p.phase === "task" ? `<span class="good">${esc(ost.label)} at ${esc(tileLabel(state, partyTile(p)))}${ost.left != null ? ` · ${ost.left}h left` : ""}</span>` :
      p.radioLive ? `<span class="good">📻 Radio contact · ${esc(ost ? ost.label : "on the road")}</span>` : `<span class="muted">${noContact}</span>`;
    const showLive = waiting || p.radioLive || p.kind === "convoy" || p.phase === "task";
    return `<div class="card small ${waiting ? "attn" : ""}">
      <div class="spread"><b>${sjob ? `Supply run: ${esc(jobName(state, sjob))}` : `${MISSIONS[p.mission]?.name || "Team"} → ${esc(tileLabel(state, p.dest))}`}</b>${showLive ? `<button data-action="center" data-tile="${partyTile(p)}"${tip("Center the map on this team")}>Locate</button>` : ""}</div>
      ${members.map(first).join(", ")} · ${v ? esc(isBike(v) ? `on ${vehicleLabel(v)}` : v.name) : "on foot"} · ${STANCES[p.stance]?.name || ""}${p.burden && p.burden.band >= 2 && p.vehicle !== true ? ` · <span class="warn"${tip("Its load slows it down and it eats and drinks more on the move (team panel)")}>${p.burden.band >= 3 ? "Overloaded" : "Heavy"}</span>` : ""}<br>
      ${showLive ? `Food ${n0((p.supplies.food || 0) + (p.supplies.preserved || 0))} · Water ${n0(p.supplies.water)}${isCar(v) ? ` · Fuel ${n0(partyFuel(state, p))} · Vehicle ${Math.round(v.condition)}%` : ""} · Load ${n0(Parties.poolLoad(p))}/${n0(partyCapacity(state, p))} kg<br>` : ""}
      ${status}
      ${canOrder && p.kind !== "convoy" && !commandable(state, p) ? `<div class="small muted"${tip(NO_RADIO)}>No radio contact: it follows its ${p.plan && p.plan.active ? "plan" : "orders"}; new orders through its cards</div>` : ""}
      ${canOrder && p.kind !== "convoy" && commandable(state, p) ? `<div class="row" style="margin-top:0.35rem">
        ${waiting ? `<button class="primary" data-action="orders" data-id="${p.id}"${tip("Choose what the team does here")}>Orders</button>` : ""}
        <button data-action="movemode" data-id="${p.id}"${tip("Then click any tile on the map. The team goes there and waits for orders.")}>${ui.moveParty === p.id ? "Click a tile…" : waiting ? "Move…" : "Redirect…"}</button>
        <button data-action="gohome" data-id="${p.id}"${tip("Head back home now. This drops the team's queue.")}>Return home</button>
      </div>` : ""}
      ${p.kind !== "convoy" ? `<div class="row" style="margin-top:0.35rem">${ost && ost.left ? `<span class="muted" style="flex:1">${esc(ost.label)} · ${armed ? "starts when unpaused" : `${ost.left}h left`}${(p.orders || []).length ? ` · +${p.orders.length} queued` : ""}</span>` : `<span style="flex:1"></span>`}<button class="mini" data-action="xp-open" data-id="${p.id}"${tip("People, gear, supplies, vehicle and the order queue; camp, scavenge, repair and treat")}>Team panel</button></div>` : ""}
      ${sjob ? `<div class="row" style="margin-top:0.35rem">
        ${p.phase === "holding" ? `<button class="mini" data-action="sr-release" data-id="${sjob.id}" data-how="return"${tip("Load the pick-up goods and head back to the home base")}>Come home</button><button class="mini" data-action="sr-release" data-id="${sjob.id}" data-how="disband"${tip("The crew join the base they are parked at; the vehicle parks there. The job is kept as a template.")}>Disband here</button>` : ""}
        ${baseById(state, sjob.originId) ? `<button class="mini" data-action="openbase" data-id="${sjob.originId}" data-tab="convoys"${tip("Open the Supply runs tab of the home base")}>Supply runs…</button>` : `<span class="muted"${tip("The base this run started from was lost. The convoy finishes its trip.")}>home base lost</span>`}
      </div>` : ""}
    </div>`;
  }).join("");
}

// ---------- right panel ----------
// Another group's base on a tile, as far as the player knows: seen there now, seen there in the last report, or
// the main base of a group you know (the Groups tab shows where that is).
function knownGroupBase(state, id, isLive, snap) {
  if (isLive) return state.factions.find((f) => f.alive && f.known && f.bases.includes(id)) || null;
  const seen = snap && snap.factionBase != null ? factionById(state, snap.factionBase) : null;
  if (seen && seen.alive && seen.known) return seen;
  return state.factions.find((f) => f.alive && f.known && f.bases[0] === id) || null;
}

// Mission actions available on a tile, based only on what the player knows: the live view, the last report,
// the pre-war map (where the public sites are; hidden ones once found, sim/discovery.js), markers, and where known groups live. Nothing is offered on open water.
export function tileActions(state, id) {
  const t = state.tiles[id];
  const actions = [];
  if (t.terrain === "water" && !t.bridge) return actions;
  if (state.bases.some((b) => b.tile === id) || !hub(state)) return actions; // no hub (conquest.js exiles): nothing to send from
  const isLive = state.live.has(id);
  const snap = isLive ? null : state.knowledge[id];
  const info = isLive ? { owner: t.owner, loot: t.loot, hordeSize: state.hordes.filter((h) => h.tile === id).reduce((a, h) => a + h.size, 0) } : snap;
  const markers = state.markers.filter((m) => m.tile === id);
  actions.push(["recon", "Send recon"]);
  actions.push(["move", "Send a team here"]);
  actions.push(["sweep", "Survey the area"]);
  // Food from the land (sim/hunting.js): the planner with the Hunting / Fishing trip preset.
  if (gameAbundance(state, id) >= 0.08) actions.push(["move", "Hunting trip", "hunt", "Plan a hunting trip here: go, hunt 8 hours (change it in the plan), come home with the game. Forest and hills are best, autumn the best season; fresh game is heavy and spoils fast."]);
  if (huntInfo(state, id).fishSpot) actions.push(["move", "Fishing trip", "fish", "Plan a fishing trip here: go, fish 8 hours, come home. Needs a fishing rod or net (the hub's goes along)."]);
  // A site nobody has reported on yet is assumed to hold something (the map draws it untouched, too).
  if (info ? info.loot > 0.05 : !!mapLoc(state, id)) actions.push(["scavenge", "Scavenge / raid"]);
  const fb = knownGroupBase(state, id, isLive, snap);
  if (fb) actions.push(["trade", "Trade visit"]);
  if (fb && captivesOf(state, fb.id).length) actions.push(["rescue", "Rescue captives"]);
  if (fb) actions.push(["assault", occupiedAt(state, id) ? "Retake the base" : "Assault their base"]);
  if (!fb && t.terrain !== "water" && (!info || info.owner == null || info.owner === "player")) actions.push(["outpost", "Build outpost"]);
  if (markers.some((m) => m.type === "death")) actions.push(["recover", "Recover bodies"]);
  if (markers.some((m) => m.type === "vehicle")) actions.push(["getvehicle", "Recover vehicle"]);
  if (markers.some((m) => (m.type === "cache" || m.type === "car" || m.type === "camp") && !m.info?.emptied)) actions.push(["investigate", "Investigate find"]);
  if (info && info.hordeSize) actions.push(["cull", "Cull horde"]);
  if (info && info.hive) actions.push(["hive", "Destroy hive"]);
  return actions;
}

export function renderRight(state, ui) {
  const xp = ui.expedition != null && state.parties.find((p) => p.id === ui.expedition);
  if (xp) return renderExpedition(state, ui, xp);
  const id = ui.selected;
  if (id < 0) {
    return `<h2>State of Calder</h2>
      <div class="small hints"><div><b>Click</b> a tile to inspect it · <b>right-click</b> for actions</div>
      <div><b>Drag</b> or <b>W A S D</b> to pan · <b>wheel</b> to zoom · <b>Space</b> run / pause</div>
      <div class="muted">Hover anything for a description.</div>
      <button class="mini" data-action="help-open" data-sec="map"${tip("Help: the map, what the bright, dim and dark tiles mean, the keys")}>? How the map works</button></div>`;
  }
  const t = state.tiles[id];
  const isLive = liveSet(state).has(id); // dev Reveal map shows the true tile here too
  const snap = isLive ? null : state.knowledge[id];
  const here = state.hordes.filter((h) => h.tile === id);
  const liveSite = isLive && state.hiveSites ? state.hiveSites.find((x) => x.tile === id) : null;
  const info = isLive ? { owner: t.owner, infection: t.infection, loot: t.loot, hive: t.hive, site: liveSite ? { biomass: liveSite.biomass, started: liveSite.started != null } : null,
    hordeSize: here.reduce((a, h) => a + h.size, 0), hordeBoss: here.reduce((a, h) => a + (h.bosses || 0), 0) } : snap;
  // The hives you know of (live or reported): this tile's place in their land.
  const knownHives = state.tiles.filter((x) => (liveSet(state).has(x.id) ? x.hive : state.knowledge[x.id] && state.knowledge[x.id].hive)).map((x) => x.id);
  const hz = knownHives.length ? hiveDanger(state, id, knownHives) : { territory: false, red: false };
  const base = state.bases.find((b) => b.tile === id);
  const ownerF = info && typeof info.owner === "number" ? factionById(state, info.owner) : null;
  const walk = estimateTrip(state, { memberIds: [1], dest: id, vehicle: false, stance: "normal" });
  // Loot by band (aiscav.js: rich, some, little, picked clean, against what the site held untouched). Not in view: the
  // band you last saw (or heard of on the radio), with its age: others may have stripped it since.
  const lootCell = (v) => {
    const word = LOOT_BANDS[lootBand(t, v)];
    if (isLive) return `${word} <span class="muted">· now</span>`;
    const at = snap.lootHour > snap.hour ? snap.lootHour : snap.hour, old = state.hour - at >= 72;
    return `<span${old ? ' class="muted"' : ""}>${snap.lootSrc === "radio" && snap.lootHour > snap.hour ? "radio news" : "last seen"} ${ageText(state, { hour: at })}: ${word.toLowerCase()}</span>${old ? `<div class="small muted">May be stripped since: other groups scavenge too</div>` : ""}`;
  };
  const actions = tileActions(state, id);
  const markers = state.markers.filter((m) => m.tile === id);
  const teamsHere = state.parties.filter((p) => p.owner === "player" && contactable(p) && partyTile(p) === id);
  const loc = mapLoc(state, id); // a hidden site nobody has found is bare ground (sim/discovery.js)
  return `
    <h2>${esc(loc ? loc.name : TERRAIN[t.terrain].name)}</h2>
    <div class="small muted">${loc ? LOCATIONS[loc.type].name + " · " : ""}${TERRAIN[t.terrain].name}${t.road ? " · road" : ""}${t.bridge ? " · bridge" : ""}</div>
    ${loc ? `<div class="small muted"${tip("Danger: how many of the dead the site holds on top of its infection (city blocks and big sites are worse, the countryside is quiet). Likely: what searching here tends to turn up.")}>${SITE_ZONES[loc.zone || LOCATIONS[loc.type].cat]?.name || "Site"} · danger ${DANGER_NAMES[siteDanger(loc)].toLowerCase()} · likely ${Object.entries(LOCATIONS[loc.type].loot).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => SUPPLIES[k].name.toLowerCase()).join(", ")}${LOCATIONS[loc.type].gear.length ? ", maybe gear" : ""}</div>` : ""}
    ${ui.moveParty ? `<div class="card attn small" style="margin-top:0.5rem">Move mode: left-click this or another tile to send the team. Esc cancels.</div>` : ""}
    <div class="card" style="margin-top:0.6rem">
      <div class="kv small">
        <div>Intel</div><div>${isLive ? `<span class="good">Live</span>` : snap ? `Last seen ${ageText(state, snap)} (day ${Math.floor(snap.hour / 24) + 1})` : `<span class="muted">None</span>`}</div>
        ${info ? `
        <div>Held by</div><div>${info.owner === "player" ? "You" : ownerF ? `<span style="color:${ownerF.color}">${esc(ownerF.name)}</span> (${attitude(ownerF).toLowerCase()})` : "Nobody"}</div>
        <div${tip("Higher infection means more of the dead, more events, faster Heat")}>Infection</div><div>${Math.round(info.infection * 100)}%</div>
        <div${tip("How much is left to scavenge here, against what it held untouched: rich, some, little, picked clean. Nothing grows back, and other groups strip sites too: what you have not seen lately may be gone.")}>Loot</div><div>${lootCell(info.loot)}</div>
        <div>Horde</div><div>${info.hordeSize ? `<span class="danger"${tip("Score from its size: how tough it is in a fight and how much it adds to a new hive (small about 3, medium 8, large 16)")}>${Math.round(info.hordeSize)}${isLive ? "" : " (then)"} · score ${hordeScore(info.hordeSize)}${info.hordeBoss ? ` · ${BOSS_NAMES.horde}` : ""}</span>` : "None seen"}</div>
        ${info.hive ? `<div${tip(`An infestation hive: it grows hordes, radiates infection over its land and holds the ${BOSS_NAMES.hive}. Destroy every hive to win (Destroy hive mission).`)}>Hive</div><div class="danger">Yes</div>` : ""}
        ${info.site ? `<div${tip(`The dead gather here to build a new hive: it stands once ${HIVE.SITE_BIOMASS} of them have gone into it. Culling the hordes gathered here sets it back.`)}>Hive being built</div><div class="danger">${info.site.started ? "under way" : "gathering"} · ${Math.round(info.site.biomass)}/${HIVE.SITE_BIOMASS} dead</div>` : ""}` : ""}
        ${hz.territory && !info?.hive ? `<div${tip("Land a hive holds: at least 3 danger skulls. On the red-skull ring right around a hive every one of the dead is much tougher (+3 power; +1 elsewhere in its land).")}>Hive land</div><div class="danger">${hz.red ? "Red-skull ground: much tougher dead" : "Yes: tougher dead"}</div>` : ""}
        ${landRows(state, id, teamsHere)}
        <div>From hub</div><div>${walk ? `${walk.tiles} tiles · ~${Math.ceil(walk.hoursOut)}h on foot` : "No route over land"}</div>
      </div>
      ${walk || base ? "" : `<div class="small muted" style="margin-top:0.3rem">${t.terrain === "water" && !t.bridge ? "Open water. Teams cross one tile of it by boat, from a shore (team panel: Boat crossing)." : "Water is in the way. Send a team to the nearest shore, then build a boat there (team panel: Boat crossing, or right-click the far shore)."}</div>`}
    </div>
    ${base ? `<div class="card"><div class="spread"><b>${esc(base.name)}</b><button class="primary" data-action="openbase" data-id="${base.id}">Manage</button></div><div class="small">Your ${base.type === "hub" ? "main hub" : "outpost"}. ${atBase(state, base.id).length} people.${base.captured ? ` Taken from ${esc(base.captured.name)} on day ${base.captured.day}.` : ""}</div></div>` : ""}
    ${t.ruin && !base && (isLive || state.knowledge[id]) ? `<div class="card small"${tip("A base burned to the ground in a raid. A little is left to scavenge, and an outpost here needs only 5 scrap: the rest is salvage.")}><b>Ruins: ${esc(t.ruin.name)}</b><div class="muted">Burned by ${esc(t.ruin.by)} on day ${t.ruin.day}${t.ruin.from && t.ruin.from !== "you" ? ` (${esc(t.ruin.from)}'s base)` : t.ruin.yours ? " (your base)" : ""}.</div></div>` : ""}
    ${occupiedAt(state, id) ? `<div class="card attn small"${tip("A base of yours another group took. Send an Assault their base team (the button below) to take it back: its walls are weakest right after it fell, and the holders patch it up every day.")}><b>${esc(occupiedAt(state, id).name)}: held by others</b><div>${esc(occupiedText(state, occupiedAt(state, id)))}</div></div>` : ""}
    ${markers.length ? `<h3>Markers</h3>${markers.map((m) => `<div class="card small"${tip(MARKER_TYPES[m.type].desc)}><b>${MARKER_TYPES[m.type].glyph} ${esc(m.label)}</b><br>
      <span class="muted">Spotted ${ageText(state, m)}${m.info?.emptied ? " · emptied" : ""}${m.info?.fuel != null ? ` · fuel ${n0(m.info.fuel)}, condition ${Math.round(m.info.condition || 0)}%` : ""}${m.info?.items != null && m.type === "death" ? ` · ${m.info.items} item(s) left then` : ""}</span></div>`).join("")}` : ""}
    ${teamsHere.length ? `<h3>Your teams here</h3>${teamsHere.map((p) => `<div class="card small"><b>${esc(teamName(state, p))}</b><div class="row" style="margin-top:0.3rem">${!commandable(state, p) ? `<span class="small muted"${tip(NO_RADIO)}>No radio contact</span>` : `${p.phase === "waiting" ? `<button class="primary" data-action="orders" data-id="${p.id}">Orders</button>` : ""}<button data-action="movemode" data-id="${p.id}">Move…</button>`}<button data-action="xp-open" data-id="${p.id}"${tip("People, gear, supplies, vehicle and orders")}>Team panel</button></div></div>`).join("")}` : ""}
    ${actions.length ? `<h3>Send a team from the hub</h3><div class="row" style="flex-wrap:wrap">${actions.map(([m, l, pre, tp]) => `<button data-action="plan" data-tile="${id}" data-mission="${m}"${pre ? ` data-preset="${pre}"` : ""}${tip(tp || MISSIONS[m].desc)}>${l}</button>`).join("")}</div>` : ""}`;
}

// Game, fish and your snares on a tile (sim/hunting.js): what the land holds now and what a hunt would bring: the
// team standing here, else the hub's two best hunters.
function landRows(state, id, teamsHere) {
  const t = state.tiles[id];
  if (!t || t.terrain === "water") return "";
  const h = hub(state);
  const p = teamsHere[0] || null;
  const people = p ? Parties.partyMembers(state, p) : h ? atBase(state, h.id).filter((s) => bestHuntWeapon(s, h.stock.ammo || 0)).sort((a, b) => hunterMult(b) - hunterMult(a) || a.id - b.id).slice(0, 2) : [];
  const ammo = p ? Parties.carried(p, "ammo") : h ? h.stock.ammo || 0 : 0;
  // What they could carry home: the team's room now, or the pair less what they would pack (about 12 kg each).
  const room = p ? Parties.cargoRoom(state, p) : Math.max(0, Parties.carryCapacity(state, people, null) - 12 * people.length);
  const info = huntInfo(state, id, { members: people, ammo, hours: HUNT.defHours, room });
  const who = p ? "this team" : people.length ? people.map((s) => esc(shortName(s))).join(" and ") : "";
  const yieldText = info.est ? ` · ~${Math.round(info.est.rations)} food in an ${HUNT.defHours}h hunt (${who})` : people.length || p ? "" : ` · <span class="muted">nobody at the hub has a hunting weapon</span>`;
  const gameTip = `Game here: ${info.word}. The land: ${Math.round(info.abundance * 100)}% (forest and hills best, farmland fair, towns and hive land almost nothing), hunted down to ${Math.round(info.level * 100)}% (it grows back over weeks). The estimate is an average for ${HUNT.defHours} hours from now (season, time of day, the hunters' weapons and skill); luck decides the rest. Gunshots raise Heat and can draw the dead; bows are silent.`;
  let out = `<div${tip(gameTip)}>Game</div><div>${info.word === "plenty" ? `<span class="good">plenty</span>` : info.word}${yieldText}</div>`;
  if (info.fishSpot) {
    const kitPeople = p ? Parties.partyMembers(state, p) : h ? atBase(state, h.id).slice(0, 2) : [];
    const kit = fishKit(kitPeople, p ? p.cargo.gear : (h && h.armory) || []);
    const fe = kit.power ? expectFish(state, kit, id, HUNT.defHours).rations : null;
    out += `<div${tip(`Fish in ${info.fishSpot.name}: ${Math.round(fishLevel(state, id) * 100)}% left (a fished-out spot comes back in a week or two). Needs a fishing rod or net; ice fishing in a freeze needs a crowbar, machete or axe.`)}>Fish</div><div>${gameWord(info.fishSpot.mult * info.fishLevel)} (${info.fishSpot.name})${fe != null ? ` · ~${Math.round(fe)} food in ${HUNT.defHours}h${frozenAt(state) ? " (through the ice)" : ""}` : ` · <span class="muted">no rod or net ${p ? "with the team" : "at the hub"}</span>`}</div>`;
  }
  const line = snareLine(state, id);
  if (line) {
    const since = line.check ?? line.set;
    const e = expectSnare(state, id, since, state.hour);
    out += `<div${tip("Your line of 8 snares. Check it (team order) to collect the catch: game left too long rots, and after 2 days unchecked someone or something may rob or spring the line.")}>Snares</div><div>yours, ${line.check != null ? "checked" : "set"} ${ageText(state, { hour: since })} · ~${Math.round(e.animals)} small game by now</div>`;
  }
  return out;
}

// ---------- legend / map layers ----------
// One short line per layer (hover: a one-line description); what each layer and symbol means is in Help → Map
// layers / Map legend (ui/help.js), behind the "?" button.
const LAYER_TIPS = { hordes: "Hordes, last sightings and hives", infection: "Red wash: how infected the land is (I key)" };
export function renderLegend(view, ui) {
  if (ui.legendCollapsed) return `<button data-action="legendtoggle"${tip("Show the map layers")}>Layers ▸</button>`;
  return `<div class="spread"><b>Layers</b><span class="lgbtns"><button data-action="help-open" data-sec="map-layers" class="mini"${tip("What the layers and map symbols mean (Help)")}>?</button><button data-action="legendtoggle" class="mini"${tip("Fold this box away")}>▾</button></span></div>
    ${Object.entries(LAYERS).map(([k, l]) => `<label class="layer"${tip(LAYER_TIPS[k] || l.desc)}><input type="checkbox" data-action="layer" data-k="${k}" ${view.layers.has(k) ? "checked" : ""}>${swatch(k)}${esc(l.name)}</label>`).join("")}`;
}

// ---------- log ----------
export function renderLog(state) {
  return state.log.slice(0, 80).map((l) => `<div class="k-${l.kind}"><span class="t">D${Math.floor(l.hour / 24) + 1} ${String(l.hour % 24).padStart(2, "0")}:00</span>${esc(l.text)}</div>`).join("");
}

// ---------- modals ----------
// Which window is up, the top layer first: [kind, builder] or null. Esc (main.js) closes them in the same order.
// While a battle is open only the loot screen shows: cards, results and "game over" wait until the battle is
// closed, so nothing covers a fight or its result.
function pickModal(state, ui) {
  if (ui.timelapse) return null; // the timelapse viewer has its own overlay (ui/timelapse.js)
  if (ui.zombieLook) return ["zlook", () => zombieLookModal(ui)];
  if (ui.settings) return ["settings", () => settingsModal(state, ui)]; // ui/settings.js: over everything, a battle included
  if (ui.inv && ui.inv.loot) return ["loot", () => inventoryModal(state, ui)]; // over the battle screen
  if (!ui.started) return ["newrun", () => newRunScreen(state, ui)];
  if (state.combat) return state.gameOver && !state.combat.over ? ["over", () => gameOverScreen(state)] : null;
  // A card's result comes before "game over", so the last thing that happened is not skipped.
  if (ui.cardResult) return ["result", () => `<div class="box"><h1>${esc(ui.cardResult.title)}</h1><div class="result">${esc(ui.cardResult.text || "Done.")}</div><button class="primary" data-action="cardok">Continue</button></div>`];
  if (state.gameOver) return ["over", () => gameOverScreen(state)];
  if (state.cards.length) return ["card", () => cardModal(state, state.cards[0])];
  if (state.engagement && !state.autopilot) return ["search", () => engagementModal(state)]; // on autopilot the governor searches (sim/autopilot.js)
  if (state.trade && !state.autopilot) return ["trade", () => tradeWindow(state, ui)]; // ui/tradewindow.js
  if (ui.diplo) return ["diplo", () => diplomacyModal(state, ui)]; // ui/diplomacy.js: jobs, market board, world affairs, coalition (over the radio panel)
  if (ui.radioWith != null) return ["radio", () => radioModal(state, ui)];
  if (ui.caravanPlan) return ["caravan", () => caravanPlanModal(state, ui)];
  if (ui.planner) return ["planner", () => plannerModal(state, ui)];
  if (ui.routeSetup) return ["route", () => routeModal(state, ui)];
  if (ui.inv) return [`inv:${ui.inv.sid}`, () => inventoryModal(state, ui)]; // closes back to the survivor / base screen under it
  if (ui.survivor) return [`survivor:${ui.survivor}`, () => survivorModal(state, ui)];
  if (ui.memorial) return ["memorial", () => memorialModal(state, ui)]; // ui/relations.js; a name opens the survivor screen over it
  if (ui.baseView) return ["base", () => baseModal(state, ui)];
  if (ui.roster) return ["roster", () => rosterModal(state, ui)]; // ui/roster.js (the survivor and base screens open over it)
  if (ui.diary) return ["diary", () => diaryModal(state, ui)];    // ui/diary.js
  return null;
}
// The planner's line for an assault: the defenders, and a strong warning when the group is not hostile.
function assaultNote(state, tile) {
  const f = state.factions.find((x) => x.alive && x.bases.includes(tile));
  if (!f) return "";
  const force = assaultForce(state, f, tile);
  const warn = assaultWarning(state, f);
  return `<div class="small ${warn ? "danger" : "muted"}" style="margin:-0.3rem 0 0.4rem">⚔ ${esc(f.name)}: about ${force.count} defenders here (defence ×${force.fortified} behind their walls)${f.bases.length === 1 ? ", their last base" : ""}. ${esc(warn)}</div>`;
}

export function renderModal(state, ui) {
  const m = pickModal(state, ui);
  return m ? m[1]() : null;
}
// The kind of window on screen, or null when the map is free (main.js: keys, scroll position).
export function modalKind(state, ui) {
  const m = pickModal(state, ui);
  return m ? m[0] : null;
}

// The new-run setup screen lives in ui/newgame.js (newRunScreen).

function gameOverScreen(state) {
  if (state.victory && state.victoryReason === "alliance") {
    const st = hiveTracker(state).stats;
    const a = goalsProgress(state).alliance;
    return `<div class="box"><h1>${esc(ALLIANCE.NAME)} holds the state</h1>
    <div class="text">Victory by alliance: the coalition holds ${Math.round(a.land.pct * 100)}% of the land (more than half), and ${a.groups ? `every group still standing (${a.groups}) is a member` : "no other group is left standing"}${state.conquest && state.conquest.stats.defeated ? ` (you broke ${state.conquest.stats.defeated} that would not join)` : ""}. ${a.hivesLeft ? `${a.hivesLeft} hive${a.hivesLeft === 1 ? " still stands" : "s still stand"}, but the state is in your hands.` : "No hive is left."} ${alive(state).length} survivors made it to day ${day(state)}; you destroyed ${st.destroyed} hive${st.destroyed === 1 ? "" : "s"}, took ${state.conquest ? state.conquest.stats.taken : 0} base${state.conquest && state.conquest.stats.taken === 1 ? "" : "s"}, saved ${state.stats.peopleSaved} people and repelled ${state.stats.raidsRepelled} raids.</div>
    <div class="row">${state.chronicle ? `<button data-action="tl-open" data-from="end"${tip("Replay the whole game sped up with the fog of war off: the groups' land, the infection, the hives rising and falling, hordes, teams and your holdout")}>Watch the timelapse</button>` : ""}
    <button data-action="keepplaying"${tip("Close this and carry on in the same world")}>Keep playing</button>
    <button class="primary" data-action="restart">New campaign</button></div></div>`;
  }
  if (state.victory) {
    const st = hiveTracker(state).stats;
    return `<div class="box"><h1>Every hive is destroyed</h1>
    <div class="text">The hives are ash. Hordes still drift in from beyond the state's borders, but nothing breeds them here any more. ${alive(state).length} survivors made it to day ${day(state)}; you destroyed ${st.destroyed} hive${st.destroyed === 1 ? "" : "s"}, beat ${st.repelled} break-in${st.repelled === 1 ? "" : "s"}, saved ${state.stats.peopleSaved} people and repelled ${state.stats.raidsRepelled} raids.</div>
    <div class="row">${state.chronicle ? `<button data-action="tl-open" data-from="end"${tip("Replay the whole game sped up with the fog of war off: the groups' land, the infection, the hives rising and falling, hordes, teams and your holdout")}>Watch the timelapse</button>` : ""}
    <button data-action="keepplaying"${tip("Close this and carry on in the same world")}>Keep playing</button>
    <button class="primary" data-action="restart">New campaign</button></div></div>`;
  }
  return `<div class="box"><h1>The holdout has fallen</h1>
    <div class="text">Every survivor is dead. You lasted ${day(state)} days, saved ${state.stats.peopleSaved} people and repelled ${state.stats.raidsRepelled} raids.</div>
    <div class="row">${state.chronicle ? `<button data-action="tl-open" data-from="end"${tip("Replay the whole game sped up with the fog of war off: the groups' land, the infection, hordes, teams, and the rise and fall of your holdout")}>Watch the timelapse</button>` : ""}
    <button class="primary" data-action="restart">New campaign</button></div></div>`;
}

// The game's help, one paragraph per topic, each starting with its bold title (the menu's Help tab splits it into
// topics: ui/help.js).
export function helpText() {
  const k = (t) => `<b>${t}</b>`;
  return `
    <b>Goal:</b> keep your people alive, find the other groups, trade or fight, expand with outposts, and push back the hordes. You <b>win</b> one of two ways: destroy every infestation hive (and no new one being built), or make the <b>Calder Coalition</b> hold more than half the land with every group still standing in it (invite the willing, break the hostile by taking their bases). You lose when the last survivor is dead, gone or lost.<br><br>
    <b>Time:</b> the game starts <b>paused</b>; a banner at the top of the map says so. Press ${k("Space")} or pick a speed (${k("1–4")}) to run the clock. Orders you give while paused are queued and start when you unpause (the banner counts them). Cards and windows (planner, base, help) stop the clock while they are open.<br>
    <b>Seasons and weather:</b> a year is four seasons of 28 days (spring, summer, autumn, winter); a run starts in mid-spring. Next to the clock: season, day of the season, today's weather and the temperature; hover it for what the weather does and the forecast (3 days; 4 with a watchtower, 5 with a radio station; the further out, the less sure). Rain and melting snow leave mud that slows off-road travel (vehicles most); snow cover slows everything, off-road most; storms and blizzards slow everyone a lot, can hurt people on the road and make boat crossings riskier; fog cuts sight by a tile and makes ambushes likelier; heat waves slow walkers. Arrival times in the planner and panels already include the weather hour by hour (the planner shows how many hours it adds). Crops grow only in their seasons and best in mild, moist weather; frost, hard freezes, blizzards, drought, heat and storms can kill them, and wet weather rots ripe ones. Cold and heat can make people outdoors ill, the dead slow down in deep cold, and the map's <i>Weather</i> layer shows snow, rain, fog and heat as a wash over the land.<br>
    <b>Map:</b> left-click a tile to inspect it, right-click for actions, drag or ${k("W A S D")} / arrows to pan, wheel to zoom. Bright tiles are live (around your bases, near a team in radio range); dim tiles show the last report with its age; dark tiles have no intel. Sites show danger as skulls under their name when zoomed in. The map shows the places everyone knew before the fall (towns, cities, roadside sites, landmarks); farms, cabins, lodges and camps off the roads, and crash sites, appear only once your people find them or hear of them. Toggle layers in the map's corner.<br>
    <b>World size:</b> chosen on the new-run screen. Small (48×32) is tight and close: fewer towns, 3–6 groups, the hives a short walk away. Normal (64×42) is the standard state with 5–10 groups. Large (80×52) adds a third city and a second outbreak, 7–14 groups. Huge (100×66) has four cities, three outbreaks and 10–18 groups: trips are long (take vehicles, build outposts), the groups mostly keep to their own corner, but more hives are within reach of your walls. Every size has about the same towns, sites and hives per tile.<br>
    <b>Bases (Manage):</b> roles (farm, scavenge, operate, build, guard, rest, medic, craft), workshop stations with operators, the construction queue, the armory, hand crafting, vehicles (refuel, repair), supply runs and the medical tab. Click a base's name on its screen to rename it. People in a hospital bed do not work.<br>
    <b>Food and the winter:</b> crops ripen in batches (Farming tab), and nothing grows outdoors in winter: the first spring harvest comes weeks into spring, so the food for the hungry gap has to be grown and stored in summer and autumn. Sow kale, winter roots and winter wheat in autumn (they stand the frost); wheat, winter wheat and dry beans go into the <b>preserved</b> stock. Fresh food needs <b>storage room</b>: the hub has a small cellar (200), an outpost a pantry (40); root cellars (+200), a storehouse (+150) and a cold store (+150, best in winter) add more. Food in storage spoils slowly; food above the room is stored outside and spoils fast (more in heat and rain). Preserved food (jarred, dried, canned, grain) barely spoils, needs no room, is eaten once the fresh food is gone, weighs less on a trip and sells well: a <b>Preserving kitchen</b> (operator, water, scrap and empty jars) and <b>Drying racks</b> (no operator) make it from surplus. Jars are found in kitchens, shops and farms; most come back when the food in them is eaten. The Farming tab's <i>Winter outlook</i> says whether the food will last to the first spring harvest.<br>
    <b>Water and the summer:</b> everyone at a base drinks 1 water a day in spring and autumn, <b>1.3 in summer</b>, 0.9 in winter and <b>at least 1.6 on a hot day</b> (a heat wave or 30 °C and up; the forecast marks them); prisoners and guests too, and teams in the field drink their rations times the same (the trip planner counts every hour at its own day's rate). Crops need watering on dry days, a fifth more in summer. In: the hub's well 12 a day, an outpost's spring 3, a river or lake next to the base 3, a Well +6 (less in a dry spell), a Rain catcher +2 per unit of rain, a water filter +3 (it clogs after about 20 days); the tanks hold 80 at the hub, 40 at an outpost, +150 a Cistern. From spring on the Farming tab's <i>Summer water</i> line says whether the water holds through an average summer day and a heat wave, and what would close a gap; a week before summer you are warned if it will not. A team on a tile next to a river or lake can <b>Fetch water</b> (2h: every free container filled, 1 kg a unit; a team panel order or a plan step). Thirst kills faster than hunger: build wells and filters before summer, keep the tanks full, and do not take in more people than the summer wells can carry.<br>
    <b>Hunting, fishing and snares:</b> right-click a tile for a <i>Hunting trip</i> or <i>Fishing trip</i> (the planner's presets: go, hunt or fish 8 hours, come home), or give a team on the spot <i>Hunt</i>, <i>Fish</i> or <i>Set snares</i> (team panel, Land). The tile panel shows the game there (plenty, some, scarce) and what an 8-hour hunt should bring. Forest and hills are the best hunting, farmland fair, towns, cities and hive land almost nothing; autumn is the best season, and snow shows tracks in winter. A hunting rifle or a bow is best (a pistol is poor; no weapon, no hunt: set snares); every gunshot costs ammo, adds Heat and can draw the dead nearby, bows and crossbows are silent. The land runs out of game as you hunt it and grows back over weeks. <b>Snares</b> (snare wire, or 2 scrap) catch a rabbit a day or so: check them within 2–3 days, before the catch rots or someone takes it. <b>Fishing</b> needs a rod or a net, on a river bank; in a freeze, a crowbar, machete or axe to cut the ice (half the catch). Fresh game and fish weigh twice what packed food does (a deer on foot is a slow walk home; a car carries it all) and spoil fast: the team eats it first, and at home drying racks and a <b>Hunting cabin</b> smoke it. A Hunting cabin (any base with game land around it) also lets up to 2 people on the <i>Hunt</i> job hunt the land within 2 tiles every day; a base on a river can put people with a rod or net on the <i>Fish</i> job.<br>
    <b>Sending a team:</b> select a tile, pick a mission, then crew, vehicle or on foot, stance and supplies. Everything has a weight: what people wear plus the packed supplies and found cargo, shared out among the team (max load 40 kg each, 28 with a Bad Back, more with a pack or Packrat). Load bands slow a team on foot and make it eat and drink more on the move: Light up to 18 kg, Medium up to 28 (−10% pace, +15% rations), Heavy up to 38 (−25%, +35%), Overloaded above (−45%, +60%). Scouting eases it (up to half at 20). A car takes the whole load off its riders (it burns more fuel the fuller it is); bikes (one each) carry 15 kg on the rack and take 55% of the rest away. Teams report only when they get home, unless a radio station is built and they are in range.<br>
    <b>Team panel:</b> click a team on the map, in the Teams tab or in the Running orders list. It shows people, gear, supplies, the vehicle and the order queue. Orders: move, return home, scavenge, look around (2h), survey the area (12, 24 or 48h), camp, roadside repair, treat someone with carried meds (1h), field crafting, boat crossings. A waiting team starts an order at once; a moving team (or queue mode) adds it to its queue. When the queue is empty the team reports in with a card.<br>
    <b>Survey and rumours:</b> the <b>Survey</b> mission (planner, right-click any tile, or a team's panel) sweeps the land around a tile (2–4 tiles, 6–48 hours) for places the old maps never showed: farms, cabins, hunting lodges, campgrounds, ranger stations and wrecks off the roads, and caches, wrecked cars and camps. The team moves from spot to spot inside the circle and ends back at its centre; the map shows the circle and its path, the team panel the hours and what it found. Each hour its odds of spotting a hidden place come from the best Scouting (and a little from each extra person), the ground (open farmland easy, forest and hills hard), how far the place is from where the team stands, daylight and the weather (night and fog are bad: a flashlight, night vision or a thermal help), how it travels (a car covers ground but sees little off the road, bikes in between) and its stance (stealthy is careful but covers less). The planner shows the odds as a word (good / fair / poor) with the reasons. It eats at the moving rate, builds Heat at half the rate of standing still, meets what the roads meet on every tile it walks into, and wears the vehicle; on hive land the tougher dead notice it. <b>Optics</b> carried by anyone on a team help: binoculars (the team sees a tile further, ×1.25 odds and a tile more reach), a pocket monocular (×1.1), a spotting scope (×1.6 and two tiles, only while it stays put: surveys, looking around, camps), a thermal monocular (no night or fog penalty; in the off hand it sees in the dark in battle), and a telescope kept in a base's armory (+1 tile of view, +2 with a watchtower). <b>Rumours:</b> radio chatter, travellers, merchants and other groups' news sometimes speak of a place nobody has found ("a hunting lodge somewhere north of Dunmore"): a dashed circle on the map that holds it for 20 days. A survey whose centre is inside it has three times the odds of finding that place.<br>
    <b>Raids (scavenging a site):</b> opens a tactical map of the place. Move next to containers and search them (${k("S")}). Guards and the dead are unaware until they see or hear you; Heat rises every turn and with noise, and each stage brings more dead. Leave from a green extraction zone (${k("X")}); a vehicle waits in its own zone. Anyone left behind is lost.<br>
    <b>Battles:</b> each unit has two actions a turn. Click a tile to move, an enemy to shoot; ${k("F")} shoot, ${k("E")} melee, ${k("O")} overwatch, ${k("H")} hunker, ${k("M")} meds, ${k("R")} retreat (one unit, from the green evac strip), ${k("Tab")} or ${k("1–9")} select, ${k("Space")} or Enter ends the turn, Esc or right-click cancels. After a win, loot the bodies: take things one by one or everything that fits.<br>
    <b>Sounding the retreat:</b> when a fight goes bad, <i>Sound the retreat</i> (${k("Shift+R")}) pulls everyone out at once. First it shows each person's chance to get away: safe on the strip; elsewhere 100% minus 3 a tile to the strip, 25 for each enemy next to them, 6 for each shooter that sees them and 4 for each of the dead close behind (at most 35), up to 30 for wounds and 2 a point of armor, plus Scouting and 10 at night (5–95%). A downed teammate next to someone is carried out (slower: the carrier's odds drop); you can leave them instead. The caught take a blow from each enemy next to them and get out hurt, unless it puts them down: then they are left behind. A downed teammate dragged onto the strip goes with the last one out. When the AI plays a battle on the map for you (the autopilot's hive assaults), it sounds the retreat itself once the fight is clearly lost.<br>
    <b>Defending your base:</b> a horde that breaks in, raiders or outsiders you fight in person and a group come to free its people are fought in three tiers on two maps. <i>Tier 1, the walls</i> (only with walls built): your people stand on the <b>walkway</b> behind the wall (height 1, up the ladders) and on the <b>watchtower's</b> two towers (height 2) and shoot down over it; the dead claw at the wall sections and the gate and raiders batter them (each has hit points: a section 40 + 12 a point of wall strength, the gate 100, 180 reinforced; a bar under it shows the damage), and a section battered down is a new breach. Whoever stands in the gate or a breach holds it. Once 3 of them (or a quarter of those left, if more) are inside the wall, or any are and nobody holds the wall line, the fight moves to the second map; you can also <i>Fall back to the yard</i> yourself (${k("Shift+R")} on the wall map), and then they move first. <i>Tier 2, the yard</i>: the map is your base as built (the same base always looks the same): the main house, bunkhouses, workshop, infirmary, storehouse and the rest as buildings, barricades, sandbags, wells and barrels as cover, the gate and breaches where they were. Everyone carries over (health, ammo, gear, roughly where they stood), the attackers inside the wall come with them and those still outside come in through the openings a few a turn; a short redeploy lets you place your people near where they were (or skip it: Options, or the button on the redeploy). <i>Tier 3, the last stand</i>: buildings have barred doors and windows with hit points that the attackers must batter in, full cover inside and half cover at the windows; the bigger ones have an <b>upper floor</b> up the stairs and flat roofs are climbed by ladders (height 1). The yard is lost once 1.5× as many attackers as defenders still outside the buildings stand in it; if everyone falls the base is overrun. The green strip is the back gate: sounding the retreat there abandons the base. <b>Height</b>: +2 sight a level, +5 aim a level at anything lower (at most +10), half cover against shooters below; climbing costs 1 move a level (the dead 2) and only on a ladder, stairs or a tower. A base without walls starts on the yard map. Fights resolved by the numbers count the tiers too: walls, a watchtower, the reinforced gate and the trench for holding at the wall; barricades, sandbags, wire and spike pits for the yard; the buildings for a last stand. A horde warning says how many would break in and whether the yard or the buildings should hold them.<br>
    <b>Fog of war:</b> in every battle you see only what your people see: their sight (13 tiles; at night 7, 9 with a flashlight, 13 with night vision or a thermal), +2 a level of height, + binoculars or a scope (+3 by day; at night only a thermal, +2); walls, buildings and trees block it. Floodlit ground at night and a flare's light are seen out to the daylight range. Enemies out of sight are not drawn and cannot be shot; a faded ghost marks where one was last seen.<br>
    <b>Boats:</b> water blocks travel. A team on a shore can build a one-use boat and cross one water tile (team panel, or right-click the far shore). It costs scrap and hours; a vehicle needs a raft or is left on the shore.<br>
    <b>Supply runs and trade routes:</b> supply runs are convoy jobs between your own bases (a base's Supply runs tab): crew, vehicle, goods each way, once or on a schedule. Trade routes are repeating convoys to a group you have a trade pact with (Groups tab); the terms must be worth it to them at their prices.<br>
    <b>Medical:</b> everyone at a base heals slowly. Each night automatic care treats the worst off first (wounds below 70 health or infected, and illnesses) while meds stay above the base's reserve and medics have time. One treatment per wound or illness a day; each takes a medic's time (3 + Medicine/4 a day per Medic, surgery most of a day). Hospitals (infirmary → field hospital → clinic → trauma hospital) need medics and give beds to people below the admit line (Medical tab, default 70) or badly hurt or ill; with too few medics they run as a lower tier. On a team, treating is a 1-hour order and needs contact. Wounds below 40 health can get infected.<br>
    <b>Crafting:</b> the Crafting tab queues makeshift weapons, armor, tools and dressings; people on the Craft role do the work. Makeshift gear wears out. Teams can make the simplest things in the field.<br>
    <b>Orders, power and stewards:</b> each workshop station (Workshops tab) takes a standing order: Forever, Until stock reaches N, Keep at least N of an input, or Off, and what its operator does while it waits. The Crafting tab keeps N of an item in the armory at a minimum quality. A generator (needs an operator and 2 fuel a day) powers the cold store, radio, floodlights, machine shop and preserving kitchen; an ethanol still makes fuel from surplus food. <i>Hand to a steward</i> (Overview tab) lets the governor run a base, area by area; pinned people are left alone, and Take over hands it back as it is.<br>
    <b>Inventory:</b> every survivor has hands, off hand, head, body, arms, legs, a pack, and four pockets. Open it from a survivor's screen, the Armory tab or the team panel: click an item, then where it should go (or drag it). Treats (chocolate, coffee, cigarettes, vodka) are used up with <i>Use</i> for a mood boost at a price.<br>
    <b>What you find:</b> sites hold what fits them (a hunting lodge rifles, bows and camo; a police station batons, riot gear and a carbine; a hardware store crowbars, sledgehammers and barbed wire; houses jewelry and keepsakes). Valuables (jewelry, smokes, liquor, gadgets, collectibles, household goods) are only for trade. Comforts lift the mood of everyone around them (cards, a harmonica, a guitar) or of whoever carries them (family photos). Camp kit (camo netting, a ghillie wrap, rag-wrapped boots, a scent mask, a smokeless stove) cuts a team's Heat while it camps or searches. Barbed wire, sandbags, bear traps and a tripwire alarm in a base's armory help hold off hordes. Pipe bombs, Molotovs, flares and smoke grenades are thrown in battle like bottles.<br>
    <b>Vehicles:</b> burn fuel, wear down, and break down more when worn. One left behind is marked on the map: bring fuel (and a part if it is badly damaged) to recover it.<br>
    <b>Groups:</b> neutral groups turn hostile if you crowd them. Radio contact, gifts and trade keep them steady; pacts stop raids and open trade routes. Hostile groups raid and take captives (rescue, ransom or goodwill gets them back). Aggressive groups grow: they push new bases out toward you and toward rich ground, take over the land of groups they break, a new gang moves in when the state runs short of hostile ones, and raider bands from outside that have looted enough may dig in and become a gang at any time. A group down to 3 people breaks up.<br>
    <b>Raids on your bases:</b> a hostile group within 30 tiles of one of its bases comes for you more often the richer you are, the more land you hold, the bigger it is and the more raids of its you have beaten (each one you beat makes its next raid 25% bigger, up to double). Its scouts size a raid to your defence with everyone at a post, so <i>Prepare defenses</i> usually holds, but not if your fighters are away when they arrive. Building and repairs stop while a base is on alert. A strong defence drives them off within hours; the longer they stay at the walls, and the worse it goes (a break-in, an overrun), the more they smash: walls and defences first, then the buildings inside. Broken buildings do nothing until repaired (the base's Repairs tab, or the card after the raid); damaged walls hold less. Tribute turns a raid back, but an aggressive group's goodwill from it fades again.<br>
    <b>Diplomacy:</b> groups post jobs (Groups tab → Jobs; accepted jobs are tagged on the map and listed in the planner), fight wars and sign pacts with each other (World affairs: broker a ceasefire or join a side), and show what they want and have spare (Market board). Invite groups that trust you into the Calder Coalition: hold over half the land with every group left standing in it, and the coalition wins (hives or not). Land: within 9 tiles of your hub and of every base you took from a group, 7 of an outpost (8 with walls) or a member's base (on Normal; more on bigger maps).<br>
    <b>Conquest:</b> <i>Assault their base</i> (right-click a group's base) is a battle against its defenders behind their walls. Win and the base is your outpost, with its land and part of its stores; some defenders join you or are taken prisoner, and a group that loses its last base is finished. Attacking a group that is not hostile ends your pact, costs 30 goodwill and angers its friends and pact partners; every base you take raises your <i>infamy</i>, and peaceful groups grow wary of a conqueror (they want more goodwill before joining). Groups can take <i>your</i> bases too: a raid that overruns a base may keep it (or, for the most violent gangs, burn it to the ground: the raid warning says so; a ruin is cheap to rebuild on), and your people there walk to your nearest base. On the raid warning you can <i>Retreat</i> instead (everyone leaves with what they can carry; the raiders take it without a fight). A lost base keeps its damage: take it back soon, before they repair the walls. Lose the hub and your nearest base becomes the hub; with no base left, your people are a team on the road that must build a new base or take one back.<br>
    <b>Radio:</b> a radio station reaches 8 tiles; a radio relay at an outpost (no operator, 1 part every 10 days) adds 6 tiles when a station or another linked relay is in range, so relays chain coverage outward (dashed circles on the map; red = not linked or off the air). Groups within reach (their radios add 4 tiles) can be called from the Groups tab (Radio…): greet, ask for news, ask for a trade caravan, make a deal ("we want 20 meds, paying 60 ammo"), call for help, pacts. <i>Scan the airwaves</i> finds groups in reach you have not met. Groups call you too, with offers and requests.<br>
    <b>Trade window:</b> two columns, yours and theirs: every supply with steppers, every item one by one. Nothing has a fixed price: each group values things its own way. Its kind matters (the military prize rifles and electronics, raiders liquor, cigarettes and gold, communes seeds, books and coffee, fortresses scrap and parts, traders pay a little over the odds for everything but sell dear; zealots will not touch liquor, drugs or cigarettes), so does its state (at war: weapons, ammo, armor and meds; hordes at its walls or raided lately: weapons and defences; sickness: meds; starving: food, and gold is worth little to it; winter: fuel and food; rich groups pay well for fine things) and how much it already has (supplies by its stock, items by the spare ones on its shelf). An item's condition and uses left count too. ▲ marks a good they want more than usual, ▼ one they care little for, ✕ one they refuse, each with the reason; outside a trade an item shows only a rough worth (junk, cheap, decent, valuable, rare). Buying where something is cheap and selling where it is wanted pays, but each sale fills their need a little. Valuables (rings, cigarettes, coffee, batteries…) are good for nothing but trade: light, and prized by the right buyer. They pay you less than they charge (Speech and goodwill narrow the gap); a deal goes through when it is fair for them. <i>Balance with</i> ammo, scrap or food fills the gap. Intel: buy a report of the area (only those tiles lose their fog) or horde sightings, or sell your own maps.<br>
    <b>Outsiders:</b> people from beyond the state cross the border now and then and leave again: raider bands (from about day 20, more often later: they go for whatever is weakly defended; pay, talk, fight or avoid them, or pay them to leave over the radio), merchant caravans (rare goods: fuel, meds, manuals, books, good gear; invite them over the radio and trade when they stop at your base) and travellers (news, maps, people who want to join or need shelter). The Groups tab lists the ones you know of.<br>
    <b>Caravans:</b> a group's caravan comes to your base for a radio deal and stays a day (Bases tab: Trade). You can attack it for its goods, but the group turns hostile and raids you. Your own trade caravans (Groups tab: New trade caravan…) visit a list of destinations; at each stop: trade, unload, stay a day, go on, or return home.<br>
    <b>Hives and hordes:</b> infestation hives gain resources every day, more when other hives stand within 5 tiles (alone 1, two together 3 each, three 6 each, up to 12), and spend them on hordes (small 10–25 of the dead for 3, medium 50–80 for 8, large 100–200 for 15) and, for 40, on a <b>Wallbreaker</b> (from day 200, at most one every 90 days per hive): a brute that leads a horde and smashes defences. Every 120–180 days the hives pick a spot for a new hive: hives within 10 tiles send hordes there, and once the gathered hordes reach a score of 30 they start turning into a hive, which stands when 1,000 of the dead have gone into it, at most 40 a day (about four weeks from the first gathering: time to strike). Hordes move at most 2 tiles a day (slower in deep cold), merge when they meet and split up; a horde's score (from its size) is how tough it is. You see them only near your bases (a watchtower sees further), with teams in radio range, or when a team reports. A hive holds the land within 4 tiles (at least 3 skulls there) and the ring right around it has red skulls: the dead there are much tougher. It radiates infection; destroying it lets the infection fade. Destroy a hive with the <b>Destroy hive</b> mission: a hard battle against its brood and the <b>Broodmother</b>. Hordes also come in from beyond the border every week or so, so the state is never quite safe.<br>
    <b>Defending against hordes:</b> a base's walls hold back a horde up to a limit (the base panel shows "Holds a horde of"); guards and the defence buildings (barricades, spike pits, trench, reinforced gate, floodlights) raise it. A bigger horde breaks in and the best 8 there fight it on the base map, with the barricades, pits and trench on it. Lose and the base is overrun: people hurt or killed, stores spoiled, an outpost lost. When lookouts see a horde coming you get a warning card: man the defences, or burn a decoy fire.<br>
    <b>Saving:</b> ${k("⚙ Menu")} in the top bar (or ${k("Esc")} with nothing open; ${k("⚙ Menu")} in a battle's panel) opens the menu: <i>Save</i>, <i>Load</i>, <i>Save and exit</i> (back to the new-run screen, where <i>Continue</i> picks the latest save up again), <i>New campaign</i>, save files (<i>Export</i>, <i>Save to file</i>, <i>Load from file</i>) and the options (autosave every day or few days at dawn, confirmations, pause when the window loses focus, UI size, the battle's end-turn question, zombie look, the keys). Saves are kept in this browser, compressed: up to 12 named saves plus the autosave, which also saves when a hive assault starts and when the run ends. A save holds everything, a battle under way included; a card waiting for an answer cannot be saved, so answer it first (the autosave waits for that too). Loading pauses the game.<br>
    <b>Dev tools</b> (${k("`")} key or the Dev button): reveal the map, infection overlay, autopilot (${k("Shift+P")}: an AI governor plays for you), fast forward 60× / 300× / 1200×, show FPS, and the timelapse so far.<br>
    <b>Keys on the map:</b> ${k("Space")} pause / run · ${k("1–4")} speed · ${k("W A S D")} / arrows pan · ${k("H")} hub · ${k("I")} infection overlay · ${k("B")} / ${k("P")} / ${k("G")} / ${k("T")} the Bases / People / Groups / Teams tab · ${k("Tab")} or ${k("N")} next team waiting for orders (Shift+Tab back) · ${k("F1–F9")} jump to your bases · ${k("Ctrl+1–9")} (or ${k("Alt+1–9")}) save a camera spot, ${k("Shift+1–9")} go back to it · ${k("J")} diary · ${k("R")} roster · ${k("Shift+P")} autopilot (dev) · ${k("Esc")} closes the top window, then move mode, then the team panel, and with nothing open shows the menu.<br>
    <b>Alerts</b> on the right of the map list what needs you now (a team waiting, food or water running low, an idle station, a horde near a base, a likely break-in, someone sick and untreated or about to leave, a building or plan finished, a caravan in). Click one to go there; 💤 hides it for a day, ✕ until it clears. The log under the map has filters (kinds of line, 🤖 autopilot notes, one base) and its names and places are links; the <b>Diary</b> keeps every line of the run, day by day.`;
}

function cardModal(state, card) {
  if (card.kind === "conflict" && card.conflict) return conflictModal(state, card);
  if (card.recruit) return recruitModal(state, card); // who asks to join, with beds, food and water (people.js)
  return `<div class="box">
    <h1>${esc(card.title)}</h1>
    ${card.where ? `<div class="where">Near ${esc(card.where)} · Day ${day(state)} ${clock(state)}</div>` : ""}
    <div class="text">${esc(card.text)}</div>
    <div class="choices">${card.choices.map((c, i) => {
      const dis = typeof c.disabled === "function" ? c.disabled(state) : c.disabled;
      return `<button data-action="choice" data-i="${i}" ${dis ? "disabled" : ""}${tip(c.hint)}>${esc(c.label)}${c.hint ? `<span class="hint">${esc(c.hint)}</span>` : ""}</button>`;
    }).join("")}</div></div>`;
}

// Conflict approach panel: who they are, how many, your team, and odds on every option.
function conflictModal(state, card) {
  const c = card.conflict;
  const v = conflictView(state, c);
  const f = v.faction;
  const named = f && v.identified;
  const total = Math.max(1, v.myStrength + v.theirStrength);
  const share = Math.round((v.myStrength / total) * 100);
  const them = `<div class="card small">
      <div class="spread"><b>${f ? `<span class="swatch" style="background:${named ? f.color : "#777"}"></span>${esc(named ? f.name : "Unknown group")}` : "The dead"}</b>
        ${f && named ? `<span style="color:${attColor(v.attitude)}"${tip("-100 to 100. Hostile at -40 or below, friendly at 20+, allied at 70+.")}>${v.attitude} · ${Math.round(f.goodwill)}</span>` : ""}</div>
      <div class="kv" style="margin-top:0.3rem">
        <div>Who</div><div>${named || !f ? esc(v.typeLabel) : "Not sure yet. Watching them would tell you"}${f && named && f.pact ? ` · ${f.pact === "trade" ? "trade pact" : "non-aggression pact"}` : ""}</div>
        <div${tip(c.exact ? "Counted while watching them" : "A rough estimate. Watching them gives the exact number")}>Numbers</div><div>${c.exact ? "" : "about "}${v.countText} ${c.enemy.kind === "zombies" ? "infected" : "armed"}</div>
        <div${tip("Rough fighting strength: number × strength each")}>Their strength</div><div>~${Math.round(v.theirStrength)} (${n1(c.enemy.power)} each)</div>
        ${v.victim ? `<div>Victims</div><div><span class="swatch" style="background:${v.victim.color}"></span>${esc(v.victim.name)} (${attitude(v.victim).toLowerCase()} to you)</div>` : ""}
        ${v.other ? `<div>Fighting</div><div><span class="swatch" style="background:${v.other.color}"></span>${esc(v.other.name)} (${attitude(v.other).toLowerCase()} to you)</div>` : ""}
        ${v.held.length ? `<div>Your people</div><div class="danger">${v.held.map(first).join(", ")}</div>` : ""}
      </div></div>`;
  const you = v.party ? `<div class="card small">
      ${v.members.map((m) => `<div class="row"><span style="width:6rem">${first(m)}</span><div style="flex:1">${bar(m.health, m.health < 40 ? "var(--danger)" : "var(--good)")}</div><span class="muted" style="width:3.2rem;text-align:right"${tip("Combat power")}>⚔ ${combatPower(m).toFixed(1)}</span></div>`).join("")}
      <div class="kv" style="margin-top:0.3rem">
        <div>Strength</div><div>${Math.round(v.myStrength)}</div>
        <div>Ammo</div><div class="${v.ammo < v.members.length * 3 ? "danger" : ""}">${n0(v.ammo)}${v.ammo < v.members.length * 3 ? " (low: fights go worse)" : ""}</div>
        <div>Transport</div><div>${esc(v.vehicle)}</div>
      </div>
      <div style="margin-top:0.3rem"><span class="chip">Stealth ${v.skills.stealth}</span><span class="chip">Speech ${v.skills.speech}</span><span class="chip">Scouting ${v.skills.scouting}</span></div>
    </div>` : `<div class="muted small">No team.</div>`;
  return `<div class="box wide">
    <h1>${esc(card.title)}</h1>
    ${card.where ? `<div class="where">Near ${esc(card.where)} · Day ${day(state)} ${clock(state)} · <span class="${c.mode === "forced" ? "danger" : c.mode === "observed" ? "good" : "warn"}">${esc(v.modeText)}</span></div>` : ""}
    <div class="text">${esc(card.text)}</div>
    <div class="grid2">
      <div><h3>Them</h3>${them}</div>
      <div><h3>Your team</h3>${you}</div>
    </div>
    <div class="row small" style="margin:0.2rem 0 0.6rem"${tip("Your strength against theirs. Ambushes, cover and luck can swing a fight either way.")}><span class="muted" style="width:6rem">Balance</span><div style="flex:1">${bar(share, share >= 55 ? "var(--good)" : share >= 40 ? "#e8a33d" : "var(--danger)")}</div><span style="width:5.5rem;text-align:right">you ${share}%</span></div>
    <div class="choices">${card.choices.map((ch, i) => {
      const dis = typeof ch.disabled === "function" ? ch.disabled(state) : ch.disabled;
      return `<button data-action="choice" data-i="${i}" ${dis ? "disabled" : ""}${tip(ch.hint)}>${esc(ch.label)}${ch.hint ? `<span class="hint">${esc(ch.hint)}</span>` : ""}</button>`;
    }).join("")}</div></div>`;
}

// The vehicle the planner means: a car, or the hub's bikes (one for each person on the crew).
export function plannerVehicle(state, pl) {
  const v = pl.vehicleId ? state.vehicles.find((x) => x.id === pl.vehicleId) : null;
  return isBike(v) ? { ...v, count: Math.max(1, pl.crew.size || 0) } : v;
}
// The planner's load: packed supplies against what the crew can carry on top of what they wear (sim/load.js), plus
// the bikes' racks or the car. The same carryCapacity the sim checks at launch; t = everyone's load and band.
export function plannerLoad(state, pl) {
  const members = [...pl.crew].map((id) => survivorById(state, id)).filter(Boolean);
  const v = plannerVehicle(state, pl);
  const cap = carryCapacity(state, members, v);
  const packed = {};
  for (const [k, q] of Object.entries(pl.supplies || {})) if (SUPPLIES[k] && q > 0) packed[k] = q;
  const load = supplyLoad(packed);
  const over = members.length > 0 && load > cap + 1e-9;
  const t = members.length ? teamLoad(members, load, v) : null;
  return { cap, load, over, t, worn: t ? t.worn : 0, why: over ? `Too heavy: the packed supplies weigh ${n1(load)} kg, the crew${v ? ` and the ${vehicleLabel(v)}` : ""} can carry ${n1(cap)} kg on top of what they wear. Pack less${v ? "" : ", take more people, bikes or a vehicle"}.` : "" };
}

function plannerModal(state, ui) {
  const pl = ui.planner;
  const h = hub(state);
  if (!h) return `<div class="box"><h1>No base to send a team from</h1><div class="text">You have no base left. Your people on the road can build one (Build outpost, with 15 scrap: it becomes your hub) or take one back (Assault their base) from their orders.</div><div class="row"><button class="primary" data-action="pl-cancel">Close</button></div></div>`;
  const crewPool = atBase(state, h.id);
  const ids = [...pl.crew];
  const v = plannerVehicle(state, pl);
  const est = estimateTrip(state, { memberIds: ids.length ? ids : [0], dest: pl.dest, vehicle: travelMode(v), v, stance: pl.stance, fuel: isCar(v) ? v.fuel + (pl.supplies.fuel || 0) : 0, supplies: pl.supplies });
  // The PLAN section (ui/plan.js): with steps, food, water and fuel are checked against the whole plan.
  const pe = est && pl.mission !== "outpost" ? planAutofill(state, pl) : null;
  const need = pe || est, needFor = pe ? "for the whole plan" : "for the round trip";
  const members = ids.map((id) => survivorById(state, id)).filter(Boolean);
  const at = (hr) => `day ${Math.floor(hr / 24) + 1}, ${String(hr % 24).padStart(2, "0")}:00`;
  const stays = (Parties.STAY_MISSIONS || ["move", "recon", "outpost"]).includes(pl.mission); // waits there for orders (or stays)
  const carry = plannerLoad(state, pl);
  // Why this mission cannot go to this tile at all (parties.js checks the same at launch).
  const problem = Parties.missionProblem ? Parties.missionProblem(state, pl.dest, pl.mission) : null;
  const showKeys = ["food", "preserved", "water", "fuel", "meds", "ammo", "parts", "scrap"];
  const warn = [];
  if (est) {
    // Preserved food (storage.js) is a ration like food, and lighter.
    const rations = (pl.supplies.food || 0) + (pl.supplies.preserved || 0);
    if (rations < need.food) warn.push(`Food: packing ${rations}${pl.supplies.preserved ? ` (${pl.supplies.preserved} preserved)` : ""}, need about ${need.food} ${needFor}`);
    if ((pl.supplies.water || 0) < need.water) warn.push(`Water: packing ${pl.supplies.water || 0}, need about ${need.water} ${needFor}`);
    if (isCar(v) && v.fuel + (pl.supplies.fuel || 0) < need.fuel) warn.push(`Fuel: tank ${n0(v.fuel)} + cans ${pl.supplies.fuel || 0}, need about ${need.fuel} ${needFor}`);
  }
  if (isBike(v) && bikesAtBase(state, h.id) < ids.length) warn.push(`Bikes: ${ids.length} people, ${bikesAtBase(state, h.id)} bikes at the hub (one each)`);
  warn.push(...loadWarnings(carry.t));
  if (pl.mission === "outpost" && (pl.supplies.scrap || 0) < Parties.outpostScrap(state, pl.dest)) warn.push(`Outposts need ${Parties.outpostScrap(state, pl.dest)} scrap carried`);
  if (pl.mission === "getvehicle" && (pl.supplies.fuel || 0) < 2) warn.push("Bring fuel cans to restart the vehicle");
  if (carry.over) warn.push(carry.why);
  const missions = Object.entries(MISSIONS).filter(([, m]) => !m.hidden);
  const keySkills = ["scouting", "stealth", "shooting", "scavenging", "speech", "medicine", "mechanics"];
  const parked = carsAtBase(state, h.id);
  const bikeStack = vehiclesAtBase(state, h.id).find(isBike);
  const nBikes = bikesAtBase(state, h.id);
  return `<div class="box wide">
    <h1>Plan a trip to ${esc(tileLabel(state, pl.dest))}</h1>
    ${plannerJobNote(state, pl.dest) /* ui/diplomacy.js: a job of yours at this target */}
    ${pl.mission === "assault" ? assaultNote(state, pl.dest) : ""}
    <div class="row" style="margin-bottom:0.6rem">Mission
      <select data-action="pl-mission"${tip(MISSIONS[pl.mission].desc)}>${missions.map(([k, m]) => `<option value="${k}" ${pl.mission === k ? "selected" : ""} title="${esc(m.desc)}">${m.name}</option>`).join("")}</select>
      <span class="small muted">${MISSIONS[pl.mission].desc}</span></div>
    <h3>Crew (${ids.length})</h3>
    <div class="crew">${crewPool.map((s) => `
      <label class="${pl.crew.has(s.id) ? "on" : ""}"${tip(`${s.name}: ${ROLES[s.role]?.name || s.role} at the hub. Taking them pauses that work.`)}><input type="checkbox" data-action="pl-crew" data-id="${s.id}" ${pl.crew.has(s.id) ? "checked" : ""}>
        <span><b>${s.leader ? "★ " : ""}${esc(s.name)}</b> <span class="muted small">HP ${n0(s.health)} · ${ROLES[s.role]?.name || s.role}</span><br>
        <span class="small">${keySkills.map((k) => `${SKILL_SHORT[k]} ${skill(s, k)}`).join(" · ")}</span><br>
        <span class="small muted">${[s.gear.weapon, s.gear.armor, s.gear.tool].filter(Boolean).map((g) => esc(g.name)).join(", ") || "No gear"} · wears ${n1(wornLoad(s))} of ${maxLoad(s)} kg${s.traits.length ? " · " + s.traits.map((t) => TRAITS[t].name).join(", ") : ""}</span></span></label>`).join("") || `<span class="muted">Nobody is at the hub.</span>`}</div>
    <div class="grid2" style="margin-top:0.6rem">
      <div>
        <h3>Transport</h3>
        <div class="choices">
          <button data-action="pl-vehicle" data-v="" class="${!v ? "active" : ""}"${tip("Slow, silent, goes anywhere except water. People carry everything: heavy loads slow the team and make it eat and drink more (load bands).")}>On foot</button>
          ${nBikes && bikeStack ? `<button data-action="pl-vehicle" data-v="${bikeStack.id}" class="${isBike(v) ? "active" : ""}" ${bikeStack.condition <= 0 ? "disabled" : ""}${tip(`One bike each (${nBikes} at the hub). No fuel. Faster than walking on roads, walking pace off-road. Each rack carries ${VEHICLE_TYPES.bike.rack} kg and riding takes 55% of the load's slow-down and extra rations away. Quiet.`)}>Bicycles<span class="hint">${nBikes} at the hub · condition ${Math.round(bikeStack.condition)}%${ids.length > nBikes ? ` · need ${ids.length}` : ""}</span></button>` : ""}
          ${parked.map((x) => `<button data-action="pl-vehicle" data-v="${x.id}" class="${v && v.id === x.id ? "active" : ""}" ${x.condition <= 0 ? "disabled" : ""}${tip(`Fast on roads, cannot cross mountains. Burns about 0.6 fuel per road tile, 1.5 off-road, more when it is loaded past 60% of its payload (×1.3 at 100%, up to ×1.6 at 125%). Payload ${VEHICLE_TYPES[x.type].payload} kg, riders (${RIDER_KG} kg each) included: they feel none of their load. Worn vehicles break down more.`)}>${esc(x.name)}<span class="hint">Fuel ${n0(x.fuel)}/${tank(x)} · condition ${Math.round(x.condition)}% · ${VEHICLE_TYPES[x.type].payload} kg payload</span></button>`).join("")}
          ${parked.length || nBikes ? "" : `<span class="small muted">No vehicles or bikes at the hub.</span>`}
        </div>
        <h3>Stance</h3>
        <div class="row">${Object.entries(STANCES).map(([k, s]) => `<button data-action="pl-stance" data-v="${k}" class="${pl.stance === k ? "active" : ""}"${tip(s.desc)}>${s.name}</button>`).join("")}</div>
        <h3>Estimate</h3>
        ${est ? `<div class="kv small"><div>Distance</div><div>${est.tiles} tiles</div>
          <div${tip("Hours on the road, worked out the same way the team really moves (stance, terrain, roads, fuel, and the weather hour by hour: mud, snow, storms). Road events can add delays.")}>Arrives in</div><div><b>${est.hoursOut}h</b> <span class="muted">(${at(est.arriveHour)})</span>${weatherEta(est)}</div>
          ${est.dryAt != null ? `<div></div><div class="danger">Fuel runs out near ${esc(tileLabel(state, est.dryAt))}; they walk the rest (vehicle left there)</div>` : ""}
          <div${tip(stays ? "If you order them home as soon as they arrive" : "Out, about 6 hours on site, and back")}>Round trip</div><div>~${est.days.toFixed(1)} days (${Math.round(est.hours)}h: ${est.hoursOut}h out, ${est.hoursBack}h back)${stays ? ` <span class="muted">if sent home on arrival</span>` : ""}</div>
          <div${tip("Food and water for the trip: one ration a person a day, more on the move under a load (Medium +15%, Heavy +35%, Overloaded +60%, less with Scouting or on bikes, none extra in a car), the hours on site at the normal rate. Water is that times each day's thirst: 1.3 in summer, at least 1.6 on a hot day, 0.9 in winter.")}>Needs</div><div>${est.food} food · ${est.water} water${isCar(v) ? ` · ${est.fuel} fuel${est.fuelMult > 1 ? ` (×${est.fuelMult.toFixed(2)} for the load)` : ""}` : ""}</div>
          <div${tip(`What the packed supplies weigh, against what the crew can carry on top of what they wear (max load 40 kg each, 28 with a Bad Back, more with a pack or Packrat)${v ? " plus the bikes' racks or the car" : ""}. Loot found on the trip needs what is left. ${BANDS_HELP}`)}>Weight</div><div class="${carry.over ? "danger" : ""}">${n1(carry.load)} kg packed + ${n1(carry.worn)} kg worn · room for ${n1(Math.max(0, carry.cap - carry.load))} kg more${carry.over ? " · too heavy" : ""}</div></div>
          ${carry.t ? `<div style="margin-top:0.3rem">${paceLine(carry.t)}${carLine(carry.t, v && v.name)}${carry.t.mode === true ? "" : loadRows(carry.t)}</div>` : ""}
          ${pl.mission === "outpost" && v ? `<div class="small muted" style="margin-top:0.3rem">The ${esc(v.name)} stays at the new outpost with the team.</div>` : ""}` : `<div class="danger">No route to this tile${v ? " by vehicle" : ""}.${v ? "" : " Water in the way? Send a team to the shore and build a boat there."}</div>`}
      </div>
      <div>
        <h3>Supplies (from hub)</h3>
        <table class="t">${showKeys.map((k) => `<tr${tip(k === "fuel" ? "Fuel cans: used when the tank runs dry, and to restart abandoned vehicles" : k === "parts" ? "For roadside repairs, restoring wrecks and recovering damaged vehicles" : k === "scrap" ? "Needed to build an outpost (15)" : k === "preserved" ? "Jarred, dried or canned food: a ration like food (eaten after the packed food), and lighter to carry (0.6 a ration)" : "")}><td>${SUPPLIES[k].name}</td><td><input type="number" min="0" data-action="pl-supply" data-k="${k}" value="${pl.supplies[k] || 0}"></td><td class="muted small">hub ${n0(h.stock[k])}</td></tr>`).join("")}</table>
        <button data-action="pl-autofill" style="margin-top:0.4rem"${tip("Pack enough for the round trip plus 25%")}>Auto-fill (+25% margin)</button>
        ${warn.length ? `<div class="small danger" style="margin-top:0.5rem">${warn.map(esc).join("<br>")}</div>` : ""}
      </div>
    </div>
    ${pl.mission === "outpost" ? `<div class="small muted" style="margin-top:0.5rem">The team stays at the new outpost: no plan after it.</div>` : planSection(state, pl, pe || (est ? planEstimate(state, pl) : null))}
    ${problem ? `<div class="danger" style="margin-top:0.6rem">${esc(problem)}</div>` : ""}
    ${ui.plannerError ? `<div class="danger" style="margin-top:0.6rem">${esc(ui.plannerError)}</div>` : ""}
    <div class="row" style="margin-top:1rem;justify-content:flex-end"><button data-action="pl-cancel">Cancel</button><button class="primary" data-action="pl-launch" ${!ids.length || !est || carry.over || problem ? "disabled" : ""}${tip(!ids.length ? "Pick at least one person" : !est ? "No route" : carry.over ? carry.why : problem || "The team leaves now. If the game is paused, it sets off when you unpause.")}>Send team</button></div>
  </div>`;
}

function engagementModal(state) {
  const e = state.engagement;
  const p = engagementParty(state);
  if (!e.approach) {
    return `<div class="box"><h1>Scavenging ${esc(tileLabel(state, e.tile))}</h1>
      <div class="text">${esc(e.log[0])}${e.guarded ? " " + esc(e.log[1]) : ""}</div>
      <div class="text small muted">Each search takes an hour on the shared clock. Heat rises as you search: Quiet → Stirring → Swarming → Overrun. Extract before it gets out of hand.</div>
      <div class="choices">${Object.entries(APPROACHES).map(([k, a]) => `<button data-action="approach" data-v="${k}"${tip(`${a.loot}× loot, +${a.heat} base Heat per hour`)}>${a.name}<span class="hint">${a.desc}</span></button>`).join("")}</div></div>`;
  }
  const stage = heatStage(e.heat);
  const members = p ? partyMembers(state, p) : [];
  const cap = p ? Parties.cargoRoom(state, p) : 0;
  const load = foundLoad(e);
  const found = [...Object.entries(e.found.supplies).filter(([, v]) => v >= 1).map(([k, v]) => `${n0(v)} ${k}`), ...e.found.gear.map((g) => g.name)];
  return `<div class="box wide"><h1>Scavenging ${esc(tileLabel(state, e.tile))} · ${APPROACHES[e.approach].name}</h1>
    <div class="spread small"><span>Heat: <b>${stage.name}</b> — ${stage.desc}</span><span>${e.hours} hour${e.hours === 1 ? "" : "s"} searched · ${clock(state)}</span></div>
    <div class="heat" style="margin:0.4rem 0 0.9rem"${tip("Quiet → Stirring (25) → Swarming (50) → Overrun (75). Fights get likelier and extraction harder.")}><i style="left:${e.heat}%"></i></div>
    <div class="grid2">
      <div><h3>Log</h3><div class="elog" id="elog">${e.log.map((l) => `<div>${esc(l)}</div>`).join("")}</div></div>
      <div><h3>Team</h3>${members.map((m) => `<div class="row small"><span style="width:7rem">${first(m)}</span><div style="flex:1">${bar(m.health, m.health < 40 ? "var(--danger)" : "var(--good)")}</div></div>`).join("")}
        <div class="small muted" style="margin-top:0.3rem">Ammo ${n0(p ? p.supplies.ammo : 0)} · Food ${n0(p ? p.supplies.food : 0)}</div>
        <h3>Found (${Math.ceil(load)} / ${Math.max(0, Math.floor(cap))} kg the team can still carry)</h3>
        <div class="small">${found.length ? found.map((f) => `<span class="chip">${esc(f)}</span>`).join("") : "<span class='muted'>Nothing yet</span>"}</div>
        ${load > cap ? `<div class="small danger">More than you can carry. The cheapest goods will be left behind.</div>` : ""}
      </div>
    </div>
    <div class="row" style="margin-top:1rem;justify-content:flex-end">
      ${e.done ? `<button class="primary" data-action="engclose">Close</button>` : `<button data-action="search"${tip("One more hour: more loot, more Heat")}>Search another hour</button><button class="primary" data-action="extract"${tip("Leave with what you found. Hard if Swarming or Overrun.")}>Extract now</button>`}
    </div></div>`;
}

function tradeModal(state, ui) {
  const ctx = tradeContext(state);
  if (!ctx) return `<div class="box"><button data-action="tradeleave">Close</button></div>`;
  const { f, speech, have } = ctx;
  const tot = tradeTotals(state);
  const a = attitude(f);
  const rows = SUPPLY_KEYS.map((k) => `<tr>
    <td><b>${SUPPLIES[k].name}</b></td>
    <td>${n0(have[k])}</td><td class="muted">${sellPrice(state, f, k, speech).toFixed(1)}</td>
    <td><button data-action="offer" data-k="${k}" data-d="-5">−</button> ${state.trade.offer[k] || 0} <button data-action="offer" data-k="${k}" data-d="5" ${(state.trade.offer[k] || 0) + 5 > have[k] ? "disabled" : ""}>+</button></td>
    <td style="border-left:1px solid var(--line)">${n0(f.stock[k])}</td><td class="muted">${buyPrice(state, f, k, speech).toFixed(1)}</td>
    <td><button data-action="ask" data-k="${k}" data-d="-5">−</button> ${state.trade.ask[k] || 0} <button data-action="ask" data-k="${k}" data-d="5" ${(state.trade.ask[k] || 0) + 5 > (f.stock[k] || 0) ? "disabled" : ""}>+</button></td>
  </tr>`).join("");
  return `<div class="box wide"><h1><span class="swatch" style="background:${f.color}"></span>${esc(f.name)}</h1>
    <div class="where">${FACTION_TYPES[f.type].label} · <span style="color:${attColor(a)}">${a}</span> · goodwill ${Math.round(f.goodwill)} · Your best Speech: ${speech}</div>
    ${captivesOf(state, f.id).length ? `<div class="small danger" style="margin-bottom:0.4rem">They hold ${captivesOf(state, f.id).map(first).join(", ")}. A ransom was offered when you arrived; a Rescue team can also get them out.</div>` : ""}
    <div class="small muted" style="margin-bottom:0.5rem">Prices follow their stock: they pay more for what they are short of. You trade from what your team carries.</div>
    <table class="t"><tr><th></th><th>You carry</th><th${tip("What they pay you per unit. Speech improves it.")}>They pay</th><th>Offer</th><th style="border-left:1px solid var(--line)">They have</th><th${tip("What you pay them per unit")}>You pay</th><th>Ask</th></tr>${rows}</table>
    <div class="spread" style="margin-top:0.6rem"><span>Your offer: <b>${tot.offer.toFixed(0)}</b> · Their goods: <b>${tot.ask.toFixed(0)}</b></span>
      <span class="${tot.offer >= tot.ask ? "good" : "danger"}">${tot.offer >= tot.ask ? "Acceptable" : "Not enough"}</span></div>
    ${ui.tradeMsg ? `<div class="result">${esc(ui.tradeMsg)}</div>` : ""}
    <div class="row" style="margin-top:0.8rem">
      <button class="primary" data-action="dotrade" ${tot.offer >= tot.ask && tot.offer > 0 ? "" : "disabled"}${tip("Swap goods. Overpaying earns a little goodwill.")}>Trade</button>
      <button data-action="gift" ${tot.offer > 0 ? "" : "disabled"}${tip("Give your offer for nothing in return. Raises goodwill.")}>Give offer as a gift</button>
      <button data-action="pact" data-k="nonaggression" ${f.pact ? "disabled" : ""}${tip("They stop treating you as a target. Needs goodwill about -10 or more.")}>Propose non-aggression pact</button>
      <button data-action="pact" data-k="trade" ${f.pact === "trade" ? "disabled" : ""}${tip("Lets you set up a recurring trade route. Needs goodwill 20.")}>Propose trade pact</button>
      <button data-action="tradeleave" style="margin-left:auto"${tip("End the visit. The team then waits for orders.")}>Leave</button>
    </div></div>`;
}

// Trade-route terms, checked by the sim (trade.js routeProblem: the load must be worth what you ask at the
// group's prices). Returns { ok, reason, hint }.
export function routeCheck(state, r) {
  const f = factionById(state, r.factionId);
  let reason = "";
  if (Trade.routeProblem) reason = Trade.routeProblem(state, r) || "";
  else if (!f || !f.alive) reason = "That group is gone.";
  else if (!(r.sendQty >= 1) || !(r.recvQty >= 1)) reason = "Send and ask for at least 1.";
  else if (r.sendKey === r.recvKey) reason = "Send one kind of goods and receive another.";
  else if (r.recvQty * buyPrice(state, f, r.recvKey, 0) > r.sendQty * sellPrice(state, f, r.sendKey, 0)) reason = `${f.name} will not give that much for ${r.sendQty} ${r.sendKey}.`;
  if (!reason && !(Number(r.interval) >= 2)) reason = "Convoys can leave every 2 days at most.";
  const h = hub(state);
  const short = !reason && f && (h.stock[r.sendKey] || 0) < r.sendQty ? `The hub has only ${n0(h.stock[r.sendKey])} ${r.sendKey} right now; a convoy leaves only when the full load is there.` : "";
  let worth = "";
  if (f && SUPPLIES[r.sendKey] && SUPPLIES[r.recvKey] && r.sendKey !== r.recvKey) {
    const max = Trade.routeWorth ? Trade.routeWorth(state, f, r.sendKey, r.sendQty, r.recvKey).maxRecv : Math.floor((r.sendQty * sellPrice(state, f, r.sendKey, 0)) / buyPrice(state, f, r.recvKey, 0));
    worth = `At today's prices ${f.name} gives up to ${max} ${r.recvKey} for ${r.sendQty} ${r.sendKey}. Prices move with their stock; a convoy never gets more than its load is worth that day.`;
  }
  return { ok: !reason, reason, hint: short, worth };
}

function routeModal(state, ui) {
  const r = ui.routeSetup;
  const f = factionById(state, r.factionId);
  const h = hub(state);
  const pool = atBase(state, h.id);
  const needPeople = ESCORTS[r.escort].people;
  const keys = SUPPLY_KEYS.filter((k) => k !== "water");
  const chk = routeCheck(state, r);
  const crewOk = r.escortIds.size === needPeople;
  return `<div class="box wide"><h1>Trade route to ${esc(f.name)}</h1>
    <div class="grid2">
      <div>
        <h3>Goods</h3>
        <div class="row">Send <input type="number" min="1" step="1" data-action="rt" data-f="sendQty" value="${r.sendQty}"> <select data-action="rt" data-f="sendKey">${keys.map((k) => `<option ${r.sendKey === k ? "selected" : ""}>${k}</option>`).join("")}</select></div>
        <div class="row" style="margin-top:0.4rem">Receive <input type="number" min="1" step="1" data-action="rt" data-f="recvQty" value="${r.recvQty}"> <select data-action="rt" data-f="recvKey">${keys.map((k) => `<option ${r.recvKey === k ? "selected" : ""}>${k}</option>`).join("")}</select></div>
        <div class="row" style="margin-top:0.4rem">Every <input type="number" min="2" step="1" data-action="rt" data-f="interval" value="${r.interval}"> days</div>
        <div class="small muted">They have ${n0(f.stock[r.recvKey])} ${r.recvKey}. ${esc(chk.worth)}</div>
        ${chk.reason ? `<div class="small danger" style="margin-top:0.3rem">${esc(chk.reason)}</div>` : chk.hint ? `<div class="small warn" style="margin-top:0.3rem">${esc(chk.hint)}</div>` : `<div class="small good" style="margin-top:0.3rem">They accept these terms.</div>`}
        <h3>Escort</h3>
        <div class="choices">${Object.entries(ESCORTS).map(([k, e]) => `<button data-action="rt-escort" data-v="${k}" class="${r.escort === k ? "active" : ""}"${tip(e.desc)}>${e.name} (${e.people} ${e.people === 1 ? "survivor" : "survivors"})<span class="hint">${e.desc}</span></button>`).join("")}</div>
      </div>
      <div>
        <h3>Choose ${needPeople} escort${needPeople === 1 ? "" : "s"} (${r.escortIds.size} picked)</h3>
        <div class="small muted" style="margin-bottom:0.4rem">Escorts are committed to the route and do not work at the hub.</div>
        <div class="crew" style="grid-template-columns:1fr">${pool.map((s) => `<label class="${r.escortIds.has(s.id) ? "on" : ""}"><input type="checkbox" data-action="rt-crew" data-id="${s.id}" ${r.escortIds.has(s.id) ? "checked" : ""}> ${esc(s.name)} <span class="small muted">Combat ${combatPower(s).toFixed(1)} · Shooting ${skill(s, "shooting")}</span></label>`).join("")}</div>
      </div>
    </div>
    <div class="row" style="margin-top:1rem;justify-content:flex-end"><button data-action="rt-cancel">Cancel</button><button class="primary" data-action="rt-create" ${crewOk && chk.ok ? "" : "disabled"}${tip(!chk.ok ? chk.reason : !crewOk ? `Pick ${needPeople} escort${needPeople === 1 ? "" : "s"}` : "The first convoy leaves at the next dawn")}>Start route</button></div>
  </div>`;
}

function gapLabel(s, item, plain = false) {
  const e = gearEffect(s, item);
  const def = GEAR[item.key];
  let txt, cls;
  if (!def.skill || e.gap <= 0) [txt, cls] = ["Full use", "good"];
  else if (e.gap <= 3) [txt, cls] = ["Slightly below skill (−15%)", "muted"];
  else if (e.gap <= 7) [txt, cls] = ["Below skill (−35%, may damage)", "danger"];
  else [txt, cls] = [`Cannot use (needs ${def.req} ${SKILL_NAMES[def.skill]})`, "danger"];
  return plain ? txt : `<span class="${cls}">${txt}</span>`;
}

function gearTip(item) {
  const d = GEAR[item.key];
  const dur = itemDur(item);
  return `${d.name}: power ${d.power}${d.skill ? `, needs ${SKILL_NAMES[d.skill]} ${d.req} for full use` : ""}, worth: ${worthTier(item)}${item.quality < 1 ? `, condition ${Math.round(item.quality * 100)}%` : ""}${dur != null ? `. Makeshift: ${dur} of ${d.dur} ${durUnit(item.key)} left before it breaks` : ""}${d.desc ? `. ${d.desc}` : ""}`;
}
// Uses left on makeshift gear, e.g. " [7/10]".
const durTag = (item) => { const v = itemDur(item); return v != null ? ` [${v}/${GEAR[item.key].dur}]` : ""; };

function survivorModal(state, ui) {
  const s = survivorById(state, ui.survivor);
  if (!s) return null;
  const base = s.alive && s.location.kind === "base" ? baseById(state, s.location.baseId) : null; // the dead (memorial wall) have no gear controls
  const slots = EQUIP_SLOTS; // inventory.js: hands, off hand, head, body, arms, legs, backpack
  ensureInv(s);
  const carried = s.pockets.filter(Boolean).length + (s.gear.backpack && s.gear.backpack.contents ? s.gear.backpack.contents.filter(Boolean).length : 0);
  return `<div class="box"><div class="spread"><h1><span class="surv-port" data-action="look-edit" data-id="${s.id}"${tip("Customize how they look")}>${spriteImg(survivorURL(s, state.seed), 3)}</span>${s.leader ? "★ " : ""}${esc(s.name)}</h1>
      <button class="mini ${ui.lookEdit === s.id ? "active" : ""}" data-action="look-edit" data-id="${s.id}"${tip("Change their look: build, hair, clothes, accessory. Shown in battle.")}>Customize look</button></div>
    ${ui.lookEdit === s.id ? appearanceEditor(state, s) : ""}
    <div class="where">${s.leader ? "Leader · " : ""}${inContact(state, s) ? `Health ${n0(s.health)} · Mood ${n0(s.mood)}` : "Health and mood unknown (no contact)"} · Combat power ${combatPower(s).toFixed(1)}${base ? ` · at ${esc(base.name)}` : ""}${inContact(state, s) && s.woundInfected ? ` · <span class="danger">Infected wound</span>` : ""} ${treatButton(state, s)}</div>
    ${isCaptive(s) ? captiveLine(state, s) : ""}
    ${s.alive ? workLine(state, s, base) : ""}
    <div class="grid2">
      ${skillsBlock(state, s)}
      <div><h3>Traits</h3>${s.traits.map((t) => `<div class="small"><b>${TRAITS[t].name}</b> <span class="muted">${TRAITS[t].desc}</span></div>`).join("")}
        <div class="spread"><h3>Gear</h3><button class="mini primary" data-action="inv-open" data-id="${s.id}" ${personPlace(s) ? "" : "disabled"}${tip("Paper-doll inventory: what they wear, hold and carry in pockets and pack. Move items to and from the armory (at a base) or teammates and the cargo (on a team).")}>Inventory</button></div>
        <div class="small muted">Armor ${Math.round(armorPower(s) * 10) / 10} from worn pieces · ${carried} item${carried === 1 ? "" : "s"} in pockets and pack</div>
        ${slots.map((slot) => {
          const cur = s.gear[slot];
          return `<div class="card small"><b>${SLOT_NAMES[slot]}:</b> ${cur ? `<span${tip(gearTip(cur))}>${esc(cur.name)}</span>${cur.quality < 1 ? ` (${Math.round(cur.quality * 100)}%)` : ""} — ${gapLabel(s, cur)}` : "<span class='muted'>none</span>"}
            ${base ? `<div class="row" style="margin-top:0.3rem">${gearControls(state, base, s, slot)}</div>` : ""}</div>`;
        }).join("")}
        ${base ? "" : `<div class="small muted">Away from a base, gear moves only between teammates and the team's cargo (Inventory).</div>`}
      </div>
    </div>
    ${s.alive ? `${studyBlock(state, s)}${skillTree(state, s, ui)}` : ""}
    ${inContact(state, s) || !s.alive ? relationsSection(state, s, ui) : ""}
    <div class="row" style="margin-top:1rem;justify-content:flex-end"><button class="primary" data-action="closesurv">Close</button></div></div>`;
}

// Their role and what they do now (sim/work.js): a work role with the why, or their fixed job (Manual).
function workLine(state, s, base) {
  const role = roleOf(state, s);
  const now = isManaged(state, s) ? taskLabel(state, s) : "";
  const job = ROLES[s.role] ? ROLES[s.role].name : s.role;
  return `<div class="card small worksurv"><div class="spread"><span><b>Work:</b> ${role ? `${esc(role.name)}${role.kind === "crew" ? " (crew)" : ""}${s.pinned ? " · pinned" : ""}` : `Manual (${esc(job)})`}${now ? ` · now <b>${esc(now)}</b>` : ""}</span>${base ? workRoleSelect(state, s) : ""}</div>
    ${now ? `<div class="muted">${esc(taskWhy(state, s))}</div>` : role ? `<div class="muted">${s.location.kind === "base" ? "Planned at the start of the next hour." : "Away: back on the role's priorities when home."}</div>` : ""}</div>`;
}

function gearControls(state, base, s, slot) {
  const cur = s.gear[slot];
  const opts = base.armory.map((g, i) => [g, i]).filter(([g]) => GEAR[g.key].slot === slot);
  return `${cur ? `<button class="mini" data-action="unequip" data-id="${s.id}" data-slot="${slot}" data-base="${base.id}"${tip(`Put the ${cur.name} in ${base.name}'s armory`)}>Unequip</button>` : ""}
    ${opts.length ? `<select data-action="equip" data-id="${s.id}" data-base="${base.id}"${tip("Equip from this base's armory")}><option value="">Equip…</option>${opts.map(([g, i]) => `<option value="${i}">${esc(g.name)}${durTag(g)} — ${gapLabel(s, g, true)}</option>`).join("")}</select>` : ""}`;
}

// ---------- base management ----------
const BASE_TABS = [
  ["overview", "Overview", "Stock, people and roles"],
  ["work", "Work", "Work priorities (like RimWorld's work tab): roles with a 1–5 priority per kind of work, a schedule, and crews that run trips by themselves"],
  ["farming", "Farming", "Crop plots: what grows, when it ripens, expected harvests, weather risks; the food and water outlook"],
  ["workshops", "Workshops", "Base scavenging and workshop stations: who works where and what they produce"],
  ["buildings", "Buildings", "What is built here and the bonuses it gives"],
  ["construction", "Construction", "Build queue with timers, and what you can build"],
  ["armory", "Armory", "Stored gear and everyone's equipment at this base"],
  ["crafting", "Crafting", "Hand-made makeshift gear and supplies: craft queue, crafters and recipes (no station needed)"],
  ["vehicles", "Vehicles", "Fuel, condition, refuel and repair"],
  ["convoys", "Supply runs", "Convoy jobs between your bases: send supplies, bring goods back, on a schedule"],
  ["medical", "Medical", "Infirmary or hospital, medics, beds, and treating the injured with meds"],
  ["repairs", "Repairs", "Broken buildings and equipment, repair jobs, wear and parked vehicles (breakdowns.js)"],
  ["prisoners", "Prisoners", "People taken prisoner in battle: cells, guards and food; question, ransom, trade back, win over or release them"],
];

function baseModal(state, ui) {
  const b = baseById(state, ui.baseView.id);
  if (!b) return null;
  const tab = ui.baseView.tab;
  const body = { overview: baseOverview, work: workTab, farming: baseFarming, workshops: baseWorkshops, buildings: baseBuildings, construction: baseConstruction, armory: baseArmory, crafting: baseCrafting, vehicles: baseVehicles, convoys: baseConvoys, medical: baseMedical, repairs: repairsTab, prisoners: prisonTab }[tab](state, b, ui);
  return `<div class="box wide basebox">
    <div class="spread"><input class="basename" data-action="baserename" data-base="${b.id}" maxlength="40" value="${esc(b.name)}"${tip("Click to rename this base (Enter to confirm)")}><span class="muted">${b.type === "hub" ? "Main hub" : "Outpost"} · ${atBase(state, b.id).length} people · Day ${day(state)} ${clock(state)}</span></div>
    <div class="tabs">${BASE_TABS.map(([k, l, t]) => `<button data-action="basetab" data-tab="${k}" class="${tab === k ? "active" : ""}"${tip(t)}>${l}</button>`).join("")}</div>
    ${ui.baseMsg ? `<div class="result small">${esc(ui.baseMsg)}</div>` : ""}
    <div class="basebody">${body}</div>
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end"><button class="primary" data-action="closebase">Close</button></div>
  </div>`;
}

// ---------- medical ----------
// A Treat button for anyone: at a base it uses the base's meds, on a team it uses the team's carried meds.
function treatButton(state, s) {
  if (!isHurt(s)) return "";
  if (s.location.kind === "base") {
    const b = baseById(state, s.location.baseId);
    const info = treatAtBaseInfo(state, b, s);
    return `<button class="mini" data-action="treat" data-base="${b.id}" data-id="${s.id}" ${info.ok ? "" : "disabled"}${tip(info.ok ? `Use ${info.cost} of ${b.name}'s meds: +${info.heal} health${info.surgery ? ` (surgery on a severe wound: most of ${info.medic ? info.medic.name.split(" ")[0] + "'s" : "a medic's"} day)` : info.medic ? `, one of ${info.medic.name.split(" ")[0]}'s treatments for today` : ""}${info.noSurgeryTime ? "; no medic has time for surgery today" : ""}${s.woundInfected ? `, ${Math.round(info.cureChance * 100)}% to clean the infected wound` : ""}. Once a day. Better with a hospital and Medicine.` : info.reason)}>Treat (${info.cost} meds)</button>`;
  }
  if (s.location.kind === "route") {
    // A trade-route escort waiting at the hub between trips is treated there (medical.js); on the road, not at all.
    const h = hub(state);
    const info = treatAtBaseInfo(state, h, s);
    return `<button class="mini" data-action="treat" data-base="${h.id}" data-id="${s.id}" ${info.ok ? "" : "disabled"}${tip(info.ok ? `Use ${info.cost} of ${h.name}'s meds: +${info.heal} health. Once a day.` : info.reason)}>Treat (${info.cost} meds)</button>`;
  }
  if (s.location.kind === "party") {
    // In the field treating is a team order that takes an hour, and the team has to be in contact (same as the team panel).
    const p = state.parties.find((x) => x.id === s.location.partyId);
    if (!p || !contactable(p) || !commandable(state, p)) return ""; // radio rule (sim/plans.js)
    const info = fieldTreatInfo(state, p, s);
    const queued = !(p.phase === "waiting" || p.phase === "task");
    return `<button class="mini" data-action="xp-order" data-id="${p.id}" data-type="treat" data-sid="${s.id}" ${info.ok ? "" : "disabled"}${tip(info.ok ? `Field treatment, a ${info.hours || 1}-hour team order${queued ? " (added to the team's queue)" : ""}, with the team's meds (${n0(partyMeds(p))} carried): ${info.cost} meds, about +${info.heal} health${info.medic ? ` (by ${info.medic.name}, Medicine ${skill(info.medic, "medicine")})` : ""}${s.woundInfected ? `, ${Math.round(info.cureChance * 100)}% to clean the infected wound` : ""}. Weaker than care at a base.` : info.reason)}>Treat (${info.cost} meds, 1h)</button>`;
  }
  return "";
}

// Health per day, bed chips and next-treatment lines for patients: ui/health.js (healPerDayText, bedChip, nextTreatLine).
function baseMedical(state, b) {
  const h = activeHospital(state, b);
  const built = h.built;
  const people = atBase(state, b.id);
  const hurtList = people.filter((s) => isHurt(s) || isSick(s)).sort((x, y) => x.health - y.health);
  const beds = new Set(patients(state, b).map((s) => s.id));
  const carePlan = Medical.autoCare(state, b, { plan: true }); // tonight's automatic care, shared by every patient row
  const next = nextHospitalType(b);
  const queued = b.construction.find((c) => BUILDINGS[c.type].family === "hospital");
  const others = people.filter((s) => s.role !== "medic");
  return `<div class="grid2">
    <div>
      <h3>Care</h3>
      <div class="card small">
        <div class="spread"><b>${built.tier ? esc(built.name) : "No hospital"}</b>${built.tier ? `<span class="chip ${h.staffed ? "on" : "off"}"${tip(`Buildings need people: each tier needs Medic-role staff to run. With too few medics it runs as the highest tier they can staff${h.staffed ? "" : ` (now ${h.tier ? `as a ${h.name}` : "as no hospital"}; needs ${built.staff})`}.`)}>${h.staffed ? "Staffed" : h.fallback ? `Runs as ${esc(h.name)}` : `Needs ${built.staff} medic${built.staff === 1 ? "" : "s"}`}</span>` : ""}</div>
        <div class="kv" style="margin-top:0.3rem">
          <div>Beds</div><div>${h.beds ? `${beds.size} of ${h.beds} in use` : "none"}</div>
          <div${tip("Extra health per day for patients in a bed, plus the best medic's Medicine × 0.5")}>Bed healing</div><div>${h.tier ? `+${h.heal} / day (+${n1(h.staffSkill * 0.5)} from medics)` : "—"}</div>
          <div${tip("Everyone at the base heals this much per day: 4 + best Medicine here × 0.4")}>Everyone</div><div>+${n1(4 + h.baseSkill * 0.4)} / day</div>
          <div${tip("Multiplier on what each dose of meds heals, for your treatments and the automatic night care")}>Meds effect</div><div>×${h.eff}</div>
          <div>Infected wounds</div><div>${h.cures ? "Cleaned in bed" : h.guards ? "Prevented in bed" : "Risky below 40 health"}</div>
          <div${tip("Below 30 health, healing runs at 40% speed without a bed; the hospital tier sets the speed in a bed. Surgery (Clinic and up) also makes treatments 50% bigger for severe wounds.")}>Severe wounds</div><div>${h.tier ? `${Math.round(h.severe * 100)}% speed in bed` : "40% speed"}${h.surgery ? " · surgery" : ""}</div>
          <div>Meds in stock</div><div>${n0(b.stock.meds)}</div>
        </div>
      </div>
      <h3>Medics</h3>
      <div class="card small">
        ${h.staff.length ? h.staff.map((s) => `<div class="spread"><span>${esc(s.name)} <span class="muted">Medicine ${skill(s, "medicine")}</span></span>${roleSelect(state, s)}</div>`).join("") : `<span class="muted">Nobody on the Medic role.</span>`}
        ${others.length ? `<div style="margin-top:0.3rem"><select data-action="medicop"${tip("Set someone's role to Medic")}><option value="">Add a medic…</option>${others.map((s) => `<option value="${s.id}">${esc(s.name)} (Medicine ${skill(s, "medicine")}, now ${ROLES[s.role]?.name || s.role})</option>`).join("")}</select></div>` : ""}
      </div>
      ${illnessCard(state, b)}
      <h3>Upgrade path</h3>
      ${hospitalTypes().map((k) => {
        const d = BUILDINGS[k];
        const isNext = k === next;
        const chk = isNext ? canBuild(state, b, k) : null;
        const status = d.tier <= built.tier ? `<span class="chip on">Built</span>` : queued && queued.type === k ? `<span class="chip">Queued</span>` : isNext ? `<button class="mini" data-action="queuebuild" data-base="${b.id}" data-type="${k}" ${chk.ok ? "" : "disabled"}${tip(chk.ok ? "Pay now; builders do the rest (Construction tab)" : chk.reason)}>${d.tier === 1 ? "Build" : "Upgrade"}</button>` : `<span class="muted">Later</span>`;
        return `<div class="card small"${tip(d.desc)}><div class="spread"><b>${d.tier}. ${esc(d.name)}</b>${status}</div>
          <span class="muted">${d.med.beds} beds · +${d.med.heal}/day · meds ×${d.med.eff} · ${d.med.staff} medic${d.med.staff === 1 ? "" : "s"}${d.med.cures ? " · cleans infections" : d.med.guards ? " · prevents infections" : ""}<br>${Object.entries(d.cost).map(([c, v]) => `${v} ${c}`).join(", ")} · ${d.hours} work-hours${d.req ? ` · needs ${Object.entries(d.req).map(([sk, l]) => `${SKILL_NAMES[sk]} ${l}+`).join(", ")}` : ""}${isNext && !chk.ok ? ` · <span class="danger">${esc(chk.reason)}</span>` : ""}</span>${d.tier > built.tier ? lockLine(state, b, "building", k) : ""}</div>`;
      }).join("")}
    </div>
    <div>
      <h3>Injured and sick (${hurtList.length})</h3>
      ${hurtList.length ? hurtList.map((s) => `<div class="card small">
        <div class="spread"><a data-action="survivor" data-id="${s.id}" class="link">${esc(s.name)}</a>${treatButton(state, s)}</div>
        <div class="row"><div style="flex:1">${bar(s.health, s.health < 40 ? "var(--danger)" : "var(--good)")}</div><span style="width:2rem;text-align:right">${n0(s.health)}</span></div>
        <div>${bedChip(state, b, s, h, beds.has(s.id))}${s.health < 30 ? `<span class="chip off"${tip("Severe wound (below 30 health): heals at 40% speed without a bed; a hospital bed and surgery help")}>Severe</span>` : ""}${s.woundInfected ? `<span class="chip off"${tip("Heals at half speed and loses 2 health a day. Treat with meds; a Clinic or better cleans it in bed.")}>Infected wound</span>` : ""}<span class="muted">${healPerDayText(state, b, s, h, beds.has(s.id), carePlan)}</span></div>
        ${nextTreatLine(state, b, s)}
        ${conditionTreatRow(state, b, s)}
      </div>`).join("") : `<div class="muted small">Nobody here is hurt or ill.</div>`}
      <div class="small muted" style="margin-top:0.4rem">The rate is the expected change over the next day: passive healing, tonight's automatic care (if they get it) and what illness costs. One treatment per wound or illness a day, each takes a medic's time.</div>
    </div>
  </div>`;
}

function baseOverview(state, b) {
  const people = atBase(state, b.id);
  const line = b.type === "outpost" ? (b.supplyLine || supplyLine(state, b)) : null;
  const fc = foodPerDay(state, b);
  return `<div class="grid2">
    <div>
      <h3>Stock</h3>
      <table class="t">${SUPPLY_KEYS.map((k) => `<tr><td>${SUPPLIES[k].name}</td><td>${n0(b.stock[k])}</td></tr>`).join("")}</table>
      ${b.type === "outpost" ? `<div class="small muted" style="margin-top:0.4rem">Outposts keep a small reserve and ship the rest to the hub each day.</div>` : ""}
      <h3>Status</h3>
      <div class="kv small">
        <div>Defense</div><div>${Math.round(baseDefense(state, b))}</div>
        ${holdRow(state, b)}
        <div>Heat</div><div>${baseHeat(state, b)}</div>
        <div${tip("Days of food left at today's rate without harvests, and the next harvest (Farming tab)")}>Food</div>${foodCellHtml(state, b)}
        <div${tip("Where the fresh food is kept and what spoils a day (storage room: cellars, storehouse, cold store; above it, food is stored outside and spoils fast), and the preserved stock")}>Food storage</div>${storeCellHtml(state, b)}
        <div${tip("Water per day (in minus out), stock and capacity, days left")}>Water</div>${waterCellHtml(state, b)}
        ${crowdingRow(state, b)}
        ${line ? `<div>Supply line</div><div>${Math.round(line.strength * 100)}%${line.hostile ? " · hostile land" : ""}${line.horde ? " · horde nearby" : ""}</div><div>Backup ETA</div><div>${isFinite(line.hours) ? line.hours + " hours" : "cut off"}</div>` : ""}
      </div>
    </div>
    <div>
      <div class="spread"><h3>People and roles</h3>${memorialButton(state, b)}</div>
      ${people.length ? `<table class="t">${people.map((s) => `<tr><td><a data-action="survivor" data-id="${s.id}" class="link">${s.leader ? "★ " : ""}${esc(s.name)}</a></td><td>${roleSelect(state, s)}</td><td class="small">${n0(s.health)} HP</td><td>${pinButton(s)}</td></tr>`).join("")}</table>` : `<div class="muted small">Nobody is here.</div>`}
      <div class="small muted" style="margin-top:0.4rem">${Object.entries(ROLES).map(([k, r]) => `<b>${r.name}</b> ${people.filter((s) => s.role === k).length}`).join(" · ")}</div>
      ${priorityCount(state, b) ? `<div class="small muted" style="margin-top:0.4rem">${priorityCount(state, b)} here work by priorities (Work tab); a steward only moves the people on Manual.</div>` : ""}
      ${stewardCard(state, b)}
    </div>
  </div>`;
}

function baseWorkshops(state, b) {
  const people = atBase(state, b.id);
  const farmers = people.filter((s) => s.role === "farm");
  const scav = people.filter((s) => s.role === "scavenge");
  const scavOut = Object.entries(scavengeOutput(state, b)).filter(([, v]) => v >= 0.1).map(([k, v]) => `${n1(v)} ${k}`).join(", ");
  const sts = stations(b);
  return `
    <h3>Farming</h3>
    <div class="card small">${farmers.length} farmer${farmers.length === 1 ? "" : "s"} on ${farmSlots(b)} plots${farmers.length ? `: ${farmers.map((x) => first(x) + bedTag(x)).join(", ")}` : ""}. Crops ripen in batches: see the <a class="link" data-action="basetab" data-tab="farming">Farming</a> tab.</div>
    <h3>Scavenging</h3>
    <div class="card small"${tip(ROLES.scavenge.desc)}>${scav.length ? `${scav.map((x) => first(x) + bedTag(x)).join(", ")} · <b>usually nothing</b> <span class="muted">(on average ${scavOut || "next to nothing"} a day; the surroundings are ${Math.round((b.scavLeft ?? 1) * 100)}% unpicked)</span>` : "<span class='muted'>Nobody scavenging</span>"}<div class="muted">Picking around the base rarely turns anything up. Send teams to real sites for supplies.</div></div>
    <h3>Workshop stations</h3>
    ${sts.length ? `<table class="t"><tr><th>Station</th><th>Operator</th><th>Status</th><th>Per day</th><th${tip("Standing order (production.js): Forever, Until stock reaches N, Keep at least N of an input, or Off, and what the operator does while it holds the station")}>Order</th></tr>${sts.map((st) => {
      const s = stationStatus(state, b, st);
      const r = RECIPES[s.recipe];
      return `<tr>
        <td${tip(`${BUILDINGS[st.type].desc} ${r.desc}`)}><b>${BUILDINGS[st.type].name}</b></td>
        <td><select data-action="stationop" data-base="${b.id}" data-station="${st.id}"${tip("Assigning someone sets their role to Operate")}><option value="">— none —</option>${people.map((p) => `<option value="${p.id}" ${(s.op ? s.op.id === p.id : p.station === st.id) ? "selected" : ""}>${esc(p.name)} (${SKILL_NAMES[r.skill]} ${skill(p, r.skill)}${p.inBed ? ", in bed" : ""})</option>`).join("")}</select></td>
        <td><span class="chip ${s.running ? "on" : "off"}">${esc(s.reason)}</span></td>
        <td class="small">${s.op ? `${Object.entries(s.in || r.in).map(([k, v]) => `−${v} ${k}`).join(", ")} → ${Object.entries(s.out).map(([k, v]) => `+${v} ${k}`).join(", ") || "power"}` : "—"}</td>
        <td>${orderCell(state, b, st)}</td>
      </tr>`;
    }).join("")}</table>` : `<div class="muted small">No workshop stations. Build an ammo bench, med station or machine shop in Construction.</div>`}
    ${racksCard(state, b)}${powerCard(state, b)}`;
}

function baseBuildings(state, b) {
  const groups = {};
  for (const x of b.buildings) groups[x.type] = (groups[x.type] || 0) + 1;
  return `<div class="grid2">
    <div><h3>Built here</h3>${Object.keys(groups).length ? Object.entries(groups).map(([t, n]) => `<div class="card small"${tip(BUILDINGS[t].desc)}><b>${BUILDINGS[t].name}${n > 1 ? ` ×${n}` : ""}</b><br><span class="muted">${BUILDINGS[t].desc}</span></div>`).join("") : `<div class="muted small">Only a shelter so far. Queue buildings in Construction.</div>`}</div>
    <div><h3>Bonuses</h3><div class="kv small">${buildingSummary(state, b).map(([k, v]) => `<div>${k}</div><div>${esc(v)}</div>`).join("")}</div>${blueprintsCard(state, b)}</div>
  </div>`;
}

function baseConstruction(state, b) {
  const rate = buildRate(state, b);
  const builders = atBase(state, b.id).filter((s) => s.role === "build");
  let elapsed = 0;
  return `<div class="grid2">
    <div>
      <h3>Queue</h3>
      <div class="small muted" style="margin-bottom:0.4rem">${builders.length ? `Builders: ${builders.map((x) => first(x) + bedTag(x)).join(", ")} (${n1(rate)} work-hours per hour${builders.some((x) => x.inBed) ? "; people in a hospital bed do not build" : ""})` : "No builders. Set someone's role to Build."}</div>
      ${b.construction.length ? b.construction.map((job, i) => {
        const left = job.hours - job.progress;
        elapsed += left;
        const eta = rate > 0 ? Math.ceil(elapsed / rate) : null;
        return `<div class="card small">
          <div class="spread"><b>${i === 0 ? "▶ " : ""}${BUILDINGS[job.type].name}</b><button class="mini" data-action="cancelbuild" data-base="${b.id}" data-id="${job.id}"${tip("Cancel and get half the materials back")}>Cancel</button></div>
          ${bar((job.progress / job.hours) * 100, "var(--accent)")}
          <span class="muted">${i === 0 ? `${n1(left)} work-hours left` : "Waiting in queue"} · ${eta != null ? `done in about ${eta}h` : "paused"}</span>
        </div>`;
      }).join("") : `<div class="muted small">Nothing queued.</div>`}
    </div>
    <div>
      <h3>Build</h3>
      ${Object.entries(BUILDINGS).map(([k, d]) => {
        const chk = canBuild(state, b, k);
        return `<div class="card small"${tip(d.desc)}>
          <div class="spread"><b>${d.name}</b><button class="mini" data-action="queuebuild" data-base="${b.id}" data-type="${k}" ${chk.ok ? "" : "disabled"}${tip(chk.ok ? "Pay now; builders do the rest" : chk.reason)}>Build</button></div>
          <span class="muted">${Object.entries(d.cost).map(([c, v]) => `${v} ${c}`).join(", ")} · ${d.hours} work-hours · have ${count(b, k)}/${d.max}${chk.ok ? "" : ` · ${esc(chk.reason)}`}</span>
          ${lockLine(state, b, "building", k)}
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

function baseArmory(state, b) {
  const people = atBase(state, b.id);
  const slots = ["weapon", "armor", "tool"];
  return `
    <h3>Stored here (${b.armory.length})</h3>
    <div class="small">${b.armory.length ? b.armory.map((g) => `<span class="chip"${tip(gearTip(g))}>${esc(g.name)}${g.quality < 1 ? ` (${Math.round(g.quality * 100)}%)` : ""}${durTag(g)}</span>`).join("") : "<span class='muted'>Empty. Gear your teams bring home (and crafted gear) lands here.</span>"}</div>
    <h3>Equipment</h3>
    ${people.length ? `<table class="t"><tr><th>Survivor</th>${slots.map((s) => `<th>${SLOT_NAMES[s]}</th>`).join("")}<th${tip("Head, arms, legs and pack (inventory.js). Open the inventory to change them, fill pockets and packs, or swap with others here.")}>Worn and carried</th></tr>${people.map((s) => `<tr>
      <td><a data-action="survivor" data-id="${s.id}" class="link">${esc(s.name)}</a><br><span class="small muted">Shoot ${skill(s, "shooting")} · Stealth ${skill(s, "stealth")} · Combat ${combatPower(s).toFixed(1)}</span></td>
      ${slots.map((slot) => {
        const cur = s.gear[slot];
        return `<td class="small">${cur ? `<span${tip(gearTip(cur))}>${esc(cur.name)}${durTag(cur)}</span><br>${gapLabel(s, cur)}` : "<span class='muted'>—</span>"}<div class="row" style="margin-top:0.2rem">${gearControls(state, b, s, slot)}</div></td>`;
      }).join("")}
      <td class="small">${ensureInv(s) && ["head", "arms", "legs", "backpack"].map((k) => s.gear[k]).filter(Boolean).map((g) => `<span class="chip"${tip(gearTip(g))}>${esc(g.name)}${durTag(g)}</span>`).join("") || "<span class='muted'>—</span>"}
        <div class="muted">Armor ${Math.round(armorPower(s) * 10) / 10} · pockets ${s.pockets.filter(Boolean).length}/${s.pockets.length}</div>
        <button class="mini" data-action="inv-open" data-id="${s.id}"${tip("Open the paper-doll inventory")}>Inventory</button></td></tr>`).join("")}</table>` : `<div class="muted small">Nobody is here to equip.</div>`}
    ${keyRingCard(state)}`;
}

// ---------- crafting (hand-made, no station) ----------
function baseCrafting(state, b) {
  const people = atBase(state, b.id);
  const crew = crafters(state, b);
  const q = craftQueue(b);
  const others = people.filter((s) => s.role !== "craft");
  const abed = people.filter((s) => s.role === "craft" && s.inBed); // on the Craft role but in a hospital bed
  const best = (r) => Math.max(0, ...crew.filter((s) => skill(s, r.skill) >= r.min).map((s) => skill(s, r.skill)));
  let elapsed = 0;
  return `<div class="grid2">
    <div>
      <h3>Crafters</h3>
      <div class="card small">
        ${crew.length || abed.length ? [...crew, ...abed].map((s) => `<div class="spread"><span>${esc(s.name)}${bedTag(s)} <span class="muted">Mechanics ${skill(s, "mechanics")} · Medicine ${skill(s, "medicine")}</span></span>${roleSelect(state, s)}</div>`).join("") : `<span class="muted">Nobody on the Craft role.</span>`}
        ${others.length ? `<div style="margin-top:0.3rem"><select data-action="craftop"${tip("Set someone's role to Craft")}><option value="">Add a crafter…</option>${others.map((s) => `<option value="${s.id}">${esc(s.name)} (Mechanics ${skill(s, "mechanics")}, Medicine ${skill(s, "medicine")}, now ${ROLES[s.role]?.name || s.role})</option>`).join("")}</select></div>` : ""}
      </div>
      <h3>Queue (${q.length}/${MAX_CRAFT_QUEUE})</h3>
      ${q.length ? q.map((job, i) => {
        const r = CRAFTS[job.recipe];
        const why = craftJobStatus(state, b, job);
        const rate = craftRate(state, b, job.recipe);
        const left = job.hours - job.progress;
        elapsed += left;
        const eta = !why && rate > 0 ? Math.ceil(elapsed / rate) : null; // jobs ahead in the queue go first
        return `<div class="card small">
          <div class="spread"><b>${i === 0 ? "▶ " : ""}${esc(craftName(job.recipe))}</b><button class="mini" data-action="cancelcraft" data-base="${b.id}" data-id="${job.id}"${tip(job.progress > 0 ? "Cancel and get half the materials back" : "Cancel and get all the materials back (not started)")}>Cancel</button></div>
          ${bar((job.progress / job.hours) * 100, "var(--accent)")}
          <span class="muted">${n1(left)} of ${job.hours} work-hours left · ${why ? `<span class="danger">${esc(why)}</span>` : eta != null ? `about ${eta}h at the current pace${r.gear ? ` · condition about ${Math.round(craftQuality(best(r), r) * 100)}%` : ""}` : "paused"}</span>
        </div>`;
      }).join("") : `<div class="muted small">Nothing queued.</div>`}
      <div class="small muted" style="margin-top:0.4rem">Crafters work on the first job they have the skill for. Finished gear goes to the armory; equip it in the Armory tab. Makeshift gear is weaker than the real thing and breaks after a number of uses.</div>
      ${craftOrdersCard(state, b)}
    </div>
    <div>
      <h3>Recipes</h3>
      <div class="small muted" style="margin-bottom:0.4rem">${hasWorkshop(b) ? "A workshop is here: workshop recipes are open (and come out a bit better)." : "No workshop here: recipes marked Workshop need an ammo bench or machine shop at this base."}</div>
      ${Object.keys(CRAFTS).map((k) => {
        const r = CRAFTS[k];
        const chk = canCraft(state, b, k);
        const d = r.gear ? GEAR[r.gear] : null;
        return `<div class="card small"${tip(d ? `${d.desc || ""} Worth: ${worthTier({ key: r.gear, quality: 1 })}.` : r.desc)}>
          <div class="spread"><b>${esc(craftName(k))}</b><span>${r.needs ? `<span class="chip"${tip("Needs an ammo bench or machine shop at this base")}>Workshop</span>` : ""}${r.field ? `<span class="chip"${tip("Simple enough for a team to make on the road from what it carries")}>Field</span>` : ""}<button class="mini" data-action="queuecraft" data-base="${b.id}" data-recipe="${k}" ${chk.ok ? "" : "disabled"}${tip(chk.ok ? "Pay the materials now; crafters do the rest" : chk.reason)}>Craft</button></span></div>
          <span class="muted">${esc(craftInText(r))} · ${r.hours} work-hours · ${SKILL_NAMES[r.skill]} ${r.min}+</span><br>
          <span>→ ${esc(craftOutputText(k))}</span>${chk.ok ? "" : ` · <span class="danger">${esc(chk.reason)}</span>`}
          ${lockLine(state, b, "craft", k)}
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

function baseVehicles(state, b) {
  const here = vehiclesAtBase(state, b.id);
  const rep = canRepair(state, b);
  const elsewhere = state.vehicles.filter((v) => !(v.loc.kind === "base" && v.loc.baseId === b.id));
  const where = (v) => {
    if (v.loc.kind === "base") return `parked at ${esc(baseById(state, v.loc.baseId)?.name)}`;
    if (v.loc.kind === "party") return "out with a team";
    const m = state.markers.find((m) => m.key === `vehicle:${v.id}`);
    return m ? `abandoned near ${esc(tileLabel(state, m.tile))} (reported ${ageText(state, m)})` : "missing (no report yet)";
  };
  return `
    <h3>Parked here</h3>
    ${here.length ? here.map((v) => isBike(v) ? `<div class="card small"${tip("Bikes: one each for a team (pick them in the trip planner). No fuel; faster than walking on roads, walking pace off-road; each rack carries 15 kg and riding takes 55% of the load's slow-down and extra rations away. Bicycles found on searches join them when a team brings them home; a workshop can build more.")}>
      <div class="spread"><b>🚲 ${esc(vehicleLabel(v))}</b><span class="muted">${VEHICLE_TYPES.bike.rack} kg rack each</span></div>
      <div class="row"><span style="width:5.5rem" class="muted">Condition</span><div style="flex:1">${bar(v.condition, v.condition < 35 ? "var(--danger)" : "var(--good)")}</div><span style="width:3rem">${Math.round(v.condition)}%</span></div>
      <div class="row" style="margin-top:0.3rem"><button class="mini" data-action="repairv" data-base="${b.id}" data-id="${v.id}" ${(b.stock.scrap || 0) >= Math.ceil((v.count || 1) / 2) && v.condition < 100 ? "" : "disabled"}${tip("Patches, chain links, spokes: anyone can do it")}>Patch up (${Math.ceil((v.count || 1) / 2)} scrap)</button></div></div>` : `<div class="card small">
      <div class="spread"><b>${esc(v.name)}</b><span class="muted"${tip(`Riders (${RIDER_KG} kg each), what they wear and the cargo; loaded past 60% it burns more fuel (×1.3 at 100%, up to ×1.6 at 125%, the most it takes).`)}>${VEHICLE_TYPES[v.type].payload} kg payload</span></div>
      <div class="row"><span style="width:5.5rem" class="muted"${tip("Low condition means more breakdowns on the road")}>Condition</span><div style="flex:1">${bar(v.condition, v.condition < 35 ? "var(--danger)" : "var(--good)")}</div><span style="width:3rem">${Math.round(v.condition)}%</span></div>
      <div class="row"><span style="width:5.5rem" class="muted">Fuel</span><div style="flex:1">${bar((v.fuel / tank(v)) * 100, "var(--accent)")}</div><span style="width:3rem">${n0(v.fuel)}/${tank(v)}</span></div>
      <div class="row" style="margin-top:0.3rem">
        <button class="mini" data-action="refuel" data-base="${b.id}" data-id="${v.id}" ${v.fuel >= tank(v) || (b.stock.fuel || 0) < 1 ? "disabled" : ""}${tip(`Fill the tank from this base's fuel (${n0(b.stock.fuel)} in stock)`)}>Refuel</button>
        <button class="mini" data-action="repairv" data-base="${b.id}" data-id="${v.id}" ${rep.ok && (b.stock.parts || 0) >= 1 && v.condition < 100 ? "" : "disabled"}${tip(rep.ok ? `1 part → +${rep.per} condition` : "Needs a garage or a Mechanics 4+ survivor here")}>Repair (1 part)</button>
      </div></div>`).join("") : `<div class="muted small">No vehicles parked here.</div>`}
    ${elsewhere.length ? `<h3>Elsewhere</h3>${elsewhere.map((v) => `<div class="card small"><b>${esc(vehicleLabel(v))}</b> · ${where(v)}</div>`).join("")}` : ""}`;
}

// ---------- supply runs ----------
const STATUS_CHIP = { road: "on", holding: "on", blocked: "off" };
const SR_SKILLS = ["shooting", "stealth", "scouting", "mechanics", "medicine"];

function baseConvoys(state, b, ui) {
  if (ui.supplyForm && ui.supplyForm.originId === b.id) return supplyFormView(state, b, ui);
  const jobs = supplyRuns(state).filter((j) => j.originId === b.id || j.destId === b.id || jobParty(state, j)?.destBaseId === b.id);
  const others = state.bases.filter((x) => x.id !== b.id);
  return `<div class="spread" style="gap:1rem;align-items:flex-start"><div class="small muted">Convoy jobs between your own bases. A run takes supplies from the base it leaves, travels the road like any team (events, fuel, vehicle wear) and can bring goods back. Outposts hold back the stock these runs need instead of shipping it to the hub.</div>
    <button class="primary" data-action="sr-new" data-base="${b.id}" ${others.length ? "" : "disabled"}${tip(others.length ? `Set up a convoy that leaves from ${b.name}` : "You need a second base first: found an outpost")}>New supply run</button></div>
    ${jobs.length ? jobs.map((j) => jobCard(state, j, b)).join("") : `<div class="muted small" style="margin-top:0.6rem">No supply runs from or to ${esc(b.name)} yet.</div>`}`;
}

function jobCard(state, j, b) {
  const st = supplyStatus(state, j);
  const p = jobParty(state, j);
  const v = j.vehicleId ? state.vehicles.find((x) => x.id === j.vehicleId) : null;
  const crew = j.crewIds.map((id) => survivorById(state, id)).filter(Boolean);
  const awayFromOrigin = (s) => s.alive && !isCaptive(s) && s.location.kind === "base" && s.location.baseId !== j.originId;
  const crewTxt = crew.map((s) => {
    const note = !s.alive ? "dead" : isCaptive(s) ? "captive" : !p && awayFromOrigin(s) ? `at ${baseById(state, s.location.baseId)?.name}` : "";
    return `${first(s)}${note ? ` <span class="danger">(${esc(note)})</span>` : ""}`;
  }).join(", ");
  const idle = !p;
  const ended = j.status === "disbanded" || j.status === "done";
  const btn = (action, label, t, extra = "") => `<button class="mini" data-action="${action}" data-id="${j.id}" data-base="${b.id}"${extra}${tip(t)}>${label}</button>`;
  const end = j.atDest === "return" ? `Comes back with ${esc(linesText(j.pickup))}` :
    j.atDest === "hold" ? `Holds there${j.pickup.length ? `; brings back ${esc(linesText(j.pickup))} when sent home` : ""}` : "Disbands into the destination";
  return `<div class="card small srjob">
    <div class="spread"><b>${esc(jobName(state, j))}</b><span class="chip ${STATUS_CHIP[st.key] || ""}">${esc(st.text)}</span></div>
    <div class="kv" style="margin-top:0.3rem">
      <div>Crew</div><div>${crewTxt || `<span class="muted">none</span>`} · ${ESCORTS[escortFor(crew.filter((s) => s.alive).length)].name.toLowerCase()} escort</div>
      <div>Transport</div><div>${v ? `${esc(v.name)} <span class="muted">(fuel ${n0(v.fuel)}/${tank(v)}, condition ${Math.round(v.condition)}%)</span>` : "On foot with hand carts"}</div>
      <div>Delivers</div><div>${esc(linesText(j.deliver))}</div>
      <div>At the end</div><div>${end}</div>
      <div>Schedule</div><div>${j.repeat ? `Every ${j.repeat} day${j.repeat === 1 ? "" : "s"}` : "Once"} · ${STANCES[j.stance]?.name || ""} · ${j.runs || 0} run${j.runs === 1 ? "" : "s"} so far</div>
      ${j.lastResult ? `<div>Last</div><div class="muted">${esc(j.lastResult)}</div>` : ""}
    </div>
    <div class="row" style="margin-top:0.35rem;flex-wrap:wrap">
      ${idle && !ended ? btn("sr-dispatch", "Dispatch now", "Send the convoy now instead of waiting for its departure day. Repeating jobs count the next departure from today.") : ""}
      ${idle && j.status === "done" ? btn("sr-dispatch", "Run again", "Send this one-off run again now with the same crew and goods") : ""}
      ${p && p.phase === "holding" ? btn("sr-release", "Load up and come home", "The held convoy loads the pick-up goods and heads back to its home base", ` data-how="return"`) + btn("sr-release", "Disband here", "The crew join this base as staff and the vehicle parks here. The job is kept as a template.", ` data-how="disband"`) : ""}
      ${!ended && j.repeat ? (j.paused ? btn("sr-resume", "Resume", "Start sending convoys on schedule again") : btn("sr-pause", "Pause", "Stop new departures. A convoy already on the road finishes its trip.")) : ""}
      ${btn("sr-edit", "Edit", "Change crew, vehicle, goods, schedule or what happens at the destination. Changes apply to the next run.")}
      ${ended || (idle && crew.some(awayFromOrigin)) ? btn("sr-recreate", "Recreate convoy", "Set the job up again with the crew picked where they are now. From the destination it runs the other way, with deliver and pick-up swapped.") : ""}
      ${btn("sr-delete", "Delete", p ? "Remove the job. The convoy on the road finishes its trip and comes home." : "Remove the job")}
    </div>
  </div>`;
}

function supplyFormView(state, b, ui) {
  const f = ui.supplyForm;
  const dests = state.bases.filter((x) => x.id !== b.id);
  const dest = baseById(state, f.destId);
  const est = supplyEstimate(state, f);
  const here = atBase(state, b.id);
  const away = f.crew.filter((id) => !here.some((s) => s.id === id)).map((id) => survivorById(state, id)).filter(Boolean);
  const crewBox = (s, note) => `<label class="${f.crew.includes(s.id) ? "on" : ""}"${tip(note ? `${s.name} is not at ${b.name} right now. They go only if they are back here on departure day.` : `${s.name}: ${ROLES[s.role]?.name || s.role} here. On departure day they leave that work; their current gear goes with them.`)}><input type="checkbox" data-action="sr-crew" data-id="${s.id}" ${f.crew.includes(s.id) ? "checked" : ""}>
      <span><b>${s.leader ? "★ " : ""}${esc(s.name)}</b> <span class="muted small">HP ${n0(s.health)} · ⚔ ${combatPower(s).toFixed(1)} · ${note ? `<span class="danger">${esc(note)}</span>` : ROLES[s.role]?.name || s.role}</span><br>
      <span class="small">${SR_SKILLS.map((k) => `${SKILL_SHORT[k]} ${skill(s, k)}`).join(" · ")}</span><br>
      <span class="small muted">${[s.gear.weapon, s.gear.armor, s.gear.tool].filter(Boolean).map((g) => esc(g.name)).join(", ") || "No gear"}</span></span></label>`;
  const awayNote = (s) => (!s.alive ? "dead" : isCaptive(s) ? "held captive" : s.location.kind === "base" ? `at ${baseById(state, s.location.baseId)?.name || "another base"}` : "away");
  const parked = carsAtBase(state, b.id);
  const jobV = f.vehicleId && !parked.some((x) => x.id === f.vehicleId) ? state.vehicles.find((x) => x.id === f.vehicleId) : null;
  const lineRows = (list, from) => `${f[list].map((l, i) => `<div class="row srline">
      <select data-action="sr-line" data-list="${list}" data-i="${i}" data-f="key"${tip("Which supply")}>${SUPPLY_KEYS.map((k) => `<option value="${k}" ${l.key === k ? "selected" : ""}>${SUPPLIES[k].name}</option>`).join("")}</select>
      <input type="number" min="0" data-action="sr-line" data-list="${list}" data-i="${i}" data-f="qty" value="${l.qty}"${tip(`How many. Weight ${SUPPLIES[l.key]?.weight ?? 1} each.`)}>
      <span class="muted small">${from ? `${esc(from.name)} has ${n0(from.stock[l.key])}` : ""}</span>
      <button class="mini" data-action="sr-delline" data-list="${list}" data-i="${i}"${tip("Remove this line")}>✕</button></div>`).join("")}
    <button class="mini" data-action="sr-addline" data-list="${list}"${tip(list === "deliver" ? "Add another supply to send" : "Add another supply to bring back")}>+ Add line</button>`;
  return `<h3 style="margin-top:0.2rem">${f.mode === "recreate" ? "Recreate supply run" : f.jobId ? "Edit supply run" : "New supply run"} from ${esc(b.name)}</h3>
  <div class="grid2">
    <div>
      <div class="row">Destination <select data-action="sr-dest"${tip("The base the convoy goes to")}>${dests.map((x) => `<option value="${x.id}" ${x.id === f.destId ? "selected" : ""}>${esc(x.name)}${x.type === "hub" ? " (hub)" : ""}</option>`).join("")}</select></div>
      <h3>Crew (${f.crew.length})</h3>
      <div class="small muted" style="margin-bottom:0.3rem">They work here between runs. Their gear goes with them: change it in the <a class="link" data-action="basetab" data-tab="armory"${tip("Open the armory. This form stays open; come back to the Supply runs tab.")}>Armory</a> tab.</div>
      <div class="crew" style="grid-template-columns:1fr">${here.map((s) => crewBox(s, "")).join("")}${away.map((s) => crewBox(s, awayNote(s))).join("")}${here.length || away.length ? "" : `<span class="muted">Nobody is here.</span>`}</div>
      <h3>Transport</h3>
      <div class="choices">
        <button data-action="sr-vehicle" data-v="" class="${!f.vehicleId ? "active" : ""}"${tip("Hand carts: slower, quiet, carry only what people can (by weight: 40 kg each less what they wear, 28 with a bad back)")}>On foot with hand carts</button>
        ${parked.map((x) => `<button data-action="sr-vehicle" data-v="${x.id}" class="${f.vehicleId === x.id ? "active" : ""}" ${x.condition <= 0 ? "disabled" : ""}${tip(`Fast on roads, cannot cross mountains. Burns about 0.6 fuel per road tile, 1.5 off-road; the tank is topped up from ${b.name}'s fuel on departure. Carries +${VEHICLE_TYPES[x.type].capacity}. If it is missing, broken or short of fuel on departure day, the convoy goes on foot when the load fits, otherwise it waits.`)}>${esc(x.name)}<span class="hint">Fuel ${n0(x.fuel)}/${tank(x)} · condition ${Math.round(x.condition)}% · +${VEHICLE_TYPES[x.type].capacity} carry</span></button>`).join("")}
        ${jobV ? `<button class="active" data-action="sr-vehicle" data-v="${jobV.id}"${tip("Picked earlier, but not parked here right now")}>${esc(jobV.name)}<span class="hint">Not parked here right now</span></button>` : ""}
      </div>
      <h3>Stance</h3>
      <div class="row">${Object.entries(STANCES).map(([k, s]) => `<button data-action="sr-stance" data-v="${k}" class="${f.stance === k ? "active" : ""}"${tip(s.desc)}>${s.name}</button>`).join("")}</div>
    </div>
    <div>
      <h3>Deliver (from ${esc(b.name)})</h3>
      ${lineRows("deliver", b)}
      <label class="small" style="display:block;margin-top:0.3rem"${tip("Off: the run waits until the full amount is in stock. On: it leaves with whatever there is.")}><input type="checkbox" data-action="sr-partial" ${f.allowPartial ? "checked" : ""}> Send what there is if short</label>
      <h3>At the destination</h3>
      <div class="row">${Object.entries(AT_DEST).map(([k, a]) => `<button data-action="sr-atdest" data-v="${k}" class="${f.atDest === k ? "active" : ""}"${tip(a.desc)}>${a.name}</button>`).join("")}</div>
      <h3>Bring back (from ${esc(dest ? dest.name : "the destination")})</h3>
      ${f.atDest === "disband" ? `<div class="small muted">Nothing: a disbanded convoy stays there.</div>` : lineRows("pickup", dest)}
      <h3>Schedule</h3>
      <div class="row">
        <button data-action="sr-sched" data-v="once" class="${f.schedule === "once" ? "active" : ""}"${tip("One trip, leaving at the next dawn (or press Dispatch now in the list)")}>Once</button>
        <button data-action="sr-sched" data-v="repeat" class="${f.schedule === "repeat" ? "active" : ""}"${tip("Leaves automatically every few days. If the last convoy is still out, the next one waits for it.")}>Repeat</button>
        ${f.schedule === "repeat" ? `every <input type="number" min="1" style="width:4rem" data-action="sr-every" value="${f.every}"${tip("Days between departures")}> days` : ""}
      </div>
      <h3>Estimate</h3>
      ${est.error ? `<div class="danger">${esc(est.error[0].toUpperCase() + est.error.slice(1))}.</div>` : `<div class="kv small">
        <div>Distance</div><div>${est.tiles} tiles ${est.useVehicle ? `by ${esc(est.v.name)}` : "on foot"}</div>
        <div>Travel</div><div>~${Math.ceil(est.hoursOut)}h each way · whole trip ~${(est.hours / 24).toFixed(1)} days</div>
        <div${tip("Taken from this base on departure: at least enough for the way out, ideally the whole trip. The way back is topped up at the destination when it can be.")}>Road supplies</div><div>${est.need}–${est.want} food · ${est.needWater ?? est.need}–${est.wantWater ?? est.want} water${est.useVehicle ? ` · ${est.fuelWant} fuel` : ""}</div>
        <div${tip("Weight of the delivery against what the crew (and vehicle) can carry")}>Load</div><div class="${est.load > est.capacity ? "danger" : ""}">${Math.ceil(est.load)} / ${est.capacity}</div>
        <div${tip("Set by crew size. Light (1): fewer zombie troubles, raiders see an easy target. Standard (2-4). Heavy (5+): deters small raids, draws zombies and big raids.")}>Escort</div><div>${ESCORTS[escortFor(f.crew.length)].name}</div>
      </div>`}
      ${!est.error && est.warnings.length ? `<div class="small warn" style="margin-top:0.4rem">${est.warnings.map(esc).join("<br>")}</div>` : ""}
    </div>
  </div>
  ${ui.supplyError ? `<div class="danger" style="margin-top:0.6rem">${esc(ui.supplyError)}</div>` : ""}
  <div class="row" style="margin-top:0.8rem;justify-content:flex-end"><button data-action="sr-cancel"${tip("Close the form without saving")}>Cancel</button><button class="primary" data-action="sr-save" ${f.crew.length && f.destId ? "" : "disabled"}${tip("Save the job. It leaves at the next dawn, or press Dispatch now in the list.")}>${f.jobId ? "Save changes" : "Create supply run"}</button></div>`;
}
