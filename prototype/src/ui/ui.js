// DOM panels and modals. Every user action goes through the action dispatcher in main.js.
// Any element with data-tip="..." shows a hover description.
import { unseenOutpost } from "../sim/hiding.js"; // the groups' hidden outposts you have not found
import { TERRAIN, LOCATIONS, SITE_ZONES, DANGER_NAMES, siteDanger, SUPPLIES, SUPPLY_KEYS, STOCK_KEYS, GEAR, SKILLS, SKILL_NAMES, TRAITS, FACTION_TYPES } from "../sim/data.js";
import { traitChips, traitChip, traitWords } from "./traitpick.js"; // trait chips: coloured by kind, the tier
import { traitOf } from "../sim/traits.js";
import {
  day, hourOfDay, isNight, hub, alive, atBase, skill, combatPower, factionById, survivorById, baseById, gearEffect, RADIO_RANGE, residents,
} from "../sim/world.js";
import { freeBeds, MOVE_OUT, CROWD_CARD, enterOption } from "../sim/moveout.js"; // the move-out planner (moveOutModal) and the base screen's button; Enter base
import { crowdLevel } from "../sim/morale.js";
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
import { hiveDanger, hiveTracker, hiveAt } from "../sim/hives.js";
import { siteText } from "../sim/hivebirth.js"; // a build site: the dead massed and the days to a hive, as known
import { HIVE, BOSS_NAMES, GROWTHS, ZTYPES, TECH, SHEPHERD } from "../sim/hiveconst.js";
import { LADDER, RAM, DROP, CUT } from "../sim/siege.js";
import { FIRE, FRAG, BLAST, FLASH } from "../sim/throwables.js";
import { growthAt, growthInfo, growthsOf, hiveTier } from "../sim/hivetech.js";
import { mixText } from "../sim/zombietypes.js";
import { snapshot } from "../sim/world.js";

// What each kind of special dead in a horde does and what beats it (sim/hiveconst.js ZTYPES), for a tooltip.
const specialTip = (mix) => Object.keys(mix || {}).filter((k) => ZTYPES[k]).map((k) => `${ZTYPES[k].name}: ${ZTYPES[k].special} Counter: ${ZTYPES[k].counter}`).join(" · ");
import { ERAS } from "../sim/eras.js";
import { ROLES, ESCORTS, supplyLine, farmOutput, scavengeOutput, foodForecast } from "../sim/economy.js";
import { baseFarming, foodCellHtml, waterCellHtml, foodLine, waterLine, woodLine, storeCellHtml, upkeepCellHtml, upkeepLine } from "./farming.js";
import { HEAT } from "../sim/upkeep.js"; // the boiler's fuel a head in the help (firewood × HEAT.wood)
import { conditionChips, conditionTreatRow, illnessCard, isSick, bedChip, healPerDayText, nextTreatLine, illnessRowHtml, illnessSummary, othersWormHtml } from "./health.js";
import { APPROACHES, heatStage, foundLoad, engagementParty } from "../sim/scavenge.js";
import { activeCrawl } from "../sim/citycrawl.js";
import { crawlModal } from "./citycrawl.js";
import { activeHiveCrawl, crawlRecText } from "../sim/hivecrawl.js";
import { hiveCrawlModal } from "./hivecrawl.js";
import { tradeContext, tradeTotals, sellPrice, buyPrice, canRadio } from "../sim/trade.js";
import {
  BUILDINGS, RECIPES, stations, stationStatus, canBuild, buildRate, buildingSummary, farmSlots, baseBeds, count, isShelter, isCamp, CAMP, SHELTER, tierName, tierUpType, tierUpJob, gatherRows, gatherCap, gatherStalled, gatherShort, matName,
  PLOTS, PLOT_NAMES, plotCap, plotsUsed, WATER_BARREL, barrels, barrelTier, barrelCap, barrelHolds, barrelName, canUpgradeBarrel, canDemolish, demolishRefund, jobName as buildJobName, canExpandBunkhouse, BARRACKS_UP, BENCH, benchType,
} from "../sim/buildings.js";
import { VEHICLE_TYPES, tank, vehiclesAtBase, carsAtBase, bikesAtBase, partyVehicle, partyFleet, canRepair, partyFuel, isBike, isCar, travelMode, vehicleLabel, RIDER_KG, payloadOf, upgradeText, upgradeEffects, upgradeOptions, garageQueue, garageJobStatus, vehicleValue, costText, vehicleById, SHOP_TEXT, carPartsCost, carPartsText, stripYield } from "../sim/vehicles.js";
import { teamLoad, wornLoad, maxLoad } from "../sim/load.js";
import { loadRows, carLine, paceLine, loadWarnings, BANDS_HELP } from "./loadview.js";
import { MARKER_TYPES, LAYERS } from "../sim/markers.js";
import { ageText, liveSet, mapLoc, ruinInfo, coalitionLand } from "./render.js";
import { searchedDay } from "../sim/discovery.js";
import { lootBand, LOOT_BANDS } from "../sim/aiscav.js";
import { conflictView, captivesOf, isCaptive, fightOdds } from "../sim/conflicts.js";
import { dealFor, talksOf, returnsOf } from "../sim/ransom.js"; // ransoms: the deal, the envoy, the way home
import { RETREAT_POLICIES, POLICY_ORDER, teamPolicy, policySource, fightForecast, forecastText } from "../sim/breakoff.js";
import { AT_DEST, supplyRuns, supplyRunById, jobParty, jobName, linesText, supplyStatus, supplyEstimate, escortFor } from "../sim/supply.js";
import { newRunScreen, zombieLookModal, appearanceEditor } from "./newgame.js";
import { survivorURL, spriteImg } from "./sprites.js";
import { renderExpedition, startsWhenUnpaused } from "./expedition.js";
import { shortName } from "./names.js";
import { orderStatus, contactable } from "../sim/orders.js";
import { planSection, planAutofill, planEstimate } from "./plan.js";
import { plannerTrips, teamsTrips } from "./trips.js"; // order templates, recent trips (Repeat trip)
import { undoBtn, buildMoveBtns } from "./undo.js"; // undo, and the build queue's ▲ ▼
import { commandable, NO_RADIO } from "../sim/plans.js";
import { teamRadioLine } from "./radiolisten.js"; // a team's receiver out of contact: what it hears (sim/radiolisten.js)
import { season as wxSeason, weather as wxNow, weatherReport, SEASON_DAYS, frontsApproaching } from "../sim/weather.js";
import { activeHospital, patients, healRatePerHour, hospitalTypes, nextHospitalType, isHurt, treatAtBaseInfo, fieldTreatInfo, partyMeds } from "../sim/medical.js";
import { CRAFTS, craftName, craftQueue, crafters, craftRate, canCraft, craftJobStatus, craftOutputText, craftQuality, hasWorkshop, itemDur, itemDurMax, durUnit, MAX_CRAFT_QUEUE, craftInText, benchQuality, benchNeeded, hasBench, craftMean } from "../sim/crafting.js";
import { craftEdge } from "../sim/blueprints.js"; // the crafting edge from known manuals and read craft books
import { orderCell, racksCard, powerCard, craftOrdersCard, stewardCard, pinButton, reloadCard } from "./production.js";
import { canUpgradeAmmoBench, RELOAD } from "../sim/reloading.js"; // the reloading bench: an ammo bench upgraded where it stands
import { EQUIP_SLOTS, SLOT_NAMES, ensureInv, personPlace, armorPower } from "../sim/inventory.js";
import { inventoryModal, takeLootReq } from "./inventory.js";
import { teamInvModal, teamsHereCard, transferButtons } from "./teaminv.js"; // the team inventory window; teams on a base's tile; Drop off / Load on its tile
import { fleetPicker } from "./fleetpick.js"; // the vehicle picker the planners share (up to four)
import { plannedFleet, pickProblem } from "../sim/teamform.js";
import { teamFormModal, formTeamButton, editTeamButton, formTeamRow } from "./teamform.js"; // Form a team… at a base; Edit team… for a team waiting on one
import { gunBuilderModal, GUNBUILDER_HELP } from "./gunbuilder.js"; // the gun builder (over the inventory or the base screen)
import { isGunKey } from "./gunart.js";
import { BATTLE_GUNS_HELP } from "./combat.js"; // fire modes, jams, suppressing fire, a thrown spear, the ammo a reload takes
import { LAUNCH_HELP } from "../sim/launchers.js"; // grenade launchers, rockets, explosions vs gear (section 13, 24)
import { tradeWindow, radioModal, caravanPlanModal, groupsRadioHeader, caravanLines } from "./tradewindow.js";
import { recruitModal, crowdingRow, moodRiskChip } from "./people.js";
import { backgroundInfo } from "../sim/hardcore-start.js"; // who they were before Calder fell (a hardcore start; a preset or a custom one)
import { backgroundEditor } from "./backgrounds.js"; // the new-run screen's custom backgrounds window
import { startGearEditor } from "./startgear.js"; // the new-run screen's starting gear window (Customize)
import { skillsBlock, skillTree, studyBlock } from "./skills.js";
import { trainingInfo, TRAINING, PROFESSOR, lessonGap } from "../sim/training.js"; // the hospital trains medics: ward rounds, the doctor, trainees
import { skillProgress } from "../sim/skills.js";
import { relChip, moodTipAttr, relationsSection, memorialModal, memorialButton } from "./relations.js";
import { whyModal, cardWhy } from "./causes.js"; // "Why?": the chain of causes of a death or a lost base
import { familyChip, familyBlock, childrenPeople } from "./family.js"; // children and families (sim/family.js)
import { diaryModal } from "./diary.js";
import { rosterModal } from "./roster.js";
import { codexModal, codexButton } from "./codex.js"; // the Codex window (C) and its top-bar button
import { keyLabel } from "./keymap.js"; // a key as it is bound now (Menu → Controls)
import { groupsDiploHeader, groupCardExtras, diplomacyModal, plannerJobNote, bandsSection } from "./diplomacy.js";
import { volRequestModal, volPickModal, volAskButton, teamVolLine, plannerVolRow } from "./volunteers.js"; // volunteers (sim/volunteers.js)
import { lentLine } from "../sim/volunteers.js";
import { ALLIANCE, goalsProgress } from "../sim/alliance.js";
import { claimText, wellText, CLAIM, WELL_SHORE, WELL_YIELD } from "../sim/claims.js"; // land claims and wells (the tile panel, the help)
import { MIL_RADIO_RANGE, GROUP_REACH, GROUP_NET_RANGE } from "../sim/radio.js";
import { LISTEN } from "../sim/radiolisten.js";
import { occupiedAt, occupiedText, assaultWarning, assaultForce } from "../sim/conquest.js";
import { occupyPreview, abandonProblem } from "../sim/occupy.js"; // Occupy: moving into an abandoned base; Abandon outpost
import { claimsTaken, claimsTakenText } from "../sim/claims.js"; // Build outpost: the groups' claims it would take
import { abandonedAt } from "../sim/groupworld.js";
import { repairsTab, blueprintsCard, keyRingCard, lockLine } from "./explore.js";
import { prisonTab } from "./prisoners.js";
import { settingsModal } from "./settings.js";
import { swatch } from "./help.js";
import { outsidersSection } from "./visitors.js";
import { workTab, roleSelect as workRoleSelect, taskChip } from "./work.js";
import { pickBar, pickCard, ownBaseCard, groupBaseCard } from "./mapselect.js"; // teams, parties and bands selected on the map; a base's card
import { defenceTab } from "./defence.js"; // the watch roster and the defence plan
import { huntInfo, gameWord, fishKit, expectFish, fishLevel, snareLine, expectSnare, bestHuntWeapon, hunterMult, HUNT, frozenAt, meatAt, gameAbundance, partyHuntMix, huntMixOf, HUNT_METHODS, METHOD_NAMES } from "../sim/hunting.js";
import { herdAt, infestedShare, WORM, wormMeatAt, baseWater, searchRiskText, boilerUse, armoryTabs } from "../sim/worm.js";
import { LIGHTS, lightsPreview, litCount } from "../sim/lights.js"; // the planner's Lights line
import { waterIn, waterText, RAW, keyWord } from "../sim/water.js"; // purified and un-purified water
import { forageInfo, foragerMult, FORAGE } from "../sim/foraging.js";
import { woodInfo, WOOD, boilerJunkOn, boilerBurnables, burnablesWood } from "../sim/woodcutting.js";
import { roleOf, isManaged, taskLabel, taskWhy, priorityCount } from "../sim/work.js";
import { nameModalUp, nameBaseModal, renameButton } from "./basename.js"; // naming and renaming bases
import { firstHubCard, fromTeamRow, stagingTileCard, fireButton, stageSteps } from "./hardcore.js";
import { stagingView, needText, ESTABLISH_LABEL, STAGING, shelterView, STRIKE_LABEL } from "../sim/staging.js";
import { gaugeRows, treatsRow, needsEffectText } from "./needs.js";
import { needsBar } from "./needsbar.js"; // the top bar's Needs button and its drop-down of every supply
import { statusIcons } from "./status.js"; // low mood, starving, thirsty, low health, infected, sick (sim/status.js)
import { STATUS, STATUS_ICONS } from "../sim/status.js";
import { NEEDS, STARVE } from "../sim/needs.js";
import { ledgerModal, runSummaryHTML, stockChipTrend } from "./ledger.js"; // the Ledger, the run summary, the stock trends
import { watchlistPin } from "./watchlist.js"; // 📌 pin to the Watching panel
import { cardUp, trayCardFrame, MAX_SPEED } from "./pacing.js"; // pause rules and the card tray
import { devButton } from "./display.js"; // the top bar's Dev button (Menu → Options → Display → Show dev tools)
import { totalRounds, sumRecs, supplyAmt, ROUND_KEYS } from "../sim/rounds.js"; // rounds by calibre
import { roundsLine, baseAmmo, baseAmmoBreakdown, teamAmmoBreakdown, breakdownText } from "../sim/ammo.js";
import { panelHead, panelTab } from "./layout.js"; // the boxes over the map share one header and folded tab
import { fold, peopleQuery, peopleIsCompact } from "./panelfold.js"; // side-panel folds; the People tab's find box and view

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n0 = (v) => Math.floor((v || 0) + 1e-9);
const n1 = (v) => (Math.round((v || 0) * 10) / 10).toString();
const bar = (v, color) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></i></div>`;
const attColor = (a) => ({ Hostile: "var(--danger)", Neutral: "var(--muted)", Friendly: "var(--good)", Allied: "var(--accent)" }[a]);
const clock = (state) => `${String(hourOfDay(state)).padStart(2, "0")}:00`;
const first = (s) => esc(shortName(s)); // first name, with a last initial when two people share it (names.js)
// Short skill labels for crew lists (whole words, never cut mid-word).
const SKILL_SHORT = { scouting: "Scout", stealth: "Stealth", shooting: "Shoot", scavenging: "Scav", speech: "Speech", medicine: "Med", mechanics: "Mech", farming: "Farm", leadership: "Lead", crafting: "Craft", melee: "Melee" };
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
// The status icons next to a name, for someone you are in touch with (ui/status.js).
const stIcons = (state, s) => (s && s.alive && inContact(state, s) ? statusIcons(state, s) : "");
// The role drop-down: work roles (priorities) and fixed jobs (Manual), with what they do now (ui/work.js).
const roleSelect = (state, s, extra = "") => `${workRoleSelect(state, s, extra)}${taskChip(state, s)}`;

// ---------- top bar ----------
// The top bar in pieces (the slots in index.html): the clock and the stock change with the hour, the buttons only
// when you press them, so each piece is redrawn only when its own text changes (main.js).
export function topbarParts(state, ui) {
  const h = hub(state);
  const nb = needsBar(state, h);
  const speeds = [[0, "⏸", "Pause (Space). Orders you give while paused start when you unpause."], [0.5, "0.5×", "Slow: an hour takes 40 seconds, a day 16 minutes (1)"], [1, "1×", "Normal: an hour takes 20 seconds, a day 8 minutes (2)"], [2, "2×", "Fast: an hour takes 10 seconds, a day 4 minutes (3)"], [3, "3×", "Very fast: an hour takes about 7 seconds, a day 2 minutes 40 seconds (4)"], [5, "5×", "Fastest, for quiet stretches: an hour takes 4 seconds, a day about 1 minute 36 seconds (5). At 3× and 5× the clock drops back to 1× when a card or a red alert arrives (Options)"]];
  const parts = {
    // The minutes are a slot of their own (main.js fills it every frame as the hour goes by).
    clock: `Day ${day(state)} · ${String(hourOfDay(state)).padStart(2, "0")}:<span id="tb-min">00</span> ${isNight(state) ? "🌙" : "☀"}${weatherChip(state)}`,
    speed: speeds.map(([s, l, t]) => `<button data-action="speed" data-speed="${s}" class="${ui.speed === s ? "active" : ""}"${tip(t)}>${l}</button>`).join("") +
      (ui.speed > MAX_SPEED ? `<button data-action="speed" data-speed="1" class="active"${tip("Dev fast forward is running. Click to go back to 1×.")}>${ui.speed}× dev</button>` : ""),
    // The stores as one Needs button with a drop-down list (ui/needsbar.js): main.js writes its button, head and list
    // as slots of their own (needs), the whole of it is the stock slot (tools and tests).
    stock: nb.html,
    people: `<span${tip("Survivors alive across all bases and teams")}>👥 ${alive(state).length}</span>`,
    // UI size and the zombie look are in Menu → Options → Display; the Dev button only with Show dev tools on (ui/display.js).
    tools: `${devButton(ui)}
      <button data-action="ld-open"${tip(`Ledger: production and use of every resource, stock, people, mood and Heat day by day, per base; and the run summary (${keyLabel("win.ledger")})`)}>📈 Ledger</button>
      <button data-action="dy-open"${tip(`Diary: the whole run day by day, with filters and search (${keyLabel("win.diary")})`)}>📖 Diary</button>
      <button data-action="ro-toggle"${tip(`Roster: everyone in one table, sortable, with roles you can change for many at once (${keyLabel("win.roster")})`)}>👥 Roster</button>
      ${codexButton(state)}
      <button data-action="pal-open"${tip(`Search: people, bases, teams, groups, places, buildings, the menu and help (${keyLabel("win.palette")})`)}>🔍 Search</button>
      <button data-action="help"${tip("How the game works, and the keys")}>Help</button>
      <button data-action="set-open"${tip("Menu: save, load, save and exit, new campaign, options (Esc)")}>⚙ Menu</button>`,
  };
  Object.defineProperty(parts, "needs", { value: nb }); // { btn, head, list }: not one of the slot strings
  return parts;
}
// The planner's weather note: hours the weather adds to the trip compared with fair weather.
function weatherEta(est) {
  const out = est.weatherOut || 0, all = out + (est.weatherBack || 0);
  if (!out && !all) return "";
  const sg = (h) => `${h > 0 ? "+" : "−"}${Math.abs(h)}h`;
  return ` <span class="${out > 0 ? "warn" : "muted"}"${tip(`Weather (mud, snow, storms, fog) changes this trip by ${sg(out)} on the way out and ${sg(all)} over the round trip, compared with fair weather. The estimate already includes it, as far as anyone can tell: the ground and the storm, rain, snow and fog fronts already on the map (they keep their course). A front that forms later can still slow the team.`)}>${sg(out)} weather</span>`;
}

// Season and the weather at the hub next to the clock, and a storm or blizzard front on its way there (within 12
// hours); hover for effects, the fronts on the map and the outlook (weather.js).
function weatherChip(state) {
  const se = wxSeason(state), w = wxNow(state);
  const next = w.severe ? null : frontsApproaching(state).find((x) => x.severe && x.eta != null && x.eta <= 12);
  return `<span class="wx" data-tip-pre${tip(weatherReport(state))}>${se.icon} ${se.name} ${se.dayOfSeason}/${SEASON_DAYS} · ${w.icon} ${Math.round(w.temp)}°C${w.severe ? " ⚠" : ""}${next ? ` · ${next.icon} in ${next.eta}h` : ""}</span>`;
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
  return firstHubCard(state) + state.bases.map((b) => {
    const people = atBase(state, b.id);
    const fc = foodPerDay(state, b);
    const job = b.construction[0];
    const rate = buildRate(state, b);
    const line = b.type === "outpost" ? (b.supplyLine || supplyLine(state, b)) : null;
    const beds = baseBeds(b);
    // The card in four groups (styles.css .pk): how the base stands, its supplies, what threatens it, what it is
    // building and who it talks to. Every row is a label and a value; long values wrap or fold.
    // On top a strip of chips (people, defence, heat, food and any warning) that opens the full card under it.
    const detail = `<div class="pk small">
        ${pkSec("Status")}
        <div class="kv">
          <div>People</div><div><span class="${people.length > beds ? "warn" : ""}"${people.length > beds ? tip("More people than beds: crowding lowers mood and raises the chance of illness") : ""}>${people.length} / ${beds} beds</span>${meter(beds ? people.length / beds : 1, people.length > beds ? "var(--danger)" : "var(--info)")}</div>
          <div${tip("Walls, guards and everyone else at the base. Ammo shortages cut it by 30%.")}>Defense</div><div class="pk-num">${Math.round(baseDefense(state, b))}</div>
          <div${tip("Noise and light that draw hordes. Workshop operators add 3 each.")}>Heat</div><div class="pk-num">${baseHeat(state, b)}</div>
        </div>
        ${pkSec("Supplies")}
        <div class="kv">
          <div${tip("Days of food left at today's rate without harvests, and the next harvest (crops ripen in batches)")}>Food</div>${foodCellHtml(state, b)}
          <div${tip("Water per day (in minus out), stock and capacity, days left")}>Water</div>${waterCellHtml(state, b)}
          ${supplySummary(state, b)}
          ${line ? `<div${tip("Share of outpost surplus that reaches the hub, and how long backup takes")}>Supply line</div><div class="${line.strength < 0.6 ? "danger" : "good"}">${Math.round(line.strength * 100)}% · ETA ${isFinite(line.hours) ? line.hours + "h" : "cut off"}</div>` : ""}
          <div${tip("Food and water used up a day: a rate per person × everyone fed here (hover for the breakdown)")}>Upkeep</div>${upkeepFold(state, b)}
        </div>
        ${pkSec("Risks")}
        <div class="kv">
          ${holdRow(state, b)}
          ${illnessRowHtml(state, b)}
        </div>
        ${pkSec("Infrastructure")}
        <div class="kv">
          <div>Building</div><div>${job ? `${buildJobName(job)}: ${rate > 0 ? `${Math.ceil((job.hours - job.progress) / rate)}h left` : "paused, no builders"}` : "<span class='muted'>Nothing queued</span>"}</div>
          ${caravanLines(state, b)}
        </div>
      </div>`;
    return `<div class="card">
      <div class="spread pk-head"><h2 style="margin:0">${esc(b.name)}</h2><span class="muted small">${tierName(b)} ${watchlistPin(state, "base", b.id, b.name)}</span></div>
      ${fold(`base:${b.id}`, baseStrip(state, b, people.length, beds), detail, { cls: "pf-card", tipText: "Show or hide the details: status, supplies, risks, building and radio" })}
      <div class="row pk-foot"><button class="primary" data-action="openbase" data-id="${b.id}"${tip("Workshops, buildings, construction, armory and vehicles")}>Manage</button><button data-action="center" data-tile="${b.tile}"${tip("Center the map here")}>Locate</button>${renameButton(b, "✎ Rename")}</div>
    </div>`;
  }).join("") + (!stagingView(state) ? `<div class="small muted pk-hint">Found outposts by sending a team and choosing Build outpost: an hour sets up a camp (nothing carried); 20 scrap and 2 building materials brought in establish it.</div>` : "");
}
// A base at a glance (the Bases tab card's fold line): people and beds, defence, heat, days of food, and the red
// warnings (crowded, cold, the boiler unlit, ill with no meds) so they show with the card folded.
function baseStrip(state, b, n, beds) {
  const f = foodLine(state, b);
  const u = upkeepLine(state, b);
  const sick = illnessSummary(state, b);
  const chip = (cls, text, t) => `<span class="bs-chip${cls ? ` ${cls}` : ""}"${tip(t)}>${text}</span>`;
  return `<span class="bs-strip">${chip(n > beds ? "danger" : "", `👥 ${n}/${beds}`, `People ${n}, beds ${beds}${n > beds ? ". More people than beds: crowding lowers mood and raises the chance of illness" : ""}`)}` +
    chip("", `🛡 ${Math.round(baseDefense(state, b))}`, "Defense: walls, guards and everyone else at the base. Ammo shortages cut it by 30%.") +
    chip("", `🔥 ${baseHeat(state, b)}`, "Heat: noise and light that draw hordes. Workshop operators add 3 each.") +
    chip(f.cls, `🥫 ${esc(f.short.split(" · ")[0])}`, `Food: ${f.short}. ${f.tip}`) +
    (u.cold ? chip("danger", "❄ Cold", "Out of firewood and fuel: everyone here is cold") : "") +
    (u.boilerCold ? chip("danger", "💧 Boiler cold", "The water boiler is cold today: nothing to burn, the water is unboiled") : "") +
    (sick.noMeds ? chip("danger", "💊 No meds", "People here are ill and there are no meds at this base to treat them") : "") + `</span>`;
}
// A section heading inside a side-panel card (Status, Supplies, ...), and a thin bar under a value (share 0..1).
const pkSec = (name, tipText = "") => `<div class="pk-sec"${tip(tipText)}>${name}</div>`;
const meter = (share, color) => `<span class="pk-meter" aria-hidden="true"><i style="width:${Math.round(Math.max(0, Math.min(1, share)) * 100)}%;background:${color}"></i></span>`;
// The Upkeep row in the Bases tab: the one-line total and a warning when the base is cold, then the breakdown folded
// in a row of its own across the card (the same lines as farming.js upkeepCellHtml, which the base window shows open).
// The last row of its group: the full-width row would otherwise shift the label / value pairs after it.
function upkeepFold(state, b) {
  const u = upkeepLine(state, b);
  const warn = `${u.cold ? `<div class="small danger">Cold: out of firewood and fuel</div>` : ""}${u.boilerCold ? `<div class="small danger">The water boiler is cold today: nothing to burn</div>` : ""}`;
  const body = `<div>${esc(`Food: ${u.food}`)}</div><div>${esc(`Water: ${u.water}`)}</div>${u.heating ? `<div class="${u.cold ? "danger" : ""}">${esc(u.heating)}${u.cold ? " · cold: out of firewood and fuel" : ""}</div>` : ""}${u.boiler ? `<div class="${u.boilerCold ? "danger" : ""}">${esc(u.boiler)}</div>` : ""}`;
  return `<div${tip(u.tip)}><div>${esc(u.short)}</div>${warn}</div><div class="pk-wide">${fold(`upkeep:${b.id}`, "Upkeep breakdown", body, { tipText: "A rate per person × the people fed here: food, water, heating and the water boiler" })}</div>`;
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
    <div class="spread"><b>${spriteImg(survivorURL(s, state.seed), 1.6)}${s.leader ? "★ " : ""}${esc(s.name)}${stIcons(state, s)}</b>${atB ? roleSelect(state, s) : ""}</div>
    ${isCaptive(s) ? captiveLine(state, s) : ""}
    ${known ? `<div class="row small"><span style="width:3.5rem" class="muted">Health</span><div style="flex:1">${bar(s.health, s.health < 40 ? "var(--danger)" : "var(--good)")}</div><span style="width:2rem">${n0(s.health)}</span></div>
    ${isHurt(s) && (s.woundInfected || treatButton(state, s)) ? `<div class="row small">${s.woundInfected ? `<span class="chip off"${tip("Heals at half speed at a base and gets worse on the road. Treat with meds.")}>Infected wound</span>` : ""}${treatButton(state, s)}</div>` : ""}
    ${isSick(s) ? `<div class="row small" style="flex-wrap:wrap">${conditionChips(state, s)}</div>` : ""}
    ${gaugeRows(s, { mood: false })}
    <div class="row small"${moodTipAttr(state, s)}><span style="width:3.5rem" class="muted">Mood</span><div style="flex:1">${bar(s.mood, "var(--info)")}</div><span style="width:2rem">${n0(s.mood)}</span></div>${moodRiskChip(s) || relChip(state, s) || familyChip(state, s) ? `<div class="small">${moodRiskChip(s)}${relChip(state, s)}${familyChip(state, s)}</div>` : ""}` :
    isCaptive(s) ? "" : s.location.kind === "errand" ? `<div class="small muted">Away on a personal errand: back around day ${s.location.until}.</div>` : s.location.kind === "lent" ? `<div class="small vol-text"${tip("Lent to another group (sim/volunteers.js): out of your orders, fighting their fights, back at the end of the span")}>${esc(lentLine(state, s))}</div>` : `<div class="small muted"${tip("Teams report when they get home, wait for orders, or come into radio range of a radio station.")}>No contact: health and mood unknown until the team reports in.</div>`}
    <div>${topSkills}${backgroundInfo(state, s.background) ? `<span class="chip"${tip(`Who they were before Calder fell${backgroundInfo(state, s.background).blurb ? `: ${backgroundInfo(state, s.background).blurb}` : ""}${backgroundInfo(state, s.background).custom ? " (a custom background)" : ""}`)}>${esc(backgroundInfo(state, s.background).name)}</span>` : ""}${traitChips(s)}</div>
  </div>`;
}

function captiveLine(state, s) {
  const f = factionById(state, s.location.factionId);
  const days = Math.floor((state.hour - s.location.since) / 24);
  const since = Math.floor(s.location.since / 24) + 1;
  const deal = f ? dealFor(state, f) : null;
  const talks = f && talksOf(state).some((t) => t.factionId === f.id);
  const back = returnsOf(state).find((r) => r.sid === s.id);
  const status = back ? `They are bringing ${esc(s.name.split(" ")[0])} home (ransom paid).` : deal ? `Ransom agreed: the handover at ${esc(tileLabel(state, deal.tile))} by day ${deal.until}${state.parties.some((p) => p.dealId === deal.id) ? " (the team is on its way)" : ""}.` : talks ? "An envoy is on the way to ask their price." : "";
  const buttons = f && f.alive && !back ? `<div class="row small" style="gap:0.3rem;margin-top:0.2rem">
    <button class="mini" data-action="plan" data-tile="${s.location.tile}" data-mission="rescue"${tip("Open the expedition planner with the Rescue mission on their base: sneak in or storm it (played on their base's map, or by the numbers), negotiate or pay at the gates.")}>Plan a rescue</button>
    ${deal && !state.parties.some((p) => p.dealId === deal.id) ? `<button class="mini" data-action="rescue-send" data-id="${deal.id}"${tip("Send your best fighters at the hub to the meeting point, the goods (and any prisoners in the deal) in their cargo. A strong team makes a betrayal less likely.")}>Send the handover team</button>` : ""}
    <button class="mini" data-action="rescue-talk" data-id="${s.id}" ${deal || talks ? "disabled" : ""}${tip(deal ? "A ransom is already agreed: send the handover team from its card." : talks ? "An envoy is already on the way." : `Ask ${f.name} their price for everyone they hold: by radio if your network reaches them, else an envoy. Haggle once (Speech), or offer prisoners in exchange.${["raider", "expansionist", "zealot"].includes(f.type) || attitude(f) === "Hostile" ? " They want a meeting point on the road: you send a team with the goods, and they may betray the handover." : " They bring your people home themselves."}`)}>Negotiate</button>
  </div>` : "";
  return `<div class="small danger"${tip("Get them back: a Rescue team (sneak in or storm their base), a ransom (Negotiate, or at the gates and during a trade visit), or goodwill until they let them go. The longer they are held, the likelier they escape, change sides, or (with zealots) die.")}>Held by ${esc(f ? f.name : "unknown captors")} at ${esc(tileLabel(state, s.location.tile))}, since day ${since} · ${days ? `${days} day${days === 1 ? "" : "s"}` : "since today"}</div>${status ? `<div class="small muted">${status}</div>` : ""}${buttons}`;
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
  // The find box and the view switch on top (ui/panelfold.js); a group with nobody matching is left out.
  const q = peopleQuery().trim().toLowerCase();
  const compact = peopleIsCompact();
  const hit = (s) => !q || personWords(state, s).includes(q);
  const shownGroups = groups.map(([name, ppl]) => [name, ppl, ppl.filter(hit)]).filter(([, , f]) => f.length);
  const found = shownGroups.reduce((a, [, , f]) => a + f.length, 0);
  const total = groups.reduce((a, [, p]) => a + p.length, 0);
  const head = `<div class="ppl-bar"><input type="search" class="ppl-q" data-action="ppl-q" data-keep="ppl-q" maxlength="40" placeholder="Find: name, job or skill" value="${esc(peopleQuery())}" aria-label="Find people by name, job or skill"${tip("Type to show only the people whose name, job, skill, background or trait has this in it")}>${q ? `<button class="mini" data-action="ppl-clear"${tip("Show everyone again")}>✕</button>` : ""}<button class="mini ppl-view" data-action="ppl-view" aria-pressed="${compact}"${tip(compact ? "Show everyone as full cards (health, hunger, thirst, mood, skills, traits)" : "Show everyone as one line each (name, job, health): more people on the screen")}>${compact ? "▤ Cards" : "☰ Compact"}</button></div>${q ? `<div class="small muted ppl-found">${found} of ${total} match “${esc(peopleQuery())}”</div>` : ""}`;
  const row = (s) => (compact && !isCaptive(s) ? personRow(state, s) : personCard(state, s));
  return head + shownGroups.map(([name, ppl, f]) => `<h3>${esc(name)} (${q ? `${f.length} of ${ppl.length}` : ppl.length})</h3>${f.map(row).join("")}`).join("") +
    childrenPeople(state, q ? (c) => String(c.name || "").toLowerCase().includes(q) : null); // ui/family.js
}
// What the People tab's find box looks through for one person: name, job (role), skills, background, traits.
function personWords(state, s) {
  const role = roleOf(state, s);
  const bg = backgroundInfo(state, s.background);
  return [s.name, role ? role.name : "", ROLES[s.role] ? ROLES[s.role].name : "", ...Object.keys(s.skills || {}).filter((k) => skill(s, k) >= 5).map((k) => SKILL_NAMES[k]), bg ? bg.name : "", traitWords(s)].join(" ").toLowerCase();
}
// The compact People tab: one line a person (name and status icons, job, health), the full card a click away
// (the survivor screen) or a switch back (Cards). Hover: health, mood and top skills.
function personRow(state, s) {
  const known = inContact(state, s);
  const top = Object.entries(s.skills).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => `${SKILL_NAMES[k]} ${skill(s, k)}`).join(", ");
  const hover = `${known ? `Health ${n0(s.health)} · mood ${n0(s.mood)}` : s.location.kind === "errand" ? `Away on a personal errand: back around day ${s.location.until}` : "No contact: health and mood unknown until the team reports in"} · ${top}. Click for skills, traits and gear.`;
  return `<div class="card surv prow" data-action="survivor" data-id="${s.id}"${tip(hover)}>
    <span class="prow-name"><b>${s.leader ? "★ " : ""}${esc(s.name)}</b>${stIcons(state, s)}</span>
    ${known ? `<span class="prow-hp${s.health < 40 ? " danger" : ""}">${meter(s.health / 100, s.health < 40 ? "var(--danger)" : "var(--good)")}<span class="pk-num">${n0(s.health)}</span></span>` : `<span class="small muted prow-hp">${s.location.kind === "errand" ? "errand" : "no contact"}</span>`}
    ${s.location.kind === "base" ? roleSelect(state, s) : ""}
  </div>`;
}

function renderGroups(state) {
  const known = state.factions.filter((f) => f.known);
  const unknown = state.factions.filter((f) => !f.known && f.alive).length;
  const routes = state.routes.filter((r) => r.active);
  return `${groupsRadioHeader(state)}${groupsDiploHeader(state)}
    ${known.length ? known.map((f) => {
      const a = attitude(f);
      const route = routes.find((r) => r.factionId === f.id);
      // Folded to one line (name, about how many, goodwill, attitude); the whole card opens under it.
      const pop = f.alive ? Math.round(f.pop / 5) * 5 || f.pop : 0;
      const summary = `<span class="gc-sum"><b class="gc-name"><span class="swatch" style="background:${f.color}"></span>${esc(f.name)}</b><span class="gc-fig small muted">${f.alive ? `~${pop} people · goodwill <span style="color:${attColor(a)}">${Math.round(f.goodwill)}</span>${f.pact ? " · pact" : ""}${f.atWar ? ` · <span class="danger">⚔</span>` : ""}` : ""}</span>${f.alive ? `<span class="att-chip" style="color:${attColor(a)}">${a}</span>` : `<span class="muted small">Collapsed</span>`}</span>`;
      const body = `<div class="spread small"><span class="muted">${FACTION_TYPES[f.type].label} · about ${pop} people · ${f.bases.length} base${f.bases.length === 1 ? "" : "s"}${f.pact ? ` · ${f.pact === "trade" ? "Trade pact" : "Non-aggression pact"}` : ""}</span>${f.alive ? watchlistPin(state, "group", f.id, f.name) : ""}</div>
        <div class="row small"><span class="muted" style="width:4.5rem"${tip("-100 to 100. Hostile at -40 or below, friendly at 20+, allied at 70+.")}>Goodwill</span><div style="flex:1">${bar((f.goodwill + 100) / 2, attColor(a))}</div><span>${Math.round(f.goodwill)}</span></div>
        ${f.lootedGear.length ? `<div class="small danger">Seen carrying: ${f.lootedGear.slice(-3).map(esc).join(", ")}</div>` : ""}
        <div class="gc-extra">${groupCardExtras(state, f)}</div>
        ${f.alive ? `<div class="row" style="margin-top:0.35rem">
          <button data-action="center" data-tile="${f.bases[0]}"${tip("Center the map on their main base")}>Locate</button>
          ${canRadio(state, f) ? `<button data-action="rd-open" data-id="${f.id}"${tip("Radio panel: greet, ask for news, ask for a trade caravan, make a deal, call for help, pacts")}>Radio…</button>` : ""}${f.heard ? `<span class="small muted"${tip("You found them by scanning the airwaves")}>heard on the radio</span>` : ""}
          ${volAskButton(state, f)}
          ${f.pact === "trade" && !route ? `<button data-action="routesetup" data-id="${f.id}"${tip("Recurring convoys with an escort you choose")}>Set up trade route</button>` : ""}
        </div>` : ""}`;
      return `<div class="card gc">${fold(`group:${f.id}`, summary, body, { cls: "pf-card", tipText: `${f.name}: click for the whole card (goodwill, wars and pacts, what they want and have spare, their arms, Locate and Radio)` })}</div>`;
    }).join("") : `<div class="muted small">You have not found any other groups yet. Send recon teams out.</div>`}
    ${unknown ? `<div class="muted small" style="margin-top:0.5rem">${unknown} group${unknown === 1 ? " is" : "s are"} still out there, unknown.</div>` : ""}
    ${bandsSection(state)}
    ${outsidersSection(state)}
    <h3>Trade routes</h3>
    ${routes.length ? routes.map((r) => {
      const f = factionById(state, r.factionId);
      const out = state.parties.some((p) => p.routeId === r.id);
      return `<div class="card small">
        <div class="spread"><b>${esc(f.name)}</b><button data-action="cancelroute" data-id="${r.id}"${tip("Stop the route; escorts return to the hub")}>End route</button></div>
        Send ${r.sendQty} ${esc(keyWord(r.sendKey))} → get ${r.recvQty} ${esc(keyWord(r.recvKey))}, every ${r.interval} days<br>
        ${ESCORTS[r.escort].name} escort: ${r.escortIds.map((id) => survivorById(state, id)).filter((s) => s && s.alive).map(first).join(", ")}<br>
        <span class="muted">${out ? "Convoy on the road" : `Next convoy day ${r.nextDay}`}</span>
      </div>`;
    }).join("") : `<div class="muted small">Sign a trade pact during a trade visit, then set up a route here.</div>`}`;
}

// One figure on a team card's supplies line (styles.css .tm-stat).
const tmStat = (k, v) => `<span class="tm-stat"><span class="muted">${k}</span> ${v}</span>`;
function renderTeams(state, ui) {
  const mine = state.parties.filter((p) => p.owner === "player");
  if (!mine.length) return `${formTeamRow(state)}<div class="muted small">No teams out. Form one at a base, select a tile on the map and choose an action, or right-click a tile.</div>${teamsTrips(state, ui)}`;
  return formTeamRow(state) + mine.map((p) => {
    const members = partyMembers(state, p);
    const v = partyFleet(state, p); // one vehicle, or several together (sim/vehicles.js fleets)
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
      <div class="spread"><b>${sjob ? `Supply run: ${esc(jobName(state, sjob))}` : `${MISSIONS[p.teamMission === "formed" && p.mission === "move" ? "formed" : p.mission]?.name || "Team"} → ${esc(tileLabel(state, p.dest))}`}</b>${showLive ? `<button data-action="center" data-tile="${partyTile(p)}"${tip("Center the map on this team")}>Locate</button>` : ""}</div>
      <div class="tm-who">${members.filter((m) => !m.vol).map(first).join(", ")}${teamVolLine(state, p)} <span class="muted">· ${v ? esc(isBike(v) ? `on ${vehicleLabel(v)}` : vehicleLabel(v)) : "on foot"} · ${STANCES[p.stance]?.name || ""}</span>${p.burden && p.burden.band >= 2 && p.vehicle !== true ? ` · <span class="warn"${tip("Its load slows it down and it eats and drinks more on the move (team panel)")}>${p.burden.band >= 3 ? "Overloaded" : "Heavy"}</span>` : ""}${p.walkers > 0 && p.vehicle ? ` · <span class="warn"${tip("A vehicle was lost and there are not enough seats: those without one walk, and the whole team goes at walking pace until a seat turns up (or leave them to follow on foot from the card). Its hours and the right-click estimates count walking pace.")}>${p.walkers} walking: foot pace</span>` : ""}</div>
      ${showLive ? `<div class="tm-stats">${tmStat("Food", n0((p.supplies.food || 0) + (p.supplies.preserved || 0)))}${tmStat("Water", `${n0(waterIn(p.supplies))}${(p.supplies[RAW] || 0) >= 1 ? ` (${n0(p.supplies[RAW])} raw)` : ""}`)}${isCar(v) ? `${tmStat("Fuel", n0(partyFuel(state, p)))}${tmStat("Vehicle", `${Math.round(v.condition)}%`)}` : ""}${tmStat("Load", `${n0(Parties.poolLoad(p))}/${n0(partyCapacity(state, p))} kg`)}</div>` : ""}
      <div class="tm-status">${status}</div>
      ${canOrder && p.kind !== "convoy" && !commandable(state, p) ? `<div class="small muted"${tip(NO_RADIO)}>No radio contact: it follows its ${p.plan && p.plan.active ? "plan" : "orders"}; new orders through its cards</div>` : ""}
      ${teamRadioLine(state, p)}
      ${canOrder && p.kind !== "convoy" && commandable(state, p) ? `<div class="row" style="margin-top:0.35rem">
        ${waiting ? `<button class="primary" data-action="orders" data-id="${p.id}"${tip("Choose what the team does here")}>Orders</button>` : ""}
        <button data-action="movemode" data-id="${p.id}"${tip("Then click any tile on the map. The team goes there and waits for orders.")}>${ui.moveParty === p.id ? "Click a tile…" : waiting ? "Move…" : "Redirect…"}</button>
        <button data-action="gohome" data-id="${p.id}"${tip("Head back home now. This drops the team's queue.")}>Return home</button>
        ${enterButton(state, p)}${editTeamButton(state, p, "")}
      </div>` : ""}
      ${p.kind !== "convoy" ? `<div class="row" style="margin-top:0.35rem">${ost && ost.left ? `<span class="muted" style="flex:1">${esc(ost.label)} · ${armed ? "starts when unpaused" : `${ost.left}h left`}${(p.orders || []).length ? ` · +${p.orders.length} queued` : ""}</span>` : `<span style="flex:1"></span>`}<button class="mini" data-action="xp-open" data-id="${p.id}"${tip("People, gear, supplies, vehicle and the order queue; camp, scavenge, repair and treat")}>Team panel</button></div>` : ""}
      ${sjob ? `<div class="row" style="margin-top:0.35rem">
        ${p.phase === "holding" ? `<button class="mini" data-action="sr-release" data-id="${sjob.id}" data-how="return"${tip("Load the pick-up goods and head back to the home base")}>Come home</button><button class="mini" data-action="sr-release" data-id="${sjob.id}" data-how="disband"${tip("The crew join the base they are parked at; the vehicle parks there. The job is kept as a template.")}>Disband here</button>` : ""}
        ${baseById(state, sjob.originId) ? `<button class="mini" data-action="openbase" data-id="${sjob.originId}" data-tab="convoys"${tip("Open the Supply runs tab of the home base")}>Supply runs…</button>` : `<span class="muted"${tip("The base this run started from was lost. The convoy finishes its trip.")}>home base lost</span>`}
      </div>` : ""}
    </div>`;
  }).join("") + teamsTrips(state, ui);
}

// ---------- right panel ----------
// Another group's base on a tile, as far as the player knows: seen there now, seen there in the last report, or
// the main base of a group you know (the Groups tab shows where that is).
function knownGroupBase(state, id, isLive, snap) {
  if (isLive) return unseenOutpost(state, id) ? null : state.factions.find((f) => f.alive && f.known && f.bases.includes(id)) || null; // sim/hiding.js
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
  actions.push(["recon", "Send recon"]);
  actions.push(["move", "Send a team here"]);
  actions.push(["sweep", "Survey the area"]);
  // Food from the land (sim/hunting.js): the planner with the Hunting / Fishing trip preset.
  if (gameAbundance(state, id) >= 0.08) actions.push(["move", "Hunting trip", "hunt", "Plan a hunting trip here: go, hunt 8 hours (change it in the plan), come home with the game. Forest and hills are best, autumn the best season; fresh game is heavy and spoils fast."]);
  if (huntInfo(state, id).fishSpot) actions.push(["move", "Fishing trip", "fish", "Plan a fishing trip here: go, fish 8 hours, come home. Needs a fishing rod, a net or a spear (the hub's goes along)."]);
  return actions.concat(siteMissions(state, id));
}

// The missions a site offers as far as the player knows (the hub's menu above, and a selected team's right-click
// menu, ui/teamctx.js): [mission, label]. Nothing on open water.
export function siteMissions(state, id) {
  const t = state.tiles[id];
  const actions = [];
  if (!t || (t.terrain === "water" && !t.bridge)) return actions;
  const isLive = state.live.has(id);
  const snap = isLive ? null : state.knowledge[id];
  const info = isLive ? { owner: t.owner, loot: t.loot, hordeSize: state.hordes.filter((h) => h.tile === id).reduce((a, h) => a + h.size, 0) } : snap;
  const markers = state.markers.filter((m) => m.tile === id);
  // A site nobody has reported on yet is assumed to hold something (the map draws it untouched, too).
  if (info ? info.loot > 0.05 : !!mapLoc(state, id)) actions.push(["scavenge", "Scavenge / raid"]);
  const fb = knownGroupBase(state, id, isLive, snap);
  if (fb) actions.push(["trade", "Trade visit"]);
  if (fb && captivesOf(state, fb.id).length) actions.push(["rescue", "Rescue captives"]);
  if (fb) actions.push(["assault", occupiedAt(state, id) ? "Retake the base" : "Assault their base"]);
  // A base standing empty (sim/groupworld.js, as you saw it): move in instead of building over it (sim/occupy.js).
  const empty = !fb && (isLive ? abandonedAt(state, id) : snap && snap.abandoned);
  if (empty) actions.push(["occupy", empty.from === "player" ? "Reoccupy your old outpost" : "Occupy the abandoned base"]);
  // A bridge can be barricaded with an outpost: the road over the river is then closed to everyone else (sim/parties.js bridgeClosedTo).
  if (!fb && !empty && (t.terrain !== "water" || t.bridge) && (!info || info.owner == null || info.owner === "player")) actions.push(["outpost", t.bridge ? "Barricade the bridge (outpost)" : "Build outpost"]);
  if (markers.some((m) => m.type === "death")) actions.push(["recover", "Recover bodies"]);
  if (markers.some((m) => m.type === "vehicle")) actions.push(["getvehicle", "Recover vehicle"]);
  if (markers.some((m) => (m.type === "cache" || m.type === "car" || m.type === "camp") && !m.info?.emptied)) actions.push(["investigate", "Investigate find"]);
  if (info && info.hordeSize) actions.push(["cull", "Cull horde"]);
  if (info && info.hive) actions.push(["hive", "Destroy hive"]);
  // A hive's growth you can see or were told of (sim/hivetech.js).
  const growth = isLive ? growthInfo(state, growthAt(state, id)) : snap && snap.growth;
  if (growth && !growth.withered) actions.push(["growth", "Burn the growth"]);
  return actions;
}

export function renderRight(state, ui) {
  const xp = ui.expedition != null && state.parties.find((p) => p.id === ui.expedition);
  if (xp) return pickBar(state, ui) + renderExpedition(state, ui, xp); // ui/mapselect.js: the other things on its tile
  const picked = pickCard(state, ui); // a group's party, a band or outsiders selected on the map (ui/mapselect.js)
  if (picked) return picked;
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
    hordeSize: here.reduce((a, h) => a + h.size, 0), hordeBoss: here.reduce((a, h) => a + (h.bosses || 0), 0), hordeMix: snapshot(state, id).hordeMix, growth: growthInfo(state, growthAt(state, id)) } : snap;
  // A hive you can see: what has grown around it and how far it has evolved (sim/hivetech.js).
  const liveHive = isLive && t.hive ? hiveAt(state, id) : null;
  const hiveGrowths = liveHive ? growthsOf(state, liveHive, false).map((g) => `${GROWTHS[g.kind].name}${state.hour < g.ready ? " (growing)" : ""}`) : [];
  // The hives you know of (live or reported): this tile's place in their land.
  const knownHives = state.tiles.filter((x) => (liveSet(state).has(x.id) ? x.hive : state.knowledge[x.id] && state.knowledge[x.id].hive)).map((x) => x.id);
  const hz = knownHives.length ? hiveDanger(state, id, knownHives) : { territory: false, red: false };
  const base = state.bases.find((b) => b.tile === id);
  const ruin = ruinInfo(state, id); // ui/render.js: a ruin you know of (razed base), with its salvage and danger
  // sim/occupy.js: a base standing empty you know of. In view: what stands and who is inside now; out of view: your
  // last report of it (what stood then; who is inside you cannot know from here).
  const known = !base && (isLive ? abandonedAt(state, id) : snap && snap.abandoned);
  const emptyBase = !known ? null : isLive ? occupyPreview(state, id)
    : { mine: known.from === "player", fromName: known.fromName, day: known.day, standing: `${known.standing} building${known.standing === 1 ? "" : "s"} (when last seen)`, stock: "", threat: null, threatText: "not known from here", grievance: "", problem: "" };
  const searched = searchedDay(state, id); // sim/discovery.js: the Known area layer
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
  const land = landRows(state, id, teamsHere);
  // The tile in four groups (styles.css .pk): what you know of it, its dangers, what the land gives, the way there.
  return `
    <h2>${esc(loc ? loc.name : TERRAIN[t.terrain].name)}</h2>
    <div class="small muted">${loc ? LOCATIONS[loc.type].name + " · " : ""}${TERRAIN[t.terrain].name}${t.road ? " · road" : ""}${t.bridge ? " · bridge" : ""}</div>
    ${loc ? `<div class="small muted"${tip("Danger: how many of the dead the site holds on top of its infection (city blocks and big sites are worse, the countryside is quiet). Likely: what searching here tends to turn up.")}>${SITE_ZONES[loc.zone || LOCATIONS[loc.type].cat]?.name || "Site"} · danger ${DANGER_NAMES[siteDanger(loc)].toLowerCase()} · likely ${Object.entries(LOCATIONS[loc.type].loot).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => SUPPLIES[k].name.toLowerCase()).join(", ")}${LOCATIONS[loc.type].gear.length ? ", maybe gear" : ""}</div>` : ""}
    ${pickBar(state, ui)}
    ${ui.moveParty ? `<div class="card attn small" style="margin-top:0.5rem">Move mode: left-click this or another tile to send the team. Esc cancels.</div>` : ""}
    ${stagingTileCard(state, id)}
    <div class="card" style="margin-top:0.6rem">
      <div class="pk small">
      ${pkSec("Intel")}
      <div class="kv">
        <div>Intel</div><div>${isLive ? `<span class="good">Live</span>` : snap ? `Last seen ${ageText(state, snap)} (day ${Math.floor(snap.hour / 24) + 1})` : `<span class="muted">None</span>`}</div>
        ${searched ? `<div${tip("Your people looked hard here (a survey, a Look around or a search): the Known area layer hatches it. Hidden places and finds nearby are likelier found already.")}>Searched</div><div>day ${searched}</div>` : ""}
        ${info ? `
        <div>Held by</div><div>${info.owner === "player" ? "You" : ownerF ? `<span style="color:${ownerF.color}">${esc(ownerF.name)}</span> (${attitude(ownerF).toLowerCase()})` : "Nobody"}</div>
        ${claimText(state, id) ? `<div${tip("A marker post (sim/claims.js): the tile counts as land the coalition holds. Lost if a group founds or takes a base on or beside it, a hive rises there, or a hostile band camps on it over a day.")}>Claim</div><div>${esc(claimText(state, id))}${wellText(state, id) ? ` · ${esc(wellText(state, id))}` : ""}</div>` : ""}` : ""}
      </div>
      ${info || (hz.territory && !info?.hive) ? `${pkSec("Dangers")}
      <div class="kv">
        ${info ? `
        <div${tip("How thick the worm’s eggs lie in the ground and the water here (Help: The dead and the worm). Higher infection means more of the dead, more events, faster Heat")}>Infection</div><div>${Math.round(info.infection * 100)}%${meter(info.infection, "var(--danger)")}</div>
        <div>Horde</div><div>${isLive ? here.map((h) => watchlistPin(state, "horde", h.id, `horde of ${h.size}`)).join("") + " " : ""}${info.hordeSize ? `<span class="danger"${tip("Score from its size: how tough it is in a fight and how much it adds to a new hive (small about 3, medium 8, large 16)")}>${Math.round(info.hordeSize)}${isLive ? "" : " (then)"} · score ${hordeScore(info.hordeSize)}${info.hordeBoss ? ` · ${BOSS_NAMES.horde}` : ""}</span>` : "None seen"}</div>
        ${info.hordeSize && info.hordeMix ? `<div${tip(specialTip(info.hordeMix))}>Special dead</div><div class="danger">${esc(mixText(info.hordeMix, info.hordeSize))}</div>` : ""}
        ${info.hive ? `<div${tip(`An infestation hive: it grows hordes, radiates infection over its land and holds the ${BOSS_NAMES.hive}. Destroy every hive to win (Destroy hive mission; see Help → Eras and winning).`)}>Hive</div><div class="danger">Yes${liveHive ? ` · tier ${hiveTier(state, liveHive)}` : ""}</div>` : ""}
        ${info.hive ? hiveCrawlRow(state, id) : ""}
        ${hiveGrowths.length ? `<div${tip("Structures the hive has grown on the land around it (Burn the growth mission on each one's tile): income, a bigger guard, the special dead its hordes carry, Wallbreakers.")}>Growths</div><div class="danger">${esc(hiveGrowths.join(", "))}</div>` : ""}
        ${info.growth ? `<div${tip(`${GROWTHS[info.growth.kind] ? GROWTHS[info.growth.kind].desc : ""} Burn it (Burn the growth: fight its guard, or 4 fuel / 2 Molotovs a fire) and its hive loses that. It regrows its flesh a little every day.`)}>Hive growth</div><div class="danger">${esc(info.growth.name)}${info.growth.withered ? " · withered (its hive is gone)" : info.growth.growing ? " · still growing" : ` · flesh ${info.growth.hp}%`}${isLive ? "" : " (then)"}</div>` : ""}
        ${info.site ? `<div${tip(`The dead gather here to build a new hive: it stands once ${HIVE.SITE_BIOMASS} of them have gone into it. Send a Cull horde team and Break up the gathering: before the mound is begun the site is given up, after that the hive loses a big part of what has gone in and starts over (Help: Hives being born).`)}>Hive being built</div><div class="danger">${info.site.started ? "under way" : "gathering"} · ${Math.round(info.site.biomass)}/${HIVE.SITE_BIOMASS} dead${siteText(state, id) ? `<div class="small">${esc(siteText(state, id))}</div>` : ""}</div>` : ""}` : ""}
        ${hz.territory && !info?.hive ? `<div${tip("Land a hive holds: at least 3 danger skulls. On the red-skull ring right around a hive every one of the dead is much tougher (+3 power; +1 elsewhere in its land).")}>Hive land</div><div class="danger">${hz.red ? "Red-skull ground: much tougher dead" : "Yes: tougher dead"}</div>` : ""}
      </div>` : ""}
      ${info || land ? `${pkSec("Land")}
      <div class="kv">
        ${info ? `<div${tip("How much is left to scavenge here, against what it held untouched: rich, some, little, picked clean. Nothing grows back, and other groups strip sites too: what you have not seen lately may be gone.")}>Loot</div><div>${lootCell(info.loot)}</div>` : ""}
        ${land}
      </div>` : ""}
      ${pkSec("Travel")}
      <div class="kv">
        ${fromTeamRow(state, id) || `<div>From hub</div><div>${walk ? `${walk.tiles} tiles · ~${Math.ceil(walk.hoursOut)}h on foot` : "No route over land"}</div>`}
      </div>
      </div>
      ${walk || base || stagingView(state) ? "" : `<div class="small muted" style="margin-top:0.3rem">${t.terrain === "water" && !t.bridge ? "Open water. Teams cross one tile of it by boat, from a shore (team panel: Boat crossing)." : "Water is in the way. Send a team to the nearest shore, then build a boat there (team panel: Boat crossing, or right-click the far shore)."}</div>`}
    </div>
    ${stagingTileCard(state, id)}
    ${base ? `<div class="card"><div class="spread"><b>${esc(base.name)}</b><span class="row">${watchlistPin(state, "base", base.id, base.name)}${renameButton(base)}${formTeamButton(state, base)}<button class="primary" data-action="openbase" data-id="${base.id}">Manage</button></span></div><div class="small">Your ${tierName(base).toLowerCase()}. ${atBase(state, base.id).length} people.${base.captured ? ` Taken from ${esc(base.captured.name)} on day ${base.captured.day}.` : ""}${base.occupiedFrom ? ` Moved into on day ${base.occupiedFrom.day}${base.occupiedFrom.from === "player" ? " (your old outpost)" : ` (left by ${esc(base.occupiedFrom.name)})`}.` : ""}</div></div>` : ""}
    ${emptyBase ? `<div class="card small"${tip("A base standing empty: a group that died out, gave it up or lost it, or an outpost of yours that was lost. Its buildings rot month by month and another group may move in first. Occupy it (the button below): clear out whoever is inside and it is your outpost with what still stands and the stores left there, no scrap needed.")}><b>🏚 ${emptyBase.mine ? `${esc(emptyBase.fromName)} (your old outpost)` : `Abandoned base (${esc(emptyBase.fromName)}'s)`}</b><div class="muted">Empty since day ${emptyBase.day}${isLive ? "" : " (as last seen)"}.</div>
      <div class="kv small"><div>Standing</div><div>${esc(emptyBase.standing)}</div>${emptyBase.stock ? `<div>Stores</div><div>${esc(emptyBase.stock)}</div>` : ""}<div${tip("Who is inside today: the dead drift in week by week, squatters come and go")}>Inside</div><div class="${emptyBase.threat && emptyBase.threat.count ? "danger" : ""}">${esc(emptyBase.threatText)}</div>${emptyBase.grievance ? `<div>Angers</div><div class="danger">${esc(emptyBase.grievance)}</div>` : ""}${emptyBase.problem ? `<div>Now</div><div class="danger">${esc(emptyBase.problem)}</div>` : ""}</div></div>` : ""}
    ${ruin && !base ? `<div class="card small"${tip(`A base burned to the ground in a raid. A little is left to scavenge, and a camp set up here builds up for ${ruin.scrap} scrap less: the rest is salvage. A camp replaces the ruins.`)}><b>${esc(ruin.title)}</b><div class="muted">Burned by ${esc(ruin.by)}${ruin.day != null ? ` on day ${ruin.day}` : ""}${ruin.from ? ` (${esc(ruin.from)}'s base)` : ruin.yours ? " (your base)" : ""}.</div>
      <div class="kv small"><div${tip("What is left to pick through, as you last saw it: rich, some, little, picked clean")}>Salvage</div><div>${esc(ruin.salvage)}${ruin.salvageLive ? "" : ` <span class="muted">(then)</span>`}</div><div${tip("The danger of the place, as the skulls under a site's name: at least very high on a hive's land")}>Danger</div><div class="${ruin.danger >= 2 ? "danger" : ""}">${esc(ruin.dangerName)}</div><div>A camp here</div><div>${ruin.scrap} scrap less to build up</div></div></div>` : ""}
    ${occupiedAt(state, id) ? `<div class="card attn small"${tip("A base of yours another group took. Send an Assault their base team (the button below) to take it back: its walls are weakest right after it fell, and the holders patch it up every day.")}><b>${esc(occupiedAt(state, id).name)}: held by others</b><div>${esc(occupiedText(state, occupiedAt(state, id)))}</div></div>` : ""}
    ${base ? ownBaseCard(state, base) : groupBaseCard(state, id, knownGroupBase(state, id, isLive, snap))}
    ${markers.length ? `<h3>Markers</h3>${markers.map((m) => `<div class="card small"${tip(MARKER_TYPES[m.type].desc)}><b>${MARKER_TYPES[m.type].glyph} ${esc(m.label)}</b><br>
      <span class="muted">Spotted ${ageText(state, m)}${m.info?.emptied ? " · emptied" : ""}${m.info?.fuel != null ? ` · fuel ${n0(m.info.fuel)}, condition ${Math.round(m.info.condition || 0)}%` : ""}${m.info?.items != null && m.type === "death" ? ` · ${m.info.items} item(s) left then` : ""}</span></div>`).join("")}` : ""}
    ${teamsHere.length ? `<h3>Your teams here</h3>${teamsHere.map((p) => `<div class="card small"><b>${esc(teamName(state, p))}</b><div class="row" style="margin-top:0.3rem">${!commandable(state, p) ? `<span class="small muted"${tip(NO_RADIO)}>No radio contact</span>` : `${p.phase === "waiting" ? `<button class="primary" data-action="orders" data-id="${p.id}">Orders</button>` : ""}<button data-action="movemode" data-id="${p.id}">Move…</button>${enterButton(state, p)}${transferButtons(state, p)}${editTeamButton(state, p, "")}`}<button data-action="xp-open" data-id="${p.id}"${tip("People, gear, supplies, vehicle and orders")}>Team panel</button></div></div>`).join("")}` : ""}
    ${actions.length ? `<h3>Send a team from the hub</h3><div class="row pk-acts">${actions.map(([m, l, pre, tp]) => `<button data-action="plan" data-tile="${id}" data-mission="${m}"${pre ? ` data-preset="${pre}"` : ""}${tip(tp || MISSIONS[m].desc)}>${l}</button>`).join("")}</div>` : ""}`;
}

// "Enter <base>" for a team standing on one of your bases, stopped there (sim/moveout.js enterOption): its people move
// in, its cargo and vehicle with them, the team is disbanded. The team panel and the orders card list it as an order.
function enterButton(state, p) {
  const o = enterOption(state, p);
  if (!o || o.disabled || !(p.phase === "waiting" || p.phase === "task")) return "";
  return `<button data-action="xp-order" data-id="${p.id}" data-type="mission" data-mission="enter"${tip(o.desc)}>${esc(o.label)}</button>`;
}

// Game, fish and your snares on a tile (sim/hunting.js): what the land holds now and what a hunt would bring: the
// team standing here, else the hub's two best hunters.
// The hive crawl's record on a hive's tile (sim/hivecrawl.js hive.crawlRec): how deep your teams got, the chambers
// mapped and whether the core was found; and how deep the war parties of groups you know got (hive.groupCrawl).
function hiveCrawlRow(state, id) {
  const hv = (state.hives || []).find((h) => h.tile === id);
  if (!hv) return "";
  const mine = crawlRecText(state, hv);
  const others = Object.entries(hv.groupCrawl || {}).map(([fid, n]) => { const f = factionById(state, Number(fid)); return f && f.known ? `${esc(f.name)} ${n} deep` : ""; }).filter(Boolean);
  if (!mine && !others.length) return "";
  return `<div${tip("The hive crawl: how deep your teams have been (the deepest chamber of the depth to the core), the chambers mapped of the den, and whether they found its core (★ been in it, ☆ heard or lit it from a passage). It is kept on the hive; when the hive grows deeper its chambers are new and the map starts again.")}>Crawled</div><div>${mine ? esc(mine) : "<span class=\"muted\">not by you</span>"}${others.length ? `<div class="small muted">War parties: ${others.join(", ")}</div>` : ""}</div>`;
}
function landRows(state, id, teamsHere) {
  const t = state.tiles[id];
  if (!t || t.terrain === "water") return "";
  const h = hub(state);
  const p = teamsHere[0] || null;
  const arrows = p ? Parties.carried(p, "arrows") : h ? h.stock.arrows || 0 : 0;
  const people = p ? Parties.partyMembers(state, p) : h ? atBase(state, h.id).filter((s) => bestHuntWeapon(s, h.stock, arrows)).sort((a, b) => hunterMult(b) - hunterMult(a) || a.id - b.id).slice(0, 2) : [];
  const ammo = p ? sumRecs(p.supplies, p.cargo && p.cargo.supplies) : h ? h.stock : 0; // rounds by key: each gun hunts with its own calibre (sim/ammo.js)
  // What they could carry home: the team's room now, or the pair less what they would pack (about 12 kg each).
  const room = p ? Parties.cargoRoom(state, p) : Math.max(0, Parties.carryCapacity(state, people, null) - 12 * people.length);
  // The hunting mix of the team's home (the hub's for its pair): traps, bows and guns (sim/hunting.js).
  const mix = p ? partyHuntMix(state, p) : huntMixOf(h);
  const info = huntInfo(state, id, { members: people, ammo, arrows, mix, hours: HUNT.defHours, room });
  const who = p ? "this team" : people.length ? people.map((s) => esc(shortName(s))).join(" and ") : "";
  const quiet = info.est && info.est.shots < 0.5 ? ", silent" : info.est ? `, ~${Math.round(info.est.shots)} shots` : "";
  // The estimate goes on a muted second line under the rating (styles.css .pk-sub).
  const yieldText = info.est ? `<span class="pk-sub">~${Math.round(info.est.rations)} food in an ${HUNT.defHours}h hunt (${who}${quiet})</span>` : people.length || p ? "" : `<span class="pk-sub">nobody at the hub has a hunting weapon</span>`;
  const gameTip = `Game here: ${info.word}. The land: ${Math.round(info.abundance * 100)}% (forest and hills best, farmland fair, towns and hive land almost nothing), hunted down to ${Math.round(info.level * 100)}% (it grows back over weeks). The estimate is an average for ${HUNT.defHours} hours from now (season, time of day, the hunters' weapons and skill (a scope fitted to the gun helps), and the hunting mix of ${p ? "the team's home" : "the hub"}: ${HUNT_METHODS.filter((k) => mix[k]).map((k) => `${METHOD_NAMES[k].toLowerCase()} ${mix[k]}%`).join(", ")}); luck decides the rest. Gunshots raise Heat and can draw the dead; bows are silent but lose arrows; traps are silent and catch less.`;
  let out = `<div${tip(gameTip)}>Game</div><div>${info.word === "plenty" ? `<span class="good">plenty</span>` : info.word}${yieldText}</div>`;
  // Infested animals (sim/worm.js): the share of the game that carries the worm here, and a herd you can see.
  const herd = state.live.has(id) ? herdAt(state, id) : null;
  const infested = infestedShare(state, id, { herd: !!herd });
  if (infested > 0) out += `<div${tip(`Animals that live on badly infected land catch the worm too: grey, thin, slow. They do not attack, but they carry its eggs to cleaner ground as they wander. Each one killed here is infested at this share: it gives a quarter of the food, and all of it carries the worm's eggs (cook it through). Infested herds wander and seed the land they pass; hunting them down thins them out.`)}>Infested</div><div class="danger">${Math.round(infested * 100)}% of the game${herd ? ` · a herd of ${herd.size} infested ${herd.kind === "deer" ? "deer" : "hogs"} here` : ""}</div>`;
  else if ((t.infection || 0) >= WORM.MEAT_AT) out += `<div${tip(`The worm's eggs lie in this ground and its water: game, fish and snares taken here carry them until cooked through, water drawn here until boiled or filtered${(t.infection || 0) >= WORM.CROP_MIN ? ", and crops grown or food gathered here until boiled" : ""}.${searchRiskText(state, id) ? ` Searching a site here: ${searchRiskText(state, id)}.` : ""}`)}>Worm</div><div class="danger">cook the meat, boil the water${(t.infection || 0) >= WORM.CROP_MIN ? " and the greens" : ""}${searchRiskText(state, id) ? `; ${searchRiskText(state, id).split(" (")[0]}` : ""}</div>`;
  if (info.fishSpot) {
    const kitPeople = p ? Parties.partyMembers(state, p) : h ? atBase(state, h.id).slice(0, 2) : [];
    const kit = fishKit(kitPeople, p ? p.cargo.gear : (h && h.armory) || [], { frozen: frozenAt(state) });
    const fe = kit.power ? expectFish(state, kit, id, HUNT.defHours).rations : null;
    out += `<div${tip(`Fish in ${info.fishSpot.name}: ${Math.round(fishLevel(state, id) * 100)}% left (a fished-out spot comes back in a week or two). Needs a fishing rod, a net or a spear (spears work in daylight, not through ice); ice fishing in a freeze needs a rod or net and a crowbar, machete or axe.`)}>Fish</div><div>${gameWord(info.fishSpot.mult * info.fishLevel)} (${info.fishSpot.name})${fe != null ? `<span class="pk-sub">~${Math.round(fe)} food in ${HUNT.defHours}h${frozenAt(state) ? " (through the ice)" : ""}</span>` : `<span class="pk-sub">no rod, net or spear ${p ? "with the team" : "at the hub"}</span>`}</div>`;
  }
  // Wild food (sim/foraging.js): what the land holds this season and what 8 hours of foraging would bring.
  const fPeople = p ? Parties.partyMembers(state, p) : h ? [...atBase(state, h.id)].sort((a, b) => foragerMult(b) - foragerMult(a) || a.id - b.id).slice(0, 3) : [];
  const fi = forageInfo(state, id, { members: fPeople, hours: FORAGE.defHours, room: p ? Parties.cargoRoom(state, p) : Infinity });
  if (fi.abundance >= 0.02) {
    const fWho = p ? "this team" : fPeople.length ? fPeople.map((s) => esc(shortName(s))).join(", ") : "";
    out += `<div${tip(`Wild food here: ${fi.word} (${fi.seasonKey}). The land: ${Math.round(fi.abundance * 100)}% (forest best, farmland and old orchards good, hills some, towns little: overgrown gardens), picked down to ${Math.round(fi.level * 100)}% (it grows back over a season). Summer and autumn are plentiful, spring gives greens, winter almost nothing. Farming and Scouting help. Foraging is time on one spot: it builds Heat like any work there.`)}>Forage</div><div>${fi.word === "plenty" ? `<span class="good">plenty</span>` : fi.word}${fi.est ? `<span class="pk-sub">~${Math.round(fi.est.rations * 10) / 10} food in ${FORAGE.defHours}h (${fWho})</span>` : ""}</div>`;
  }
  // Firewood (sim/woodcutting.js): what the land holds and what 8 hours of cutting would bring.
  const wi = woodInfo(state, id, { members: fPeople, spare: p ? p.cargo.gear : (h && h.armory) || [], hours: WOOD.defHours, room: p ? Parties.cargoRoom(state, p) : Infinity });
  if (wi.abundance >= 0.02) {
    const fWho = p ? "this team" : fPeople.length ? fPeople.map((s) => esc(shortName(s))).join(", ") : "";
    out += `<div${tip(`Firewood here: ${wi.word}. The land: ${Math.round(wi.abundance * 100)}% (forest best, hills fair, mountain scrub some, farmland hedgerows and suburbs' fences and fallen trees little, a city next to nothing), cut down to ${Math.round(wi.level * 100)}% (trees grow back slowly: a quarter within a season). An axe (a fire axe best), a sledgehammer or a machete cuts much faster than bare hands; Farming and Mechanics help. The winter's heating: a base burns firewood before fuel. Chopping is loud: it builds Heat.`)}>Wood</div><div>${wi.word === "plenty" ? `<span class="good">plenty</span>` : wi.word}${wi.est ? `<span class="pk-sub">~${Math.round(wi.est.wood)} firewood (${Math.round(wi.est.wood * SUPPLIES.wood.weight)} kg) in ${WOOD.defHours}h (${fWho}${wi.tools ? `, ${wi.tools} axe${wi.tools === 1 ? "" : "s"}` : ", no axe"})</span>` : ""}</div>`;
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
// state: the Coalition land line shows the share held against the goal while that layer is on (ui/render.js
// coalitionLand, the same land the alliance victory counts).
export function renderLegend(view, ui, state = null) {
  const on = Object.keys(LAYERS).filter((k) => view.layers.has(k)).length;
  const box = { icon: "🗺", title: "Layers", badges: [{ text: on, tip: `${on} of ${Object.keys(LAYERS).length} layers on` }], action: "legendtoggle" };
  if (ui.legendCollapsed) return panelTab({ ...box, tip: `Show the map layers (${on} on)` });
  const land = state && state.tiles && view.layers.has("coalition") ? coalitionLand(state) : null;
  const extra = (k) => (k === "coalition" && land ? ` <span class="muted"${tip(`${land.held} of ${land.land} land tiles; victory needs over ${Math.round(land.goal * 100)}%`)}>${Math.round(land.pct * 100)}%/${Math.round(land.goal * 100)}%</span>` : "");
  return `${panelHead({ ...box, tip: "Fold this box away", extra: `<button data-action="help-open" data-sec="map-layers" class="mini"${tip("What the layers and map symbols mean (Help)")}>?</button>` })}
    <div class="fp-body">${Object.entries(LAYERS).map(([k, l]) => `<label class="layer"${tip(LAYER_TIPS[k] || l.desc)}><input type="checkbox" data-action="layer" data-k="${k}" ${view.layers.has(k) ? "checked" : ""}>${swatch(k)}${esc(l.name)}${extra(k)}</label>`).join("")}</div>`;
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
  if (ui.bgEditor && !ui.started) return ["bgedit", () => backgroundEditor(state, ui)]; // ui/backgrounds.js, over the new-run screen
  if (ui.gearEdit && !ui.started) return ["gearedit", () => startGearEditor(state, ui)]; // ui/startgear.js, over the new-run screen
  if (ui.settings) return ["settings", () => settingsModal(state, ui)]; // ui/settings.js: over everything, a battle included
  if (ui.title) return null; // the title screen (ui/title.js) is up: the new-run screen waits for New game
  takeLootReq(state, ui); // a raid's search window asked for by the battle (ui/combat.js, sim/raidloot.js)
  if (ui.inv && (ui.inv.loot || ui.inv.raid)) return [ui.inv.raid ? "rloot" : "loot", () => inventoryModal(state, ui)]; // over the battle screen
  if (!ui.started && ui.nrMap) return null; // the new-run screen put aside to look at the map (View map)
  if (!ui.started) return ["newrun", () => newRunScreen(state, ui)];
  // A card raised over a fight (sim/floorfolk.js: the survivors barricaded upstairs) is the one card that shows during it.
  if (state.combat && !state.combat.over && !state.gameOver && state.cards.length && state.cards[0].battle) return ["card", () => cardModal(state, state.cards[0])];
  if (state.combat) return state.gameOver && !state.combat.over ? ["over", () => gameOverScreen(state)] : null;
  if (ui.why) return ["why", () => whyModal(state, ui)]; // ui/causes.js: over a card, the diary, the memorial wall or game over
  // A card's result comes before "game over", so the last thing that happened is not skipped.
  if (ui.cardResult) return ["result", () => `<div class="box"><h1>${esc(ui.cardResult.title)}</h1><div class="result">${esc(ui.cardResult.text || "Done.")}</div><button class="primary" data-action="cardok">Continue</button></div>`];
  if (state.gameOver) return ui.ledger ? ["ledger", () => ledgerModal(state, ui)] : ["over", () => gameOverScreen(state)]; // the Ledger opens over the end screen
  // A card that stops the clock by the pause rules, or one opened from the tray (ui/pacing.js puts it first).
  if (nameModalUp(state, ui)) return ["namebase", () => nameBaseModal(state, ui)]; // ui/basename.js: a base just founded, or ✎ Rename (before its founding card)
  if (cardUp(state, ui)) return ["card", () => trayCardFrame(state, ui, cardModal(state, state.cards[0]))];
  if (!state.autopilot && activeCrawl(state)) return ["crawl", () => crawlModal(state, ui)]; // a city crawl's block card (ui/citycrawl.js)
  if (!state.autopilot && activeHiveCrawl(state)) return ["hivecrawl", () => hiveCrawlModal(state, ui)]; // a hive crawl's chamber (ui/hivecrawl.js)
  if (state.engagement && !state.autopilot) return ["search", () => engagementModal(state)]; // on autopilot the governor searches (sim/autopilot.js)
  if (state.trade && !state.autopilot) return ["trade", () => tradeWindow(state, ui)]; // ui/tradewindow.js
  if (ui.volPick) return ["volpick", () => volPickModal(state, ui)]; // ui/volunteers.js: a group's ask of you, choose who goes
  if (ui.volReq) return ["volreq", () => volRequestModal(state, ui)]; // ui/volunteers.js: ask a group for volunteers
  if (ui.diplo) return ["diplo", () => diplomacyModal(state, ui)]; // ui/diplomacy.js: jobs, market board, world affairs, coalition (over the radio panel)
  if (ui.radioWith != null) return ["radio", () => radioModal(state, ui)];
  if (ui.caravanPlan) return ["caravan", () => caravanPlanModal(state, ui)];
  if (ui.planner) return ["planner", () => plannerModal(state, ui)];
  if (ui.routeSetup) return ["route", () => routeModal(state, ui)];
  if (ui.gunb) return ["gunb", () => gunBuilderModal(state, ui)]; // ui/gunbuilder.js: over the inventory (never in a battle: above)
  if (ui.inv && ui.inv.form) return ["teamform", () => teamFormModal(state, ui)]; // ui/teamform.js: Form a team at a base, or edit one waiting there
  if (ui.inv && ui.inv.team != null) return ["teaminv", () => teamInvModal(state, ui)]; // ui/teaminv.js: a whole team; Drop off and Load at a base
  if (ui.inv) return [`inv:${ui.inv.sid}`, () => inventoryModal(state, ui)]; // closes back to the survivor / base screen under it
  if (ui.survivor) return [`survivor:${ui.survivor}`, () => survivorModal(state, ui)];
  if (ui.memorial) return ["memorial", () => memorialModal(state, ui)]; // ui/relations.js; a name opens the survivor screen over it
  if (ui.baseView) return ["base", () => baseModal(state, ui)];
  if (ui.roster) return ["roster", () => rosterModal(state, ui)]; // ui/roster.js (the survivor and base screens open over it)
  if (ui.diary) return ["diary", () => diaryModal(state, ui)];    // ui/diary.js
  if (ui.codex) return ["codex", () => codexModal(state, ui)];    // ui/codex.js
  if (ui.ledger) return ["ledger", () => ledgerModal(state, ui)]; // ui/ledger.js
  return null;
}
// The planner's lines for Occupy (sim/occupy.js): what stands there, the stores left, who is inside and the crew's odds
// against them, and who it angers.
function occupyNote(state, tile, members) {
  const v = occupyPreview(state, tile, members);
  if (!v) return "";
  const th = v.threat;
  const odds = v.odds != null && th && th.count ? ` Your crew: about ${Math.round(v.odds * 100)}% to clear it.` : "";
  return `<div class="small ${v.grievance || (v.odds != null && v.odds < 0.5 && th.count) ? "danger" : "muted"}" style="margin:-0.3rem 0 0.4rem"${tip("What is inside changes with time: the dead drift in week by week, squatters come and go. Those you kill in a failed attempt stay dead about a week.")}>🏚 ${v.mine ? `${esc(v.fromName)}, your old outpost` : `The base ${esc(v.fromName)} left`}, empty since day ${v.day}. Standing: ${esc(v.standing)}.${v.stock ? ` Stores left: ${esc(v.stock)}.` : ""} Inside: ${esc(v.threatText)}${th && th.count ? ` (power ${th.power} each)` : ""}.${odds}${v.grievance ? ` Moving in angers ${esc(v.grievance)}.` : ""}</div>`;
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

// The end screen (fallen, or a victory) with the run summary under its words (ui/ledger.js), before its buttons.
function gameOverScreen(state) {
  return gameOverWords(state).replace('<div class="box">', '<div class="box rsbox">')
    .replace('<div class="row">', `<div class="rs-over">${runSummaryHTML(state, { noButtons: true })}</div><div class="row"><button data-action="ld-open" data-tab="ledger"${tip("Every resource day by day, per base (E)")}>📈 Ledger</button>`);
}
function gameOverWords(state) {
  if (state.victory && state.victoryReason === "alliance") {
    const st = hiveTracker(state).stats;
    const a = goalsProgress(state).alliance;
    return `<div class="box"><h1>${esc(ALLIANCE.NAME)} holds the state</h1>
    <div class="text">Victory by alliance: the coalition holds ${Math.round(a.land.pct * 100)}% of the land (more than half${a.land.claimed ? `, ${a.land.claimed} tile${a.land.claimed === 1 ? "" : "s"} of it claimed by your teams` : ""}), and ${a.members} group${a.members === 1 ? " stands" : "s stand"} in it beside you${a.groups > a.members ? ` (${a.groups - a.members} outside: conquest counts)` : ""}${state.conquest && state.conquest.stats.defeated ? ` (you broke ${state.conquest.stats.defeated} that would not join)` : ""}. ${a.hivesLeft ? `${a.hivesLeft} hive${a.hivesLeft === 1 ? " still stands" : "s still stand"}, but the state is in your hands.` : "No hive is left."} ${alive(state).length} survivors made it to day ${day(state)}; you destroyed ${st.destroyed} hive${st.destroyed === 1 ? "" : "s"}, took ${state.conquest ? state.conquest.stats.taken : 0} base${state.conquest && state.conquest.stats.taken === 1 ? "" : "s"}, saved ${state.stats.peopleSaved} people and repelled ${state.stats.raidsRepelled} raids.</div>
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
  const kb = (id, def) => k(keyLabel(id, 1) || def); // a key as it is bound now (Menu → Controls)
  return `
    <b>Goal:</b> keep your people alive, find the other groups, trade or fight, expand with outposts, and push back the hordes. You <b>win</b> one of two ways: destroy every infestation hive (and no new one being built), or make the <b>Calder Coalition</b> (you and at least one member group) hold more than half the land (your bases' reach, your members' bases and the tiles your teams claim; a member's land counts once it has been in the coalition a year and while it is not at war; invite the willing, break the hostile or leave them be: groups outside no longer block it) and keep it that way for a year. Neither comes before year ${ERAS.WIN_FROM_YEAR}; a campaign is paced to be won between years 10 and 15 (see <i>Eras and winning</i>). You lose when the last survivor is dead, gone or lost.<br><br>
    <b>Time:</b> the game starts <b>paused</b>; a banner at the top of the map says so. Press ${k("Space")} or pick a speed (${k("1–5")}) to run the clock. Orders you give while paused are queued and start when you unpause (the banner counts them). Windows (planner, base, help) stop the clock while they are open. Cards stop it by your pause rules (Options → Pause for…); the others wait in the card tray at the top of the map while the clock runs (Help: Pause rules and the card tray). At 3× and 5× the clock drops back to 1× when something happens.<br>
    <b>Seasons and weather:</b> a year is four seasons of 28 days (spring, summer, autumn, winter); a run starts in mid-spring. Next to the clock: season, day of the season, the weather at your hub and the temperature (and a storm on its way there: ⛈️ in 5h); hover it for what the weather does, the weather fronts on the map with when they reach you, and the outlook for the region (3 days; 4 with a watchtower, 5 with a radio station; the further out, the less sure). Rain and melting snow leave mud that slows off-road travel (vehicles most); snow cover slows everything, off-road most; storms and blizzards slow everyone a lot, can hurt people on the road and make boat crossings riskier; fog cuts sight by a tile and makes ambushes likelier; heat waves slow walkers. Arrival times in the planner and panels already include the weather hour by hour as far as anyone can tell (the ground, and the fronts already on the map: a front that forms later can still slow a team; the planner shows how many hours the weather adds). Crops grow only in their seasons and best in mild, moist weather; frost, hard freezes, blizzards, drought, heat and storms can kill them, and wet weather rots ripe ones. Cold and heat can make people outdoors ill, the dead slow down in deep cold, and the map's <i>Weather</i> layer shows snow, rain and heat as a wash over the land.<br>
    <b>Regional weather:</b> the season and the temperature are the same across the state, but storms, rain belts, blizzards, snow squalls and fog banks are <i>fronts</i>: they come in from the map's edges (mostly the west; from the north in winter) and cross it over hours to a couple of days, so a storm can lash a team in the hills while your hub stays dry. The weather under a front is what counts where you are: a team's pace, sight and ambushes, injuries on the road, boat crossings, hunting, foraging and woodcutting, how fast the dead walk; your hub's crops, rain barrels and the like go by the hub's own weather. The Weather layer shows fronts as faint clouds, the Weather fronts layer strongly with where each is heading; a team's panel shows the weather where it is.<br>
    <b>Frozen rivers:</b> after a run of freezing days in deep winter the rivers freeze, from their northern reaches down, and can be walked across (1.75 hours a tile; no vehicles or bikes). The ice is drawn pale on the map. The dead and other groups cross it too: a river that kept your base safe all year is no barrier until the thaw (an alert says when the river by a base has frozen). Early and late in the freeze the ice is thin: someone may go through (hurt, two hours lost). When it thaws, anyone on it scrambles ashore and ways over it are planned again.<br>
    <b>Map:</b> left-click a tile to inspect it, right-click for actions, drag or ${k("W A S D")} / arrows to pan, wheel to zoom. Bright tiles are live (around your bases, near a team in radio range); dim tiles show the last report with its age; dark tiles have no intel. Sites show danger as skulls under their name when zoomed in. The map shows the places everyone knew before the fall (towns, cities, roadside sites, landmarks); farms, cabins, lodges and camps off the roads, and crash sites, appear only once your people find them or hear of them. Toggle layers in the map's corner.<br>
    <b>Hardcore mode:</b> chosen on the new-run screen (Mode). The run starts on the day Calder falls instead of 6–12 months later. <i>You:</i> three survivors (or one to four: <b>Starting people</b> on the new-run screen, Hardcore only) on the road with whatever they grabbed as they fled (some with a bag, some with only their pockets; maybe a knife, a bat or a pistol with a few rounds), food and water for a day or three each (a farmer, a hunter or a trucker grabbed more food; a veteran, a nurse, a mechanic or a cop less, running with ammo, a vest, meds or tools instead), no hub and one car between you (what is in its back and a prepper's packed bag are one of each whatever the count: fewer of you share them, but carry, scavenge, build and fight with fewer hands). One or two who got out are the kind who can look after themselves: better Scouting, Stealth and Medicine (more alone), the car's empty seats loaded with food, water and meds, and fewer armed strangers stop them on the road, and fewer of them. You are with them, so the team always takes orders and you see what it sees. The run opens on a short account of what they grabbed (<i>Begin</i> closes it), the clock paused and the team waiting for orders: give them from its panel (click the team on the map, or the Teams tab). Find water first (rivers and lakes: Fetch water; shops, diners and churches), then give the order <b>${ESTABLISH_LABEL}</b> on a good spot (water near, sites around, few of the dead): the team sets up camp there (an hour, nothing carried; a camp is the barest base, its people live there and the team's load goes into its stores), and its step up into a shelter needs ${needText(STAGING.HARDCORE.needs)} brought in (as many trips as it takes) and ${STAGING.HARDCORE.work} work-hours by its builders (faster with more hands and Mechanics; people at a camp draw the dead and raiders). Later the shelter is built up into your hub. The camp's base window (its Camp tab), the Bases tab and the alerts show what is still missing. People you meet on the road can join the team. <i>The outbreak:</i> it is just starting, in one or two places, and spreads through the first year. <i>The other groups:</i> bands of survivors founding their own hubs too; the military holds its base until a hive near it overruns it; no raiders at first.<br>
    <b>World size:</b> chosen on the new-run screen. Small (48×32) is tight and close: fewer towns, 3–6 groups, the hives a short walk away. Normal (64×42) is the standard state with 5–10 groups. Large (80×52) adds a third city and a second outbreak, 7–14 groups. Huge (100×66) has four cities, three outbreaks and 10–18 groups: trips are long (take vehicles, build outposts), the groups mostly keep to their own corner, but more hives are within reach of your walls. Every size has about the same towns, sites and hives per tile.<br>
    <b>Bases (Manage):</b> roles (farm, scavenge, operate, build, guard, rest, medic, craft), workshop stations with operators, the construction queue (beds: the hub 4, an outpost 2, a bunkhouse +6, a barracks +12 on one building plot, or a bunkhouse expanded into a barracks where it stands; more people than beds lowers everyone's mood every day), the armory, hand crafting, vehicles (refuel, repair), supply runs and the medical tab. Click a base's name on its screen to rename it. People in a hospital bed do not work.<br>
    <b>Hunger, thirst and mood:</b> everyone has a Hunger, a Thirst and a Mood gauge (0–100). Below ${NEEDS.lean} hunger and thirst cut work and aim; below ${NEEDS.low} they cost mood by the hour. At a base that is out of food (water), or below ${NEEDS.starving} away from a base, someone is <b>starving</b> (or parched): every morning it lasts costs more mood than the last (hunger −${STARVE.food.step}, −${STARVE.food.step * 2}, −${STARVE.food.step * 3} … up to −${STARVE.food.max} a day; thirst −${STARVE.water.step}, −${STARVE.water.step * 2} … up to −${STARVE.water.max}) until they eat or drink, which resets it. Left alone it ends at rock bottom: under 10 mood for 3 mornings they may break down, below 15 they may walk out, or the empty gauge kills them. <b>Status icons</b> next to a name (the roster, the People tab, a base's people, a team's members, the battle roster) show what is wrong, one each and stacking: ${STATUS_ICONS.mood} low mood (below ${STATUS.mood}), ${STATUS_ICONS.hunger} hungry or starving (hunger below ${STATUS.hunger}), ${STATUS_ICONS.thirst} thirsty or parched (thirst below ${STATUS.thirst}), ${STATUS_ICONS.health} low health (below ${STATUS.health}), ${STATUS_ICONS.infected} infected (an infected wound, or the worm once spotted), ${STATUS_ICONS.sick} sick (${STATUS_ICONS.injured} only injured). A red frame means it is serious; hover one for the detail ("Starving: day 3, mood −${STARVE.food.step * 3} a day").<br>
    <b>Food and the winter:</b> crops ripen in batches (Farming tab), and nothing grows outdoors in winter: the first spring harvest comes weeks into spring, so the food for the hungry gap has to be grown and stored in summer and autumn. Sow kale, winter roots and winter wheat in autumn (they stand the frost); wheat, winter wheat and dry beans go into the <b>preserved</b> stock. Fresh food needs <b>storage room</b>: the hub has a small cellar (200), an outpost a pantry (40); root cellars (+200), a storehouse (+150) and a cold store (+150, best in winter) add more. Food in storage spoils slowly; food above the room is stored outside and spoils fast (more in heat and rain). Preserved food (jarred, dried, canned, grain) barely spoils, needs no room, is eaten once the fresh food is gone, weighs less on a trip and sells well: a <b>Preserving kitchen</b> (operator, water, scrap and empty jars) and <b>Drying racks</b> (no operator) make it from surplus. Jars are found in kitchens, shops and farms; most come back when the food in them is eaten. An <b>Animal pen</b> (hens and goats, a building plot) gives food every day of the year to a keeper (an operator, Farming): 3 a day (4 with Farming 6+), three quarters of it in winter, half without walls; the animals graze two of the base's outdoor crop plots. Greenhouses grow through the winter too. The Farming tab's <i>Winter outlook</i> says whether the food will last to the first spring harvest.<br>
    <b>Water and the summer:</b> everyone at a base drinks 1 water a day in spring and autumn, <b>1.3 in summer</b>, 0.9 in winter and <b>at least 1.6 on a hot day</b> (a heat wave or 30 °C and up; the forecast marks them); prisoners and guests too, and teams in the field drink their rations times the same (the trip planner counts every hour at its own day's rate). Crops need watering on dry days, a fifth more in summer. In: the hub's well 12 a day, an outpost's spring 3, a river or lake next to the base 3, a Well +6 (less in a dry spell), a Rain catcher +2 per unit of rain, a water filter +3 (it clogs after about 20 days); the tanks hold 80 at the hub, 40 at an outpost, +150 a Cistern. From spring on the Farming tab's <i>Summer water</i> line says whether the water holds through an average summer day and a heat wave, and what would close a gap; a week before summer you are warned if it will not. A team on a tile next to a river or lake can <b>Fetch water</b> (2h: every free container filled, 1 kg a unit; a team panel order or a plan step). <b>Purified and un-purified water:</b> water from the land (the well, springs, streams, Wells, rain catchers, claimed wells, prisoners hauling it, and what teams fetch) comes in <i>un-purified</i>; bottled water found in shops and houses is <i>purified</i>. Each day before drinking a lit Water boiler purifies the day's drinking for everyone at the base, each water filter ${WORM.PURIFY_FILTER} a day, a shelter's lit fire like the boiler. People drink purified water first, then un-purified water (rather than go thirsty; any of it can carry the worm, and on infected ground it carries the worm's eggs), and crops get un-purified water first; the tanks hold both, and thirst counts both. The top bar shows both (purified, + raw). A team packs purified water first; on the road it drinks un-purified water through a water filter, boiled at a lit camp fire (which also boils some of it into purified water each hour), or with <b>purification tablets</b> (one per ${WORM.TABS_WATER} water: on the move, or at a camp whose fire is out or has nothing left to burn; a lit camp fire with firewood comes first and saves them). The tablets are for the road (a team fetching water or out more than two days packs a tube from the armory); a base uses its armory's only in an emergency, when the boiler is cold with nothing to burn (no firewood, no junk it may burn, no fuel) and there is no water filter (a log line says so). Other groups sell purified water and pay about half for un-purified. Thirst kills faster than hunger: build wells and filters before summer, keep the tanks full, and do not take in more people than the summer wells can carry.<br>
    <b>Hunting, fishing and snares:</b> right-click a tile for a <i>Hunting trip</i> or <i>Fishing trip</i> (the planner's presets: go, hunt or fish 8 hours, come home), or give a team on the spot <i>Hunt</i>, <i>Fish</i> or <i>Set snares</i> (team panel, Land). The tile panel shows the game there (plenty, some, scarce) and what an 8-hour hunt should bring. Forest and hills are the best hunting, farmland fair, towns, cities and hive land almost nothing; autumn is the best season, and snow shows tracks in winter. A hunting rifle or a bow is best (a pistol is poor; no weapon, no hunt: set snares); every gunshot costs ammo, adds Heat and can draw the dead nearby, bows and crossbows are silent but shoot <b>arrows</b> (a shot at game loses its arrow about half the time: craft 12 from 30 firewood and 1 scrap, or find them at hunting lodges, gun stores, sports shops and campgrounds; a hunting trip takes up to 12 from the hub when someone has a bow; in a fight a bow uses an arrow a shot too, and about half are picked up again after a win). <b>The hunting mix</b> (each base's Farming tab, <i>Hunting</i>): the share of the hunting hours with <i>traps</i> (snares and deadfalls: small game only, silent, no ammo; about half a rifle's food), <i>bows</i> (silent, arrows; nearly a rifle's food) and <i>guns</i> (each hunter's best weapon: the most food, ammo, Heat, and the dead within 3 tiles may come to the shots), for the base's hunters and for the teams that hunt from it. Short of a gun or ammo the hour goes to a bow, short of a bow or arrows to the traps: never louder than the mix. The governor's cabins go quiet when the dead wander within 3 tiles (unless food is short), and it saves ammo with bows. The land runs out of game as you hunt it and grows back over weeks. <b>Snares</b> (snare wire, or 2 scrap) catch a rabbit a day or so: check them within 2–3 days, before the catch rots or someone takes it. <b>Fishing</b> needs a rod or a net, on a river bank; in a freeze, a crowbar, machete or axe to cut the ice (half the catch). Fresh game and fish weigh twice what packed food does (a deer on foot is a slow walk home; a car carries it all) and spoil fast: the team eats it first, and at home drying racks and a <b>Hunting cabin</b> smoke it. A Hunting cabin (any base with game land around it) also lets the people on the <i>Hunt</i> job hunt the land within 2 tiles every day by the base's hunting mix (gunshots add to the base's Heat); a base on a river can put people with a rod or net on the <i>Fish</i> job.<br>
    <b>Foraging:</b> anyone can gather wild food: berries, nuts, mushrooms, greens, roots, apples from abandoned orchards, now and then herbs (meds) or a wild hive's honey. Give a team <i>Forage</i> (team panel, Land; or right-click <i>Go and forage here</i>; a plan step), a team in camp short of food forages around it in daylight, and at a base the <i>Forage</i> job gathers within 2 tiles while food is short. Forest is best, farmland and old farms good, hills some, towns little; summer and autumn are plentiful, spring gives greens, winter almost nothing. Farming and Scouting help. It stretches the food (a forager brings in a ration or two a day in season), it does not replace the farms; the land picked hard grows back over a season. It is time on one spot (Heat), and a bad mushroom now and then makes someone ill. When food runs low the alerts and the team panel say where to forage or hunt nearby.<br>
    <b>Firewood:</b> the winter's heating. Below 0°C a base burns 15 firewood (1.5 kg) a person a day (22.5 in a bitter frost) before any fuel (30 firewood, 3 kg, heat as much as 0.2 fuel), so cut a winter's worth in late summer and autumn and keep the fuel for the vehicles and the generator. The <i>Cut wood</i> job (Work tab) cuts within 2 tiles of the base; a team can <i>Cut wood</i> anywhere (team panel, Land; right-click; a plan step) and carry it home (0.1 kg a piece, and a day's cutting is tens of kilos: a car helps). Firewood also turns up in woodpiles, log baskets and sheds, and anything wooden, paper or cloth breaks down into firewood by its weight (inventory: Break down for firewood). Forest gives most, hills fair, farmland and suburbs little, a city next to nothing; an axe, a sledgehammer or a machete cuts far faster than bare hands. Chopping is loud and axes slip; cut land grows back over seasons. A camp fire burns deadfall for free, except on bare ground. The top bar's Firewood says how long it lasts in the cold, and an alert warns when winter is coming without enough.<br>
    <b>Sending a team:</b> select a tile, pick a mission, then crew, vehicle or on foot, stance and supplies. Everything has a weight: what people wear plus the packed supplies and found cargo, shared out among the team (max load 40 kg each, 28 with a Bad Back, 48 with a Strong Back, more with a pack or Packrat). Load bands slow a team on foot and make it eat and drink more on the move: Light up to 18 kg, Medium up to 28 (−10% pace, +15% rations), Heavy up to 38 (−25%, +35%), Overloaded above (−45%, +60%). Scouting eases it (up to half at 20). A car takes the whole load off its riders (it burns more fuel the fuller it is); bikes (one each) carry 15 kg on the rack and take 55% of the rest away. Teams report only when they get home, unless a radio station is built and they are in range.<br>
    <b>Forming a team:</b> <i>Form a team…</i> (the base screen, the Teams tab, the tile panel, or right-click your base) picks people at that base (with their skills, health, sleep and kit; filter and sort the list), up to four vehicles (cars, and the base's bikes: a bike for each person not driving; every vehicle needs its own person (a driver, a rider) and, with two or more, everyone a seat; a team that loses people leaves the vehicles nobody can drive, marked; if a lost vehicle leaves too few seats the rest walk and the team slows to their pace (or leave them to follow on foot); seats, payload and fuel add up, the slowest sets the pace, bikes among cars keep the convoy to the bikes on roads; every vehicle wears on the road, a breakdown hits one of them and it can be left behind if the others seat everyone; on a battle map the first car is the one you drive, the others stand beside it), what each person wears and carries from the armory (the Gear tab is the inventory), and the supplies and cargo it takes from the stores. <i>Form team</i>: they leave the base's roster and stand on its tile as a team waiting for orders. While a team waits on one of your bases, <i>Edit team…</i> adds people from that base or sends some back in, swaps the vehicle, and changes gear, supplies and cargo (the same weight rules); <i>Enter base</i> brings the whole team back in. Closing the window after moving gear asks: <i>Keep gear changes</i> or <i>Undo changes</i> (everything moved goes back exactly where it was); the window's own <i>Undo changes</i> button does it while it stays open. Keys in the window: 1 2 3 the tabs, ↑ ↓ and Space pick people, F filter, S sort, Enter form.<br>
    <b>Team panel:</b> click a team on the map, in the Teams tab or in the Running orders list. It shows people, gear, supplies, the vehicle and the order queue. Orders: move, return home, scavenge, look around (2h), survey the area (12, 24 or 48h), set up camp, roadside repair, treat someone with carried meds (1h), field crafting, boat crossings. A waiting team starts an order at once; a moving team (or queue mode) adds it to its queue. When the queue is empty the team reports in with a card. In the queue, the move under way is the first line: ✕ cancels it and the team stops where it is (the next queued order starts there). Queued orders can be removed, or reordered: drag a line onto another, or click one to select it and press ↑ ↓ (Delete removes it).<br>
    <b>Moving people between bases:</b> a base with more people than beds loses mood every day, and says so with an <i>Overcrowded</i> card (once, then again after ${CROWD_CARD.days} days or sooner if it gets worse). <i>Move a team out…</i> (on the card, or under Beds on the base screen) opens the move-out planner: pick who goes, their transport and what they take from that base's stores (by default the trip plus ${MOVE_OUT.days} days of food and water, and ${MOVE_OUT.scrap} scrap for an outpost), and where: another of your bases, or <i>Pick a place on the map</i> (they wait outside and the next click on the map sends them). On the map it is a team like any other: order <i>Build outpost</i> on a good spot to found a new base with them. A team that ends a move on one of your bases that is not its home is asked <i>Enter that base?</i>: yes, they live and work there from now on, and what they carry goes into its stores (the vehicle parks there); no, they stay a team and wait for orders.<br>
    <b>Survey and rumours:</b> the <b>Survey</b> mission (planner, right-click any tile, or a team's panel) sweeps the land around a tile (2–4 tiles, 6–48 hours) for places the old maps never showed: farms, cabins, hunting lodges, campgrounds, ranger stations and wrecks off the roads, and caches, wrecked cars and camps. The team moves from spot to spot inside the circle and ends back at its centre; the map shows the circle and its path, the team panel the hours and what it found. Each hour its odds of spotting a hidden place come from the best Scouting (and a little from each extra person), the ground (open farmland easy, forest and hills hard), how far the place is from where the team stands, daylight and the weather (night and fog are bad: a light, night vision or a thermal help; the brighter the light the better), how it travels (a car covers ground but sees little off the road, bikes in between) and its stance (stealthy is careful but covers less). The planner shows the odds as a word (good / fair / poor) with the reasons. It eats at the moving rate, builds Heat at half the rate of standing still, meets what the roads meet on every tile it walks into, and wears the vehicle; on hive land the tougher dead notice it. <b>Optics</b> carried by anyone on a team help: binoculars (the team sees a tile further, ×1.25 odds and a tile more reach), a pocket monocular (×1.1), a spotting scope (×1.6 and two tiles, only while it stays put: surveys, looking around, camps), a thermal monocular (no night or fog penalty; in the off hand it sees in the dark in battle), and a telescope kept in a base's armory (+1 tile of view, +2 with a watchtower). <b>Rumours:</b> radio chatter, travellers, merchants and other groups' news sometimes speak of a place nobody has found ("a hunting lodge somewhere north of Dunmore"): a dashed circle on the map that holds it for 20 days. A survey whose centre is inside it has three times the odds of finding that place.<br>
    <b>Raids (scavenging a site):</b> opens a tactical map of the place. Move next to containers and search them (${k("Shift+S")}): a window shows what is inside next to the survivor, with weights; drag what to take. Each survivor carries their own finds up to their max load; the first 8 kg a turn are free to haul, then 12 kg an action. Teammates next to each other hand things over for free. Someone who bleeds out drops what they carried. With a vehicle, walk to it and open it (${k("N")}) to put what you carry in it or take things out. Guards and the dead are unaware until they see or hear you; Heat rises every turn and with noise, and each stage brings more dead. Leave from a green extraction zone (${k("X")}); a vehicle waits in its own zone. Anyone left behind is lost.<br>
    <b>Battles:</b> each unit has two actions a turn. Click a tile to move, an enemy to shoot; ${k("F")} shoot, ${k("I")} reload, ${kb("battle.melee", "V")} melee, ${k("O")} overwatch, ${k("H")} hunker, ${k("M")} meds (anyone can stabilize someone who is down, by hand with no meds), Shift+H heal and Shift+V revive (a medic: anyone with a med kit), Shift+D drag a downed teammate out of the line of fire (again: put them down), Shift+K finish a downed enemy (see Medics and the downed), ${k("U")} crush the skull of a body next to the unit (a Carrier raises the human dead near it at once; a crushed skull keeps the loot), ${k("J")} double tap a body in sight (1 round, noise), ${k("P")} pick up or put down a body (half the move distance and no shooting while carrying; a carried body cannot get up), ${k("Z")} lay a carried body in the team's car (a raid's vehicle zone, a field battle's evac strip; the body weighs 70 kg plus its things in the team's load, so the car needs the room: it comes home to be buried or burned on the Armory tab), ${k("R")} retreat (one unit, from the green evac strip), ${k("Shift+T")} man a vehicle's turret from inside it (the M2 on a military Humvee: Shoot fires 3-round bursts from its belt, a level up and through cover, very loud, pinning whoever it lands near; the gunner is the one rider who can be shot; again to get down), ${k("Tab")} or ${k("1–9")} select, ${k("Space")} or Enter ends the turn, Esc or right-click cancels. After a win, loot the bodies: take things one by one or everything that fits. <b>Guns use ammo, bows use arrows:</b> every gunshot costs a round (an assault rifle two), every shot from a bow or crossbow an arrow (or bolt), from what the team packed and found or, defending a base, from its stock; the battle panel shows both. With none left, the gun or the bow is only a club (melee). After a win about half the arrows shot are picked up again, after a loss or a retreat none. By the numbers (fights resolved without the map, raids on your bases, the dead at the walls) the same holds: up to 6 shots a head, the bows' in arrows; under 3 a head the guns or the bows fight at 60%. Teams with a bow pack a dozen arrows each (the planner's Auto-fill, the governor, crews).<br><br>
    <b>Magazines and reloading:</b> every gun holds so many rounds (9mm pistol 15, pump shotgun 6, hunting rifle 5, assault rifle 30, that is 15 two-round bursts, pipe shotgun 1, .357 revolver 6, lever-action rifle 8, police carbine 30) and starts a battle loaded. Each shot takes its rounds from the magazine (and from the team's ammo); an empty gun cannot shoot or go on overwatch until it is reloaded: ${k("I")} or <i>Reload</i>, 1 action, fills it from the team's ammo, so reload with one action and shoot with the other. The panel shows each gun's rounds ("9mm pistol 7/15", never more than the team's ammo left) and flags an empty one. Bows and crossbows draw a fresh arrow or bolt with each shot (it costs an arrow) and never need reloading. The enemy's guns run dry too: they reload instead of shooting (their spare ammo never runs out), and a gun picked up in the middle of a raid comes empty.<br>
    ${BATTLE_GUNS_HELP()}<br>
    ${LAUNCH_HELP}<br>
    <b>Battle view:</b> battles are drawn in an isometric (pseudo-3D) view: textured ground (grass, fields, dirt, gravel, asphalt, floorboards, concrete, rubble, water, the hive's mud and blood), walls, fences, cars, trees and barricades as raised blocks, walkways, towers, upper floors and flat roofs at their real height (with ladders and stairs), units standing on them with a shadow, a ring in their side's color, a health bar and, for the enemies in sight, the selected unit's chance to hit. Buildings have roofs: one with your people inside (or an enemy you see, or the mouse) is shown cut away, its near walls lowered; ${k("B")} or <i>Roofs</i> in the battle panel hides every roof. A wall, tree or roof in front of your people is drawn faded, and anyone still hidden shows as a faint silhouette. Pointing at a tree's crown picks the ground behind it (the tree itself at the foot of its trunk): a tile hidden behind a tree, a car or a wall shows a dashed outline on top when you point at it, and anyone standing behind one has their tile outlined dashed. Tiles nobody sees are dark and grey, with a ghost where an enemy was last seen. Drag the map (or hold ${k("W")} ${k("A")} ${k("S")} ${k("D")} or the arrow keys, or push the mouse to the screen edge) to pan, the wheel or ${k("+")} / ${k("−")} to zoom, ${kb("bview.rotLeft", "Q")} and ${kb("bview.rotRight", "E")} to turn the view a quarter, ${kb("bview.center", "Home")} to center on the selected unit. The compass in the corner points north. A big map opens on your people and the ground toward the enemy, at a zoom that shows them, and a red arrow at the edge of the view points at each enemy you see (or last saw) off screen. A building with several storeys is shown one floor at a time: the floor you are on is drawn raised to its height with the storeys below as the building's outer walls, the storeys above cut away and the roof only on the top floor, the street below dimmed; ${k("PageUp")} / ${k("PageDown")} or the view bar's <i>Floor 2 of 5 ▲ ▼</i> control change the floor shown, selecting a unit shows its floor, and someone on another floor is a faint ▲ / ▼ marker with the floor number at their spot (click it to jump there). Stairwells are the same cell on every floor: standing on one, <i>Go up</i> / <i>Go down</i> in the actions take the stairs (1 action), and the view follows.<br>
    <b>Battle map sizes:</b> four sizes by the kind of battle: Small 24 × 18, Medium 32 × 24, Large 40 × 30, Extra-large 48 × 34. Raids by the site: hospitals, universities, prisons, military bases, malls, factories, airports, the warehouse district and city centers are Large; supermarkets, schools, police and fire stations, apartments, offices, motels, churches, farms, ranches, lodges and campgrounds Medium; gas stations, diners, groceries, pharmacies, clinics, cabins, barns and small shops between Small and Medium. A bigger site has more rooms, more to search and more of the dead. Fights in the open are Medium, up to Large with more people and dead on the map (a little bigger on open plains, a little smaller in forest and hills, where the cover makes up for it). A hive assault is Large; a group's base Medium to Extra-large by how many live there; your hub's yard Large to Extra-large and an outpost's Medium to Large by their buildings (the wall map is as long as the yard). Bigger maps carry more buildings, cover and props, not empty ground: most open ground has something to hide behind within 3 tiles. The two sides start about 15–20 tiles apart whatever the size, so the first shots come in a turn or two. When only a couple of the enemy are left, far off and unaware (or running), the area is clear enough: ${k("Area clear: finish")} (${k("Shift+C")}) ends the fight as a win, or hunt them down; a raider who runs off out of sight gets away.<br>
    <b>Sounding the retreat:</b> when a fight goes bad, <i>Sound the retreat</i> (${k("Shift+R")}) pulls everyone out at once. First it shows each person's chance to get away: safe on the strip; elsewhere 100% minus 3 a tile to the strip, 25 for each enemy next to them, 6 for each shooter that sees them and 4 for each of the dead close behind (at most 35), up to 30 for wounds and 2 a point of armor, plus Scouting and 10 at night (5–95%). A downed teammate next to someone is carried out (slower: the carrier's odds drop); you can leave them instead. The caught take a blow from each enemy next to them and get out hurt, unless it puts them down: then they are left behind. A downed teammate dragged onto the strip goes with the last one out. When the AI plays a battle on the map for you (the autopilot's hive assaults), it sounds the retreat itself once the fight is clearly lost.<br>
    <b>Retreat by the numbers:</b> a fight that nobody plays on the map (${k("Auto-resolve")} on turn 1 of a battle, the autopilot, crews) is decided on the odds the card shows and plays out in three rounds; a fight being won takes its knocks early, one being lost keeps taking them. A card with a fight on it has a <i>Retreat if it goes badly</i> row, kept for the team: <i>Never</i> (fight it out), <i>When most are down</i> (more than half the team down or under 50 health), <i>If losing</i> (the fight turns against you, or anyone goes down), <i>At first blood</i> (anyone hurt). Under each fight choice it shows what that would likely bring ("If losing: about 64% to win; if it turns, most get away"). Breaking off: everyone standing runs, with the same escape check as <i>Sound the retreat</i> (distance, the enemy on them or shooting and chasing, wounds, armor, Scouting, night; by the numbers also +10 with the car close by, +5 bikes, +10 a stealthy team), the downed carried by the one with the best odds (they pull through half the time, more with a medic), the caught take blows and can be dragged down. The downed left behind are lost to the dead, or killed or taken prisoner by a group's people. The enemy keeps most of its people, nothing is looted, and the rounds not fought do not use their ammo. The autopilot breaks off <i>If losing</i> when Cautious or Balanced and <i>When most are down</i> when Aggressive; a crew follows its role's <i>Retreat</i> setting (by its style unless set). A horde fight on the road breaks off between wounds the same way. Base defences have no retreat by the numbers.<br>
    <b>Defending your base:</b> a horde that breaks in, raiders or outsiders you fight in person and a group come to free its people are fought in three tiers on two maps. <i>Tier 1, the walls</i> (only with walls built): your people stand on the <b>walkway</b> behind the wall (height 1, up the ladders) and on the <b>watchtower's</b> two towers (height 2) and shoot down over it; the dead claw at the wall sections and the gate and raiders batter them (each has hit points: a section 40 + 12 a point of wall strength, the gate 100, 180 reinforced; a bar under it shows the damage), and a section battered down is a new breach. Whoever stands in the gate or a breach holds it. Once 3 of them (or a quarter of those left, if more) are inside the wall, or any are and nobody holds the wall line, the fight moves to the second map; you can also <i>Fall back to the yard</i> yourself (${k("Shift+R")} on the wall map), and then they move first. <i>Tier 2, the yard</i>: the map is your base as built (the same base always looks the same): the main house, bunkhouses, workshop, infirmary, storehouse and the rest as buildings, barricades, sandbags, wells and barrels as cover, the gate and breaches where they were. Everyone carries over (health, ammo, gear, roughly where they stood), the attackers inside the wall come with them and those still outside come in through the openings a few a turn; a short redeploy lets you place your people near where they were (or skip it: Options, or the button on the redeploy). <i>Tier 3, the last stand</i>: buildings have barred doors and windows with hit points that the attackers must batter in, full cover inside and half cover at the windows; the bigger ones have an <b>upper floor</b> up the stairs and flat roofs are climbed by ladders (height 1). The yard is lost once 1.5× as many attackers as defenders still outside the buildings stand in it; if everyone falls the base is overrun. The green strip is the back gate: sounding the retreat there abandons the base. <b>Height</b>: +2 sight a level, +5 aim a level at anything lower (at most +10), half cover against shooters below; climbing costs 1 move a level (the dead 2) and only on a ladder, stairs or a tower. A base without walls starts on the yard map. Fights resolved by the numbers count the tiers too: walls, a watchtower, the reinforced gate and the trench for holding at the wall; barricades, sandbags, wire and spike pits for the yard; the buildings for a last stand. A horde warning says how many would break in and whether the yard or the buildings should hold them.<br>
    <b>Siege, fire and decoys:</b> <i>Grenades</i> (frag grenades from soldiers and military sites, pipe bombs) are thrown over walls: no line of sight is needed to a cell someone on your side can see (or where an enemy was last seen), but they land a tile off now and then (45% less 0.8 a point of aim over 40, more thrown blind): ${FRAG.dmg[0]}–${FRAG.dmg[1]} (a pipe bomb ${BLAST.dmg[0]}–${BLAST.dmg[1]}) to everyone within a tile, crates, fences, sandbags and barricades there blown apart, a door or the gate hit. A <i>siege ladder</i> (crafted; team cargo) is carried a tile slower and set against a wall section in one action from its foot; anyone then climbs onto the walkway, exposed while on it. From the walkway next to it a defender pushes it off (${LADDER.PUSH}% + a fifth of melee aim, Tough and Brave help, −15 with someone on it; the climber falls ${LADDER.FALL[0]}–${LADDER.FALL[1]}). A <i>battering ram</i> (crafted at a workshop; ${GEAR.ram.weight} kg) needs ${RAM.MIN}–${RAM.CREW} carriers who walk ${RAM.MOB} tiles an action, cannot shoot and have no cover; its lead swings it at a barred gate or door for ${RAM.DMG[0]}–${RAM.DMG[1]} a carrier. Shoot the crew, or drop rocks on them from the walkway (${DROP.CHANCE}%, ${DROP.DMG[0]}–${DROP.DMG[1]}, and the crew is bunched). Raiders bring ladders, a ram and grenades the better prepared they are (from about year 3, nearly always by year 10; outsiders less often), and the raid warning says so; against such a raid the walls count for less by the numbers (up to −${Math.round(CUT.max * 100)}% off their bonus). An <b>Assault</b> takes the hub's ram, ladders (one per three people) and grenades along in the team's cargo. A <i>Molotov</i> sets a 3 × 3 patch on fire for 2–3 turns; the dead that follow light or heat walk into it and burn ${FIRE.zburn[0]}–${FIRE.zburn[1]} a turn (brutes less), people ${FIRE.burn[0]}–${FIRE.burn[1]}; people's AI walks round it; it spreads to hay, crates, fences, wooden barricades, grass and floors, never to stone, asphalt or dirt, and its smoke blocks sight. <i>Decoys</i> pull the dead even after they have seen you, by what they sense: the ordinary dead follow noise and light, runners and brutes noise, spitters noise and light, crawlers heat; screamers follow nothing. Noise: noise makers, firecrackers, a wind-up alarm clock, a pocket radio; heat: hand warmers, a heat pack; a road flare and fire are light and heat. People are never fooled: a guard who hears a decoy looks to where it was thrown from. A <b>Shepherd</b> (from a hive's Shepherd's fold, about year ${SHEPHERD.YEAR} on) keeps behind its pack and out of the flames; the dead within ${SHEPHERD.AURA} tiles of it ignore decoys and fire, go for your people and keep together, until it dies. On the State Map a horde warning offers decoys from the armory as well as a decoy fire; a horde led by a Shepherd (the card says so) turns for either only ${Math.round(SHEPHERD.DECOY_CUT * 100)}% as often.<br>
    <b>Flashbangs:</b> police stations, prisons and the National Guard keep them (an armoury's crate holds 2–4, an evidence locker or an armoury safe a couple), Army trucks and wrecks carry them, and soldiers and guards bring one to a fight now and then. Thrown like a grenade (${k("G")}, up to 7 tiles; a doorway you can see is enough to toss one into a room nobody sees into): a bang and a blinding flash. Everyone of either side within ${FLASH.r} tiles who sees the spot (${FLASH.near} through a doorway or a window; walls stop it) is <i>stunned</i>: next turn they lose an action (${FLASH.apNear} within a tile), aim −${FLASH.aim} until that turn ends, and no overwatch (theirs drops). Facing away (and the thrower): only <i>dazed</i>, aim −${FLASH.daze}. A riot helmet's visor takes off ${Math.round(FLASH.visor * 100)}%. The dead are not blinded: the bang draws them like a noise lure (the aware ones too, for a turn). ${FLASH.dmg[0]}–${FLASH.dmg[1]} damage right next to it, no cover broken; it wakes the people within ${FLASH.wake} tiles and raises Heat. Soldiers and guards throw theirs at two or more of your people bunched in cover, then rush; the autopilot and the raid bot throw yours into a room with two or more enemies who know you are there. STN / DZ over a unit: stunned / dazed.<br>
    <b>Fog of war:</b> in every battle you see only what your people see: their sight (13 tiles; at night 7, more with a light: a headlamp 8, a flashlight or torch 9, a lantern 10, a spotlight 12; 13 with night vision or a thermal), +2 a level of height, + binoculars or a scope (+3 by day; at night only a thermal, +2); walls, buildings and trees block it. Floodlit ground at night and a flare's light are seen out to the daylight range. Enemies out of sight are not drawn and cannot be shot; a faded ghost marks where one was last seen.<br>
    <b>Boats:</b> water blocks travel. A team on a shore can build a one-use boat and cross one water tile (team panel, or right-click the far shore). It costs scrap and hours; a vehicle needs a raft or is left on the shore.<br>
    <b>Supply runs and trade routes:</b> supply runs are convoy jobs between your own bases (a base's Supply runs tab): crew, vehicle, goods each way, once or on a schedule. Trade routes are repeating convoys to a group you have a trade pact with (Groups tab); the terms must be worth it to them at their prices.<br>
    <b>Medical:</b> everyone at a base heals slowly. Each night automatic care treats the worst off first (wounds below 70 health or infected, and illnesses) while meds stay above the base's reserve and medics have time. One treatment per wound or illness a day; each takes a medic's time (3 + Medicine/4 a day per Medic, surgery most of a day). Hospitals (infirmary → field hospital → clinic → trauma hospital) need medics and give beds to people below the admit line (Medical tab, default 70) or badly hurt or ill; with too few medics they run as a lower tier. They also train medics: medics on duty learn from the patients (ward rounds), and the doctor teaches people on the Trainee role (Help: Training medics). On a team, treating is a 1-hour order and needs contact. Wounds below 40 health can get infected.<br>
    <b>Crafting:</b> the Crafting tab queues makeshift weapons, armor, tools and dressings; people on the Craft role do the work. All gear wears out (weapons and armor a use a fight, fishing gear a day of fishing, camp kit a day in the field): makeshift gear fastest, a well-made piece lasts longer, found gear is part-worn. Teams can make the simplest things in the field (Field recipes); at a base everything else needs a crafting bench (a utility plot, ${BUILDINGS.craftbench.cost.scrap} scrap and ${BUILDINGS.craftbench.cost.parts === 1 ? "a part" : `${BUILDINGS.craftbench.cost.parts} parts`}: no base starts with one, so it is one of your first choices), where crafters also work faster and make better gear. Upgrade it to a workbench for the workshop recipes and before an ammo bench can be built, then to a master workbench. The Crafting skill sets how fast they work and how good the result is (a roll around the expected condition, steadier the better the crafter); each recipe's own skill (Mechanics, Medicine, Stealth) is only the minimum to try it. Every finished craft trains Crafting: more for weapons and armor, dearer materials and a better result. Craft books (DIY, blacksmithing, bushcraft) teach Crafting, and once anyone has read one to the end, or studied a craft blueprint, special recipes open and the ones it covers come out better and faster.<br>
    <b>Orders, power and base leaders:</b> each workshop station (Workshops tab) takes a standing order: Forever, Until stock reaches N, Keep at least N of an input, or Off, and what its operator does while it waits. The Crafting tab keeps N of an item in the armory at a minimum quality. A generator (needs an operator and 2 fuel a day) powers the cold store, radio, floodlights, machine shop and preserving kitchen; an ethanol still makes fuel from surplus food. <b>Base leader</b> (Overview tab): name one of the people living at a base its leader (or let the best by Leadership be picked) and let them run it, area by area, with the governor's logic: roles, building, crafting and gear, the sick and hurt, food, defence (guards, the night watch roster and a defence plan by role unless you made your own, and the raid and horde warnings about the base, never answered by leaving it), emergency hauls when water or food is about to run out, trading (caravans at the gates, a small radio deal for water, food or meds), supply runs from a hub to its outposts, and hunting, fishing and firewood trips. Nothing drastic: no scavenging trips, wars, new outposts, people moved or bases left. The leader keeps their own job and is never sent out; while they are away the next best there stands in, and if they die or move the next best takes over. Their Leadership lifts everyone's mood there (as the group's leader does where they live), and under Leadership 5 they are slow to act: some hours nothing gets done. Pinned people are left alone, and Take over hands it back as it is.<br>
    <b>Inventory:</b> every survivor has hands, off hand, head, body, arms, legs, a pack, and four pockets. Open it from a survivor's screen, the Armory tab or the team panel: click an item, then where it should go (or drag it). Treats (chocolate, coffee, cigarettes, vodka) are used up with <i>Use</i> for a mood boost at a price.<br>
    ${GUNBUILDER_HELP}<br>
    <b>What you find:</b> sites hold what fits them (a hunting lodge rifles, bows and camo; a police station batons, riot gear and a carbine; a hardware store crowbars, sledgehammers and barbed wire; houses jewelry and keepsakes). Valuables (jewelry, smokes, liquor, gadgets, collectibles, household goods) are only for trade. Comforts lift the mood of everyone around them (cards, a harmonica, a guitar) or of whoever carries them (family photos). Camp kit (camo netting, a ghillie wrap, rag-wrapped boots, a scent mask, a smokeless stove) cuts a team's Heat while it camps or searches. Barbed wire, sandbags, bear traps and a tripwire alarm in a base's armory help hold off hordes. Frag grenades, pipe bombs, Molotovs, flares and smoke grenades are thrown in battle like bottles; alarm clocks, pocket radios, hand warmers and heat packs are decoys for the dead (Siege, fire and decoys).<br>
    <b>Night on the map:</b> from 20:00 to 06:00 a team in the field sees only the tile it is on (scouts, binoculars and the rest count again at dawn); with night vision goggles or a thermal monocular in someone's off hand it sees a tile around. Your bases see only a tile round at night too, watchtower or not. Hordes and other groups' parties beyond that do not show, so a team moving at night can walk straight into them. <b>Same tile, a fight:</b> a team on the same tile as a horde or an enemy group's party (a group at war with you, raiders or expansionists you have no pact with, any raiding party) is attacked, day or night: the team stops there and the card offers running, fighting, hiding from the dead, or paying and talking to people. Raiders and robbers from beyond the border on the same tile stop the team the same way (their toll card). The same horde, party or band does not come at the same team again for 3 hours. By day you see them coming and can steer round.<br>
    <b>Lights:</b> five, each heavier and brighter: a <i>headlamp</i> (0.2 kg, strapped on: works from anywhere on them, hands free), a <i>flashlight</i> (0.3 kg), a <i>torch</i> (0.7 kg, an open flame; made from firewood), a <i>lantern</i> (1.2 kg, all around) and a <i>spotlight</i> (3.5 kg, a long beam); all but the headlamp go in the off hand. At night in a fight or a raid they set how far your people see (7 tiles without; 8, 9, 9, 10, 12 with them) and how much further off the guards notice them (+1, +3, +4, +4, +6); a rummage without one is louder and cuts hands more often; a survey's night hours keep more of their odds with a brighter light. Teams take a light each from the armory when they set out (the planner's <i>Lights</i> line, on by default; the lightest that will work for each person), and the weight counts in their pace. On the map a team carrying lights glows at night. Found at hardware stores, campgrounds, lodges, fire and police stations and the like; a torch is made anywhere from firewood, the others at a bench (a spotlight in a workshop).<br>
    <b>Travel times:</b> on foot a tile takes an hour, whatever the ground. A car takes 15 minutes a tile on a road or a bridge and 30 minutes off-road (no mountains); bikes 30 minutes on a road and walking pace off it. Stance, load and the weather change these (the planner shows the real time). While the clock runs the minutes tick by and your teams in contact move across the map between tiles. <i>Road blockages:</i> a car or bikes on a road now and then reach stalled cars, debris, a fallen tree, a pile-up or a washed-out dip and lose 15 minutes to 3 hours getting through (bikes much less); the log says so and the map shows <i>Road blocked</i> over the team while it is held up.<br>
    <b>Vehicles:</b> burn fuel, wear down, and break down more when worn. One left behind is marked on the map: bring fuel (and a part if it is badly damaged) to recover it.<br>
    <b>Army trucks and convoys:</b> the Army's cargo trucks, Humvees and MRAPs were left where the evacuation broke down: now and then on a road (far more often on the roads round a National Guard base), 3–5 in a base's motor pool, a Humvee at some army helicopter wrecks, and 2–4 together at an <i>abandoned Army convoy</i> (an event: a card puts it on a road tile; other groups race you for it, and it is stripped and burned out after 6–9 days). On a raid map each truck is big hard cover with a cargo bed to search (intact ones are often padlocked): rifles, ammunition by the crate, plate carriers and helmets, grenades, rations, now and then night vision, a thermal sight or a radio. A wrecked truck holds less, a burned-out one only what survives a fire. Their crews turned: dead soldiers in plate carriers stand round the trucks, and some are still strapped in the cab and tear free when the cargo is opened (Heat, and everything nearby hears it). A team searching hour by hour reaches the trucks too. Teams that see one on a road mark it on the map (🪖).<br>
    <b>Found cars:</b> any car or truck on a battle or raid map can be looked at from next to it (the 🚗 row under the unit's actions). Get in (some are locked: pick the lock, jimmy it with a pry bar, or break the glass, which is loud), look for the keys (sun visor, glovebox, the dead lying near it) or hotwire it (Mechanics, older cars are easier; Army vehicles have a start switch), then inspect it: engine, tyres, battery and fuel. Most are dead; a few run, and some can be fixed with parts, scrap, a Mechanics level and some hours. Siphon the fuel of any of them. Claim one that runs or can be fixed: it is parked on the tile and marked on the map, and one that runs joins the team after the fight if the team has none. A found vehicle that needs work is repaired from the team's orders (<i>Repair the …</i>: the team works on the spot for the hours it needs, noisy; then a Mechanics check, and a failure wastes half the parts). A team that already has a vehicle can send one of its people home in the found one (<i>Drive it home</i>). An <b>Army cargo truck</b> got running carries 2500 kg and seats 12, but it is about 1.5× slower than a car (slower still off-road), burns twice the fuel, and its engine draws the hordes it passes and more Heat where it is parked or driven.<br>
    <b>Groups:</b> neutral groups turn hostile if you crowd them. Radio contact, gifts and trade keep them steady; pacts stop raids and open trade routes. Hostile groups raid and take captives (a rescue raid on their base, a ransom by radio or envoy, or goodwill gets them back: Help, Getting captives back). Aggressive groups grow: they push new bases out toward you and toward rich ground, take over the land of groups they break, a new gang moves in when the state runs short of hostile ones, and raider bands from outside that have looted enough may dig in and become a gang at any time. A group down to 3 people breaks up.<br>
    <b>Raids on your bases:</b> a hostile group within 30 tiles of one of its bases comes for you more often the richer you are, the more land you hold, the bigger it is and the more raids of its you have beaten (each one you beat makes its next raid 25% bigger, up to double). Its scouts size a raid to your defence with everyone at a post, so <i>Prepare defenses</i> usually holds, but not if your fighters are away when they arrive. Building and repairs stop while a base is on alert. A strong defence drives them off within hours; the longer they stay at the walls, and the worse it goes (a break-in, an overrun), the more they smash: walls and defences first, then the buildings inside. Broken buildings do nothing until repaired (the base's Repairs tab, or the card after the raid); damaged walls hold less. Tribute turns a raid back, but an aggressive group's goodwill from it fades again.<br>
    <b>Diplomacy:</b> groups post jobs (Groups tab → Jobs; accepted jobs are tagged on the map and listed in the planner), fight wars and sign pacts with each other (World affairs: broker a ceasefire or join a side), and show what they want and have spare (Market board). Invite groups that trust you into the Calder Coalition: hold over half the land with every group left standing in it, and once that has held for a year (the Calder Accord) the coalition wins (hives or not). Land: within 9 tiles of your hub and of every base you took from a group, 7 of an outpost (8 with walls) or a member's base (on Normal; more on bigger maps).<br>
    <b>Conquest:</b> <i>Assault their base</i> (right-click a group's base) is a battle against its defenders behind their walls. Win and the base is your outpost, with its land and part of its stores; some defenders join you or are taken prisoner, and a group that loses its last base is finished. Attacking a group that is not hostile ends your pact, costs 30 goodwill and angers its friends and pact partners; every base you take raises your <i>infamy</i>, and peaceful groups grow wary of a conqueror (they want more goodwill before joining). Groups can take <i>your</i> bases too: a raid that overruns a base may keep it (or, for the most violent gangs, burn it to the ground: the raid warning says so; a ruin is cheap to rebuild on), and your people there walk to your nearest base. On the raid warning you can <i>Retreat</i> instead (everyone leaves with what they can carry; the raiders take it without a fight). A lost base keeps its damage: take it back soon, before they repair the walls. Lose the hub and your nearest base becomes the hub; with no base left, your people are a team on the road that must build a new base or take one back.<br>
    <b>Abandoned bases:</b> a group that dies out, gives a base up or loses it in a raid leaves it standing empty, and so does an outpost of yours that is lost: its buildings (rotting month by month) and some of its stores. Right-click it for <i>Occupy the abandoned base</i> (or pick Occupy in the planner, or from a team's orders on the tile): the team clears out whoever is inside (the dead drift in week by week, now and then a band of squatters: the planner and the tile panel show who and the crew's odds) and moves in as its first staff. It is your outpost (your hub if you have none) with what still stands, wear and damage and all, as far as the plots allow, and the stores; no scrap needed. The group whose base it was, and any group whose claims round it you take, lose goodwill toward you. Other groups move into empty bases too, first come first served, and pay for clearing them out in people. <i>Abandon outpost…</i> (an outpost's Overview, a card asks first) gives one up yourself: its people walk to your nearest base with what they can carry, and it stands empty with its buildings for you to reoccupy later; a group spread too thin gives up its farthest base the same way. Building an outpost or occupying a base takes every group's land claim within 2 tiles (the planner says whose): each costs goodwill with that group.<br>
    <b>Prisoners and jails:</b> a base keeps prisoners only in a jail (Construction; each tier upgrades the one below in place): <i>Makeshift cells</i> (${BUILDINGS.lockup.cost.scrap} scrap, ${BUILDINGS.lockup.hours} hours, a utility plot, a shelter too) hold 2 but leak (6% a day with no jail guard, 2% with one) and sour them (mood −1 a day, slower to win over); <i>Holding cells</i> (${BUILDINGS.cells.cost.scrap} scrap, a part) hold 3 (3% / 0.4%); a <i>Jailhouse</i> (${BUILDINGS.jailhouse.cost.scrap} scrap, ${BUILDINGS.jailhouse.cost.parts} parts, Mechanics 2) holds 8 (1.5% / 0.2%), one guard on its post watches every prisoner at work, the work detail runs half as often and a rescue meets your defence ×1.25 (makeshift ×0.85). A smuggled pick, key or blade, a loner's tricks or Stealth 6+ help a prisoner most in makeshift cells (×1.5 each; a jailhouse ×1.1). The battle's Tie up button and result screen say how much room your bases have. Take more than there is room for and each extra one gets a card: <i>Release</i> (goodwill +4), <i>Execute</i>, <i>Ask to join</i> on the spot (one try at a penalty; no and they go), or <i>Hold at</i> a base with room (an escort walks them there, or they go on with the team). A team still leads its prisoners home; they are booked into a base with room. Prisoners work (Farm, Build, Fetch water, Kitchen, Clean and mend, Cut wood, Haul and sort scrap) at 50–70% of a survivor × rations × health × mood (a broken prisoner 60%, a content one up to 115%); under mood 25 they run more and now and then spoil what they worked on. The Prisoners tab shows the jail, the room at every base, and moves a prisoner to a base with room; there you name the jail's guards: they guard it with their work hours while anyone is held, each one more makes escapes rarer (less each time; Scouting helps, exhaustion hurts). The other groups put guards on their jails by their size: a big group's captives rarely get out before you come, a handful's often. The other groups keep jails too (makeshift cells to a jailhouse): your people they hold escape by it, are worked (by raiders hardest) and can be sold to another group (a card says where they are now); with no room raiders sell, or hold your person a few days for a ransom (Negotiate) and then kill them,, the military, the fortress and communes let people go, zealots kill. Groups ransom, swap and sell each other's people; you hear of it on the radio. A group's jail shows on its Groups card once you know it (a prisoner of theirs talked, or you have seen their base).<br>
    <b>Land claims and wells:</b> a team on a land tile bordering land you hold (a base, the ground right around it or another claim) can <b>Claim this tile</b> (${CLAIM.HOURS}h, ${CLAIM.SCRAP} scrap for the marker post; the team panel, the right-click menu or the orders card): the tile counts as land the coalition holds, toward the 50% the alliance victory needs, and the Territory layer shows it in a lighter blue (hover: <i>Claimed by you (day N)</i>). A claim is lost when a group founds or takes a base on or beside it, a hive rises there, or a hostile team or band camps on it over a day tick; a claim of another group can be claimed over. On a claim next to one of your bases a team can <b>Dig a well</b> (${CLAIM.WELL_HOURS}h, ${CLAIM.WELL_SCRAP} scrap, ${CLAIM.WELL_PARTS} part): beside a river or lake ${WELL_SHORE} water a day, farmland ${WELL_YIELD.plains}, forest ${WELL_YIELD.forest}, hills ${WELL_YIELD.hills}, suburbs and city ${WELL_YIELD.suburb}, mountains none. The base's people haul it (one well per ${CLAIM.WELL_PER_PEOPLE} people there counts; the base card's water line lists them); a well holds 1,500–4,000 water, gives half under 20% left and runs dry at 0.<br>
    <b>Radio:</b> a radio station reaches ${RADIO_RANGE} tiles (a base with a <i>Military encrypted radio</i> in its armory is a station reaching ${MIL_RADIO_RANGE}); a radio relay (a utility plot at any base without a station, the hub too; Mechanics 3+ and the Radio Engineering Handbook to build; no operator, 1 part every 10 days) adds 6 tiles around its base when a station or another linked relay is in range, so relays chain coverage outward (dashed circles on the map; red = not linked or off the air). Groups within reach (their radios add ${GROUP_REACH} tiles) can be called from the Groups tab (Radio…): greet, ask for news, ask for a trade caravan, make a deal ("we want 20 meds, paying 60 ammo"), call for help, pacts. The same reach is what the coalition's invitation needs: a group "out of radio reach" comes into it when a relay brings its base within your coverage + ${GROUP_REACH} (the Groups tab names the base where one would; or send a team to their gates, hold a base within ${ALLIANCE.NEIGHBOUR} tiles of theirs, or win a member within ${ALLIANCE.MEMBER_RELAY}). <i>Scan the airwaves</i> finds groups in reach you have not met. Groups call you too, with offers and requests. <i>Networks:</i> your stations and relays are one network; every group with a base has its own, around each of its bases by type (military ${GROUP_NET_RANGE.military} tiles, traders and fortresses ${GROUP_NET_RANGE.traders}, communes, zealots and expansionists ${GROUP_NET_RANGE.commune}, raiders ${GROUP_NET_RANGE.raider}; a base taken or lost changes it). A receiver (a station, a <i>Military encrypted radio</i>, or a <i>Hand-crank radio</i>: loot, the prepper's kit, needs no batteries) hears a network only while it stands inside its coverage, and nothing past every network. A hand-crank radio only listens: it calls nobody, a team carrying one out of your coverage takes no orders, and it gives nobody coverage. <i>Listen in</i> (${LISTEN.HOURS}h: a team order in the team panel, or a base's set in the Groups tab's radio header) tunes a receiver to one network in range (pick one when several overlap; the same action switches): it catches up on their last ${LISTEN.CATCHUP_DAYS} days of traffic and then hears their channel each day while tuned and in range: caravans setting out (route, destination), raids and war parties (target, rough day; a warning card when one is coming for your base), their fights with the hives, their wars, their stores (for trades), rumours of places, how they talk about you. Each line is caught or missed by the dice, better with Scouting; a military channel is encrypted (a Military encrypted radio helps). Now and then a group notices you listening (−5 goodwill). Your own channel gives what it always did. The coverage of a channel you are tuned to shows on the map in the group's colour. The <i>Pocket radio</i> is a thrown decoy.<br>
    <b>Trade window:</b> two columns, yours and theirs: every supply with steppers, every item one by one. Nothing has a fixed price: each group values things its own way. Its kind matters (the military prize rifles and electronics, raiders liquor, cigarettes and gold, communes seeds, books and coffee, fortresses scrap and parts, traders pay a little over the odds for everything but sell dear; zealots will not touch liquor, drugs or cigarettes), so does its state (at war: weapons, ammo, armor and meds; hordes at its walls or raided lately: weapons and defences; sickness: meds; starving: food, and gold is worth little to it; winter: fuel and food; rich groups pay well for fine things) and how much it already has (supplies by its stock, items by the spare ones on its shelf). An item's condition and uses left count too. ▲ marks a good they want more than usual, ▼ one they care little for, ✕ one they refuse, each with the reason; outside a trade an item shows only a rough worth (junk, cheap, decent, valuable, rare). Buying where something is cheap and selling where it is wanted pays, but each sale fills their need a little. Valuables (rings, cigarettes, coffee, batteries…) are good for nothing but trade: light, and prized by the right buyer. They pay you less than they charge (Speech and goodwill narrow the gap); a deal goes through when it is fair for them. <i>Balance with</i> ammo, scrap or food fills the gap. Intel: buy a report of the area (only those tiles lose their fog) or horde sightings, or sell your own maps.<br>
    <b>Outsiders:</b> people from beyond the state cross the border now and then and leave again: raider bands (from about day 20, more often later: they go for whatever is weakly defended; pay, talk, fight or avoid them, or pay them to leave over the radio), merchant caravans (rare goods: fuel, meds, manuals, books, good gear; invite them over the radio and trade when they stop at your base) and travellers (news, maps, people who want to join or need shelter). The Groups tab lists the ones you know of.<br>
    <b>Caravans:</b> a group's caravan comes to your base for a radio deal and stays a day (Bases tab: Trade). You can attack it for its goods, but the group turns hostile and raids you. Your own trade caravans (Groups tab: New trade caravan…) visit a list of destinations; at each stop: trade, unload, stay a day, go on, or return home.<br>
    <b>The dead and the worm:</b> nobody turns from a bite or a scratch. The dead carry a parasite, a pale tapeworm everyone calls <i>the worm</i>. They shed its eggs into the soil and the water, where they last for months: a tile's <i>Infection</i> is how thick the eggs lie there. People catch it by swallowing the eggs (water drunk unboiled, food grown or gathered on infected ground, game that grazed there and was not cooked through, hands that handled the dead); the other groups catch it the same way, and lose people to it. It shows within a day and works fast: cramps and fever, the carrier eating like two and weaker every day, and strong medicine can purge it in the first days; left alone its larvae reach the brain on the fifth day and within about a week it kills them, and they get up again. What walks afterwards is the worm driving a body and spreading its eggs. A carrier who dies of anything else rises soon after; someone clean stays dead, which is why most bodies on the road are only bodies. Heat kills the eggs. A hive is a colony of the worm grown huge around its Broodmother, and it soaks its land in eggs, which die off slowly once the hive is gone.<br>
    <b>Catching the worm, and curing it:</b> <i>Any un-purified water</i> can carry it: ${Math.round(WORM.RAW_BASE * 1000) / 10}% a day for someone drinking nothing else, from any well, spring, stream or rain catcher, and far more from infected ground (above about ${Math.round(WORM.CLEAN * 100)}% Infection: +${WORM.WATER * 100}% a day × how thick the eggs lie). Prisoners, guests and a holding convoy's crew drink it too, and your people held by a group drink theirs. A <b>Water boiler</b> purifies the day's drinking, each water filter ${WORM.PURIFY_FILTER} a day, and a shelter's fed fire boils it; the boiler burns ${WORM.BOILER_WOOD_HEAD} firewood's worth a person fed there a day on every day un-purified water would be drunk and the purified water and the filters do not cover it: firewood first, then cheap wooden, paper and cloth junk from the armory while the base allows it ("Boiler may burn spare wooden items and paper" on the boiler's card; items marked in the inventory go by their mark, and weapons, tools and armour only when marked), then fuel (${Math.round(WORM.BOILER_WOOD_HEAD * HEAT.wood * 100) / 100} a person); a day with nothing to burn it stays cold. Anything made of wood, paper or cloth can be broken down for firewood in the inventory (<i>Break down for firewood</i>, or the armory's <i>Break down junk for firewood</i>; no time, and a team's camp fire burns it), and woodpiles, log baskets and broken furniture turn up as firewood when searching farms, barns, cabins, lodges, campgrounds, ranger stations and houses (then, with no water filter, the armory's purification tablets are used; else the water is drunk un-purified). On the road, in order: a water filter carried strains it, a lit camp fire with firewood (or deadfall) boils it (a smokeless stove faster), purification tablets are dropped in on the move or at a camp whose fire cannot be kept going (one per ${WORM.TABS_WATER} water); otherwise it is drunk as it is. Un-purified water and uncooked food also give an <b>upset stomach</b> now and then (about ${WORM.SICK_X} times as often as the worm): a little mood a day for a few days, no health lost, and it passes; if you want it gone now, 1 meds cures it at once (the Treat button on the Medical tab or a team's panel: automatic care leaves it alone). It is not the worm: only the worm hurts. <i>Meat</i>: game, fish and snares taken on land at ${Math.round(WORM.MEAT_AT * 100)}%+ Infection carry the eggs until cooked through. A <b>Cook fire</b> (or a preserving kitchen) cooks everything a base eats; drying racks and a hunting cabin's smoke house take that meat first; without them it waits in the stores and is eaten last, half-raw. A team cooks it at a camp fire. <i>Crops and forage</i> from land at ${Math.round(WORM.CROP_MIN * 100)}%+ Infection carry the eggs too (${WORM.CROP * 100}% a ration of crops eaten raw, ${WORM.FORAGE * 100}% of forage; the Farming tab says when a base's ground is that bad): the Cook fire or a kitchen boils them like the meat, a camp fire too, and dry grain and beans are safe. <i>Camping</i> on land at ${Math.round(WORM.CAMP_AT * 100)}%+ Infection is a risk every day (half with the fire lit). <i>Searching</i> a site on infected ground (a site search, a raid, a city crawl: hands that handled the dead) is ${WORM.SEARCH * 100}% an hour × the eggs for each searcher, rolled that night: a team that washes (camped with its fire lit, or home the same day to a base whose water is safe) skips it ${Math.round(WORM.SEARCH_WASH * 100)}% of the time; the planner and the tile panel warn for badly infected sites. It shows from the first day: ${WORM.DAY_HP.join(", ")} health on days 1 to ${WORM.DAY_HP.length} (about ${WORM.DAY_HP.reduce((a, v) => a + v, 0)} in all, so someone at full health dies in about a week and someone hurt sooner; they heal at half the rate while it is in them, except in a hospital bed on a day their care uses meds (a wound treated, an illness dosed), where they heal at the full rate: that buys a few days, no more), and ${WORM.DAY_MOOD[0]} to ${WORM.DAY_MOOD[WORM.DAY_MOOD.length - 1]} mood a day. Days 1 to ${WORM.BRAIN_FROM - 1} are the gut stage: the carrier eats an extra ration a day and works a little less. A medic at a base spots it quickly (better Medicine sooner; the Medical tab and an alert show it: <i>Infected (day N of about ${WORM.COURSE})</i>), and a <b>Dewormer</b> (pharmacies, clinics, hospitals, farms and ranches, or made at a med station) cures it for sure, or a <b>purge</b> (${WORM.PURGE_MEDS} meds and a medic's treatment, about 50% plus Medicine and the hospital) usually does; the night's automatic care does this by itself. Prisoners and guests at your base catch it from the same water and are spotted the same way: treat them from the Medical tab, the Prisoners tab or the guests' card in the Groups tab (curing a guest wins their group's goodwill, +${WORM.OTHERS.GUEST}; a prisoner's opinion of you rises, and their group remembers it when you let them go); the night's care treats them only with the base's <i>Treat prisoners and guests too</i> on (the autopilot turns it on while guests are sheltering). A team notices within a day or two (the <i>The worm</i> card: a dewormer, purge it with ${WORM.PURGE_MEDS} meds and a Medicine check, end it, or hope it passes). From day ${WORM.BRAIN_FROM} it is in the brain: fits and staggering, a day or two left, and only surgery in a staffed Clinic can save them; otherwise lock them away (nobody is hurt when they turn) or end it. When it kills them they get up again: at a base they go for the nearest people (fewer hurt with a guard on duty; locked away, nobody), on the road the card <i>… rose</i> (put them down, leave them, or crush the skull if someone saw the last breath), in a city the street encounter <i>One of you turned</i>, inside a building one of the dead stands where they fell; at another group's base the group puts them down (and blames you if they came visiting).<br>
    <b>Infested animals:</b> game on badly infected land catches the worm too. Infested herds (grey, gaunt deer and hogs on the map) do not attack, but they wander out of the dead land and seed the ground they pass with eggs, toward farms and bases. Every animal killed on infected land may be infested (the tile panel says what share): it gives a quarter of the food, all of it with the eggs. Hunting a herd down thins it out until it is gone.<br>
    <b>The other groups and the worm:</b> a group whose base stands on infected ground loses people to it, at the rate a base of yours that size would catch it (its water, and its crops on land at ${Math.round(WORM.CROP_MIN * 100)}%+), less the half they cure: military and fortress hubs boil their water from the start (×${WORM.GROUPS.TYPE.military}), traders mostly (×${WORM.GROUPS.TYPE.traders}), communes farm the infected land (×${WORM.GROUPS.TYPE.commune}), raiders and zealots take it as it comes; after a base's first loss it boils its water too (×${WORM.GROUPS.BOILER}). Their parties on the move lose one now and then on a herd's land or badly infected ground. The worm never takes a group below ${WORM.GROUPS.MIN} people. You hear of the losses on the radio (the Groups tab's news and cards) and they go into the chronicle.<br>
    A bite is still a dirty wound that can get infected, but it never makes anyone one of them: the old belief that it did cost a lot of arms and friends in the first weeks.<br>
    <b>Hives and hordes:</b> infestation hives gain resources every day, more when other hives stand within 5 tiles (alone 1, two together 3 each, three 6 each, up to 12), and spend them on hordes (small 10–25 of the dead for 3, medium 50–80 for 8, large 100–200 for 15) and, for 40, on a <b>Wallbreaker</b> (only a hive that has grown a Wallbreaker den, from day ${HIVE.BOSS_DAY}, at most one every ${HIVE.BOSS_GAP} days per hive): a brute that leads a horde and smashes defences. They also grow structures around themselves (see <i>Hive growths</i>). Every 120–180 days the hives pick a spot for a new hive: hives within 10 tiles send hordes there, and once the gathered hordes reach a score of 30 they start turning into a hive, which stands when 1,000 of the dead have gone into it, at most 40 a day (about four weeks from the first gathering: time to strike). Hordes move at most 2 tiles a day (slower in deep cold; a quarter faster with many runners), merge when they meet and split up; a horde's score (from its size) is how tough it is. You see them only near your bases (a watchtower sees further), with teams in radio range, or when a team reports. A hive holds the land within 4 tiles (at least 3 skulls there) and the ring right around it has red skulls: the dead there are much tougher. It radiates infection; destroying it lets the infection fade. Destroy a hive with the <b>Destroy hive</b> mission: <i>Enter the hive</i> and crawl its chambers to the core room, where the <b>Broodmother</b> guards the <b>Hivemind</b>; kill the Hivemind and the hive dies (see <i>The hive crawl</i>). Hordes also come in from beyond the border every week or so, so the state is never quite safe.<br>
    <b>Eras and winning:</b> the years are the calendar's (four seasons of 28 days). <i>Early game</i> (years 1–${ERAS.LIST[1].from - 1}): medium hordes at the gates, raids sized to your walls, outsider bands with clubs and old pistols. From year ${ERAS.GROW_FROM} the threats grow every year, on through the <i>mid game</i> (years ${ERAS.LIST[1].from}–${ERAS.LIST[2].from - 1}, as the hives evolve: brutes, spitters and stranger dead): new roaming, attacking and border hordes come ${Math.round(ERAS.GROW.horde * 100)}% bigger a year (at most +${Math.round(ERAS.GROW.hordeMax * 100)}%), the aggressive groups are ${Math.round(ERAS.GROW.gangArms * 100)}% stronger a year (better arms, at most +${Math.round(ERAS.GROW.gangArmsMax * 100)}%) and recruit larger, new gangs from beyond the border arrive bigger, outsider raider bands bring more people and better guns. Raids and hive hordes on your bases come <b>fewer but better prepared</b>: a gang raids only a base it thinks it can take (its strength against your defence with everyone at a post, a higher bar every few years) and sizes the raid to it; about ${ERAS.RAIDS.PER_YEAR[0][1]} raids a year early, ${ERAS.RAIDS.PER_YEAR[2][1]} around year 5, up to ${ERAS.RAIDS.PER_YEAR[ERAS.RAIDS.PER_YEAR.length - 1][1]} late (at most; often fewer), and a hive's horde sent at you about every ${Math.round(112 / ERAS.HORDES[0][1])} days early, every ${Math.round(112 / ERAS.HORDES[ERAS.HORDES.length - 1][1])} late. The brood in a hive fights harder every year from year ${ERAS.BROOD_FROM}, and gangs from beyond the border do not settle on the coalition's land; once the coalition holds over half the state, no new gang or raider band digs in at all and the peaceful groups outside slowly warm to it. <i>Late game</i> (year ${ERAS.LIST[2].from} on, as the hives grow their worst: screamers, crawlers, Wallbreakers): the growth reaches its caps, new gangs keep coming whenever fewer than ${ERAS.LATE_MIN_AGG} hostile ones are left, and every coalition member sends ${ERAS.ALLY_LATE} more fighter${ERAS.ALLY_LATE === 1 ? "" : "s"} when you storm a hive or a group's base (members near the target fight beside you in both). While the outbreak beyond the border still burns (until a year between ${ERAS.OUTBREAK.BURNOUT[0]} and ${ERAS.OUTBREAK.BURNOUT[1]}, different in every world), the state never runs out of hives: when fewer than ${ERAS.OUTBREAK.FLOOR[0][1]} stand (${ERAS.OUTBREAK.FLOOR[1][1]} from year ${ERAS.OUTBREAK.FLOOR[1][0]}), a mass of the dead pours over the border a few weeks later and starts building one (a build site you can strike). Once it has burned out no new hive is founded at all, and the hives left starve (their resources × ${ERAS.OUTBREAK.STARVE}: fewer hordes, a guard slower to rebuild). <b>No victory comes before year ${ERAS.WIN_FROM_YEAR}.</b> The hive victory: every hive destroyed and none being built once the outbreak beyond the border has burned out, and the state kept clear for ${ERAS.CONTAIN.DAYS} days. The coalition victory (the Calder Accord): you and at least one member holding over half the land (groups outside do not block it), kept for ${ERAS.ACCORD.DAYS} days of the late game (its clock starts in year ${ERAS.WIN_FROM_YEAR}; a day it fails takes ${ERAS.ACCORD.DECAY} back; a gang that has just come over the border does not count against it for ${ERAS.ACCORD.GRACE} days: break it or win it over), with a coalition at least ${ERAS.ACCORD.SEASONS} seasons old. The Goals card shows the year, the era and both clocks.<br>
    <b>Hive growths:</b> a hive spends its resources on structures it grows on the land within ${TECH.RANGE} tiles of it (never on water, a site, a base or another growth), one at a time, taking days to grow. What it may grow depends on how far it has evolved: the years go by and a hive gets older (its <i>tier</i> in the tile panel). ${Object.values(GROWTHS).map((G) => `<b>${G.name}</b> (tier ${G.tier}, ${G.cost} resources, ${G.days} days): ${G.desc}`).join(" ")} A hive attacked lately (a crawl, a growth burned) grows a brood chamber first. You see a growth on the map beside a hive you know of (live or reported; faint while it grows, a grey husk once its hive is gone), in the tile panel, and in the log: one finished in sight is reported, and sometimes rumours tell of one out of sight. Send a team with <b>Burn the growth</b> (right-click its tile): fight its guard in a small battle (the hive's special dead among them, more of the growth's own kind), or set it on fire (${TECH.FIRE_FUEL} fuel burns ${TECH.FIRE_DMG}% of its flesh, ${TECH.BOMBS} Molotovs ${TECH.BOMB_DMG}%; it regrows ${TECH.REGROW}% a day, so a fresh one takes two fires). Gone, its hive loses what it gave. Destroying the hive withers all its growths. The autopilot burns the most dangerous growths it knows of while it cannot storm the hive yet.<br>
    <b>The special dead:</b> a hive breeds a kind once it has grown the growth for it (a worm cyst, warren, pit, sac, ossuary, sinew scaffold, worm pit, egg cistern, dread hollow, spire, burrow or fold; Carriers come first: a young hive grows the cyst after its first biomass pit). Each new horde brings each kind the hive breeds by chance: likelier in a big horde and from an older hive or one with a brood chamber, a small horde only a kind or two; its guard brings nearly all, and storming a hive you meet at least one of every kind it breeds (the tile panel and the horde warnings say how many). Away from the hordes you meet them exploring: more in towns and cities every year, more on a hive's land, and on the red-skull ground around a hive the kinds that hive breeds. Late in the game the hordes from beyond the border bring some too. Bodies lie about the battle maps, and now and then one is a <b>Sleeper</b>: Scouting spots one (it shows with its ring), and anyone who steps next to one unspotted gets a worm swarm in the face. ${Object.values(ZTYPES).filter((z) => !z.military).map((z) => `<b>${z.name}s</b>: ${z.special} <i>Counter:</i> ${z.counter}`).join(" ")} No hive breeds the <b>armoured dead</b>: soldiers and riot police who turned in their gear. They are where they fell: National Guard bases and army helicopter wrecks are full of dead soldiers (a few on the roads round a base, where the checkpoints were, and hordes that cross a base pick some up), police stations and prisons have dead riot police. ${Object.values(ZTYPES).filter((z) => z.military).map((z) => `<b>${z.name}s</b>: ${z.special} <i>Counter:</i> ${z.counter}`).join(" ")} Their bodies are worth searching: worn armour, a helmet, rounds, now and then a rifle or a radio. A mutation vat makes a hive's special dead <b>elite</b> (a ★ in battle): tougher and harder hitting. In battle each kind has its own ring color and letter; hover one for what it does.<br>
    <b>Defending against hordes:</b> a base's walls hold back a horde up to a limit (the base panel shows "Holds a horde of"); guards and the defence buildings (barricades, spike pits, trench, reinforced gate, floodlights) raise it. A bigger horde breaks in and the best 8 there fight it on the base map, with the barricades, pits and trench on it. Lose and the base is overrun: people hurt or killed, stores spoiled, an outpost lost. When lookouts see a horde coming you get a warning card: man the defences, or burn a decoy fire. <b>Watchtower alarm:</b> a base with a watchtower that sees a horde coming for it, or one within 3 tiles, raises an alarm (a log line once, a 🗼 alert while it lasts; a tile of view at night): people there on work priorities who have Guard as a backup job (set lower than their first priority) move it up to priority 1, and the walls take as many more lookouts as it takes to hold that horde (at least one), until it has gone, is beaten off or lured away; then Guard is back where it was. Their cell shows the 1 in red; setting it yourself ends that for them. The autopilot and stewards put guards on the walls early the same way.<br>
    <b>Saving:</b> ${k("⚙ Menu")} in the top bar (or ${k("Esc")} with nothing open; ${k("⚙ Menu")} in a battle's panel) opens the menu: <i>Save</i>, <i>Load</i>, <i>Save and exit</i> (back to the new-run screen, where <i>Continue</i> picks the latest save up again), <i>New campaign</i>, save files (<i>Export</i>, <i>Save to file</i>, <i>Load from file</i>) and the options (autosave every day or few days at dawn, confirmations, pause when the window loses focus, UI size, the battle's end-turn question, the keys; Display: UI size, zombie look, colour-blind colours, larger map text, reduce motion, the minimap and the dev tools; Confirmations: the questions you stopped). Saves are kept in this browser, compressed: up to 12 named saves plus the last 3 autosaves of each campaign, which also save when a hive assault starts and when the run ends (more under Autosaves and crashes). A save holds everything, a battle under way included; a card waiting for an answer cannot be saved, so answer it first (the autosave waits for that too). Loading pauses the game.<br>
    <b>Dev tools</b> (for testing; switch on <i>Show dev tools</i> in ⚙ Menu → Options → Display, then the ${k("`")} key or the Dev button in the top bar): reveal the map, infection overlay, autopilot (${k("Shift+P")}: an AI governor plays for you), fast forward 60× / 300× / 1200×, show FPS, and the timelapse so far.<br>
    <b>Keys on the map:</b> ${k("Space")} pause / run · ${k("1–5")} speed · ${k("W A S D")} / arrows pan · ${k("H")} hub · ${k("I")} infection overlay · ${k("B")} / ${k("P")} / ${k("G")} / ${k("T")} the Bases / People / Groups / Teams tab · ${k("Tab")} or ${k("N")} next team waiting for orders (Shift+Tab back) · ${k("F1–F9")} jump to your bases · ${k("Ctrl+1–9")} (or ${k("Alt+1–9")}) save a camera spot, ${k("Shift+1–9")} go back to it · ${k("J")} diary · ${k("R")} roster · ${k("M")} minimap · ${k("E")} Ledger (production and use, the run summary) · ${k("Shift+P")} autopilot (dev tools) · ${k("Esc")} closes the top window, then move mode, then the team panel, and with nothing open shows the menu.<br>
    <b>Alerts</b> on the right of the map list what needs you now (a team waiting, food or water running low, an idle station, a horde near a base, a likely break-in, someone sick and untreated or about to leave, a building or plan finished, a caravan in). Click one to go there; 💤 hides it for a day, ✕ until it clears. The log under the map has filters (kinds of line, 🤖 autopilot notes, one base) and its names and places are links; the <b>Diary</b> keeps every line of the run, day by day.`;
}

function cardModal(state, card) {
  if (card.kind === "conflict" && card.conflict) return conflictModal(state, card);
  if (card.recruit) return recruitModal(state, card); // who asks to join, with beds, food and water (people.js)
  return `<div class="box">
    <h1>${esc(card.title)}</h1>
    ${card.where ? `<div class="where">Near ${esc(card.where)} · Day ${day(state)} ${clock(state)}</div>` : ""}
    <div class="text">${esc(card.text)}</div>
    ${cardWhy(state, card)}
    ${retreatPolicyRow(state, card)}
    <div class="choices">${card.choices.map((c, i) => {
      const dis = typeof c.disabled === "function" ? c.disabled(state) : c.disabled;
      return `<button data-action="choice" data-i="${i}" ${dis ? "disabled" : ""}${tip(c.hint)}>${esc(c.label)}${c.hint ? `<span class="hint">${esc(c.hint)}</span>` : ""}${fightForecastHtml(state, card, c)}</button>`;
    }).join("")}</div></div>`;
}

// A card with a fight on it (a choice with .fight: { odds?, enemy, ambush }): the team's "Retreat if it goes badly"
// policy for a fight resolved by the numbers (breakoff.js: Auto-resolve, the autopilot, crews), and on each fight
// choice what that would likely bring. The forecast is cached on the card per policy and team health.
const cardFightParty = (state, card) => (card && card.partyId != null && (card.choices || []).some((c) => c && c.fight) ? state.parties.find((x) => x.id === card.partyId) || null : null);
export function retreatPolicyRow(state, card) {
  const p = cardFightParty(state, card);
  if (!p) return "";
  const cur = teamPolicy(state, p);
  const src = { crew: " (the crew's setting)", autopilot: " (the autopilot's style)" }[policySource(state, p)] || "";
  return `<div class="row small retreat-policy" style="margin:0.2rem 0 0.4rem;flex-wrap:wrap;gap:0.3rem"><span class="muted"${tip("If the fight is resolved by the numbers (Auto-resolve on the battle screen, the autopilot, a crew), the team breaks it off by this rule: everyone still standing runs for it (an escape check each, like Sound the retreat), carrying the downed. Only a won fight is looted. Kept for this team.")}>Retreat if it goes badly${esc(src)}:</span>${POLICY_ORDER.map((k) => `<button data-action="retreat-policy" data-v="${k}" class="${cur === k ? "active" : ""}"${tip(RETREAT_POLICIES[k].desc)}>${esc(RETREAT_POLICIES[k].name)}</button>`).join("")}</div>`;
}
export function fightForecastHtml(state, card, ch) {
  const p = ch && ch.fight && ch.fight.enemy ? cardFightParty(state, card) : null;
  if (!p) return "";
  const people = Parties.partyMembers(state, p);
  if (!people.length) return "";
  const f = ch.fight;
  const odds = f.odds ?? fightOdds(state, p, f.enemy, f.ambush);
  const policy = teamPolicy(state, p);
  const key = `${policy}:${Math.round(odds * 100)}:${people.map((s) => `${s.id}/${Math.round(s.health)}`).join(",")}`;
  ch.forecastCache = ch.forecastCache && ch.forecastCache.key === key ? ch.forecastCache : { key, text: forecastText(fightForecast(state, p, people, { odds, enemy: f.enemy, ambush: f.ambush }, policy)) };
  return ch.forecastCache.text ? `<span class="hint">If auto-resolved: ${esc(ch.forecastCache.text)}</span>` : "";
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
        <div>Ammo</div><div class="${v.ammo < (v.members.length - v.archers) * 3 ? "danger" : ""}">${n0(v.ammo)}${v.ammo < (v.members.length - v.archers) * 3 ? " (low: fights go worse)" : ""}</div>
        ${v.archers || v.arrows ? `<div${tip("Arrows for the bows and crossbows (1 a shot; under 3 a bow, the bows fight worse; with none they fight in melee). About half the arrows shot are picked up again after a won fight.")}>Arrows</div><div class="${v.arrows < v.archers * 3 ? "danger" : ""}">${n0(v.arrows)}${v.arrows < v.archers * 3 ? " (low: the bows fight worse)" : ""}</div>` : ""}
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
    ${retreatPolicyRow(state, card)}
    <div class="row small" style="margin:0.2rem 0 0.6rem"${tip("Your strength against theirs. Ambushes, cover and luck can swing a fight either way.")}><span class="muted" style="width:6rem">Balance</span><div style="flex:1">${bar(share, share >= 55 ? "var(--good)" : share >= 40 ? "#e8a33d" : "var(--danger)")}</div><span style="width:5.5rem;text-align:right">you ${share}%</span></div>
    <div class="choices">${card.choices.map((ch, i) => {
      const dis = typeof ch.disabled === "function" ? ch.disabled(state) : ch.disabled;
      return `<button data-action="choice" data-i="${i}" ${dis ? "disabled" : ""}${tip(ch.hint)}>${esc(ch.label)}${ch.hint ? `<span class="hint">${esc(ch.hint)}</span>` : ""}${fightForecastHtml(state, card, ch)}</button>`;
    }).join("")}</div></div>`;
}

// The vehicles the planner means: a car, the base's bikes (one for each person on the crew), or up to four together
// (pl.vehicleIds: ui/fleetpick.js, sim/vehicles.js fleets).
export const plannerIds = (pl) => (pl.vehicleIds && pl.vehicleIds.length ? pl.vehicleIds : pl.vehicleId ? [pl.vehicleId] : []);
const plannerHome = (state, pl) => (pl.fromBaseId != null ? baseById(state, pl.fromBaseId) : hub(state));
export function plannerVehicle(state, pl) {
  return plannedFleet(state, plannerHome(state, pl), plannerIds(pl), pl.crew.size || 0);
}
// Why the picked vehicles cannot go ("" when they can): a person to each, a seat each, bikes, fuel (sim/teamform.js).
export const plannerFleetProblem = (state, pl) => pickProblem(state, plannerHome(state, pl), plannerIds(pl), pl.crew.size || 0, pl.supplies.fuel || 0);
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

// The hub's water for the planner: "57 (+30 un-purified)".
const hubWaterText = (h) => { const r = Math.floor(Math.max(0, h.stock[RAW] || 0)); return `${Math.floor(Math.max(0, h.stock.water || 0))}${r > 0 ? ` (+${r} un-purified)` : ""}`; };
// The planner's tablets row: a tube of purification tablets from the armory for the road (sim/worm.js packTablets).
function tabsRow(state, h, pl) {
  const tubes = armoryTabs(h);
  if (!tubes.length) return `<tr${tip("No purification tablets in the hub's armory (pharmacies, clinics, campgrounds and truck stops have them; a med station makes them).")}><td>Purification tablets</td><td class="muted small" colspan="2">none in the armory</td></tr>`;
  const n = tubes.reduce((a, it) => a + (it.dur ?? 10), 0);
  return `<tr${tip(`A tube of purification tablets for the road: one makes ${WORM.TABS_WATER} un-purified water safe to drink without stopping to boil it (river water fetched on the way, un-purified water packed here). Suggested for a trip that fetches water or is out more than two days.`)}><td>Purification tablets</td><td><label><input type="checkbox" data-action="pl-tabs" ${pl.tabs ? "checked" : ""}> pack a tube</label></td><td class="muted small">armory ${tubes.length} (${n} tablets)</td></tr>`;
}
// The planner's lights row: a light each from the armory for those without one (sim/lights.js packLights), on by
// default; what would go and its weight.
function lightsRow(state, h, pl) {
  const crew = [...pl.crew].map((id) => survivorById(state, id)).filter(Boolean);
  const have = litCount(crew), pv = lightsPreview(h, crew);
  const stock = h.armory.filter((it) => it && LIGHTS[it.key]).length;
  const on = pl.lights !== false;
  const why = `At night a light lets your people see further in a fight or a raid and search without fumbling, but the light is seen from further off; a survey's night hours go better with one. ${Object.entries(LIGHTS).map(([k, L]) => `${L.name[0].toUpperCase() + L.name.slice(1)} ${GEAR[k].weight} kg: sees ${L.sight} tiles at night (7 without), seen ${L.seen} further`).join("; ")}. A headlamp works from anywhere on them, the others in the off hand (only for someone whose off hand is free). Each person takes the lightest that will work for them.`;
  if (!crew.length) return "";
  const what = !on ? "none packed" : pv.names.length ? `${pv.names.join(", ")} (+${pv.kg} kg)` : stock ? "none that fits (off hands full)" : "none in the armory";
  return `<tr${tip(why)}><td>Lights</td><td><label><input type="checkbox" data-action="pl-lights" ${on ? "checked" : ""}> one each</label></td><td class="muted small">${have}/${crew.length} lit · ${esc(what)}</td></tr>`;
}
// The planners' crew list (who is at the base: skills, gear, what they wear), transport (on foot, the base's bikes,
// its cars) and supplies table (from the base's stores): the trip planner (from the hub) and the move-out planner
// (from any base of yours, sim/moveout.js). where: how the base is named in the text ("the hub").
const PLAN_SKILLS = ["scouting", "stealth", "shooting", "melee", "scavenging", "speech", "medicine", "mechanics"];
function crewPick(state, crewPool, pl, where) {
  const keySkills = PLAN_SKILLS;
  return `<div class="crew">${crewPool.map((s) => `
      <label class="${pl.crew.has(s.id) ? "on" : ""}"${tip(`${s.name}: ${ROLES[s.role]?.name || s.role} at ${where}. Taking them pauses that work.`)}><input type="checkbox" data-action="pl-crew" data-id="${s.id}" ${pl.crew.has(s.id) ? "checked" : ""}>
        <span><b>${s.leader ? "★ " : ""}${esc(s.name)}</b>${stIcons(state, s)} <span class="muted small">HP ${n0(s.health)} · ${ROLES[s.role]?.name || s.role}</span><br>
        <span class="small">${keySkills.map((k) => `${SKILL_SHORT[k]} ${skill(s, k)}`).join(" · ")}</span><br>
        <span class="small muted">${[s.gear.weapon, s.gear.armor, s.gear.tool].filter(Boolean).map((g) => esc(g.name)).join(", ") || "No gear"} · wears ${n1(wornLoad(s))} of ${maxLoad(s)} kg${s.traits.length ? " · " + traitWords(s) : ""}</span></span></label>`).join("") || `<span class="muted">Nobody is at ${where}.</span>`}</div>`;
}
// The shared picker (ui/fleetpick.js): up to four vehicles, click to take or leave each.
function transportPick(state, h, pl, v, ids, where) {
  void v; void where;
  return fleetPicker(state, { base: h, ids: plannerIds(pl), crewN: ids.length, cans: pl.supplies.fuel || 0, action: "pl-vehicle" });
}
const PLAN_SUPPLY_KEYS = ["food", "preserved", "water", "fuel", "meds", "ammo", "arrows", "parts", "scrap"];
function suppliesTable(state, h, pl, label) {
  const showKeys = PLAN_SUPPLY_KEYS;
  return `<table class="t">${showKeys.map((k) => `<tr${tip(k === "arrows" ? "Arrows for bows and crossbows: 1 a shot in a fight (about half picked up again after a win, none after a loss or a retreat; with none a bow is only a club) and on a hunt (a shot at game loses its arrow about half the time). Auto-fill packs a dozen for each bow on the team; a hunting trip takes up to 12 from the hub by itself when someone has a bow." : k === "fuel" ? "Fuel cans: used when the tank runs dry, and to restart abandoned vehicles" : k === "parts" ? "For roadside repairs, restoring wrecks and recovering damaged vehicles" : k === "scrap" ? "Needed to build an outpost (15)" : k === "preserved" ? "Jarred, dried or canned food: a ration like food (eaten after the packed food), and lighter to carry (0.6 a ration)" : k === "water" ? "Water for the road: purified water is packed first, then un-purified water (from the wells and rivers: boil it at a camp fire, filter it or drop purification tablets in)" : k === "ammo" ? `Rounds for the team's guns, any calibre: packed as the rounds that fit each person's gun (most for the gun they carry). At ${h.name}, by calibre: ${breakdownText(baseAmmoBreakdown(state, h), "; ")}` : "")}><td>${k === "water" ? "Water" : k === "ammo" ? "Rounds for their guns" : SUPPLIES[k].name}</td><td><input type="number" min="0" data-action="pl-supply" data-k="${k}" value="${pl.supplies[k] || 0}"></td><td class="muted small">${label} ${k === "water" ? esc(hubWaterText(h)) : n0(k === "ammo" ? totalRounds(h.stock) : h.stock[k])}</td></tr>`).join("")}${tabsRow(state, h, pl)}${lightsRow(state, h, pl)}</table>`;
}
function plannerModal(state, ui) {
  const pl = ui.planner;
  if (pl.moveOut) return moveOutModal(state, ui); // sim/moveout.js: a team out of a crowded base
  const h = hub(state);
  if (!h && stagingView(state) && stagingView(state).first) return `<div class="box"><h1>No hub yet</h1><div class="text">Hardcore: your survivors are a team on the road, and there is no base to send anyone from. Give the team its orders (Teams tab, or right-click a tile to move it): ${ESTABLISH_LABEL} on a good spot sets up a camp (an hour, nothing carried) whose step up into a shelter needs ${esc(needText(STAGING.HARDCORE.needs))} brought in, then the work.</div><div class="row"><button class="primary" data-action="pl-cancel">Close</button></div></div>`;
  if (!h) return `<div class="box"><h1>No base to send a team from</h1><div class="text">You have no base left. Your people on the road can build one (${ESTABLISH_LABEL}: a camp that becomes your hub, built up into a shelter with ${esc(needText(STAGING.EXILE.needs))} brought in, then the work) or take one back (Assault their base) from their orders.</div><div class="row"><button class="primary" data-action="pl-cancel">Close</button></div></div>`;
  const crewPool = atBase(state, h.id);
  const ids = [...pl.crew];
  const v = plannerVehicle(state, pl);
  const est = estimateTrip(state, { memberIds: ids.length ? ids : [0], dest: pl.dest, vehicle: travelMode(v), v, stance: pl.stance, fuel: isCar(v) ? v.fuel + (pl.supplies.fuel || 0) : 0, supplies: pl.supplies });
  // The PLAN section (ui/plan.js): with steps, food, water and fuel are checked against the whole plan.
  const settles = (Parties.SETTLE_MISSIONS || ["outpost"]).includes(pl.mission); // the team lives there after: no plan
  const pe = est && !settles ? planAutofill(state, pl) : null;
  const need = pe || est, needFor = pe ? "for the whole plan" : "for the round trip";
  const members = ids.map((id) => survivorById(state, id)).filter(Boolean);
  const at = (hr) => `day ${Math.floor(hr / 24) + 1}, ${String(hr % 24).padStart(2, "0")}:00`;
  const stays = (Parties.STAY_MISSIONS || ["move", "recon", "outpost"]).includes(pl.mission); // waits there for orders (or stays)
  const carry = plannerLoad(state, pl);
  // Why this mission cannot go to this tile at all (parties.js checks the same at launch).
  const problem = Parties.missionProblem ? Parties.missionProblem(state, pl.dest, pl.mission) : null;
  const warn = [];
  if (est) {
    // Preserved food (storage.js) is a ration like food, and lighter.
    const rations = (pl.supplies.food || 0) + (pl.supplies.preserved || 0);
    if (rations < need.food) warn.push(`Food: packing ${rations}${pl.supplies.preserved ? ` (${pl.supplies.preserved} preserved)` : ""}, need about ${need.food} ${needFor}`);
    if ((pl.supplies.water || 0) < need.water) warn.push(`Water: packing ${pl.supplies.water || 0}, need about ${need.water} ${needFor}`);
    if ((pl.supplies.water || 0) > Math.floor(h.stock.water || 0) && !pl.tabs && !armoryTabs(h).length) warn.push(`Water: only ${Math.floor(h.stock.water || 0)} of it purified; the rest is packed un-purified (boil it at a camp fire)`);
    if (isCar(v) && v.fuel + (pl.supplies.fuel || 0) < need.fuel) warn.push(`Fuel: tank ${n0(v.fuel)} + cans ${pl.supplies.fuel || 0}, need about ${need.fuel} ${needFor}`);
  }
  const fleetWhy = ids.length ? plannerFleetProblem(state, pl) : ""; // a person to each vehicle, seats, bikes, fuel
  if (fleetWhy) warn.push(fleetWhy);
  warn.push(...loadWarnings(carry.t));
  if (pl.mission === "outpost" && (pl.supplies.scrap || 0) < Parties.outpostScrap(state, pl.dest)) warn.push(`Outposts need ${Parties.outpostScrap(state, pl.dest)} scrap carried`);
  if (pl.mission === "getvehicle" && (pl.supplies.fuel || 0) < 2) warn.push("Bring fuel cans to restart the vehicle");
  if (carry.over) warn.push(carry.why);
  const missions = Object.entries(MISSIONS).filter(([, m]) => !m.hidden);
  return `<div class="box wide">
    <h1>Plan a trip to ${esc(tileLabel(state, pl.dest))}</h1>
    ${plannerTrips(state, ui) /* ui/trips.js: templates, retreat policy, undo */}
    ${plannerVolRow(state, pl) /* ui/volunteers.js: ask an ally for volunteers to meet the team */}
    ${plannerJobNote(state, pl.dest) /* ui/diplomacy.js: a job of yours at this target */}
    ${pl.mission === "assault" ? assaultNote(state, pl.dest) : ""}
    ${pl.mission === "occupy" ? occupyNote(state, pl.dest, members) : ""}
    ${pl.mission === "outpost" && claimsTaken(state, pl.dest).length ? `<div class="small danger" style="margin:-0.3rem 0 0.4rem"${tip("A new base of yours takes every group's claim within 2 tiles, as a group's new base takes yours: each one costs goodwill with that group (a grievance: your expansion near their land).")}>⚑ Building here takes claims round it and angers ${esc(claimsTakenText(claimsTaken(state, pl.dest)))}.</div>` : ""}
    <div class="row" style="margin-bottom:0.6rem">Mission
      <select data-action="pl-mission"${tip(MISSIONS[pl.mission].desc)}>${missions.map(([k, m]) => `<option value="${k}" ${pl.mission === k ? "selected" : ""} title="${esc(m.desc)}">${m.name}</option>`).join("")}</select>
      <span class="small muted">${MISSIONS[pl.mission].desc}</span></div>
    <h3>Crew (${ids.length})</h3>
    ${crewPick(state, crewPool, pl, "the hub")}
    <div class="grid2" style="margin-top:0.6rem">
      <div>
        <h3>Transport</h3>
        ${transportPick(state, h, pl, v, ids, "the hub")}
        <h3>Stance</h3>
        <div class="row">${Object.entries(STANCES).map(([k, s]) => `<button data-action="pl-stance" data-v="${k}" class="${pl.stance === k ? "active" : ""}"${tip(s.desc)}>${s.name}</button>`).join("")}</div>
        <h3>Estimate</h3>
        ${est ? `<div class="kv small"><div>Distance</div><div>${est.tiles} tiles</div>
          <div${tip("Hours on the road, worked out the same way the team really moves (stance, terrain, roads, fuel, and the weather hour by hour: mud, snow, storms). Road events can add delays.")}>Arrives in</div><div><b>${est.hoursOut}h</b> <span class="muted">(${at(est.arriveHour)})</span>${weatherEta(est)}</div>
          ${est.dryAt != null ? `<div></div><div class="danger">Fuel runs out near ${esc(tileLabel(state, est.dryAt))}; they walk the rest (vehicle left there)</div>` : ""}
          <div${tip(stays ? "If you order them home as soon as they arrive" : "Out, about 6 hours on site, and back")}>Round trip</div><div>~${est.days.toFixed(1)} days (${Math.round(est.hours)}h: ${est.hoursOut}h out, ${est.hoursBack}h back)${stays ? ` <span class="muted">if sent home on arrival</span>` : ""}</div>
          <div${tip("Food and water for the trip: one ration a person a day, more on the move under a load (Medium +15%, Heavy +35%, Overloaded +60%, less with Scouting or on bikes, none extra in a car), the hours on site at the normal rate. Water is that times each day's thirst: 1.3 in summer, at least 1.6 on a hot day, 0.9 in winter; food times each day's cold: 1.1 below 0 °C, 1.2 below −8 °C (no camp fire on such a trip).")}>Needs</div><div>${est.food} food · ${est.water} water${isCar(v) ? ` · ${est.fuel} fuel${est.fuelMult > 1 ? ` (×${est.fuelMult.toFixed(2)} for the load)` : ""}` : ""}</div>
          <div${tip(`What the packed supplies weigh, against what the crew can carry on top of what they wear (max load 40 kg each, 28 with a Bad Back, 48 with a Strong Back, more with a pack or Packrat)${v ? " plus the bikes' racks or the car" : ""}. Loot found on the trip needs what is left. ${BANDS_HELP}`)}>Weight</div><div class="${carry.over ? "danger" : ""}">${n1(carry.load)} kg packed + ${n1(carry.worn)} kg worn · room for ${n1(Math.max(0, carry.cap - carry.load))} kg more${carry.over ? " · too heavy" : ""}</div></div>
          ${carry.t ? `<div style="margin-top:0.3rem">${paceLine(carry.t)}${carLine(carry.t, v && v.name)}${carry.t.mode === true ? "" : loadRows(carry.t)}</div>` : ""}
          ${settles && v ? `<div class="small muted" style="margin-top:0.3rem">The ${esc(v.name)} stays at the new outpost with the team.</div>` : ""}` : `<div class="danger">No route to this tile${v ? " by vehicle" : ""}.${v ? "" : " Water in the way? Send a team to the shore and build a boat there."}</div>`}
      </div>
      <div>
        <h3>Supplies (from hub)</h3>
        ${suppliesTable(state, h, pl, "hub")}
        <button data-action="pl-autofill" style="margin-top:0.4rem"${tip("Pack enough for the round trip plus 25%")}>Auto-fill (+25% margin)</button>
        ${warn.length ? `<div class="small danger" style="margin-top:0.5rem">${warn.map(esc).join("<br>")}</div>` : ""}
      </div>
    </div>
    ${settles ? `<div class="small muted" style="margin-top:0.5rem">The team stays at the ${pl.mission === "occupy" ? "base it moves into" : "new outpost"}: no plan after it.</div>` : planSection(state, pl, pe || (est ? planEstimate(state, pl) : null))}
    ${problem ? `<div class="danger" style="margin-top:0.6rem">${esc(problem)}</div>` : ""}
    ${ui.plannerError ? `<div class="danger" style="margin-top:0.6rem">${esc(ui.plannerError)}</div>` : ""}
    <div class="row" style="margin-top:1rem;justify-content:flex-end"><button data-action="pl-cancel">Cancel</button><button class="primary" data-action="pl-launch" ${!ids.length || !est || carry.over || problem || fleetWhy ? "disabled" : ""}${tip(!ids.length ? "Pick at least one person" : !est ? "No route" : carry.over ? carry.why : problem || fleetWhy || "The team leaves now. If the game is paused, it sets off when you unpause.")}>Send team</button></div>
  </div>`;
}

// The move-out planner (main.js openMoveOut; sim/moveout.js moveTeamOut): who leaves a base (from the Overcrowded
// card or the base screen), their transport and what they take from its stores, and where to: another of your bases
// (they are asked to move in when they get there), or a tile picked on the map once they are out (a place for a new
// outpost: the scrap it needs is packed by default). Food and water: the trip, plus MOVE_OUT.days for the road ahead.
function moveOutModal(state, ui) {
  const pl = ui.planner;
  const b = baseById(state, pl.fromBaseId);
  if (!b) return `<div class="box"><h1>Move a team out</h1><div class="text">That base is no longer yours.</div><div class="row"><button class="primary" data-action="pl-cancel">Close</button></div></div>`;
  const where = b.type === "hub" ? "the hub" : b.name;
  const pool = atBase(state, b.id);
  const ids = [...pl.crew];
  const v = plannerVehicle(state, pl);
  const carry = plannerLoad(state, pl);
  const dest = pl.dest != null ? pl.dest : b.tile;
  const est = estimateTrip(state, { memberIds: ids.length ? ids : [0], dest, vehicle: travelMode(v), v, stance: pl.stance, fuel: isCar(v) ? v.fuel + (pl.supplies.fuel || 0) : 0, supplies: pl.supplies, homeBaseId: b.id });
  const to = pl.dest != null ? state.bases.find((x) => x.tile === pl.dest) || null : null;
  const beds = baseBeds(b), now = residents(state, b.id).length, after = now - ids.length;
  const lvl = (n) => crowdLevel(n / Math.max(1, beds));
  const others = state.bases.filter((x) => x !== b);
  const warn = [];
  const fleetWhy = ids.length ? plannerFleetProblem(state, pl) : ""; // a person to each vehicle, seats, bikes, fuel
  if (fleetWhy) warn.push(fleetWhy);
  if (pl.dest == null && (pl.supplies.scrap || 0) < MOVE_OUT.scrap) warn.push(`A new outpost needs ${MOVE_OUT.scrap} scrap carried (5 on the ruins of a base): pack it now, or find it on the way`);
  if (to && ids.length > freeBeds(state, to)) warn.push(`${to.name} has ${Math.max(0, freeBeds(state, to))} free bed${freeBeds(state, to) === 1 ? "" : "s"} for ${ids.length}: it would be crowded`);
  if (pl.dest != null && !est) warn.push(`No route to ${to ? to.name : "there"}${v ? " for the vehicle" : ""}.`);
  warn.push(...loadWarnings(carry.t));
  if (carry.over) warn.push(carry.why);
  const destBtn = (x) => {
    const e = estimateTrip(state, { memberIds: ids.length ? ids : [0], dest: x.tile, vehicle: travelMode(v), v, stance: pl.stance, fuel: isCar(v) ? v.fuel + (pl.supplies.fuel || 0) : 0, supplies: pl.supplies, homeBaseId: b.id });
    const free = freeBeds(state, x);
    return `<button data-action="pl-dest" data-tile="${x.tile}" class="${pl.dest === x.tile ? "active" : ""}" ${e ? "" : "disabled"}${tip(`Walk${v ? " or drive" : ""} to ${x.name}; when they get there you are asked whether they move in (they live and work there from then on, and what they carry goes into its stores).`)}>${esc(x.name)}<span class="hint">${free > 0 ? `${free} free bed${free === 1 ? "" : "s"}` : `full (${residents(state, x.id).length} in ${baseBeds(x)} beds)`} · ${e ? `about ${e.hoursOut}h` : "no route"}</span></button>`;
  };
  const go = !ids.length ? "Pick at least one person" : carry.over ? carry.why : pl.dest != null && !est ? "No route" : pl.dest == null ? "They leave now and wait outside; then click a tile on the map to send them (Esc: they wait for orders)" : `They set off for ${to ? to.name : "there"} now`;
  return `<div class="box wide">
    <h1>Move a team out of ${esc(b.name)}</h1>
    <div class="text small">${now} people live at ${esc(b.name)} with ${beds} beds (<span class="${lvl(now).tone}">${esc(lvl(now).name.toLowerCase())}</span>)${ids.length ? `; with ${ids.length} gone, ${after} in ${beds} beds (<span class="${lvl(after).tone}">${esc(lvl(after).name.toLowerCase())}</span>)` : ""}. The team is a team like any other on the map: send it to a good spot and order <b>Build outpost</b> there, or to another of your bases and move in when it arrives.</div>
    <h3>Who goes (${ids.length})</h3>
    ${crewPick(state, pool, pl, where)}
    <div class="grid2" style="margin-top:0.6rem">
      <div>
        <h3>Where to</h3>
        <div class="choices">
          <button data-action="pl-dest" data-tile="" class="${pl.dest == null ? "active" : ""}"${tip("They leave and wait just outside; the map goes to move mode so you can click where they go: a spot for a new outpost, or anywhere.")}>Pick a place on the map<span class="hint">a new outpost, or anywhere: click it once they are out</span></button>
          ${others.map(destBtn).join("")}
        </div>
        <h3>Transport</h3>
        ${transportPick(state, b, pl, v, ids, where)}
        <h3>Stance</h3>
        <div class="row">${Object.entries(STANCES).map(([k, x]) => `<button data-action="pl-stance" data-v="${k}" class="${pl.stance === k ? "active" : ""}"${tip(x.desc)}>${x.name}</button>`).join("")}</div>
      </div>
      <div>
        <h3>Supplies (from ${esc(where)})</h3>
        ${suppliesTable(state, b, pl, b.type === "hub" ? "hub" : "base")}
        <button data-action="pl-autofill" style="margin-top:0.4rem"${tip(`Pack for the trip plus ${MOVE_OUT.days} days of food and water${pl.dest == null ? `, and ${MOVE_OUT.scrap} scrap for an outpost` : ""}`)}>Auto-fill</button>
        ${est && pl.dest != null ? `<div class="kv small" style="margin-top:0.4rem"><div>Arrives in</div><div><b>${est.hoursOut}h</b>${weatherEta(est)}</div><div>Weight</div><div class="${carry.over ? "danger" : ""}">${n1(carry.load)} kg packed · room for ${n1(Math.max(0, carry.cap - carry.load))} kg more</div></div>` : `<div class="small muted" style="margin-top:0.4rem">Weight: ${n1(carry.load)} kg packed · room for ${n1(Math.max(0, carry.cap - carry.load))} kg more</div>`}
        ${warn.length ? `<div class="small danger" style="margin-top:0.5rem">${warn.map(esc).join("<br>")}</div>` : ""}
      </div>
    </div>
    ${ui.plannerError ? `<div class="danger" style="margin-top:0.6rem">${esc(ui.plannerError)}</div>` : ""}
    <div class="row" style="margin-top:1rem;justify-content:flex-end"><button data-action="pl-cancel">Cancel</button><button class="primary" data-action="pl-launch" ${!ids.length || carry.over || fleetWhy || (pl.dest != null && !est) ? "disabled" : ""}${tip(fleetWhy || go)}>Move out</button></div>
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
  const found = [...Object.entries(e.found.supplies).filter(([, v]) => v >= 1).map(([k, v]) => `${n0(v)} ${keyWord(k)}`), ...e.found.gear.map((g) => g.name)];
  return `<div class="box wide"><h1>Scavenging ${esc(tileLabel(state, e.tile))} · ${APPROACHES[e.approach].name}</h1>
    <div class="spread small"><span>Heat: <b>${stage.name}</b> — ${stage.desc}</span><span>${e.hours} hour${e.hours === 1 ? "" : "s"} searched · ${clock(state)}</span></div>
    <div class="heat" style="margin:0.4rem 0 0.9rem"${tip("Quiet → Stirring (25) → Swarming (50) → Overrun (75). Fights get likelier and extraction harder.")}><i style="left:${e.heat}%"></i></div>
    <div class="grid2">
      <div><h3>Log</h3><div class="elog" id="elog">${e.log.map((l) => `<div>${esc(l)}</div>`).join("")}</div></div>
      <div><h3>Team</h3>${members.map((m) => `<div class="row small"><span style="width:7rem">${first(m)}</span><div style="flex:1">${bar(m.health, m.health < 40 ? "var(--danger)" : "var(--good)")}</div></div>`).join("")}
        <div class="small muted" style="margin-top:0.3rem"><span${tip(`Every round and arrow the team has, by calibre: ${breakdownText(teamAmmoBreakdown(state, p), "; ")}`)}>Ammo ${n0(p ? teamAmmoBreakdown(state, p).total : 0)}</span> · Food ${n0(p ? p.supplies.food : 0)}</div>
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
  const rows = SUPPLY_KEYS.filter((k) => k !== "ammo" && (!(SUPPLIES[k].round || SUPPLIES[k].reload) || (have[k] || 0) >= 1)).map((k) => `<tr>
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
  const short = !reason && f && supplyAmt(h.stock, r.sendKey) < r.sendQty ? `The hub has only ${n0(supplyAmt(h.stock, r.sendKey))} ${keyWord(r.sendKey)} right now; a convoy leaves only when the full load is there.` : "";
  let worth = "";
  if (f && SUPPLIES[r.sendKey] && SUPPLIES[r.recvKey] && r.sendKey !== r.recvKey) {
    const max = Trade.routeWorth ? Trade.routeWorth(state, f, r.sendKey, r.sendQty, r.recvKey).maxRecv : Math.floor((r.sendQty * sellPrice(state, f, r.sendKey, 0)) / buyPrice(state, f, r.recvKey, 0));
    worth = `At today's prices ${f.name} gives up to ${max} ${keyWord(r.recvKey)} for ${r.sendQty} ${keyWord(r.sendKey)}. Prices move with their stock; a convoy never gets more than its load is worth that day.`;
  }
  return { ok: !reason, reason, hint: short, worth };
}

function routeModal(state, ui) {
  const r = ui.routeSetup;
  const f = factionById(state, r.factionId);
  const h = hub(state);
  const pool = atBase(state, h.id);
  const needPeople = ESCORTS[r.escort].people;
  // Rounds by calibre and type (2026-10-09, user request: "All ammo should be based on caliber"): a route sends or
  // receives one round key, never a bare "ammo" (an old route's "ammo" stays in its list until changed).
  const keys = [...STOCK_KEYS.filter((k) => k !== "water" && k !== RAW && k !== "ammo"), ...ROUND_KEYS.filter((k) => SUPPLIES[k].common !== false && !SUPPLIES[k].round.hand), ...(r.sendKey === "ammo" || r.recvKey === "ammo" ? ["ammo"] : [])];
  const chk = routeCheck(state, r);
  const crewOk = r.escortIds.size === needPeople;
  return `<div class="box wide"><h1>Trade route to ${esc(f.name)}</h1>
    <div class="grid2">
      <div>
        <h3>Goods</h3>
        <div class="row">Send <input type="number" min="1" step="1" data-action="rt" data-f="sendQty" value="${r.sendQty}"> <select data-action="rt" data-f="sendKey">${keys.map((k) => `<option value="${k}" ${r.sendKey === k ? "selected" : ""}>${esc(keyWord(k))}</option>`).join("")}</select></div>
        <div class="row" style="margin-top:0.4rem">Receive <input type="number" min="1" step="1" data-action="rt" data-f="recvQty" value="${r.recvQty}"> <select data-action="rt" data-f="recvKey">${keys.map((k) => `<option value="${k}" ${r.recvKey === k ? "selected" : ""}>${esc(keyWord(k))}</option>`).join("")}</select></div>
        <div class="row" style="margin-top:0.4rem">Every <input type="number" min="2" step="1" data-action="rt" data-f="interval" value="${r.interval}"> days</div>
        <div class="small muted">They ${SUPPLIES[r.recvKey] && SUPPLIES[r.recvKey].round ? `can spare about ${n0(Trade.available ? Trade.available(f, r.recvKey) : 0)}` : `have ${n0(f.stock[r.recvKey])}`} ${esc(keyWord(r.recvKey))}. ${esc(chk.worth)}</div>
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
  return `${d.name}: power ${d.power}${d.skill ? `, needs ${SKILL_NAMES[d.skill]} ${d.req} for full use` : ""}, worth: ${worthTier(item)}${item.quality < 1 ? `, condition ${Math.round(item.quality * 100)}%` : ""}${dur != null ? d.tabs ? `. ${dur} of ${d.dur} tablets left` : d.count ? `. ${dur} of ${d.dur} left` : d.groom ? `. ${dur} of ${d.dur} days of use left` : `. ${d.makeshift ? "Makeshift: " : ""}${dur} of ${itemDurMax(item)} ${durUnit(item.key)} left before it breaks` : ""}${d.desc ? `. ${d.desc}` : ""}`;
}
// Uses left before it breaks, e.g. " [7/10]".
const durTag = (item) => { const v = itemDur(item); return v != null ? ` [${v}/${itemDurMax(item)}]` : ""; };

function survivorModal(state, ui) {
  const s = survivorById(state, ui.survivor);
  if (!s) return null;
  const base = s.alive && s.location.kind === "base" ? baseById(state, s.location.baseId) : null; // the dead (memorial wall) have no gear controls
  const slots = EQUIP_SLOTS; // inventory.js: hands, off hand, head, body, arms, legs, backpack
  ensureInv(s);
  const carried = s.pockets.filter(Boolean).length + (s.gear.backpack && s.gear.backpack.contents ? s.gear.backpack.contents.filter(Boolean).length : 0);
  return `<div class="box"><div class="spread"><h1><span class="surv-port" data-action="look-edit" data-id="${s.id}"${tip("Customize how they look")}>${spriteImg(survivorURL(s, state.seed), 3)}</span>${s.leader ? "★ " : ""}${esc(s.name)}${stIcons(state, s)}</h1>
      <span class="row">${s.alive ? watchlistPin(state, "person", s.id, s.name, { label: true }) : ""}<button class="mini ${ui.lookEdit === s.id ? "active" : ""}" data-action="look-edit" data-id="${s.id}"${tip("Change their look: build, hair, clothes, accessory. Shown in battle.")}>Customize look</button></span></div>
    ${ui.lookEdit === s.id ? appearanceEditor(state, s) : ""}
    <div class="where">${s.leader ? "Leader · " : ""}${inContact(state, s) ? `Health ${n0(s.health)} · Mood ${n0(s.mood)}` : "Health and mood unknown (no contact)"} · Combat power ${combatPower(s).toFixed(1)}${base ? ` · at ${esc(base.name)}` : ""}${inContact(state, s) && s.woundInfected ? ` · <span class="danger">Infected wound</span>` : ""} ${treatButton(state, s)}</div>
    ${isCaptive(s) ? captiveLine(state, s) : ""}
    ${s.alive && inContact(state, s) ? `<div class="card small" style="max-width:28rem">${gaugeRows(s)}${needsEffectText(s) ? `<div class="warn">${esc(needsEffectText(s))}</div>` : ""}${isSick(s) ? `<div class="row" style="flex-wrap:wrap">${conditionChips(state, s)}</div>` : ""}${treatsRow(state, s)}</div>` : ""}
    ${s.alive ? workLine(state, s, base) : ""}
    <div class="grid2">
      ${skillsBlock(state, s)}
      <div><h3>Traits</h3>${s.traits.map((t) => `<div class="small">${traitChip(s, t)} <span class="muted">${esc(traitOf(s, t).desc)}</span></div>`).join("")}
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
    ${familyBlock(state, s)}
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
  ["camp", "Camp", "The camp at a glance: its stage and what it can become, who is there, the teams at the camp, its stores and vehicles; set up teams, build it up, or strike it"],
  ["overview", "Overview", "Stock, people and roles"],
  ["work", "Work", "Work priorities (like RimWorld's work tab): roles with a 1–5 priority per kind of work, a schedule, and crews that run trips by themselves"],
  ["defence", "Defence", "The watch roster (who stands guard at which hours) and the defence plan (where everyone stands when the base is attacked)"],
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
  // A camp (sim/staging.js, the barest base): its own Camp tab first, and only the tabs a camp has use for.
  const tabs = isCamp(b) ? BASE_TABS.filter(([k]) => CAMP_TABS.includes(k)) : BASE_TABS.filter(([k]) => k !== "camp");
  const tab = tabs.some(([k]) => k === ui.baseView.tab) ? ui.baseView.tab : tabs[0][0];
  const body = { camp: campTab, overview: baseOverview, work: workTab, defence: defenceTab, farming: baseFarming, workshops: baseWorkshops, buildings: baseBuildings, construction: baseConstruction, armory: baseArmory, crafting: baseCrafting, vehicles: baseVehicles, convoys: baseConvoys, medical: baseMedical, repairs: repairsTab, prisoners: prisonTab }[tab](state, b, ui);
  return `<div class="box wide basebox">
    <div class="spread"><input class="basename" data-action="baserename" data-base="${b.id}" maxlength="40" value="${esc(b.name)}"${tip("Click to rename this base (Enter to confirm)")}>${renameButton(b, "✎ Rename")}<span class="muted">${tierName(b)} · ${atBase(state, b.id).length} people · Day ${day(state)} ${clock(state)}</span></div>
    <div class="tabs">${tabs.map(([k, l, t]) => `<button data-action="basetab" data-tab="${k}" class="${tab === k ? "active" : ""}"${tip(t)}>${l}</button>`).join("")}</div>
    ${ui.baseMsg ? `<div class="result small">${esc(ui.baseMsg)}</div>` : ""}
    <div class="basebody">${body}</div>
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end"><button class="primary" data-action="closebase">Close</button></div>
  </div>`;
}

// The tabs a camp shows (BASE_TABS keys).
const CAMP_TABS = ["camp", "overview", "construction", "armory", "vehicles", "crafting", "work", "medical"];

// ---------- the camp (sim/staging.js) ----------
// The Camp tab: the stage ladder and the step up (tierUpRows), what each stage opens up, the people at the camp, the
// teams standing at it (Edit team, Enter), Form a team, the stores and vehicles at a glance, its water, fire and Heat,
// and Strike camp. Everything acts through the base's own systems: teams are formed and edited here as at any base
// (ui/teamform.js: people, vehicles, gear, supplies and cargo by weight and seats), stores and items are the base's
// stock and armory (Armory tab, the team inventory), vehicles and their cargo the Vehicles tab.
function campTab(state, b) {
  const v = shelterView(state, b);
  const people = v.people || [];
  const teams = v.teams || [];
  const out = b.type === "outpost";
  const parked = state.vehicles.filter((x) => x.loc.kind === "base" && x.loc.baseId === b.id);
  const stock = STOCK_KEYS.filter((k) => k !== "jars" && n0(k === "ammo" ? totalRounds(b.stock) : b.stock[k]) >= 1).map((k) => [k, b.stock[k]]);
  const nameList = (keys) => keys.map((k) => BUILDINGS[k] ? BUILDINGS[k].name : k).join(", ");
  const atShelter = Object.keys(SHELTER.build).filter((k) => !BUILDINGS[k].tierUp && !CAMP.build[k]);
  const ladder = out
    ? `<div>Next</div><div class="small">An outpost: a dug spring (3 water a day), a fence (wall 1), 6 building plots and 6 utility plots, room for every building an outpost takes.</div>`
    : `<div>At the shelter</div><div class="small">A roof and beds for ${SHELTER.beds}, two utility plots and a garden patch: ${esc(nameList(atShelter))}, and its own step up (${esc(BUILDINGS.hub_up.name)}: ${esc(needText(BUILDINGS.hub_up.cost))}).</div>
      <div>At the base</div><div class="small muted">A main house, a dug well, walls, 16 building and 14 utility plots: every building (workshops, the hospital, bunkhouses, the radio station…). Construction lists them with what each needs.</div>`;
  const away = v.away >= 1 && !people.length ? `<div${tip(`Nobody at the camp. After ${STAGING.ABANDON} days alone it may be looted (part of its stores and its step up); empty and bare for ${STAGING.GONE} days it is gone.`)}>Alone</div><div class="${v.away >= STAGING.ABANDON ? "danger" : "warn"}">${Math.floor(v.away)} day${Math.floor(v.away) === 1 ? "" : "s"}</div>` : "";
  return `<div class="grid2">
    <div>
      <h3>Camp ${stageSteps(0)}</h3>
      <div class="card small"${tip("A camp is the barest base: tarps, bedrolls and a fire. Its people live there (base healing, twice as fast at rest as at a base without a hospital; meals and water from its stores), but it has no well, no wall strength, one utility plot and no crop plots. Build it up with time and materials, or strike it and move on.")}>
        <div class="kv small">
          ${tierUpRows(state, b)}
          ${ladder}
        </div>
      </div>
      <h3>People here (${people.length}/${baseBeds(b)} bedrolls)</h3>
      <div class="card small">${people.length ? people.map((s) => `<div class="spread"><a class="link" data-action="survivor" data-id="${s.id}">${first(s)}</a><span class="muted">${esc(ROLES[s.role] ? ROLES[s.role].name : s.role || "")} · health ${n0(s.health)}</span></div>`).join("") : `<span class="muted">Nobody lives at the camp now.</span>`}
        <div class="row" style="margin-top:0.4rem">${formTeamButton(state, b)}</div>
        <div class="muted" style="margin-top:0.3rem">Form a team: pick people, vehicles, gear and supplies from the camp\'s stores; they stand outside as a team (split as many teams as you like). A team at the camp is edited here (people in or out, vehicles, loading and dropping off by weight) or moves back in with Enter.</div>
      </div>
      <h3>Teams at the camp (${teams.length})</h3>
      <div class="card small">${teams.length ? teams.map((p) => `<div class="spread"><a class="link" data-action="xp-open" data-id="${p.id}">${esc(teamName(state, p))}</a><span class="row">${editTeamButton(state, p)}<button class="mini" data-action="xp-order" data-id="${p.id}" data-type="mission" data-mission="enter"${tip(`Move this team into ${b.name}: its people live at the camp, what it carries goes into the stores and armory, its vehicles park here`)}>Enter</button></span></div>`).join("") : `<span class="muted">No team stands at the camp.</span>`}</div>
    </div>
    <div>
      <h3>Stores</h3>
      <div class="card small">${stock.length ? stock.map(([k, q]) => `<span class="chip">${esc(SUPPLIES[k].name)} ${n0(k === "ammo" ? totalRounds(b.stock) : q)}</span>`).join(" ") : `<span class="muted">Nothing in the stores.</span>`}
        <div class="muted" style="margin-top:0.3rem">${b.armory.length} item${b.armory.length === 1 ? "" : "s"} in the camp\'s armory (Armory tab). Teams set down what they carry when they enter, and take supplies and gear when they are formed or edited here.</div>
        <div class="row" style="margin-top:0.3rem"><button class="mini" data-action="basetab" data-tab="armory">Armory</button><button class="mini" data-action="basetab" data-tab="construction">Construction</button></div>
      </div>
      <h3>Vehicles (${parked.length})</h3>
      <div class="card small">${parked.length ? parked.map((x) => `<div class="spread"><span>${esc(x.name)}${x.count > 1 ? ` ×${x.count}` : ""}</span><span class="muted">condition ${n0(x.condition)}%${x.fuel != null && !/bike/.test(x.type) ? ` · fuel ${n0(x.fuel)}` : ""}</span></div>`).join("") : `<span class="muted">No vehicle parked here.</span>`}
        <div class="row" style="margin-top:0.3rem"><button class="mini" data-action="basetab" data-tab="vehicles"${tip("Fuel, repairs and each vehicle's cargo")}>Vehicles tab</button></div>
      </div>
      <h3>Around the camp</h3>
      <div class="card small"><div class="kv small">
        <div${tip("A camp has no well: beside a river or lake its people haul water into the stores; anywhere else only what is carried in.")}>Water</div><div class="${v.riverside ? "good" : "warn"}">${esc(v.water)}</div>
        <div${tip("The camp's Heat (what draws the dead and raiders): its fire (most at night), vehicles parked here and shooting nearby lately; its people count as at any base.")}>Heat from</div><div>${esc(v.heat.text || "nothing but its people")}</div>
        <div${tip("The camp fire: warmth, hot food and boiled water, better spirits. Its light and smoke add to the Heat, most at night.")}>Fire</div><div>${v.fire ? "Lit" : "Out"} ${fireButton(v.fire, `data-base="${b.id}"`)}</div>
        ${away}
        ${v.looted ? `<div>Looted</div><div class="warn">${v.looted} time${v.looted === 1 ? "" : "s"}</div>` : ""}
      </div></div>
      <div class="row" style="margin-top:0.6rem;justify-content:flex-end"><button class="danger" data-action="strikecamp" data-base="${b.id}" ${v.strike ? "disabled" : ""}${tip(v.strike || `${STRIKE_LABEL}: everyone here forms one team with the vehicles that run (as far as drivers and seats allow) and what they can carry of the stores and armory (water and food first). What is left stays here as a cache to recover, and the camp is gone.`)}>${STRIKE_LABEL}</button></div>
    </div>
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
      ${trainingCard(state, b)}
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
        <div class="spread"><span><a data-action="survivor" data-id="${s.id}" class="link">${esc(s.name)}</a>${stIcons(state, s)}</span>${treatButton(state, s)}</div>
        <div class="row"><div style="flex:1">${bar(s.health, s.health < 40 ? "var(--danger)" : "var(--good)")}</div><span style="width:2rem;text-align:right">${n0(s.health)}</span></div>
        <div>${bedChip(state, b, s, h, beds.has(s.id))}${s.health < 30 ? `<span class="chip off"${tip("Severe wound (below 30 health): heals at 40% speed without a bed; a hospital bed and surgery help")}>Severe</span>` : ""}${s.woundInfected ? `<span class="chip off"${tip("Heals at half speed and loses 2 health a day. Treat with meds; a Clinic or better cleans it in bed.")}>Infected wound</span>` : ""}<span class="muted">${healPerDayText(state, b, s, h, beds.has(s.id), carePlan)}</span></div>
        ${nextTreatLine(state, b, s)}
        ${conditionTreatRow(state, b, s)}
      </div>`).join("") : `<div class="muted small">Nobody here is hurt or ill.</div>`}
      ${othersWormHtml(state, b)}
      <div class="small muted" style="margin-top:0.4rem">The rate is the expected change over the next day: passive healing, tonight's automatic care (if they get it) and what illness costs. One treatment per wound or illness a day, each takes a medic's time.</div>
    </div>
  </div>`;
}

// Training (sim/training.js): the doctor, the ward rounds, the Medic trainees with their Medicine progress, and a
// picker to put someone on the Trainee role.
function trainingCard(state, b) {
  const t = trainingInfo(state, b);
  if (!t.def.tier) return "";
  const med = (s) => { const p = skillProgress(s, "medicine"); return `<span class="muted">Medicine ${p.level}${p.maxed ? "" : ` · ${p.pct}% to ${p.raw + 1}`}</span>`; };
  const doc = t.doc ? `<div class="spread"${tip(`The doctor: the best medic here with Medicine ${TRAINING.docMin}+ teaches the trainees every day: ${TRAINING.base} + ${TRAINING.perSkill} × their Medicine, × ${t.def.teach} for the ${t.def.name.toLowerCase()}${t.doc.onDuty ? "" : `, × ${TRAINING.offDuty} off Medic duty (evening lessons)`}${t.quiet ? `, × ${TRAINING.quiet} on a quiet ward` : ""}${t.doc.s.perks && t.doc.s.perks.includes("professor") ? `, × ${PROFESSOR.mult} as a Professor` : ""}. Lessons stop ${lessonGap(t.def) ? `${lessonGap(t.def)} below the doctor's Medicine` : "at the doctor's own Medicine (trauma hospital)"}. Each day of teaching gives the doctor ${TRAINING.docLead} Leadership and ${TRAINING.docSpeech} Speech XP; ${PROFESSOR.days} days with Medicine ${PROFESSOR.minMed}+ make them a Professor of Medicine (lessons × ${PROFESSOR.mult}, for good).`)}><span>Doctor: <b>${esc(t.doc.s.name)}</b> ${med(t.doc.s)}${t.doc.s.perks && t.doc.s.perks.includes("professor") ? ` <span class="chip on">Professor</span>` : ` <span class="muted">· taught ${t.doc.s.teachDays || 0} of ${PROFESSOR.days} days to Professor</span>`}</span><span class="chip ${t.doc.onDuty ? "on" : ""}">${t.doc.onDuty ? "On duty" : "Off duty"}</span></div>`
    : `<div class="muted">No doctor: lessons need someone here with Medicine ${TRAINING.docMin}+ (best here ${t.hosp.baseSkill}).</div>`;
  const ward = `<div class="muted"${tip("Ward rounds: each patient adds to what the medics on duty learn a day (2 in a bed, 0.5 on their feet, +2 severe, +2 infected, +1 an illness), × the tier's factor, shared among them, capped by the tier. On top of the Medic role's 8 a day and each treatment's XP.")}>Ward rounds: ${t.medics.length ? `+${n1(t.wardEach)} Medicine XP a day for each medic on duty (cap ${t.hosp.ward || 0} here)` : "nobody on Medic duty"}</div>`;
  const rows = t.trainees.map((x) => `<div class="spread"${tip(x.why ? `Learns nothing from the doctor: ${x.why}. Ward work still gives ${n1(x.practice)} XP a day.` : `+${n1(x.xp)} XP a day from the doctor (up to Medicine ${x.cap}), +${n1(x.practice)} for the ward work.`)}><span>${esc(x.s.name)} ${med(x.s)}${x.why ? ` <span class="warn">· ${esc(x.why)}</span>` : ` <span class="good">+${n1(x.xp + x.practice)}/day</span>`}</span><span>${skill(x.s, "medicine") >= TRAINING.graduate ? `<button class="mini primary" data-action="makemedic" data-id="${x.s.id}"${tip(`${esc(x.s.name)} has Medicine ${skill(x.s, "medicine")}: put them on the Medic role (by hand, off work priorities).`)}>Make medic</button> ` : ""}${roleSelect(state, x.s)}</span></div>`).join("");
  const others = atBase(state, b.id).filter((s) => s.role !== "trainee" && (!t.doc || s !== t.doc.s));
  const pick = others.length ? `<div style="margin-top:0.3rem"><select data-action="traineeop"${tip("Put someone on the Trainee role: they work on the ward and learn Medicine from the doctor")}><option value="">Add a trainee…</option>${others.map((s) => `<option value="${s.id}">${esc(s.name)} (Medicine ${skill(s, "medicine")}, now ${ROLES[s.role]?.name || s.role})</option>`).join("")}</select></div>` : "";
  return `<h3${tip("The hospital trains medics: ward rounds for the medics on duty, lessons from the doctor for the trainees (Help: Training medics)")}>Training</h3>
      <div class="card small">
        ${doc}
        ${ward}
        <div style="margin-top:0.3rem"><b>Trainees</b> <span class="muted">${t.slots - t.left} of ${t.slots} place${t.slots === 1 ? "" : "s"} used · a trainee counts as half a medic</span></div>
        ${rows || `<span class="muted">Nobody on the Trainee role.</span>`}
        ${t.juniors.length ? `<div style="margin-top:0.3rem"${tip("A trainee place nobody on the Trainee role uses goes to a medic on duty below the doctor's cap: they take the lesson on top of their own work.")}><b>Junior medics learning</b></div>${t.juniors.map((x) => `<div class="spread"><span>${esc(x.s.name)} ${med(x.s)} <span class="good">+${n1(x.xp)}/day</span></span><span class="muted">On a free place</span></div>`).join("")}` : ""}
        ${pick}
      </div>`;
}

// An outpost camp's step up (sim/buildings.js outpost_up, a job that gathers its materials): the work's bar (its
// lighter part: what the materials delivered allow), each material taken against what it needs, and what holds it up.
function tierUpRows(state, b) {
  const type = tierUpType(b), def = BUILDINGS[type], out = b.type === "outpost";
  const stage = out ? "Outpost camp → <b>Outpost</b>" : isCamp(b) ? "Camp → <b>Shelter</b> → Base" : "Shelter → <b>Base</b>";
  const job = tierUpJob(b);
  if (!job) {
    const chk = canBuild(state, b, type);
    return `<div>Stage</div><div>${stage}</div><div></div><div><button class="mini" data-action="queuebuild" data-base="${b.id}" data-type="${type}" ${chk.ok ? "" : "disabled"}${tip(chk.ok ? `${def.desc} Needs ${gatherShort({ type, paid: {}, cost: b.ruinSalvage && def.cost.scrap ? { ...def.cost, scrap: Math.max(0, def.cost.scrap - CAMP.ruinScrap) } : undefined })} brought in, and ${def.hours} work-hours.` : chk.reason)}>${esc(def.name)}</button></div>${isCamp(b) ? `<div></div><div class="small muted">A plain camp: nothing is building. Queue the step up to start; the materials are taken from the stores as they come in.</div>` : ""}`;
  }
  const f = job.hours ? job.progress / job.hours : 0, cap = job.paid ? gatherCap(job) : 1;
  const rate = buildRate(state, b);
  const short = job.paid ? gatherShort(job) : "";
  const status = job.paid && gatherStalled(job) ? `<span class="warn">Waiting for ${esc(short)}: ${out ? "bring them with a team or a supply run" : "scavenge or trade for them"}</span>`
    : rate <= 0 ? `<span class="warn">No builders: set someone here to Build</span>`
    : `${n1(job.hours - job.progress)} work-hours left, about ${Math.ceil((Math.min(job.hours, job.hours * cap) - job.progress) / rate)}h${cap < 1 ? ` with what is in (still ${esc(short)} to come)` : ""}`;
  const rows = job.paid ? gatherRows(job).map((r) => `<span class="${r.ok ? "good" : "warn"}"${tip(`${SUPPLIES[r.key] ? SUPPLIES[r.key].name : r.key}: ${n0(r.have)} of ${r.need} taken from the stores${r.ok ? "" : ` (${n0(b.stock[r.key] || 0)} more in the stores; it is taken as it comes in)`}${r.key === "buildmat" ? ". Building materials are scavenged: hardware stores and quarries most, then warehouses, factories, barns, farms and towns" : ""}`)}>${r.ok ? "✓" : "○"} ${esc(SUPPLIES[r.key] ? SUPPLIES[r.key].name : r.key)} ${n0(r.have)}/${r.need}</span>`).join(" · ") : "<span class=\"good\">Paid</span>";
  const why = out
    ? "A new outpost starts as a camp (the barest base: tarps, bedrolls and a fire, no well, one utility plot). Establish it for a dug spring, a fence and room to build: the materials are taken from its stores as they come in, and its builders do the work, never more of it than the materials delivered allow."
    : "Your home grows in stages: a camp (the barest base), a shelter (tier 0), then a base. Building it up takes the materials from the stores as they come in, and its builders do the work, never more of it than the materials delivered allow.";
  return `<div${tip(why)}>Stage</div><div>${stage}</div>
    <div>${out ? "Establishing" : "Building up"}</div><div><div class="bar" style="position:relative"${tip("The bar: the work done; its lighter part, as far as the materials delivered allow")}><i style="width:${Math.round(cap * 100)}%;background:rgba(143,180,224,0.35)"></i><i style="position:absolute;left:0;top:0;bottom:0;width:${Math.round(Math.min(1, f) * 100)}%;background:var(--accent)"></i></div><span class="small">${Math.round(f * 100)}% built</span></div>
    <div>Needs</div><div class="small">${rows}</div>
    <div></div><div class="small">${status}</div>`;
}
// A shelter (tier 0, sim/buildings.js) or an outpost camp: its step up (tierUpRows: the bar and the materials), its
// water, its fire and (a shelter) what its Heat is made of (sim/fieldheat.js shelterHeat).
function shelterRows(state, b) {
  const v = shelterView(state, b);
  if (!v) return "";
  if (b.type === "outpost") return `${tierUpRows(state, b)}
    <div${tip("A camp has no well: water from a river or lake beside it (its people haul it), rain catchers, or what teams and the hub bring in.")}>Water source</div><div class="${v.riverside ? "good" : "warn"}">${esc(v.water)}</div>
    <div${tip("The camp's fire: warmth, boiled water, better spirits. Its light and smoke add to the Heat, most at night.")}>Fire</div><div>${v.fire ? "Lit" : "Out"} ${fireButton(v.fire, `data-base="${b.id}"`)}</div>`;
  return `${tierUpRows(state, b)}
    <div${tip("A shelter has no well: water from a river or lake beside it (its people haul it), rain catchers, or what teams bring in.")}>Water source</div><div class="${v.riverside ? "good" : "warn"}">${esc(v.water)}</div>
    <div${tip("A shelter's Heat in place of the hub's flat 3: its fire (most at night), vehicles parked here and shooting nearby lately; its people count as at any base.")}>Heat from</div><div>${esc(v.heat.text || "nothing but its people")}</div>
    <div${tip("The shelter's fire: warmth (the tarps are as cold as outside without it), boiled water, better spirits (+0.5 mood a day; cold nights without it cost 1). Its light and smoke add to the Heat, most at night.")}>Fire</div><div>${v.fire ? "Lit" : "Out"} ${fireButton(v.fire, `data-base="${b.id}"`)}</div>`;
}

function baseOverview(state, b) {
  const people = atBase(state, b.id);
  const line = b.type === "outpost" ? (b.supplyLine || supplyLine(state, b)) : null;
  const fc = foodPerDay(state, b);
  return `<div class="grid2">
    <div>
      <h3>Stock</h3>
      <table class="t">${STOCK_KEYS.map((k) => `<tr><td${k === "ammo" ? tip(`Every calibre: ${roundsLine(b.stock)}`) : ""}>${SUPPLIES[k].name}</td><td>${n0(k === "ammo" ? totalRounds(b.stock) : b.stock[k])}</td></tr>`).join("")}</table>
      ${b.type === "outpost" ? `<div class="small muted" style="margin-top:0.4rem">Outposts keep a small reserve and ship the rest to the hub each day.</div>` : ""}
      <h3>Status</h3>
      <div class="kv small">
        <div>Defense</div><div>${Math.round(baseDefense(state, b))}</div>
        ${holdRow(state, b)}
        <div>Heat</div><div>${baseHeat(state, b)}</div>
        ${shelterRows(state, b)}
        <div${tip("Days of food left at today's rate without harvests, and the next harvest (Farming tab)")}>Food</div>${foodCellHtml(state, b)}
        <div${tip("Where the fresh food is kept and what spoils a day (storage room: cellars, storehouse, cold store; above it, food is stored outside and spoils fast), and the preserved stock")}>Food storage</div>${storeCellHtml(state, b)}
        <div${tip("Water per day (in minus out), stock and capacity, days left")}>Water</div>${waterCellHtml(state, b)}
        <div${tip("Food and water used up a day: a rate per person × everyone fed here (hover for the breakdown)")}>Upkeep</div>${upkeepCellHtml(state, b)}
        ${illnessRowHtml(state, b)}
        ${crowdingRow(state, b)}
        ${people.length ? `<div></div><div><button class="mini" data-action="moveout" data-base="${b.id}"${tip("Pick people to leave this base as a team, with a vehicle and supplies from its stores: send them to found a new outpost, or to another of your bases to move in (the move-out planner).")}>Move a team out…</button> ${formTeamButton(state, b)}</div>` : ""}
        ${line ? `<div>Supply line</div><div>${Math.round(line.strength * 100)}%${line.hostile ? " · hostile land" : ""}${line.horde ? " · horde nearby" : ""}</div><div>Backup ETA</div><div>${isFinite(line.hours) ? line.hours + " hours" : "cut off"}</div>` : ""}
        ${b.type === "outpost" ? `<div></div><div><button class="mini danger" data-action="abandonbase" data-base="${b.id}"${abandonProblem(state, b) ? " disabled" : ""}${tip(abandonProblem(state, b) || "Give this outpost up (a card asks first): its people walk to your nearest base with what they can carry, its buildings stay standing as an empty base (half of the stores left there) that rots month by month and that another group may move into. Take it back later with Reoccupy your old outpost.")}>Abandon outpost…</button></div>` : ""}
      </div>
    </div>
    <div>
      <div class="spread"><h3>People and roles</h3>${memorialButton(state, b)}</div>
      ${people.length ? `<table class="t">${people.map((s) => `<tr><td><a data-action="survivor" data-id="${s.id}" class="link">${s.leader ? "★ " : ""}${esc(s.name)}</a>${stIcons(state, s)}</td><td>${roleSelect(state, s)}</td><td class="small">${n0(s.health)} HP</td><td>${pinButton(s)}</td></tr>`).join("")}</table>` : `<div class="muted small">Nobody is here.</div>`}
      <div class="small muted" style="margin-top:0.4rem">${Object.entries(ROLES).map(([k, r]) => `<b>${r.name}</b> ${people.filter((s) => s.role === k).length}`).join(" · ")}</div>
      ${priorityCount(state, b) ? `<div class="small muted" style="margin-top:0.4rem">${priorityCount(state, b)} here work by priorities (Work tab); a base leader only moves the people on Manual.</div>` : ""}
      ${stewardCard(state, b)}
    </div>
  </div>`;
}

function baseWorkshops(state, b) {
  const people = atBase(state, b.id);
  const farmers = people.filter((s) => s.role === "farm");
  const scav = people.filter((s) => s.role === "scavenge");
  const scavOut = Object.entries(scavengeOutput(state, b)).filter(([, v]) => v >= 0.1).map(([k, v]) => `${n1(v)} ${keyWord(k)}`).join(", ");
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
        <td class="small">${s.op ? `${Object.entries(s.in || r.in).map(([k, v]) => `−${v} ${keyWord(k)}`).join(", ")} → ${Object.entries(s.out).map(([k, v]) => `+${v} ${SUPPLIES[k] && SUPPLIES[k].round ? SUPPLIES[k].name : k}`).join(", ") || "power"}` : "—"}</td>
        <td>${orderCell(state, b, st)}</td>
      </tr>`;
    }).join("")}</table>` : `<div class="muted small">No workshop stations. Build an ammo bench (needs a workbench here), med station or machine shop in Construction.</div>`}
    ${reloadCard(state, b)}${racksCard(state, b)}${powerCard(state, b)}`;
}

// The water boiler's day (sim/worm.js boilerUse): what it burns and whether it is lit.
function boilerNote(state, b) {
  const u = boilerUse(state, b);
  const junk = burnablesWood(boilerBurnables(b));
  const toggle = `<label class="small" style="display:block"${tip("When the firewood runs short the boiler may burn cheap wooden, paper and cloth things from the armory (novels, magazines, rag boots, toilet paper, candles: worth 5 or less, never weapons, tools, armour or bags), before it touches the fuel. Items you mark in the inventory (Boiler may burn it / Keep from the fire) go by their mark.")}><input type="checkbox" data-action="boiler-junk" data-base="${b.id}" ${boilerJunkOn(b) ? "checked" : ""}> Boiler may burn spare wooden items and paper${junk > 0 ? ` <span class="muted">(${junk} firewood's worth in the armory)</span>` : ""}</label>`;
  if (!u.active) return `<div class="small good">Standing ready: ${u.heads ? "the water filters here purify the day's drinking" : "nobody here"} (nothing burned).</div>${toggle}`;
  return `<div class="small ${u.lit ? "" : "danger"}">${u.lit ? "Lit" : "Cold today (nothing to burn: the water is drunk un-purified, or treated with the armory's purification tablets if there is no water filter)"}: burns ${esc(u.text)} on the days the purified water in store and the filters do not cover the drinking (about ${Math.round(u.share * 100)}% of days); it purifies the day's drinking for everyone here. Firewood first, then the armory's burnable junk and anything marked to burn, then fuel.</div>${toggle}`;
}
function baseBuildings(state, b) {
  const groups = {};
  for (const x of b.buildings) groups[x.type] = (groups[x.type] || 0) + 1;
  return `<div class="grid2">
    <div><h3>Built here</h3>${Object.keys(groups).length ? Object.entries(groups).map(([t, n]) => `<div class="card small"${tip(BUILDINGS[t].desc)}><b>${BUILDINGS[t].name}${n > 1 ? ` ×${n}` : ""}</b><br><span class="muted">${BUILDINGS[t].desc}</span>${t === "boiler" ? boilerNote(state, b) : ""}</div>`).join("") : `<div class="muted small">Only a shelter so far. Queue buildings in Construction.</div>`}</div>
    <div><h3>Bonuses</h3><div class="kv small">${buildingSummary(state, b).map(([k, v]) => `<div>${k}</div><div>${esc(v)}</div>`).join("")}</div>${blueprintsCard(state, b)}</div>
  </div>`;
}

// Construction (sim/buildings.js): the plots (building and utility, by the base's size), the queue, what stands on
// the plots (demolish to free one), the water barrels (upgrade each, choose what it holds) and what can be built.
function baseConstruction(state, b, ui) {
  const rate = buildRate(state, b);
  const builders = atBase(state, b.id).filter((s) => s.role === "build");
  let elapsed = 0;
  const costText = (cost) => Object.entries(cost).map(([c, v]) => `${v} ${c}`).join(", ");
  const demolishBtn = (x) => {
    const chk = canDemolish(state, b, x.id);
    const back = costText(demolishRefund(x)) || "nothing";
    return `<button class="mini" data-action="demolish" data-base="${b.id}" data-id="${x.id}" ${chk.ok ? "" : "disabled"}${tip(chk.ok ? `Pull it down to free its plot: ${back} salvaged (asks first).` : chk.reason)}>Demolish</button>`;
  };
  const plotBar = (kind) => {
    const cap = plotCap(b, kind), used = plotsUsed(b, kind);
    return `<div class="spread"><b>${PLOT_NAMES[kind]}s</b><span class="${cap && used >= cap ? "warn" : "muted"}">${used} of ${cap} used</span></div>${cap ? bar(Math.min(100, (used / cap) * 100), used > cap ? "var(--danger)" : "var(--accent)") : `<div class="muted">None at a ${tierName(b).toLowerCase()}.</div>`}`;
  };
  const sizes = [["shelter", "Shelter"], ["outpost", "Outpost"], ["hub", "Main hub"]].map(([k, n]) => `${n} ${PLOTS[k].building} / ${PLOTS[k].utility}`).join(" · ");
  // A bunkhouse can be expanded into a barracks where it stands (12 beds instead of 6, no new plot: BARRACKS_UP).
  const expandBtn = (x) => {
    if (b.construction.some((c) => c.target === x.id)) return `<span class="chip">Expanding</span>`;
    const chk = canExpandBunkhouse(state, b, x.id);
    return `<button class="mini" data-action="bunk-expand" data-base="${b.id}" data-id="${x.id}" ${chk.ok ? "" : "disabled"}${tip(`Expand it into a barracks where it stands: 12 beds instead of 6, no new plot. ${costText(BARRACKS_UP.cost)}, ${BARRACKS_UP.hours} work-hours; its 6 beds stay in use meanwhile.${chk.ok ? "" : ` ${chk.reason}.`}`)}>Expand</button>`;
  };
  // An ammo bench can be upgraded into a reloading bench where it stands (sim/reloading.js).
  const reloadBtn = (x) => {
    if (b.construction.some((c) => c.target === x.id)) return `<span class="chip">Upgrading</span>`;
    const chk = canUpgradeAmmoBench(state, b, x.id);
    return `<button class="mini" data-action="reload-up" data-base="${b.id}" data-id="${x.id}" ${chk.ok ? "" : "disabled"}${tip(`Upgrade it into a reloading bench where it stands: rounds by calibre and type (hollow points, slugs, match, AP) from brass, powder and primers by standing orders; common rounds from scrap as before when there is no order to work; a quarter of the Heat. ${costText(RELOAD.UP.cost)}, ${RELOAD.UP.hours} work-hours, a Mechanics 3+ survivor here.${chk.ok ? "" : ` ${chk.reason}.`}`)}>Upgrade</button>`;
  };
  // What stands on the plots, the barrels apart (their own card).
  const plotList = (kind) => {
    const list = b.buildings.filter((x) => BUILDINGS[x.type] && BUILDINGS[x.type].plot === kind && x.type !== "water_barrel");
    return list.length ? list.map((x) => `<div class="spread small"><span${tip(BUILDINGS[x.type].desc)}>${esc(BUILDINGS[x.type].name)}${x.broken ? ` <span class="chip off">Broken</span>` : ""}</span><span class="row">${x.type === "bunkhouse" ? expandBtn(x) : ""}${x.type === "ammo_bench" ? reloadBtn(x) : ""}${demolishBtn(x)}</span></div>`).join("") : `<div class="muted small">Nothing yet.</div>`;
  };
  const holdsSel = (x) => `<select data-action="barrel-holds" data-base="${b.id}" data-id="${x.id}"${tip("Un-purified: room for the well, rain and river water. Purified: room only safe water may use (the water filters' surplus, bottled water brought home), never crowded out by the well's water. Switching moves nothing: water of the other kind goes to the tanks, or stands outside if they are full.")}><option value="rawwater" ${barrelHolds(x) === "rawwater" ? "selected" : ""}>Un-purified</option><option value="water" ${barrelHolds(x) === "water" ? "selected" : ""}>Purified</option></select>`;
  const barrelCard = () => {
    const list = barrels(b);
    const tiers = WATER_BARREL.tiers.slice(1).map((t, i) => `${i + 1}. ${t.name} ${t.cap}`).join(" → ");
    return `<div class="card small"${tip(BUILDINGS.water_barrel.desc)}>
      <div class="spread"><b>Water barrels</b><span class="muted">${list.length}/${BUILDINGS.water_barrel.max}</span></div>
      <div class="muted">${tiers} water. Each keeps room for one kind.</div>
      ${list.map((x, i) => {
        const up = canUpgradeBarrel(state, b, x.id);
        const queuedUp = b.construction.some((c) => c.target === x.id);
        const next = WATER_BARREL.tiers[barrelTier(x) + 1];
        const upBtn = queuedUp ? `<span class="chip">Upgrade queued</span>` : next ? `<button class="mini" data-action="barrel-up" data-base="${b.id}" data-id="${x.id}" ${up.ok ? "" : "disabled"}${tip(`${next.name} (${next.cap} water): ${next.desc}. ${costText(next.cost)}, ${next.hours} work-hours.${up.ok ? "" : ` ${up.reason}.`}`)}>Upgrade</button>` : `<span class="chip on">Top tier</span>`;
        return `<div class="row" style="margin-top:0.3rem;gap:0.4rem;flex-wrap:wrap"><span style="flex:1;min-width:8rem">${i + 1}. ${esc(barrelName(x))} <span class="muted">${barrelCap(x)}${x.broken ? " · broken" : ""}</span></span>${holdsSel(x)}${upBtn}${demolishBtn(x)}</div>`;
      }).join("")}
    </div>`;
  };
  const buildCard = (k, d) => {
    const chk = canBuild(state, b, k);
    return `<div class="card small"${tip(d.desc)}>
      <div class="spread"><b>${d.name}</b><button class="mini" data-action="queuebuild" data-base="${b.id}" data-type="${k}" ${chk.ok ? "" : "disabled"}${tip(chk.ok ? "Pay now; builders do the rest" : chk.reason)}>Build</button></div>
      <span class="muted">${costText(d.cost)} · ${d.hours} work-hours · have ${count(b, k)}/${d.max}${chk.ok ? "" : ` · ${esc(chk.reason)}`}</span>
      ${lockLine(state, b, "building", k)}
    </div>`;
  };
  const up = tierUpType(b);
  const types = Object.entries(BUILDINGS).filter(([k, d]) => (!d.shelterOnly || isShelter(b)) && (!d.tierUp || k === up)).sort(([ka], [kb]) => (isShelter(b) ? (kb === up) - (ka === up) : 0));
  const section = (title, list) => `<h3>${title}</h3>${list.map(([k, d]) => buildCard(k, d)).join("") || `<div class="muted small">None.</div>`}`;
  const free = (kind) => Math.max(0, plotCap(b, kind) - plotsUsed(b, kind));
  const freeText = (kind) => `<span class="muted small">(${free(kind)} ${PLOT_NAMES[kind].toLowerCase()}${free(kind) === 1 ? "" : "s"} free)</span>`;
  return `<div class="grid2">
    <div>
      <h3>Plots</h3>
      <div class="card small"${tip("Every building stands on a plot. Building plots: anything with a roof (bunkhouses and barracks, the storehouse, cellars, workshops, the hospital). Utility plots: the small things in the yard (the boiler, water barrels, storage crates, the watchtower, the cook fire, rain catchers, benches). Walls, defences and farm plots need none. A hospital keeps its plot when upgraded; a barrel's upgrades stay on its plot, and so does a bunkhouse expanded into a barracks.")}>
        ${plotBar("building")}
        <div style="margin-top:0.4rem">${plotBar("utility")}</div>
        <div class="muted" style="margin-top:0.4rem">By base size (building / utility): ${sizes}. Demolish a building to free its plot.</div>
      </div>
      <h3>Queue ${undoBtn(state, ui, "build", b.id)}</h3>
      <div class="small muted" style="margin-bottom:0.4rem">${builders.length ? `Builders: ${builders.map((x) => first(x) + bedTag(x)).join(", ")} (${n1(rate)} work-hours per hour${builders.some((x) => x.inBed) ? "; people in a hospital bed do not build" : ""})` : "No builders. Set someone's role to Build."}</div>
      ${b.construction.length ? b.construction.map((job, i) => {
        const left = job.hours - job.progress;
        elapsed += left;
        const eta = rate > 0 ? Math.ceil(elapsed / rate) : null;
        const plot = BUILDINGS[job.type].plot;
        return `<div class="card small">
          <div class="spread"><b>${i === 0 ? "▶ " : ""}${esc(buildJobName(job))}</b><span>${buildMoveBtns(b, i)}<button class="mini" data-action="cancelbuild" data-base="${b.id}" data-id="${job.id}"${tip("Cancel and get half the materials back")}>Cancel</button></span></div>
          ${bar((job.progress / job.hours) * 100, "var(--accent)")}
          ${job.paid ? `<div>${gatherRows(job).map((r) => `<span class="${r.ok ? "good" : "warn"}">${r.ok ? "✓" : "○"} ${esc(matName(r.key))} ${n0(r.have)}/${r.need}</span>`).join(" · ")}${gatherStalled(job) ? ` <span class="warn">· waiting for the materials (taken from the stores as they come in)</span>` : ""}</div>` : ""}
          <span class="muted">${i === 0 ? `${n1(left)} work-hours left` : "Waiting in queue"} · ${eta != null ? `done in about ${eta}h` : "paused"}${plot && !job.target ? ` · ${PLOT_NAMES[plot].toLowerCase()}` : ""}</span>
        </div>`;
      }).join("") : `<div class="muted small">Nothing queued.</div>`}
      <h3>On the building plots</h3>
      <div class="card small">${plotList("building")}</div>
      <h3>On the utility plots</h3>
      <div class="card small">${plotList("utility")}</div>
      ${barrels(b).length ? barrelCard() : ""}
    </div>
    <div>
      ${section(`Buildings ${freeText("building")}`, types.filter(([, d]) => d.plot === "building"))}
      ${section(`Utilities ${freeText("utility")}`, types.filter(([, d]) => d.plot === "utility"))}
      ${section(`Walls, defences and fields <span class="muted small">(no plot)</span>`, types.filter(([, d]) => !d.plot))}
    </div>
  </div>`;
}

// ⚙: the gun builder on a gun (ui/gunbuilder.js), never during a battle.
const gunCog = (state, g, loc) => (g && isGunKey(g.key) && !state.combat ? ` <a class="link" data-action="gb-open" data-loc="${loc}"${tip(`Modify the ${g.name}: the gun builder (its parts, the ammo it is loaded with, how reliable it is)`)}>⚙</a>` : "");
function baseArmory(state, b) {
  const people = atBase(state, b.id);
  const slots = ["weapon", "armor", "tool"];
  return `
    ${teamsHereCard(state, b)}${bodiesCard(state, b)}
    <h3>Stored here (${b.armory.length})</h3>
    <div class="small">${b.armory.length ? b.armory.map((g, i) => `<span class="chip"${tip(gearTip(g))}>${esc(g.name)}${g.quality < 1 ? ` (${Math.round(g.quality * 100)}%)` : ""}${durTag(g)}${gunCog(state, g, `armory:${b.id}:list:${i}`)}</span>`).join("") : "<span class='muted'>Empty. Gear your teams bring home (and crafted gear) lands here.</span>"}</div>
    <h3>Equipment</h3>
    ${people.length ? `<table class="t"><tr><th>Survivor</th>${slots.map((s) => `<th>${SLOT_NAMES[s]}</th>`).join("")}<th${tip("Head, arms, legs and pack (inventory.js). Open the inventory to change them, fill pockets and packs, or swap with others here.")}>Worn and carried</th></tr>${people.map((s) => `<tr>
      <td><a data-action="survivor" data-id="${s.id}" class="link">${esc(s.name)}</a>${stIcons(state, s)}<br><span class="small muted">Shoot ${skill(s, "shooting")} · Stealth ${skill(s, "stealth")} · Combat ${combatPower(s).toFixed(1)}</span></td>
      ${slots.map((slot) => {
        const cur = s.gear[slot];
        return `<td class="small">${cur ? `<span${tip(gearTip(cur))}>${esc(cur.name)}${durTag(cur)}</span>${slot === "weapon" ? gunCog(state, cur, `s:${s.id}:weapon`) : ""}<br>${gapLabel(s, cur)}` : "<span class='muted'>—</span>"}<div class="row" style="margin-top:0.2rem">${gearControls(state, b, s, slot)}</div></td>`;
      }).join("")}
      <td class="small">${ensureInv(s) && ["head", "arms", "legs", "backpack"].map((k) => s.gear[k]).filter(Boolean).map((g) => `<span class="chip"${tip(gearTip(g))}>${esc(g.name)}${durTag(g)}</span>`).join("") || "<span class='muted'>—</span>"}
        <div class="muted">Armor ${Math.round(armorPower(s) * 10) / 10} · pockets ${s.pockets.filter(Boolean).length}/${s.pockets.length}</div>
        <button class="mini" data-action="inv-open" data-id="${s.id}"${tip("Open the paper-doll inventory")}>Inventory</button></td></tr>`).join("")}</table>` : `<div class="muted small">Nobody is here to equip.</div>`}
    ${keyRingCard(state)}`;
}

// Bodies brought home in a team's car (sim/carriers.js): bury (their things to the armory) or burn (nothing kept).
// One with the worm in it, left unburied, gets up in the night.
function bodiesCard(state, b) {
  const list = b.bodies || [];
  if (!list.length) return "";
  return `<h3>Brought home (${list.length})</h3><div class="card small">${list.map((body) => `<div class="spread" style="margin-bottom:0.3rem"><span><b>${esc(body.name)}</b>'s body${body.worm && !body.safe ? ` <span class="danger"${tip("The worm is in it: left unburied it gets up in the night and hurts someone.")}>the worm is in it</span>` : ""}<br><span class="muted">${body.items.length ? `On them: ${body.items.map((g) => esc(g.name)).join(", ")}` : "Nothing on them"}${Object.values(body.supplies || {}).some((v) => v > 0) ? `, ${Object.entries(body.supplies).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${SUPPLIES[k] ? SUPPLIES[k].name.toLowerCase() : k}`).join(", ")}` : ""}</span></span>
    <span class="row"><button class="mini" data-action="burybody" data-base="${b.id}" data-id="${body.id}"${tip("Crush the skull and bury them. Their things go to the armory.")}>Bury</button><button class="mini" data-action="burnbody" data-base="${b.id}" data-id="${body.id}"${tip("Burn the body with everything on it. Nothing is kept, and the worm is surely gone.")}>Burn</button></span></div>`).join("")}</div>`;
}

// ---------- crafting (hand-made, no station) ----------
function baseCrafting(state, b) {
  const people = atBase(state, b.id);
  const crew = crafters(state, b);
  const q = craftQueue(b);
  const others = people.filter((s) => s.role !== "craft");
  const abed = people.filter((s) => s.role === "craft" && s.inBed); // on the Craft role but in a hospital bed
  let elapsed = 0;
  return `<div class="grid2">
    <div>
      <h3>Crafters</h3>
      <div class="card small">
        ${crew.length || abed.length ? [...crew, ...abed].map((s) => `<div class="spread"><span>${esc(s.name)}${bedTag(s)} <span class="muted"${tip("Crafting sets the speed, the expected condition and how far a roll can stray from it; a recipe's own skill (Mechanics, Medicine, Stealth) is only its minimum.")}>Crafting ${skill(s, "crafting")} · Mechanics ${skill(s, "mechanics")} · Medicine ${skill(s, "medicine")}</span></span>${roleSelect(state, s)}</div>`).join("") : `<span class="muted">Nobody on the Craft role.</span>`}
        <div class="muted" style="margin-top:0.3rem"${tip(benchType(b) ? BUILDINGS[benchType(b)].desc : BUILDINGS.craftbench.desc)}>${benchType(b) ? `${esc(BUILDINGS[benchType(b)].name)}: crafters work ${Math.round((BENCH[benchType(b)].rate - 1) * 100)}% faster, gear comes out +${Math.round(BENCH[benchType(b)].quality * 100)}% condition${BENCH[benchType(b)].workshop ? ", workshop recipes open" : ""}.` : hasBench(b) ? "No crafting bench: the workshop here does for one (no bonus). Build a crafting bench (Construction, a utility plot) to work faster and better." : `<span class="warn">No crafting bench: only the simple Field recipes can be made here.</span> Build one in Construction (a utility plot, ${Object.entries(BUILDINGS.craftbench.cost).map(([k, v]) => `${v} ${k === "parts" ? (v === 1 ? "part" : "parts") : k}`).join(" and ")}, ${BUILDINGS.craftbench.hours} work-hours).`}</div>
        ${others.length ? `<div style="margin-top:0.3rem"><select data-action="craftop"${tip("Set someone's role to Craft")}><option value="">Add a crafter…</option>${others.map((s) => `<option value="${s.id}">${esc(s.name)} (Crafting ${skill(s, "crafting")}, Mechanics ${skill(s, "mechanics")}, Medicine ${skill(s, "medicine")}, now ${ROLES[s.role]?.name || s.role})</option>`).join("")}</select></div>` : ""}
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
          <span class="muted">${n1(left)} of ${job.hours} work-hours left · ${why ? `<span class="danger">${esc(why)}</span>` : eta != null ? `about ${eta}h at the current pace${r.gear && craftMean(state, b, job.recipe) != null ? ` · condition about ${Math.round(craftMean(state, b, job.recipe) * 100)}% (a roll: Crafting narrows it)` : ""}` : "paused"}</span>
        </div>`;
      }).join("") : `<div class="muted small">Nothing queued.</div>`}
      <div class="small muted" style="margin-top:0.4rem">Crafters work on the first job they have the skill for. Finished gear goes to the armory; equip it in the Armory tab. Makeshift gear is weaker than the real thing and breaks after a number of uses. Every finished craft gives Crafting XP: more for weapons and armor, for dearer materials and for a better result.</div>
      ${craftOrdersCard(state, b)}
    </div>
    <div>
      <h3>Recipes</h3>
      <div class="small muted" style="margin-bottom:0.4rem">${hasWorkshop(b) ? "A workshop is here: workshop recipes are open (and come out a bit better)." : "No workshop here: recipes marked Workshop need a workbench, ammo bench or machine shop at this base."} ${hasBench(b) ? "" : "Recipes marked Bench need a crafting bench here."}</div>
      ${Object.keys(CRAFTS).map((k) => {
        const r = CRAFTS[k];
        const chk = canCraft(state, b, k);
        const d = r.gear ? GEAR[r.gear] : null;
        const edge = craftEdge(state, k);
        return `<div class="card small"${tip(d ? `${d.desc || ""} Worth: ${worthTier({ key: r.gear, quality: 1 })}.` : r.desc)}>
          <div class="spread"><b>${esc(craftName(k))}</b><span>${r.needs === "workshop" ? `<span class="chip"${tip("Needs a workbench (or better), an ammo bench or a machine shop at this base")}>Workshop</span>` : r.needs ? `<span class="chip"${tip(`Needs a ${BUILDINGS[r.needs] ? BUILDINGS[r.needs].name.toLowerCase() : r.needs} at this base`)}>${esc(BUILDINGS[r.needs] ? BUILDINGS[r.needs].name : r.needs)}</span>` : ""}${benchNeeded(r) ? `<span class="chip"${tip("Needs a crafting bench (or better) at this base")}>Bench</span>` : ""}${r.field ? `<span class="chip"${tip("Simple enough for a team to make on the road from what it carries")}>Field</span>` : ""}<button class="mini" data-action="queuecraft" data-base="${b.id}" data-recipe="${k}" ${chk.ok ? "" : "disabled"}${tip(chk.ok ? "Pay the materials now; crafters do the rest" : chk.reason)}>Craft</button></span></div>
          <span class="muted">${esc(craftInText(r))} · ${r.hours} work-hours · ${SKILL_NAMES[r.skill]} ${r.min}+${r.cmin ? ` · Crafting ${r.cmin}+` : ""}</span>${edge.n ? ` <span class="chip on"${tip(`From ${edge.from.join(" and ")}: +${Math.round(edge.quality * 100)}% condition, ${Math.round((edge.speed - 1) * 100)}% faster.`)}>Edge +${Math.round(edge.quality * 100)}%</span>` : ""}<br>
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
      <div class="spread"><b>${esc(v.name)}</b><span class="muted"${tip(`Riders (${RIDER_KG} kg each), what they wear and the cargo; loaded past 60% it burns more fuel (×1.3 at 100%, up to ×1.6 at 125%, the most it takes).${upgradeText(v) ? ` Its upgrades weigh ${VEHICLE_TYPES[v.type].payload - payloadOf(v)} kg of the ${VEHICLE_TYPES[v.type].payload}.` : ""} Worth about ${vehicleValue(v)} in trade.`)}>${payloadOf(v)} kg payload</span></div>
      ${upgradeText(v) ? `<div class="small"${tip(upgradeEffects(v))}>🛡 ${esc(upgradeText(v))}</div>` : ""}
      <div class="row"><span style="width:5.5rem" class="muted"${tip("Low condition means more breakdowns on the road")}>Condition</span><div style="flex:1">${bar(v.condition, v.condition < 35 ? "var(--danger)" : "var(--good)")}</div><span style="width:3rem">${Math.round(v.condition)}%</span></div>
      <div class="row"><span style="width:5.5rem" class="muted">Fuel</span><div style="flex:1">${bar((v.fuel / tank(v)) * 100, "var(--accent)")}</div><span style="width:3rem">${n0(v.fuel)}/${tank(v)}</span></div>
      <div class="row" style="margin-top:0.3rem">
        <button class="mini" data-action="refuel" data-base="${b.id}" data-id="${v.id}" ${v.fuel >= tank(v) || (b.stock.fuel || 0) < 1 ? "disabled" : ""}${tip(`Fill the tank from this base's fuel (${n0(b.stock.fuel)} in stock)`)}>Refuel</button>
        <button class="mini" data-action="repairv" data-base="${b.id}" data-id="${v.id}" ${rep.ok && carPartsCost((k) => b.stock[k] || 0, 1).ok && v.condition < 100 ? "" : "disabled"}${tip(rep.ok ? `${carPartsText(1)} → +${rep.per} condition` : "Needs a garage or a Mechanics 4+ survivor here")}>Repair (1 car part)</button>
        <button class="mini" data-action="stripv" data-base="${b.id}" data-id="${v.id}"${tip(`Take it apart for good: ${stripYield(v).carparts} car parts (by its condition), ${stripYield(v).scrap} scrap and the fuel in its tank. The vehicle is gone.`)}>Strip for parts</button>
      </div>${garageRow(state, b, v)}</div>`).join("") : `<div class="muted small">No vehicles parked here.</div>`}
    ${garageJobs(state, b)}
    ${elsewhere.length ? `<h3>Elsewhere</h3>${elsewhere.map((v) => `<div class="card small"><b>${esc(vehicleLabel(v))}</b> · ${where(v)}</div>`).join("")}` : ""}`;
}

// Upgrades in the garage (sim/vehicles.js): fit or strip glass, mesh grilles, armour plate, scrap plating.
function garageRow(state, b, v) {
  const opts = upgradeOptions(state, b, v);
  if (!opts.length) return "";
  const what = (o) => o.op === "strip"
    ? `${o.hours}h, Mechanics ${o.mech}+; back: ${Object.entries(o.refund || {}).map(([k, q]) => (k === "spareGlass" ? "the glass, whole" : k === "lmg" ? "the LMG it was built round" : costText({ [k]: q }))).join(", ") || "nothing"}`
    : `${o.spare ? "a spare glass set from this base" : costText(o.cost)}${o.items && o.items.length ? `, an unused ${o.items.map((k) => (k === "lmg" ? "light machine gun (LMG)" : k)).join(", ")} from the armory` : ""}, ${o.hours}h, Mechanics ${o.mech}+${o.shop ? `, ${SHOP_TEXT[o.shop]}` : ""}; +${o.kg} kg`;
  return `<div class="row" style="flex-wrap:wrap;gap:0.25rem;margin-top:0.3rem"><span class="small muted"${tip("Garage jobs: the materials are paid when queued; people on the Craft role with the Mechanics level do the work. Stripping refunds half the car parts, and bulletproof glass comes out whole. An LMG turret is built round an unused LMG from the armory and gives it back when stripped; an M2 is bolted to its military vehicle for good.")}>Garage:</span>${opts.map((o) => `<button class="mini" data-action="vupgrade" data-base="${b.id}" data-id="${v.id}" data-key="${o.key}" data-op="${o.op}" ${o.ok ? "" : "disabled"}${tip(`${o.name}: ${what(o)}.${o.ok ? "" : ` ${o.why}`}`)}>${esc(o.name)}</button>`).join("")}</div>`;
}
function garageJobs(state, b) {
  const q = garageQueue(b);
  if (!q.length && !b.spareGlass) return "";
  return `<h3>Garage</h3>${b.spareGlass ? `<div class="small muted">${b.spareGlass} spare set${b.spareGlass === 1 ? "" : "s"} of bulletproof glass (fitted again with no materials).</div>` : ""}${q.map((j) => {
    const v = vehicleById(state, j.vehicleId), why = garageJobStatus(state, b, j);
    return `<div class="card small"><div class="spread"><b>${j.op === "strip" ? "Strip" : "Fit"} ${esc(j.key === "turret" ? "turret" : j.key === "scrapPlate" ? "scrap plating" : j.key === "plating" ? "armour plate" : j.key === "mesh" ? "mesh grilles" : "bulletproof glass")} · ${esc(v ? v.name : "?")}</b><button class="mini" data-action="vgaragecancel" data-base="${b.id}" data-id="${j.id}">Cancel</button></div>
      <div class="row"><div style="flex:1">${bar((j.progress / j.hours) * 100, "var(--accent)")}</div><span style="width:4rem">${Math.floor(j.progress)}/${j.hours}h</span></div>${why ? `<div class="small warn">${esc(why)}</div>` : ""}</div>`;
  }).join("")}`;
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
      <span><b>${s.leader ? "★ " : ""}${esc(s.name)}</b>${stIcons(state, s)} <span class="muted small">HP ${n0(s.health)} · ⚔ ${combatPower(s).toFixed(1)} · ${note ? `<span class="danger">${esc(note)}</span>` : ROLES[s.role]?.name || s.role}</span><br>
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
