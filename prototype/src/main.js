// Entry point: game loop, input, and the action dispatcher that connects the UI to the simulation.
import { haulAdd, haulDel, haulVeh, haulFormChange } from "./ui/hauling.js"; // the Hauling panel's actions
import { togglePeopleIdle, assignIdlePreview } from "./ui/activity.js"; // the People tab's Idle filter, Assign all idle
import { gearOutdoorWorkers, gearText } from "./sim/tripgear.js"; // the Work now panel's Gear outdoor workers (trips-plus #2)
import { applyIdlePlan } from "./sim/idlework.js";
import {
  createWorld, worldMapCached, isPreview, tickHour, hub, survivorById, baseById, log, day, atBase, factionById, addCard, newId, renameSurvivor, assignStartingRoles, archerCount, ARROWS,
} from "./sim/world.js";
import { GEAR, SUPPLIES, SUPPLY_KEYS } from "./sim/data.js";
import * as Parties from "./sim/parties.js";
import { abandonProblem, abandonCard } from "./sim/occupy.js"; // Abandon outpost
import { launchExpedition, estimateTrip, ordersCard, orderMove, startReturn, planPath, partyTile, setClockFrac, arrivalsDue } from "./sim/parties.js";
import { stockHas } from "./sim/water.js"; // purified and un-purified water
import { moveTeamOut, MOVE_OUT } from "./sim/moveout.js"; // a team moved out of a crowded base (the move-out planner)
import { thirstAhead } from "./sim/weather.js";
import { armoryTabs, TABS_TRIP_DAYS } from "./sim/worm.js"; // purification tablets for the road
import { searchHour, extract, engagementParty } from "./sim/scavenge.js";
import { engScout, engWaitNight } from "./sim/raidplan.js"; // before the search: a scout first, or the night
import { planEsc, kitUp } from "./ui/raidplan.js"; // before a raid: Esc brings the Before you go in window back; its kit windows stay up over the battle
import * as TradeSim from "./sim/trade.js";
import { executeTrade, giftAll, proposePact, endTrade, radioTalk } from "./sim/trade.js";
import { releaseEscorts, ESCORTS } from "./sim/economy.js";
import { queueBuild, cancelBuild, assignStations, queueBarrelUpgrade, setBarrelHolds, demolish, queueBunkhouseExpand, BUILDINGS, demolishRefund } from "./sim/buildings.js";
// What pulling a building down gives back, for the question (sim/buildings.js demolishRefund).
const demolishText = (bld) => { try { const r = demolishRefund(bld) || {}; return Object.entries(r).filter(([, q]) => q > 0).map(([k, q]) => `${q} ${k}`).join(", ") || "nothing"; } catch { return "some of it"; } };
import { refuel, repair, queueUpgrade, cancelGarageJob, stripVehicle } from "./sim/vehicles.js";
import { buryBody, burnBodyHome } from "./sim/carriers.js"; // bodies brought home in a team's car
import {
  saveSupplyRun, dispatchSupplyRun, supplyRunById, jobForm, releaseHeld, pauseSupplyRun, deleteSupplyRun,
} from "./sim/supply.js";
import { treatAtBase } from "./sim/medical.js";
import { makeMedic } from "./sim/training.js"; // "Make medic" for a graduated trainee
import { queueCraft, cancelCraft, craftQueue } from "./sim/crafting.js";
import { initRenderer, render, resize, centerOn, screenToTile, zoomAt, camera, view, tileTooltip, resetView, mapLoc, HEX } from "./ui/render.js";
import { setPoiReveal } from "./sim/pois.js"; // the dev tools' Reveal map shows every point of interest
import { workerAt } from "./ui/workermap.js"; // the base workers on the map: their tooltip, a click opens the person
import { keyHint, devText, pickWord, escCancels, kh, padHtml } from "./ui/hints.js"; // the key hints in the words of the device in use: the banners, the tips
import { fieldworksActions, fieldworksChange, fwPlaceTiles, fwPlaceBanner, fwPlaceClick, fwPlaceCancel, teamFieldItems } from "./ui/fieldworks.js";
import { fwAt as fieldWorkAt, FIELD, placeProblem, planFieldWork } from "./sim/fieldworks.js"; // field works: the base tab, the tile picker
import { topbarParts, renderLeft, renderRight, renderLog, renderModal, modalKind, renderLegend, tileActions, plannerLoad, plannerVehicle, routeCheck } from "./ui/ui.js";
import { needsSkeleton, initNeedsBar, NB_ACTIONS } from "./ui/needsbar.js"; // the top bar's Needs button and its list of every supply
import { threatSkeleton, initThreatBar, THREAT_ACTIONS } from "./ui/threatbar.js"; // the top bar's 7-day threat forecast
import { isCar, travelMode } from "./sim/vehicles.js";
import { startCombat, combatAct, runEnemyPhase } from "./sim/combat.js";
import { queueOrder, startOrder, stopTask, resumeQueue, removeQueued, reorderQueued, cancelMove, contactable, queueEndTile, describeOrder } from "./sim/orders.js";
import { startExitWalk } from "./sim/poiwalk.js"; // the POI dialogue's "Leave for another tile…": the walk out to the tile's edge first
import { tileViewFrame } from "./ui/poipick.js"; // the tile view: the team walking on its tile
import { setNightPlan } from "./sim/nightmarch.js"; // the team panel's night plan
import { strikeCamp, STRIKE_LABEL, layoutDone } from "./sim/staging.js"; // camps: Strike camp (the base window, the tile panel)
import { setFire } from "./sim/fieldheat.js";
import { commandable, NO_RADIO } from "./sim/plans.js";
import { PLAN_ACTIONS, PLAN_CHANGE, planAutofill, planLaunchOpts, applyPreset } from "./ui/plan.js";
import { orderSweepAt, sweepOpts } from "./sim/survey.js";
import { armedList } from "./ui/expedition.js";
import { boatOrder, boatPlan, boatTip, crossingTo } from "./sim/crossing.js";
import { fishSpot, gameAbundance } from "./sim/hunting.js";
import { forageAbundance } from "./sim/foraging.js";
import { woodAbundance } from "./sim/woodcutting.js";
import { canClaim, wellProblem, CLAIM } from "./sim/claims.js"; // land claims and wells (the right-click menu)
import { initCombatUI, drawCombat, renderCombatPanel, renderCombatBar, raidLayout, renderRaidTop, renderRaidCards, renderRaidLog, renderRaidLogFoot, combatTick, combatMouse, combatClick, combatKey, combatKeyUp, combatAction, combatPress, combatRelease, combatWheel, combatPan, combatLeave, combatTap, combatTapChip, cui, padCur, combatPadOn, combatPadOff, combatPadMove, combatPadFrame, combatPadA, combatPadB, combatPadCycle, combatPadEnd, combatPadZoom } from "./ui/combat.js";
import { defaultCustom, cleanCustom, clampCustomCount, isCustomRun, startsWithVehicle } from "./sim/custommode.js"; // Custom mode and Start with a vehicle (2026-10-24)
import { defaultFleet, fleetText } from "./sim/startfleet.js"; // the starting vehicles: each its kind, point limit and back (2026-10-24)
import { isCrashRun } from "./sim/crashmode.js"; // Crashlanding (2026-10-24): a normal-mode run with state.crash, the screen's fourth mode
import { LOOK_ACTIONS, LOOK_CHANGE_ACTIONS, crewSnapshot, randomizeAllCrew, randomizeEverything, randomizeGear, randomizeOne, rerollCarried, randomBackground, rollRandomRun, ironmanCrew, crewCustomized, crewWithBackground, crewWithBackgrounds, blankCrew, backToSetup, stashModeSet, takeModeSet, crashSizeDef, generating, generatingUp } from "./ui/newgame.js"; // crashSizeDef: Crashlanding's map defaults (runOpts); generating: the "Generating map…" box over every world build (gen)
import { CUSTOM_POINTS, clampMax, overText } from "./sim/custompoints.js"; // Customize: everything costs points
import { BG_ACTIONS, BG_CHANGE, BG_INPUT, customLibrary } from "./ui/backgrounds.js"; // custom backgrounds (sim/custombg.js), not in Ironman
import { WC_ACTIONS, WC_CHANGE, uiCfg, wcChanged } from "./ui/worldcfg.js"; // World…: the run's dials (sim/worldcfg.js), into the world as it is built
import { cleanCfg, isDefaultCfg, cfgSummary } from "./sim/worldcfg.js";
import { SG_ACTIONS, SG_CHANGE, GP_INPUT, loadDice } from "./ui/startgear.js"; // starting gear picked under Customize (sim/startgear.js)
import { clearStartGear } from "./sim/startgear.js";
import { loadUpAll } from "./sim/itemacts.js"; // physical rounds out of a fight: loaded at Start
import { DEFAULT_SIZE, sizeDef, clampGroups, clampHives, customDef, clampCustomW, clampCustomH, BASE_W, BASE_H } from "./sim/worldsize.js";
import { INV_ACTIONS, INV_CHANGE, invDrop } from "./ui/inventory.js";
import { ITEMMENU_ACTIONS, itemMenuHtml, openItemMenu, closeItemMenu } from "./ui/itemmenu.js"; // right-click on an item in an inventory view
import { BOX_ACTIONS, boxViewHtml } from "./ui/boxview.js"; // an opened lock box or case: a window of what is inside
import { ARMV_ACTIONS, ARMV_INPUT } from "./ui/armoryview.js"; // the armory list: grouped, cards or compact rows
import { TEAMINV_ACTIONS, TEAMINV_CHANGE, UNPACK_ACTIONS, unpackUp } from "./ui/teaminv.js"; // the team inventory, Drop off and Load at a base
import { TEAMMEET_ACTIONS, TEAMMEET_CHANGE } from "./ui/teammeet.js"; // teams together on a tile: people, goods, merge
import { toggleFleetIds, leadId } from "./ui/fleetpick.js"; // the planners' vehicle picker (up to four)
import { TEAMFORM_ACTIONS, TEAMFORM_CHANGE, teamFormDrop, teamFormKey, teamFormEsc, formTeamCtx } from "./ui/teamform.js"; // Form a team at a base; Edit team
import { CARRY_ACTIONS, CARRY_CHANGE, carryHtml, askQty, carryKey } from "./ui/carry.js"; // supplies in pockets, packs and arms; the ground; how much to collect
import { LAND_ACTIONS, LAND_CHANGE, landHtml, askLand, landKey, asksHours } from "./ui/landorder.js";
import { callBack, detach, isSome, splittable } from "./sim/detach.js";
import { isLandJob } from "./sim/landest.js"; // some of a team out on a job of their own: Call back // Forage, Hunt, Fish, Cut wood, Gather stone: how many hours, and what they would bring
import { renameBase } from "./sim/basenames.js";
import { BN_ACTIONS, BN_INPUT, bnKey, nameModalUp } from "./ui/basename.js"; // naming a base you found, renaming any base
import { CS_ACTIONS, siteViewDue, siteGenWhat } from "./ui/campsite.js"; // the camp's spot on its tile's 500 × 500 map, in the isometric view
import { stackKey, stackInput, stackWheel, dropPoint } from "./ui/stackmove.js"; // the stack mover: Enter / Esc, the slider live, the wheel, the drop popover
import { GB_ACTIONS, GB_CHANGE } from "./ui/gunbuilder.js"; // the gun builder
import { FARM_ACTIONS, FARM_CHANGE } from "./ui/farming.js";
import { COOK_ACTIONS, COOK_CHANGE } from "./ui/cooking.js"; // wave 2 cooking: the stations' bills
import { PROD_ACTIONS, PROD_CHANGE } from "./ui/production.js";
import { queueReloadUpgrade } from "./sim/reloading.js"; // the reloading bench
import { queueCannerUpgrade, queueGenUpgrade } from "./sim/buildings.js";
import { widenRing, refreshBaseMap } from "./sim/basemap.js"; // the Defenses tab's Widen the ring (the wall pieces the game places) // machines-2: the pressure canner fitted to a preserving room; gen-tiers: a generator upgraded
import { HEALTH_ACTIONS, HEALTH_CHANGE } from "./ui/health.js";
import { SKILL_ACTIONS, SKILL_CHANGE } from "./ui/skills.js";
import { TRADE_ACTIONS, TRADE_CHANGE_ACTIONS, meetPickBanner, meetPickClick, meetPickCancel, openMeetPlan } from "./ui/tradewindow.js";
import { radioDeals } from "./sim/radiotrade.js"; // radio deals your caravan fetches
import { VISITOR_ACTIONS } from "./ui/visitors.js";
import { DIPLO_ACTIONS, DIPLO_CHANGE } from "./ui/diplomacy.js";
import { VOL_ACTIONS, VOL_CHANGE, openVolPick, plannerVolAsk } from "./ui/volunteers.js"; // volunteers: asking a group for people, a group's ask of you
import { renderDevPanel, devSample, DEV_SPEEDS } from "./ui/devtools.js";
import { TL_ACTIONS, tlFrame, tlKey, closeTimelapse } from "./ui/timelapse.js";
import { REL_ACTIONS } from "./ui/relations.js";
import { PRISON_ACTIONS, PRISON_CHANGE } from "./ui/prisoners.js";
import { openNegotiation, sendHandover, dealsOf } from "./sim/ransom.js"; // ransoms for your captives (the People tab)
import { setAutopilot, setPersonality, autopilotResolve } from "./sim/autopilot.js";
import { playerTile } from "./sim/hardcore-start.js";
import { startWhyNot } from "./sim/startpick.js"; // Pick start on map: can a tile be the start
import { freshRng } from "./sim/appearance.js"; // Random run: dice of their own for the settings
import { START_PEOPLE, NORMAL_PEOPLE, clampStartPeople, peopleRange } from "./sim/hardcore.js";
import { setTeamPolicy } from "./sim/breakoff.js";
import { noteNames } from "./ui/names.js";
import { renderLogPanel, DIARY_ACTIONS, DIARY_CHANGE } from "./ui/diary.js";
import { WHY_ACTIONS } from "./ui/causes.js"; // "Why?" on deaths and lost bases
import { renderAlerts, ALERT_ACTIONS, mapHotkey, initAlerts, camSpot, nextWaitingTeam } from "./ui/alerts.js";
import { ROSTER_ACTIONS, ROSTER_CHANGE } from "./ui/roster.js";
import { GUIDE_ACTIONS, guideCheck, renderGuide, guideTab, renderGuideTip, guidePulse, startGuide, guideDefault } from "./ui/guide.js"; // the first-week guide under the alerts; its notes over new windows
import { LEDGER_ACTIONS, ledgerKey, drawCharts, sparkNode } from "./ui/ledger.js"; // the Ledger, the run summary, the stock trends
import { ACH_ACTIONS, achievementsFlash } from "./ui/achievements.js"; // the run's achievements: the window, the toast
import { HALL_ACTIONS, hallRecord } from "./ui/halloffame.js"; // the hall of fame of past runs: the window, an ending written to it
import { WATCHLIST_ACTIONS, renderWatchlist, syncWatchlist, ctxWatchlist } from "./ui/watchlist.js"; // the Watching panel (📌) and map notes
import { EXPLORE_ACTIONS, EXPLORE_CHANGE } from "./ui/explore.js";
import { LOCK_ACTIONS } from "./ui/locks.js";
import { installSelectSearch, searchOpenIn } from "./ui/selectsearch.js"; // long drop-downs you can type in to filter
import { CAR_ACTIONS } from "./ui/carpanel.js"; // cars found on a battle map (sim/foundcars.js)
import { CRAWL_ACTIONS } from "./ui/citycrawl.js";
import { HIVE_CRAWL_ACTIONS } from "./ui/hivecrawl.js";
import { NEEDS_ACTIONS } from "./ui/needs.js";
import { LISTEN_ACTIONS } from "./ui/radiolisten.js"; // Listen in on radio traffic: a team order, a base's set (sim/radiolisten.js)
import { activeCrawl } from "./sim/citycrawl.js";
import { activeHiveCrawl } from "./sim/hivecrawl.js";
import { MAX_SPEED, SPEEDS, SLOWEST_SPEED, initPacing, cardUp, trayEsc, pacingFrame, beforeHour, afterHour, holdsNextHour, afterRefresh, trayHTML, pauseWhyHTML, PACE_ACTIONS } from "./ui/pacing.js"; // pause rules, the card tray, the speeds
import { SETTINGS_ACTIONS, SETTINGS_CHANGE, initSettings, openSettings, autosaveCheck, autosaveState, unsaved, inDesktopApp, ironUnload, ironHidden, saveBeforeFight } from "./ui/settings.js";
// An Ironman game saves when the window is hidden (another tab, minimized) as well as when the page closes.
document.addEventListener("visibilitychange", () => { if (document.hidden && !crashUp()) ironHidden(state, ui); }); // not a world that just crashed (ui/crash.js)
import { checkPictures } from "./ui/pictures.js"; // once a second: a kept picture found blank (a lost GPU context) is drawn again, with every other
import { initCrash, reportCrash, crashUp } from "./ui/crash.js"; // the error screen: an uncaught exception stops the clock, writes the crash save
import { newCampaignId } from "./sim/savesummary.js"; // each run's id: the save list groups its saves, its autosaves rotate
import { loadOptions, saveOptions } from "./ui/saves.js";
import { initTitle, showTitle, syncTitle, titleFrame, titleKey, titleCovers, TITLE_ACTIONS } from "./ui/title.js"; // the title screen the game opens on
import { WORK_ACTIONS, WORK_CHANGE, workKey, applyRoleChoice } from "./ui/work.js";
import { DEFENCE_ACTIONS, DEFENCE_CHANGE } from "./ui/defence.js";
import { BASEMAP_ACTIONS, openForJob, openToPlace, openBuildMap } from "./ui/basemap.js"; // the base map tab; Build opens the map to place the new building
import { BUILDMAP_ACTIONS, buildMapKey } from "./ui/buildmap.js"; // Open the build map: the alert's click and the key (U)
import { STORAGE_ACTIONS, STORAGE_CHANGE } from "./ui/storage.js"; // the base window's Storage tab: the containers (sim/containers.js)
import { INTEL_ACTIONS, INTEL_CHANGE } from "./ui/intel.js"; // hidden bases (Run silent) and radio security (sim/hiding.js, sim/intel.js)
import { toManual } from "./sim/work.js";
import {
  loadLayout, saveLayout, setFolded, setShut, toggleAll, resetLayout, autoReveal, newDangerAlerts, alertsPill, alertsFoldButton, windowFrame,
} from "./ui/layout.js";
import { initPanels, applyLayout, setLogLine, setRailBadges, fitWindows, resetWindows, windowSizes, watchFloating } from "./ui/windows.js";
import { initTouch, touchGestures, touchRecent } from "./ui/touch.js"; // a finger: tap, long press (a right-click), drag and pinch on the maps
import { initResponsive, pickCancel, touchUI, compactUI, setKeysBadge } from "./ui/responsive.js";
import { initInputMode, inputMode } from "./ui/inputmode.js"; // the device used last (mouse, finger, controller): <html class="input-…">, the key hints
import { initGamepad, claimPad } from "./ui/gamepad.js"; // a controller: the map's and the battle's layers below (map input, combat input) // phones and tablets: the drawers, the dock, the ⋯ menu, a ✕ on windows (responsive.css)
import { initPadNav, navPanels, navBar, navBattle } from "./ui/padnav.js"; // a controller in the windows, menus and panels (its layer: after the battle's, under the question's)
import { initLogWindow, syncLogWindow } from "./ui/logwindow.js"; // a raid's log as a small window over the battle map
import { initOverlays, syncOverlays, resetOverlays } from "./ui/overlaydrag.js";
import { initHudBar, syncHudBar } from "./ui/hudbar.js"; // the row of buttons at the bottom left of the map: a box over the map each, shown or hidden // the boxes over the map move (drag a header, Alt+arrows)
import { keepFocusBefore, keepScrollBefore, afterPanelWrite, PANEL_ACTIONS, PANEL_INPUT } from "./ui/panelfold.js"; // the side panels' folds, find box, scroll fades
import { initKeymap, keyAction, keyIs } from "./ui/keymap.js"; // every key in one table, rebindable (Menu → Controls)
import { CONTROLS_ACTIONS, controlsKey } from "./ui/controls.js";
import { initPalette, openPalette, paletteIndex } from "./ui/cmdpalette.js"; // the search box (Ctrl+K or /)
import { CODEX_ACTIONS, CODEX_CHANGE, codexScan } from "./ui/codex.js"; // the Codex (C): what the player has met
import { TRIP_ACTIONS, TRIP_CHANGE, useArmedTemplate } from "./ui/trips.js"; // order templates and Repeat trip
import { rememberLaunch } from "./sim/trips.js";
import { UNDO_ACTIONS, installUndo, undoKey, undoable } from "./ui/undo.js"; // undo in the planner, build queue and Work tab
import { initAudio, audioFrame } from "./ui/audio.js"; // sound: WebAudio, made on the spot (ui/soundcues.js says what to play)
// Display options and their keys (M, `, Shift+P), the minimap, and the one confirmation box (ui/display.js, ui/minimap.js, ui/confirm.js).
import { initDisplay, DISPLAY_ACTIONS, DISPLAY_CHANGE, displayKey } from "./ui/display.js";
import { initMinimap, minimapFrame } from "./ui/minimap.js";
import { initEdgeFx, edgeFrame } from "./ui/edgefx.js"; // red pulses at the screen edge for an attack off screen (map and battle)
import { initConfirm, askHtml, askKey, ASK_ACTIONS, ask } from "./ui/confirm.js";
import { selectedTeam, teamOnTile } from "./ui/teamsel.js"; // the selected team (its panel open, or picked on the map)
import { teamTileMenu, teamCtxHtml, runTeamAction, landPick, splitPick, queueAhead } from "./ui/teamctx.js";
import { WHO_ACTIONS, whoHtml, askWho, whoKey, whoIds } from "./ui/whopick.js"; // who does an order: some of the team, or all of it // its right-click menu: actions for the tile
import { clickPick, syncPick, MAPSEL_ACTIONS } from "./ui/mapselect.js"; // selecting teams, parties and bands on the map like tiles
import { breakOut } from "./sim/poirooms.js"; // a camp inside a POI cut off: Break out (issue #71)

const HOURS_PER_SECOND = 1 / 20; // at 1× speed an hour takes 20 seconds and a day 8 minutes
// MAX_SPEED (ui/pacing.js): the fastest normal speed (5×); anything above is a dev fast-forward
const SLOW_REFRESH_MS = 250;    // above MAX_SPEED the panels are redrawn about 4 times a second, not every tick

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Orders given while the game is paused wait for the clock: parties touched (id -> how long their queue was
// before), construction and craft jobs queued. Cleared as soon as an hour passes. The banner counts them.
const newArmed = () => ({ parties: new Map(), builds: new Set(), crafts: new Set() });

// Everything about one run of the game. A new world (new campaign, new seed, new map) starts from these again;
// the interface size, the group count and the collapsed panels are the player's preferences and stay.
const freshUi = () => ({
  started: false, speed: 0, lastSpeed: 1, tab: "bases", selected: -1,
  planner: null, plannerError: "", routeSetup: null, survivor: null, cardResult: null, tradeMsg: "",
  baseView: null, baseMsg: "", moveParty: null, moveMsg: "", supplyForm: null, supplyError: "",
  expedition: null, xpMsg: "", xpQueue: false, moveQueue: false, qSel: null, // team panel and order queue (qSel: the selected queued order)
  inv: null, invSel: null, invMsg: "", // inventory / loot screen (ui/inventory.js)
  lookEdit: null, zombieLook: false, nrMsg: "", timelapse: null, bgEditor: null, // bgEditor: the custom backgrounds window (ui/backgrounds.js)
  gearEdit: null, // the new-run screen's starting gear window (ui/startgear.js): { i: the colonist's place in the crew }
  fleetEdit: null, // the new-run screen's window for a starting vehicle's back (ui/startgear.js fleetEditor): { i: its place in the fleet, msg, tsel, tqty }
  fleetView: null, // the new-run screen's look at a starting vehicle's back as rolled (ui/startgear.js fleetViewer): { i }
  crewInv: null, // a crew card's 👁 Inventory window (ui/newgame.js crewInvViewer): { i: the survivor's place in the crew }
  nrMap: false, // the new-run screen put aside to look at the map (ui/newgame.js View map; the banner or Esc brings it back)
  nrPick: false, // with nrMap: a click on the map picks where you start (ui/newgame.js Pick start on map; main.js pickStartAt)
  wcOpen: false, wcWas: null, // the World… window (ui/worldcfg.js) and the dials as they were when it opened
  dev: false, showFps: false, armed: newArmed(),
  radioWith: null, radioMsg: "", radioDeal: null, radioBase: null, radioMeet: null, meetPick: null, meetMsg: "", caravanPlan: null, cvMsg: "", attackConfirm: null, // ui/tradewindow.js
  settings: null, slot: null, savedMark: null, // ui/settings.js: the menu, the save slot this game uses, when it was last saved
  codex: null, paletteRecent: [], palFocus: null, // ui/codex.js window; ui/cmdpalette.js recent picks and a build button to light up
  ledger: null, // ui/ledger.js: the Ledger window is open
  achView: null, // ui/achievements.js: the Achievements window is open
  hall: null, hallNote: null, // ui/halloffame.js: the Hall of fame window ({ ending, mode, sel, confirm, msg }); the end screen's note
  ask: null, // ui/confirm.js: the question up before an order that cannot be undone
  mapSel: null, selParty: null, // ui/mapselect.js: a party, band or outsiders selected on the map; selParty: your selected team's id
  tileView: null, moveExit: null, // ui/poipick.js: the tile view of a team walking on its tile ({ partyId }); move mode from its "Leave for another tile…" (the team's id)
});
const ui = { title: false, scale: 1, factionCount: 7, worldSize: DEFAULT_SIZE, customW: BASE_W, customH: BASE_H, hiveCount: null, mode: "normal", startPeople: NORMAL_PEOPLE.DEF, ironman: false, freeEdit: false, pointsMax: CUSTOM_POINTS.DEF, crewEdited: false, crewRoll: null, startPick: null, startVehicle: true, custom: defaultCustom(), fleet: defaultFleet("normal"), ...freshUi() }; // mode: Normal, Hardcore, Custom or Crashlanding (sim/hardcore.js MODES); startPeople: the starting team (Normal 1–8, Hardcore 1–4, Custom 1–30, Crashlanding 1); pointsMax: Customize's Points each; startVehicle: Start with a vehicle; custom: Custom mode's counts (sim/custommode.js)
// Each mode keeps its own Starting people, Points each, Start with a vehicle and Starting vehicles (2026-10-19 and
// 2026-10-24, user requests): ui.startPeople, ui.pointsMax, ui.startVehicle and ui.fleet (sim/startfleet.js: each starting
// vehicle's kind, point limit and back) are the current mode's, the other modes' wait here (switching mode swaps them:
// ui/newgame.js stashModeSet and takeModeSet, from the gamemode select, rollRandomRun and adopt).
ui.modeSets = {
  normal: { startPeople: NORMAL_PEOPLE.DEF, pointsMax: CUSTOM_POINTS.DEF, startVehicle: true, fleet: defaultFleet("normal") },
  hardcore: { startPeople: START_PEOPLE.DEF, pointsMax: CUSTOM_POINTS.DEF, startVehicle: true, fleet: defaultFleet("hardcore") },
  custom: { startPeople: peopleRange("custom").DEF, pointsMax: CUSTOM_POINTS.DEF, startVehicle: true, fleet: defaultFleet("custom") },
  crash: { startPeople: peopleRange("crash").DEF, pointsMax: CUSTOM_POINTS.DEF, startVehicle: false, fleet: [] }, // Crashlanding (sim/crashmode.js): one survivor, no vehicle; its Points each is its own
};
// Folded panels and their widths (ui/layout.js), remembered in the browser. The Layers box keeps its old ui flag,
// which reads and writes the layout.
const layout = loadLayout();
for (const [prop, p] of [["legendCollapsed", "legend"]]) {
  Object.defineProperty(ui, prop, { enumerable: true, get: () => layout[p], set: (v) => { layout[p] = !!v; saveLayout(layout); } });
}
// The Options tab (ui/settings.js), remembered in the browser (ui/saves.js): autosave, confirmations, pause on focus loss, UI size.
const options = loadOptions();
initKeymap(options); // the player's key bindings (ui/keymap.js)
initPacing(options, saveOptions); // Options → Pause for… (ui/pacing.js)
initAlerts(options); // Options → Good news alerts (ui/alerts.js GOOD_NEWS)
ui.scale = options.uiScale;
ui.guide = guideDefault(options); // the new-run screen's First-week guide box (ui/guide.js): on for the first campaign here
ui.worldCfg = cleanCfg(options.worldCfg); // the new-run screen's World… dials (ui/worldcfg.js), as last set in this browser
if (ui.scale !== 1) document.documentElement.style.setProperty("--ui-scale", ui.scale);
initAudio(options, () => saveOptions(options)); // the Sound options, the first-gesture unlock, button clicks
// The first world: a preview (sim/world.js PREVIEW_MAP; the user's request 2026-10-24: "Do not start the map generation
// until you start the game, or want to select a tile or view the map prior to starting instead of what is currently
// loading the map as the application starts"): the settings and the crew on a tiny map, built at once; the real map is
// built when it is needed (newWorld's real, gen). Every later build goes through gen() below.
let state = createWorld({ seed: randomSeed(), factionCount: ui.factionCount, size: ui.worldSize, worldCfg: ui.worldCfg, preview: true });
let dirty = true;      // a tick changed something: redraw the panels (throttled at dev speeds)
let dirtyNow = false;  // the player did something on the map: redraw on the next frame
let clockDirty = false; // a new minute on the clock and nothing else: only what counts the minutes (refreshClock)
let drawn = 0;           // panel redraws so far (refresh, refreshClock): the map's tooltip is built again after one
let timedUi = false;     // the last refresh showed something that ends after real seconds (the alerts' flash, the guide's pulse)

function randomSeed() {
  return Math.floor(Math.random() * 1e6);
}
// Seeds are whole positive numbers.
function cleanSeed(v) {
  const n = Math.floor(Math.abs(Number(v)));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 999999999) : 1;
}

const $ = (id) => document.getElementById(id);
const canvas = $("map");
// The top bar's slots (index.html). Built here when the page does not have them.
if (!$("tb-clock")) {
  $("topbar").innerHTML = `<span class="title">BROKEN STATE</span><span class="clock" id="tb-clock"></span><span class="speed row" id="tb-speed"></span>
    <span class="stock" id="tb-stock"></span><span class="threat" id="tb-threat"></span><span id="tb-people"></span><span class="row small" id="tb-tools"></span>`;
}
// The alerts stack on the map (index.html has it; built here when the page does not).
if (!$("alerts")) {
  const al = document.createElement("div");
  al.id = "alerts";
  al.className = "hidden";
  $("mapwrap").appendChild(al);
}
// The confirmation box (ui/confirm.js), over everything.
if (!$("ask")) {
  const el = document.createElement("div");
  el.id = "ask";
  el.className = "hidden";
  document.body.appendChild(el);
}
// The bars between the map and its panels, the map-only button and resizable windows (ui/windows.js), set up before
// the map measures itself so a folded panel's room is the map's from the start.
initPanels({ layout, relayout: (fn) => relayout(fn), refresh: () => { dirtyNow = true; } });
initRenderer(canvas);
initCombatUI($("combatmap"));
initMinimap($("mapwrap"), canvas, options); // ui/minimap.js: the map's corner
initEdgeFx($("mapwrap"), $("cbmapwrap"), () => refresh(false)); // ui/edgefx.js: the screen-edge warnings
initOverlays({ refresh: () => { dirtyNow = true; } }); // ui/overlaydrag.js: the boxes over the map keep where the player put them
initHudBar($("mapwrap")); // ui/hudbar.js: the buttons at the bottom left of the map
initLogWindow($("cblogwin"), $("cbmapwrap"), { refresh: () => { dirtyNow = true; } }); // ui/logwindow.js: the raid's log window (drag, resize, fold)
initResponsive(); // ui/responsive.js: only while a phone or tablet media query matches
initInputMode(); // ui/inputmode.js: the pointer, the keyboard and the controller say which device is in use
// The map follows its box whatever changes it (a panel folded or dragged wider, the UI size).
if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => {
    const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    if (Math.round(r.width * d) !== canvas.width || Math.round(r.height * d) !== canvas.height) resize();
  }).observe(canvas);
}
centerOn(state, playerTile(state));

// ---------- loop ----------
let last = performance.now();
let acc = 0;
let lastRefresh = 0;
let shownMinute = -1; // the clock's minute (hours since the start × 60) the panels were last marked dirty for
const paused = () => ui.started && ui.speed === 0;
function blocked() {
  // On autopilot the governor answers cards, runs searches and trades itself (sim/autopilot.js), so they do not stop the clock.
  // cardUp (ui/pacing.js): a card that stops the clock by the pause rules, or one opened from the tray.
  const pending = !state.autopilot && (cardUp(state, ui) || !!state.engagement || !!state.trade || !!activeCrawl(state) || !!activeHiveCrawl(state)); // activeCrawl: a city crawl's block card (sim/citycrawl.js); a hive crawl's window (sim/hivecrawl.js)
  return !ui.started || !!state.combat || generatingUp() || state.gameOver || !!ui.cardResult || pending ||
    !!ui.planner || !!ui.routeSetup || ui.radioWith != null || !!ui.caravanPlan || !!ui.survivor || !!ui.memorial || !!ui.baseView || !!ui.zombieLook || !!ui.wcOpen || !!ui.bgEditor || !!ui.inv || !!ui.meet || !!ui.gunb || !!ui.timelapse || !!ui.diary || !!ui.roster || !!ui.settings || !!ui.ledger || !!ui.ask || !!ui.codex || !!ui.carry || nameModalUp(state, ui) || unpackUp(state, ui);
}

// An exception in a frame (a sim tick, the autopilot, drawing) stops the clock and opens the error screen (ui/crash.js),
// which writes the crash save; the loop then waits (no frames run under the screen) instead of throwing every frame.
const frameErrors = new Map(); // how often each message was thrown (window.game.frameErrors)
function frame(now) {
  if (crashUp()) { last = now; requestAnimationFrame(frame); return; }
  try {
    step(now);
  } catch (e) {
    const key = String(e && e.message);
    frameErrors.set(key, (frameErrors.get(key) || 0) + 1);
    reportCrash(e, "the game loop (a frame: the clock, the autopilot or drawing)");
  }
  requestAnimationFrame(frame);
}

function step(now) {
  const t0 = ui.showFps ? performance.now() : 0;
  checkPictures(now); // ui/pictures.js: the sentinel, once a second
  const gap = now - last;
  const dt = Math.min(0.25, gap / 1000);
  last = now;
  let ticks = 0;
  if (state.autopilot && ui.started && !ui.settings && autopilotResolve(state)) dirty = true; // cards and battles never wait for a click (the menu holds everything)
  pacingFrame(state, ui); // ui/pacing.js: new cards get their kind, cards out of date leave the tray
  // An event that stops the clock (a card, battle, search, trade or crawl) leaves the speed paused, so the clock
  // is still stopped when the player leaves it; Space or Run goes back to the speed it had.
  if (ui.started && ui.speed > 0 && !state.autopilot && !state.gameOver &&
      (cardUp(state, ui) || !!state.combat || !!state.engagement || !!state.trade || !!activeCrawl(state) || !!activeHiveCrawl(state))) {
    if (ui.speed <= MAX_SPEED) ui.lastSpeed = ui.speed;
    ui.speed = 0;
  }
  if (!blocked() && ui.speed > 0 && !ui.moveParty && !ui.fwPlace && !ui.meetPick) { // ui/fieldworks.js: the clock waits for a field work's tile
    acc += dt * ui.speed * HOURS_PER_SECOND;
    while (acc >= 1 && ticks < 12) {
      setClockFrac(0); // the hour's end: what the tick and its tray rules start, starts on the hour (sim/parties.js)
      if (beforeHour(state, ui)) dirty = true; // tray cards past their time answer themselves; their teams hold
      if (blocked()) { acc = 0; break; }       // a default answer that opened a battle
      tickHour(state);
      afterHour(state, ui); // the pause rules: new cards, deaths, first contacts, groups turning hostile
      acc -= 1;
      ticks++;
      dirty = true;
      if (blocked()) {
        acc = 0;
        break;
      }
    }
    if (ticks >= 12) acc = Math.min(acc, 1); // too slow to keep up: drop the backlog instead of running on after a speed change
    if (ticks) ui.armed = newArmed();        // time moved: nothing is waiting for the unpause any more
    // Teams that get where they are going at this minute arrive now, as the glide reaches the centre of the tile
    // (sim/parties.js arrivalsDue; a team held by a card in the tray does not move); their new cards follow the pause
    // rules as a tick's do.
    setClockFrac(Math.min(0.999, acc));
    if (!blocked() && arrivalsDue(state, Math.min(0.999, acc), (p) => holdsNextHour(state, p))) {
      afterHour(state, ui);
      dirty = true;
    }
  }
  // The minutes of the coming hour tick by on the clock, and your moving teams glide towards their next tile by them.
  view.hourFrac = Math.max(0, Math.min(0.999, acc));
  view.clockSpeed = ui.speed; // the map draws a glide often enough at slow speeds too (ui/render.js)
  setClockFrac(view.hourFrac); // orders given from now on start this far into the hour (sim/parties.js wayOn)
  const mins = $("tb-min"), mm = String(Math.floor(view.hourFrac * 60)).padStart(2, "0");
  if (mins && mins.textContent !== mm) mins.textContent = mm;
  // A new minute on the clock redraws what counts the minutes: the ETAs, the "left" times and the bars of the orders
  // under way count the minutes of the hour already gone (sim/parties.js clockFrac), so they move with the clock, not
  // only on the hour or at the next click (refreshClock; the rest waits for the world or the player to change).
  const minute = state.hour * 60 + Math.floor(view.hourFrac * 60);
  if (minute !== shownMinute) { shownMinute = minute; if (timedUi) dirty = true; else clockDirty = true; } // a flash or pulse showing: everything, so it goes on time
  autosaveCheck(state, ui, settingsApi, now); // dawn, a hive assault, the end of the run (ui/settings.js)
  if (ui.timelapse) tlFrame(state, ui, now); // recorded frames instead of the live map (ui/timelapse.js)
  else if (state.combat) {
    if (!ui.settings && combatTick(state, now)) dirtyNow = true; // the enemy turn waits while the menu is open
    drawCombat(state, now);
  } else if (!titleCovers(ui)) render(state); // the title screen hides the map (unless the map is its background)
  minimapFrame(state, ui, now); // ui/minimap.js (hidden over a battle, the title and the timelapse)
  edgeFrame(state, ui, now, !ui.timelapse && !state.combat && !titleCovers(ui)); // ui/edgefx.js: attacks off screen
  if (titleCovers(ui)) titleFrame(state, ui, now); // the title, and its background under the new-run screen (ui/title.js newRunUp)
  audioFrame(state, ui, now); // battle and map cues, the ambience (ui/audio.js)
  if (dirtyNow || (dirty && (ui.speed <= MAX_SPEED || now - lastRefresh >= SLOW_REFRESH_MS))) refresh(false);
  else if (clockDirty && ui.speed <= MAX_SPEED) refreshClock(); // (at dev speeds the throttled refresh has them too)
  tileViewFrame(state, ui); // ui/poipick.js: the team's dot walking on the tile view, by the clock's minutes
  if (ui.showFps) fpsFrame(now, gap, performance.now() - t0, ticks);
}

// ---------- drawing the panels ----------
// Each panel keeps the HTML it shows; a refresh that produces the same string leaves the DOM alone, so buttons
// stay clickable and hover descriptions stay up while the clock runs. A panel is not rebuilt while the mouse
// button is down on it (the click would be lost), nor under an open drop-down when only a tick asked for it.
const PANELS = ["tb-clock", "tb-speed", "nb-btn", "nb-head", "nb-list", "tb-stock", "tb-people", "tb-tools", "left", "right", "log", "modal", "legend", "devpanel", "cbpanel", "cbbar", "cbtop", "cbcards", "cblogbody", "cblogfoot", "banner", "alerts", "guide", "watchlist", "ask"];
const shown = new Map(); // element id -> the HTML last written
let held = null;         // panel the mouse button went down in
let heldBack = false;    // a rebuild was skipped because of it
let selectFocusAt = 0;   // when a drop-down last took the focus
let modalShown = null;   // which modal is on screen (for keeping its scroll position)

function panelOf(target) {
  for (const id of PANELS) {
    const el = $(id);
    if (el && el.contains && el.contains(target)) return id;
  }
  return null;
}
function selectOpenIn(el) {
  if (searchOpenIn(el)) return true; // a long drop-down's filter box (ui/selectsearch.js) is open over it
  const a = document.activeElement;
  return !!a && a.tagName === "SELECT" && el.contains(a) && performance.now() - selectFocusAt < 20000;
}
// The top bar's Needs button and drop-down (ui/needsbar.js): the frame once, then its button, head and list each as a
// slot of its own, so an open panel keeps the mouse, the focus and the list's scroll position while the stock changes.
function writeNeeds(nb, user) {
  const root = $("tb-stock");
  if (!root) return;
  if (!$("nb-list")) { root.innerHTML = needsSkeleton(); shown.delete("nb-btn"); shown.delete("nb-head"); shown.delete("nb-list"); }
  initNeedsBar(root);
  setHTML("nb-btn", nb.btn, user);
  setHTML("nb-head", nb.head, user);
  const list = $("nb-list"), top = list.scrollTop;
  if (setHTML("nb-list", nb.list, user) && top) list.scrollTop = top;
}
// The threat forecast meter (ui/threatbar.js) the same way: its frame once, then the meter, the head and the list.
function writeThreat(tf, user) {
  const root = $("tb-threat");
  if (!root) return;
  if (!$("tf-list")) { root.innerHTML = threatSkeleton(); shown.delete("tf-btn"); shown.delete("tf-head"); shown.delete("tf-list"); }
  initThreatBar(root);
  setHTML("tf-btn", tf.btn, user);
  setHTML("tf-head", tf.head, user);
  const list = $("tf-list"), top = list.scrollTop;
  if (setHTML("tf-list", tf.list, user) && top) list.scrollTop = top;
}
// Writes a panel's HTML if it changed. Returns true when the DOM was touched.
function setHTML(id, html, user) {
  const el = $(id);
  if (!el || shown.get(id) === html) return false;
  if (held === id || (!user && selectOpenIn(el))) {
    heldBack = true;
    return false;
  }
  const keep = keepFocusBefore(el), scroll = keepScrollBefore(el); // a text box being typed in keeps its focus and caret, a data-keepscroll list its scroll (ui/panelfold.js)
  el.innerHTML = html;
  shown.set(id, html);
  afterPanelWrite(el, keep, scroll); // and the boxes that scroll fade at the edges with more to see
  return true;
}
function setPanel(id, html, user) {
  const wrote = setHTML(id, html, user);
  const el = $(id);
  if (el && (wrote || shown.get(id) === html)) el.classList.toggle("hidden", !html);
  return wrote;
}
function releaseHold() {
  held = null;
  if (heldBack) { heldBack = false; dirtyNow = true; }
}
document.addEventListener("mousedown", (e) => {
  const t = e.target;
  // A drop-down is guarded by its focus instead (its mouseup may never reach the page).
  held = e.button === 0 && !(t && (t.tagName === "SELECT" || t.tagName === "OPTION")) ? panelOf(t) : null;
}, true);
document.addEventListener("mouseup", releaseHold, true); // the click that follows redraws
// A finger holds its panel too (its mouse events only come once it lifts): let go when it lifts or the browser takes it
// for a scroll (ui/touch.js).
document.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse" && e.isPrimary) { const t = /** @type {Element} */ (e.target); held = t && t.tagName !== "SELECT" && t.tagName !== "OPTION" ? panelOf(t) : null; } }, true);
for (const k of ["pointerup", "pointercancel"]) document.addEventListener(k, (e) => { if (e.pointerType !== "mouse") releaseHold(); }, true);
document.addEventListener("dragend", releaseHold, true);
document.addEventListener("focusin", (e) => { if (e.target && e.target.tagName === "SELECT") selectFocusAt = performance.now(); });
window.addEventListener("blur", releaseHold);
// Options: pause when the window loses focus; in a browser tab, ask before closing it with progress not saved (the
// desktop app quits through the menu, so it never asks there).
window.addEventListener("blur", () => {
  if (!options.pauseOnBlur || !ui.started || ui.speed === 0) return;
  if (ui.speed <= MAX_SPEED) ui.lastSpeed = ui.speed;
  ui.speed = 0;
  dirtyNow = true;
});
window.addEventListener("beforeunload", (e) => {
  if (crashUp()) return; // the error screen is up: the crash save has the world; an Ironman slot keeps its last good save
  if (ironUnload(state, ui)) return; // an Ironman game is saved as the page closes (ui/settings.js): nothing to ask
  if (state.ironman) return;
  if (!options.confirmQuit || settingsApi.desktop || !unsaved(state, ui) || state.gameOver) return;
  e.preventDefault();
  e.returnValue = "";
});

// Screens and panels that point at something that no longer exists (a lost outpost, a team that got home) close.
function tidyUi() {
  // A camp just set up (sim/staging.js makeCamp): its base window opens on the Camp tab, once (not under the governor,
  // nor over a battle or another window the player is in).
  if (state.campOpen != null) {
    const id = state.campOpen;
    delete state.campOpen;
    if (!state.autopilot && !state.combat && !ui.baseView && baseById(state, id)) { ui.baseView = { id, tab: "camp" }; ui.baseMsg = ""; }
  }
  // ui/campsite.js: a team waiting for its camp's spot: the tile's map opens in the isometric view, built under the
  // "Generating map…" box (the user's request 2026-10-26)
  siteViewDue(state, ui, (fn) => generating(fn, { text: siteGenWhat(state), after: () => { dirtyNow = true; refresh(); } }));
  if (ui.baseView && !baseById(state, ui.baseView.id)) { ui.baseView = null; ui.baseMsg = ""; }
  if (ui.supplyForm && (!ui.baseView || !baseById(state, ui.supplyForm.originId))) { ui.supplyForm = null; ui.supplyError = ""; }
  if (ui.survivor != null && !survivorById(state, ui.survivor)) { ui.survivor = null; ui.lookEdit = null; }
  if (ui.expedition != null && !partyById(ui.expedition)) { ui.expedition = null; ui.xpMsg = ""; ui.xpQueue = false; ui.qSel = null; }
  if (ui.qSel != null && (ui.expedition == null || ui.qSel >= (partyById(ui.expedition).orders || []).length)) ui.qSel = null; // the queue got shorter
  if (ui.moveParty != null && !partyById(ui.moveParty)) endMoveMode();
  if (ui.fwPlace && !baseById(state, ui.fwPlace.baseId)) { ui.fwPlace = null; ui.fwMsg = ""; }
  view.fwPlace = ui.fwPlace ? fwPlaceTiles(state, ui) : null; // ui/fieldworks.js: the tile picker's highlight
  if (state.combat && ui.inv && !ui.inv.loot && !ui.inv.raid && !(ui.inv.peek && !state.combat.over) && !kitUp(state, ui)) { ui.inv = null; ui.invSel = null; } // only the loot screen, a raid's search window, a survivor's kit (look only, ui/inventory.js peekModal) and the plan's team inventory (ui/raidplan.js kitUp) go over a battle
  if (!state.combat && ui.inv && ui.inv.peek) { ui.inv = null; ui.invSel = null; } // the battle's kit view goes with the battle
  if (state.combat && ui.gunb && !(ui.gunb.battle != null && !state.combat.over)) ui.gunb = null; // the gun builder: in a battle only on a fighter's gun (the item menu's Modify, ui/gunbuilder.js)
  // A defence drill closed (ui/defence.js, sim/defenceplan.js): back to the base's Defence tab it was opened from.
  if (ui.drillFrom != null && !(state.combat && state.combat.drill)) { if (!state.combat && baseById(state, ui.drillFrom)) ui.baseView = { id: ui.drillFrom, tab: "defence" }; ui.drillFrom = null; }
  // The base map closed (ui/basemap.js, sim/basemap.js): back to the base's tab it was opened from (tab "none": opened
  // from the side panel, back to the map).
  if (state.combat && state.combat.layout) layoutDone(state, state.combat.layout.baseId); // Open the build map: its map is open, the ask is answered (sim/staging.js)
  if (ui.mapFrom && !(state.combat && state.combat.layout)) { if (!state.combat && ui.mapFrom.tab !== "none" && baseById(state, ui.mapFrom.id)) ui.baseView = { id: ui.mapFrom.id, tab: ui.mapFrom.tab }; ui.mapFrom = null; }
}

// ---------- folded panels ----------
// Runs fn (which folds, unfolds or resizes panels) and gives the map the room: the canvas is measured again and
// the camera moved so the land under the mouse stays where it was. One redraw, no cache rebuilt.
function relayout(fn) {
  const a = canvas.getBoundingClientRect();
  fn();
  const b = canvas.getBoundingClientRect();
  if (a.left !== b.left || a.top !== b.top || a.width !== b.width || a.height !== b.height) {
    if (!ui.timelapse) { camera.x += (b.left - a.left) / camera.zoom; camera.y += (b.top - a.top) / camera.zoom; }
    resize();
  }
  dirtyNow = true;
}
function foldPanel(p, v) {
  relayout(() => { setFolded(layout, p, v); applyLayout(layout); });
  saveLayout(layout);
}
// Close the left panel, the right panel or the log completely (no strip), or open a closed one (ui/layout.js setShut).
function shutPanel(p, v) {
  relayout(() => { setShut(layout, p, v); applyLayout(layout); });
  saveLayout(layout);
}
// What was picked at the last refresh (autoReveal compares), the danger alerts already seen, and a tile clicked on
// the map since (that shows the right panel even when the same tile is clicked again).
let picked = null, dangerSeen = null, dangerState = null, mapClicked = false, rightToTop = false;
function autoShow() {
  const now = { state, started: ui.started, sel: ui.selected, xp: ui.expedition, tab: ui.tab };
  if (dangerState !== state) { dangerSeen = null; dangerState = state; }
  const d = newDangerAlerts(dangerSeen, ui.alertList);
  dangerSeen = d.seen;
  const show = autoReveal(layout, picked, now, { autoOpen: options.autoOpen, newDanger: d.fresh.length > 0, clicked: mapClicked });
  picked = now;
  mapClicked = false;
  if (!show.length) return;
  relayout(() => { for (const p of show) setFolded(layout, p, false); applyLayout(layout); });
  saveLayout(layout);
  if (show.includes("right")) rightToTop = true; // what was picked, from the top
}
// The alerts stack under its header, or its folded tab (ui/layout.js alertsFoldButton, alertsPill). On a phone the
// stack is a sheet under the strip over the map (ui/responsive.js): opened with nothing in it, it says so (a desktop
// shows nothing then: there is no box to be empty).
function alertsHTML(html) {
  if (layout.alerts) return alertsPill(ui.alertList, (/<div class="al-flash">[\s\S]*?<\/div>/.exec(html) || [""])[0]);
  const list = ui.alertList || [];
  if (html.includes('class="al ')) return alertsFoldButton(list.length, list.some((a) => a && a.tone === "danger")) + html;
  if (compactUI() && ui.started && !state.gameOver && !ui.timelapse) return alertsFoldButton(0, false) + html + `<div class="al-empty small muted">Nothing needs you right now.</div>`;
  return html;
}

function refresh(user = true) {
  dirty = false;
  dirtyNow = false;
  clockDirty = false;
  drawn++;
  lastRefresh = last;
  tidyUi();
  syncPick(state, ui); // ui/mapselect.js: a selected party followed as it moves, the gold ring on the map
  noteNames(state);
  codexScan(state, ui); // ui/codex.js: open the entries for what the player now sees (before the alerts: it may flash)
  guideCheck(state, ui); // the first-week guide ticks off what is done (ui/guide.js), before the alerts show its toast
  achievementsFlash(state, ui); // ui/achievements.js: a toast for an achievement just earned
  if (state.gameOver) hallRecord(state, ui); // ui/halloffame.js: the ending written to the hall of fame, once by its key
  const alerts = renderAlerts(state, ui); // the alerts stack on the right of the map (ui/alerts.js); also sets ui.alertList
  autoShow();
  afterRefresh(state, ui); // ui/pacing.js: a new red alert slows the clock to 1×, a horde near a base stops it
  const tb = topbarParts(state, ui);
  setHTML("tb-clock", tb.clock, user);
  setHTML("tb-speed", tb.speed, user);
  writeNeeds(tb.needs, user);
  writeThreat(tb.forecast, user);
  setHTML("tb-people", tb.people, user);
  setHTML("tb-tools", tb.tools, user);
  // A folded panel is not drawn (it is drawn again when it opens).
  if (!layout.left) setHTML("left", renderLeft(state, ui), user);
  if (!layout.right) {
    setHTML("right", renderRight(state, ui), user);
    if (rightToTop) { rightToTop = false; $("right").scrollTop = 0; }
  }
  if (!layout.log) setHTML("log", renderLogPanel(state, ui), user); // filters and links (ui/diary.js)
  else setLogLine(state.log && state.log[0] ? String(state.log[0].text || "") : "");
  const waitingTeams = () => (ui.started ? state.parties.filter((p) => p.owner === "player" && p.phase === "waiting").length : 0);
  if (layout.left) setRailBadges({ teams: waitingTeams(), tab: ui.tab }); // the folded left panel's rail
  if (touchUI()) setKeysBadge(waitingTeams()); // ❗ Next team on a phone or tablet (ui/responsive.js)
  refreshModal(user);
  setHTML("legend", renderLegend(view, ui, ui.started ? state : null), user);
  if (ui.started) devSample(state);
  setPanel("devpanel", ui.started ? renderDevPanel(state, ui) : "", user);
  setPanel("alerts", alertsHTML(alerts), user);
  setPanel("guide", layout.guide ? guideTab(state, ui) : renderGuide(state, ui), user); // the first-week guide: its own box under the alerts, or its tab (ui/hudbar.js: its button)
  setPanel("watchlist", ui.started ? renderWatchlist(state, ui, { folded: !!layout.all }) : "", user); // ui/watchlist.js: top left of the map
  renderCombat(user);
  setPanel("guidetip", renderGuideTip(state, ui), user); // the first-week guide's note over a window new to the player (ui/guide.js)
  setPanel("banner", bannerHTML(), user);
  syncWatchlist(state, ui, { act: actions, refresh }); // places the Watching panel; the map-note editor
  syncHudBar(state, ui, layout, options); // ui/hudbar.js: the buttons' counts and lights, the guide's place
  syncOverlays(); // ui/overlaydrag.js: moved boxes in their place, every box kept on the map
  setPanel("ask", askHtml(ui) + carryHtml(state, ui) + landHtml(state, ui) + whoHtml(state, ui), user); // ui/confirm.js; ui/carry.js: how much to collect, picking up from the ground; ui/landorder.js: a land job's hours
  writeItemMenu(user);
  if (ui.box && !ui.inv && !ui.baseView && !ui.gunb && !ui.meet) ui.box = null; // its window was closed (as the item menu)
  setPanel("boxview", boxViewHtml(state, ui), user); // ui/boxview.js: an opened box's window, over the windows
  syncTitle(state, ui); // ui/title.js
  $("banner").classList.toggle("dev", !!ui.dev);
  const fps = $("fps");
  if (fps) {
    fps.classList.toggle("hidden", !ui.showFps);
    fps.classList.toggle("fixed", !!state.combat);
  }
  if (tipTarget && tipTarget.isConnected === false) hideTip(); // only when the hovered element was replaced
  guidePulse(ui); // what the guide's Show me points at (ui/guide.js)
  timedUi = alerts.includes('class="al-flash"') || !!ui.guidePulse; // ui/alerts.js: 4 s; ui/guide.js: GUIDE.PULSE_MS
}

// A new minute on the clock and nothing else: only what counts the minutes is drawn again. The Teams tab, the running
// orders, the watchlist, a team's panel or window (their ETAs and "left" times), and the selected team followed as
// its sprite glides past the middle of a tile (ui/mapselect.js teamTileOf). The rest (the bases, the Needs and the
// threat bars, the alerts, the log) changes only with the world (a tick, an arrival, an answer) or a click, which
// set `dirty` and redraw everything (refresh). At 5x the clock shows a new minute 15 times a second, the hour once.
function refreshClock() {
  clockDirty = false;
  drawn++;
  syncPick(state, ui);
  if (!layout.left && (ui.tab === "teams" || ui.tab === "orders")) setHTML("left", renderLeft(state, ui), false); // the Teams and Orders tabs count the minutes
  if (!layout.right) setHTML("right", renderRight(state, ui), false);
  refreshModal(false);
  const watch = setPanel("watchlist", ui.started ? renderWatchlist(state, ui, { folded: !!layout.all }) : "", false);
  if (watch) { syncWatchlist(state, ui, { act: actions, refresh }); syncOverlays(); } // its box kept on the map
}

// The item right-click menu (ui/itemmenu.js) over the windows, kept inside the screen: where it would run off an edge
// it is moved in once, and the place is kept (so the next redraw is the same markup).
function writeItemMenu(user) {
  if (ui.imenu && !ui.inv && !ui.baseView && !ui.gunb && !ui.meet) ui.imenu = null; // its window was closed
  setPanel("itemmenu", itemMenuHtml(state, ui), user);
  const box = ui.imenu && $("itemmenu").firstElementChild;
  if (!box) return;
  const r = box.getBoundingClientRect();
  const x = Math.max(4, Math.min(ui.imenu.x, window.innerWidth - r.width - 4)), y = Math.max(4, Math.min(ui.imenu.y, window.innerHeight - r.height - 4));
  if (x !== ui.imenu.x || y !== ui.imenu.y) { ui.imenu.x = Math.round(x); ui.imenu.y = Math.round(y); setPanel("itemmenu", itemMenuHtml(state, ui), true); }
}

function refreshModal(user) {
  const html = windowFrame(renderModal(state, ui), modalKind(state, ui)); // big windows get resize grips (ui/layout.js)
  const modal = $("modal");
  if (!html) {
    modal.classList.add("hidden");
    if (shown.get("modal")) { modal.innerHTML = ""; shown.set("modal", ""); }
    modalShown = null;
    return;
  }
  const kind = `${modalKind(state, ui)}${ui.baseView ? `:${ui.baseView.id}:${ui.baseView.tab}:${ui.supplyForm ? "form" : ""}` : ""}`;
  if (shown.get("modal") !== html) {
    // The same screen redrawn keeps its scroll position (the whole box, and the base screen's body).
    const same = kind === modalShown;
    const box = modal.querySelector(".box"), body = modal.querySelector(".basebody");
    const boxTop = same && box ? box.scrollTop : 0, bodyTop = same && body ? body.scrollTop : 0;
    if (setHTML("modal", html, user)) {
      modalShown = kind;
      fitWindows(); // the size and place the player gave this kind of window (ui/windows.js)
      const nb = modal.querySelector(".box"), nbody = modal.querySelector(".basebody");
      if (nb && boxTop) nb.scrollTop = boxTop;
      if (nbody && bodyTop) nbody.scrollTop = bodyTop;
      const elog = $("elog");
      if (elog) elog.scrollTop = elog.scrollHeight;
      modal.classList.remove("hidden"); // shown before the charts measure themselves
      if (!same) { const af = modal.querySelector("input[autofocus]"); if (af) { af.focus({ preventScroll: true }); af.select(); } } // a new window with a box to type in (ui/basename.js): ready to type
      drawCharts(modal); // the Ledger's and the run summary's charts (ui/ledger.js)
    }
  }
  modal.classList.remove("hidden");
  modal.classList.toggle("over-combat", !!state.combat); // the loot screen sits on top of the battle
}

// Tactical battle overlay.
function renderCombat(user) {
  const box = $("combat");
  if (!state.combat) {
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  // A raid on a site has no side panel (ui/combat.js raidLayout): the top strip, the cards over the map and the log window instead.
  const raid = raidLayout(state.combat);
  box.classList.toggle("noside", raid);
  if (raid) {
    setHTML("cbpanel", "", user);
    if (setHTML("cbtop", renderRaidTop(state), user)) {
      const top = $("cbtop"), mid = top && top.querySelector(".ct-mid");
      if (mid && mid.offsetHeight) top.parentElement.style.setProperty("--cbtop-h", `${Math.round(mid.offsetHeight) + 14}px`); // the cards start under the strip
    }
    setHTML("cbcards", renderRaidCards(state), user);
    if (setHTML("cblogbody", renderRaidLog(state), user)) {
      const clog = $("cblogbody");
      if (clog) clog.scrollTop = clog.scrollHeight;
    }
    setHTML("cblogfoot", renderRaidLogFoot(state), user);
    syncLogWindow(true);
  } else {
    for (const id of ["cbtop", "cbcards", "cblogbody", "cblogfoot"]) setHTML(id, "", user);
    syncLogWindow(false);
    if (setHTML("cbpanel", renderCombatPanel(state), user)) {
      const clog = $("cblog");
      if (clog) clog.scrollTop = clog.scrollHeight;
    }
  }
  setHTML("cbbar", renderCombatBar(state), user); // the bottom bar: the selected one's card, the orders, the turn controls (ui/battlebar.js)
}

// Banners at the top of the map: paused (with the orders waiting for the unpause), setting up (the new-run screen's
// map) and move mode. On a phone or an upright tablet (ui/responsive.js compactUI) each is one short line under the
// strip over the map: what is only a description of what is happening goes into its hover (the user's request
// 2026-10-24), the action stays.
function bannerHTML() {
  const compact = compactUI();
  if (!ui.started && ui.nrMap && !ui.title) {
    const pickHow = `${keyHint({ key: "Click", touch: "Tap", pad: `${kh("A")} on` })} ${state.mode === "hardcore" ? "open land" : "a town"} to start there`;
    const about = "The new-run screen is put aside so you can look around the map: where you start, the groups, the roads. Nothing runs until you start.";
    if (compact) return `<div class="paused compact" data-tip="${about}"><b class="big">Setting up</b>${ui.nrPick ? ` <span class="small">${pickHow}</span>` : ""} ` +
      `<button class="mini" data-action="nr-start" data-tip="Roll a new starting position on this same map and seed (the map, the hives and your colonists stay)">📍 New start</button> ` +
      `<button class="mini${ui.nrPick ? " primary" : ""}" data-action="nr-pick" data-tip="${ui.nrPick ? "Stop picking: clicks on the map look around again" : "Pick where you start: click a tile on the map"}">🎯 Pick start${ui.nrPick ? ": on" : ""}</button> ` +
      `<button class="mini" data-action="nr-map" data-tip="Back to the new-run screen (Esc)">◀ Setup</button>${ui.nrMsg ? ` <span class="small">${esc(ui.nrMsg)}</span>` : ""}</div>`;
    return `<div class="paused" data-tip="${about}">` +
      `<b class="big">Setting up</b> ${ui.nrPick ? pickHow : `Looking at the map${keyHint({ key: "", touch: "", pad: ` · ${kh("Y")} to pick the start` })}`} <button data-action="nr-start" data-tip="Roll a new starting position on this same map and seed (the map, the hives and your colonists stay)">📍 New start position</button> <button data-action="nr-pick"${ui.nrPick ? ` class="primary"` : ""} data-tip="${ui.nrPick ? "Stop picking: clicks on the map look around again" : "Pick where you start: click a tile on the map"}">🎯 Pick start${ui.nrPick ? ": on" : ""}</button> <button data-action="nr-map" data-tip="Back to the new-run screen (Esc)">◀ Back to setup</button>${ui.nrMsg ? ` <span class="small">${esc(ui.nrMsg)}</span>` : ""}</div>`;
  }
  if (!ui.started || state.gameOver || state.combat || ui.timelapse) return "";
  let html = trayHTML(state, ui); // the card tray (ui/pacing.js)
  if (ui.speed === 0) {
    const waiting = armedList(state, ui);
    const n = waiting.length;
    const orders = n ? `${n} order${n === 1 ? "" : "s"} will start when you unpause: ${esc(waiting.join(" · "))}` : "";
    // A pill: ⏸ Paused · ▶ Run, the waiting orders a count (their list, why the clock stopped and the way to Help in the hover).
    if (compact) html += `<div class="paused compact" data-tip="The clock is stopped${ui.pauseWhy ? ` (${esc(ui.pauseWhy)})` : ""}. Orders you give now start when you unpause${n ? `. ${orders}` : ""}. Help → Time has the speeds and the pause rules."><b class="big">⏸ Paused</b>` +
      `<button data-action="speed" data-speed="${ui.lastSpeed || 1}" data-tip="Run at ${ui.lastSpeed || 1}× (Space)">▶ Run</button>` +
      (n ? `<b class="rs-badge armed" data-tip="${orders}">${n}</b>` : "") + `</div>`;
    // One short line; the rest is a hover description and Help → Time ("?").
    else html += `<div class="paused" data-tip="The clock is stopped. Orders you give now start when you unpause."><b class="big">Paused</b>${pauseWhyHTML(ui)} ${keyHint({ key: "<b>Space</b> to run", touch: "tap", pad: `${kh("Menu")} to run` })}` +
      `<button data-action="speed" data-speed="${ui.lastSpeed || 1}" data-tip="Run at ${ui.lastSpeed || 1}× (Space)">▶ Run</button>` +
      `<button class="mini" data-action="help-open" data-sec="time" data-tip="Help: time, pausing and speeds">?</button>` +
      (n ? `<span class="armed" data-tip="${esc(waiting.join(" · "))}">${n} order${n === 1 ? "" : "s"} will start when you unpause</span>` : "") + `</div>`;
  }
  html += fwPlaceBanner(state, ui); // ui/fieldworks.js: placing a field work
  html += meetPickBanner(state, ui); // ui/tradewindow.js: a tile to meet a group's caravan at
  if (ui.moveParty) {
    const cancel = pickCancel("move"); // a finger's ✕ Cancel (ui/responsive.js): with it, "✕ cancels" would say the same twice
    html += `<div class="movemode" data-tip="The clock waits until you pick a tile.">Move: <b>${pickWord()} a tile</b> to ${ui.moveQueue ? "queue a move" : "send the team"}${cancel ? "" : escCancels()}` + cancel +
      (ui.moveMsg ? `<br><span class="danger">${esc(ui.moveMsg)}</span>` : "") + `</div>`;
  }
  return html;
}

// ---------- dev tools: frame rate overlay ----------
// Measured in the real frame loop: frames per second and time between frames over the last second, the time
// this script spent per frame, and simulation hours ticked per second. Costs one check per frame when off.
const fpsLog = [];
let fpsShownAt = 0;
function fpsFrame(now, gap, work, ticks) {
  fpsLog.push({ t: now, gap, work, ticks });
  while (fpsLog.length > 2 && now - fpsLog[0].t > 1000) fpsLog.shift();
  if (now - fpsShownAt < 250) return;
  fpsShownAt = now;
  const el = $("fps");
  if (!el) return;
  const rest = fpsLog.slice(1); // each of these frames is measured from the one before it
  const span = Math.max(1, now - fpsLog[0].t);
  const avg = rest.length ? span / rest.length : 0;
  const worst = rest.length ? Math.max(...rest.map((f) => f.gap)) : 0;
  const workAvg = fpsLog.reduce((a, f) => a + f.work, 0) / fpsLog.length, workMax = Math.max(...fpsLog.map((f) => f.work));
  const tps = (rest.reduce((a, f) => a + f.ticks, 0) * 1000) / span;
  el.textContent = `${avg > 0 ? (1000 / avg).toFixed(0) : "–"} FPS\nframe ${avg.toFixed(1)} ms avg · ${worst.toFixed(1)} worst\nscript ${workAvg.toFixed(1)} ms avg · ${workMax.toFixed(1)} worst\nsim ${tps.toFixed(1)} ticks/s`;
}

// ---------- orders given while paused ----------
const partySig = (p) => `${p.phase}|${p.orderStart}|${p.dest}|${p.task ? p.task.type : ""}|${p.mission}|${(p.orders || []).length}`;
// Call before an action; returns what to compare with afterwards (null when the clock is not paused).
function armSnap() {
  if (!paused()) return null;
  const mine = state.parties.filter((p) => p.owner === "player");
  return {
    sig: new Map(mine.map((p) => [p.id, partySig(p)])),
    queue: new Map(mine.map((p) => [p.id, (p.orders || []).length])),
    builds: new Set(state.bases.flatMap((b) => b.construction.map((j) => j.id))),
    crafts: new Set(state.bases.flatMap((b) => craftQueue(b).map((j) => j.id))),
  };
}
function armDiff(before) {
  if (!before || !paused()) return;
  const a = ui.armed;
  for (const p of state.parties) {
    if (p.owner !== "player" || before.sig.get(p.id) === partySig(p)) continue;
    if (!a.parties.has(p.id)) a.parties.set(p.id, before.queue.get(p.id) || 0);
  }
  for (const b of state.bases) {
    for (const j of b.construction) if (!before.builds.has(j.id)) a.builds.add(j.id);
    for (const j of craftQueue(b)) if (!before.crafts.has(j.id)) a.crafts.add(j.id);
  }
}

// ---------- actions ----------
// The base a planner sends its team from: the hub, or (the move-out planner) the crowded base it was opened for.
const plannerBase = (pl) => (pl.fromBaseId != null ? baseById(state, pl.fromBaseId) : hub(state));
function autofill(pl) {
  const h = plannerBase(pl);
  if (!h) return; // no base to send a team from (the planner says so): exiles, hardcore before its first hub
  const ids = [...pl.crew];
  const v = plannerVehicle(state, pl);
  // Moving out (sim/moveout.js): to the destination picked, or (none yet) just outside the base; MOVE_OUT.days of
  // food and water on top for the road ahead, and the scrap for an outpost when they may found one.
  const out = !!pl.moveOut;
  // A plan with steps (ui/plan.js) packs for the whole plan; otherwise for the round trip. Estimated twice: what the
  // team packs is part of its load, and its load sets its pace and how much it eats on the way (sim/load.js).
  const n = Math.max(1, ids.length);
  // The bows and crossbows on the team shoot arrows (sim/world.js usesArrows): a dozen each (ARROWS.PACK).
  const archers = archerCount(ids.map((id) => survivorById(state, id)).filter(Boolean));
  let est = null;
  for (let pass = 0; pass < 2; pass++) {
    est = (!Parties.SETTLE_MISSIONS.includes(pl.mission) && !out && planAutofill(state, pl)) || estimateTrip(state, { memberIds: ids.length ? ids : [0], dest: pl.dest ?? h.tile, vehicle: travelMode(v), v, stance: pl.stance, supplies: pl.supplies, homeBaseId: h.id });
    view.preview = est && pl.dest != null ? est.path : null;
    if (!est) return;
    const ahead = out ? n * MOVE_OUT.days : 0;
    const want = {
      food: Math.ceil(est.food * 1.25 + ahead), water: Math.ceil(est.water * 1.25 + ahead * thirstAhead(state, MOVE_OUT.days)),
      fuel: (isCar(v) ? Math.max(0, Math.ceil(est.fuel * 1.25 - v.fuel)) : 0) + (pl.mission === "getvehicle" ? 10 : 0),
      meds: Math.min(2, n), ammo: (out ? MOVE_OUT.ammo : 15) * n, arrows: archers * ARROWS.PACK, parts: pl.mission === "getvehicle" || pl.mission === "investigate" ? 2 : 0,
      // Snares without snare wire in the hub's armory: 2 scrap of fence wire for each line (sim/hunting.js).
      scrap: pl.mission === "outpost" ? 15 : out ? (pl.dest == null ? MOVE_OUT.scrap : 0) : ((pl.plan && pl.plan.steps) || []).filter((s) => s.kind === "snare").length * (h.armory.some((it) => it && it.key === "snarewire") ? 0 : 2),
    };
    for (const k of Object.keys(want)) pl.supplies[k] = Math.max(0, Math.min(Math.floor(stockHas(h.stock, k)), want[k])); // water: both kinds, purified packed first (sim/water.js)
  }
  // A tube of purification tablets for a team going to fetch water or out more than two days (sim/worm.js packTablets).
  const fetches = ((pl.plan && pl.plan.steps) || []).some((s) => s.kind === "water");
  pl.tabs = armoryTabs(h).length > 0 && (fetches || (est.hours || 0) > TABS_TRIP_DAYS * 24);
  // Too heavy for the crew (and vehicle): less ammo, then fewer meds, then the 25% margin on food and water.
  if (!ids.length) return;
  const trim = (k, floor) => {
    const c = plannerLoad(state, pl);
    const over = c.load - c.cap;
    if (over > 0) pl.supplies[k] = Math.max(Math.min(pl.supplies[k], floor), pl.supplies[k] - Math.ceil(over / (SUPPLIES[k] ? SUPPLIES[k].weight : Parties.FOOD_PACK_KG))); // food: days of it (sim/parties.js)
  };
  trim("ammo", 5 * n);
  trim("meds", 1);
  trim("food", est.food);
  trim("water", est.water);
}

const partyById = (id) => state.parties.find((p) => p.id === Number(id));
// The move-out planner (ui.js moveOutModal, sim/moveout.js): who leaves a base, their transport and supplies from
// its stores, and where to (another of your bases, or a tile picked on the map once they are out).
function openMoveOut(baseId) {
  if (!baseById(state, baseId)) return;
  const pl = { moveOut: true, fromBaseId: baseId, dest: null, mission: "move", crew: new Set(), vehicleId: null, stance: "normal", supplies: {} };
  ui.planner = pl;
  ui.plannerError = "";
  endMoveMode();
  autofill(pl);
}
const baseOf = (d) => baseById(state, Number(d.base));
// A message from a base action: on the base screen when it is open, otherwise in the log.
function baseSay(msg) {
  if (!msg) return;
  if (ui.baseView) ui.baseMsg = msg;
  else log(state, msg, "info");
}
function endMoveMode() {
  ui.moveParty = null;
  ui.moveExit = null;
  ui.moveQueue = false;
  ui.moveMsg = "";
  view.preview = null;
}

// The team panel's order from a button's data (xp-order).
function xpOrderOf(d) {
  const o = { type: d.type };
  if (d.qty != null && d.qty !== "") o.qty = Number(d.qty);
  if (d.mission) o.mission = d.mission;
  if (d.type === "camp") o.hours = d.hours ? Number(d.hours) : null;
  if (d.sid) o.survivorId = Number(d.sid);
  if (d.recipe) o.recipe = d.recipe; // field crafting
  if (d.type === "sweep") Object.assign(o, sweepOpts({ radius: d.radius, hours: d.hours })); // a survey here (sim/survey.js)
  if (d.hours && d.type !== "camp") o.hours = Number(d.hours); // hunt, fish (sim/hunting.js)
  if (d.mode) o.mode = d.mode; // snares: set, check, lift
  if (d.type === "deadhunt") o.stance = d.stance || "normal"; // Hunt the dead (sim/deadhunt.js): Stealthy, Normal, Lure
  return o;
}
const actions = {
  // Dev fast-forward speeds never become the speed that Space goes back to.
  speed: (d) => { ui.speed = Number(d.speed) || 0; if (ui.speed > 0 && ui.speed <= MAX_SPEED) ui.lastSpeed = ui.speed; },
  tab: (d) => { ui.tab = d.tab; },
  "dev-toggle": () => { ui.dev = !ui.dev; },
  "dev-reveal": () => { view.devReveal = !view.devReveal; setPoiReveal(view.devReveal); }, // pois.js: every point of interest shows too
  "dev-infection": () => { view.layers.has("infection") ? view.layers.delete("infection") : view.layers.add("infection"); },
  "dev-fps": () => { ui.showFps = !ui.showFps; fpsLog.length = 0; fpsShownAt = 0; const el = $("fps"); if (el) el.textContent = "… FPS"; },
  // Autopilot: an AI governor runs the holdout (sim/autopilot.js). A battle or loot screen left open is finished for you.
  "dev-autopilot": () => {
    if (!ui.started || state.gameOver) return;
    if (!state.autopilot) { ui.cardResult = null; if (ui.inv && (ui.inv.loot || ui.inv.raid || ui.inv.peek)) { ui.inv = null; ui.invSel = null; } }
    setAutopilot(state, !state.autopilot);
  },
  "dev-persona": (d) => { setPersonality(state, d.v); },
  center: (d) => { centerOn(state, Number(d.tile)); ui.selected = Number(d.tile); view.selected = ui.selected; },
  help: () => openSettings(ui, "help"), // the menu's Help tab (ui/settings.js, ui/help.js)
  "pal-open": () => openPalette(), // the top bar's 🔍: the search box (ui/cmdpalette.js)
  legendtoggle: () => { ui.legendCollapsed = !ui.legendCollapsed; },
  // Panels around the map (ui/layout.js): fold or show one (data-p: left, right, log, alerts, legend), close
  // one completely or open it again (data-p: left, right, log: the strip's ✕, the top bar's ◧ ◨ ⬓, the tab at the
  // map's edge), map only (fold them all; again: back as they were), and the menu's reset (windows and panels as
  // they first were).
  "panel-toggle": (d) => foldPanel(d.p, d.v === undefined ? undefined : d.v === "1"),
  "panel-close": (d) => shutPanel(d.p, d.v === undefined ? undefined : d.v === "1"),
  // The folded left panel's rail (ui/windows.js): a tab's button opens the panel on that tab.
  "panel-tab": (d) => { ui.tab = d.tab; foldPanel("left", false); },
  "panel-all": () => { relayout(() => { toggleAll(layout); applyLayout(layout); }); saveLayout(layout); },
  "win-reset": () => {
    resetWindows();
    relayout(() => { resetLayout(layout); applyLayout(layout); });
    saveLayout(layout);
    if (ui.settings) { ui.settings.msg = "Windows and panels are back to their usual size and place."; ui.settings.err = false; }
  },
  "ov-reset": () => { // ui/overlaydrag.js: the boxes over the map back where they start
    resetOverlays();
    if (ui.settings) { ui.settings.msg = "The boxes over the map are back where they start."; ui.settings.err = false; }
  },
  // Base management.
  openbase: (d) => {
    if (!baseById(state, Number(d.id))) { log(state, "That base is gone.", "info"); return; }
    ui.baseView = { id: Number(d.id), tab: d.tab || "overview" };
    ui.baseMsg = "";
    ui.supplyForm = null;
  },
  basetab: (d) => { ui.baseView.tab = d.tab; ui.baseMsg = ""; },
  "wall-mat": (d) => { ui.baseView.wallMat = Number(d.mat) || 1; }, // the Defenses tab: the material the wall pieces are built of (sim/buildings.js WALL_TIERS)
  "wall-widen": (d) => { const b = baseOf(d); if (b) ui.baseMsg = widenRing(b); },
  cxtab: (d) => { ui.baseView.cx = d.tab; ui.baseView.tab = "construction"; ui.baseMsg = ""; }, // Construction: the Buildings or the Defenses list (from the Defence tab too)
  closebase: () => { ui.baseView = null; ui.baseMsg = ""; ui.supplyForm = null; },
  "win-close": () => { closeTopLayer(); }, // the ✕ in the corner of a window without a title bar of its own (ui/layout.js windowFrame): Esc
  // Supply runs (Supply runs tab of the base screen).
  // Hauling (ui/hauling.js, the Supply runs tab).
  "hl-add": (d) => { ui.baseMsg = haulAdd(state, ui, d.base); },
  "hl-del": (d) => { haulDel(state, d.id); },
  "hl-veh": (d) => { haulVeh(state, d.id); },
  "sr-new": (d) => { ui.supplyForm = jobForm(state, null, Number(d.base)); ui.supplyError = ""; },
  "sr-edit": (d) => {
    const j = supplyRunById(state, Number(d.id));
    if (!j) return;
    if (!baseById(state, j.originId)) { baseSay("That supply run's home base is gone. Recreate the job from another base, or delete it."); return; }
    ui.supplyForm = jobForm(state, j, j.originId, "edit");
    if (ui.baseView) ui.baseView.id = j.originId;
    ui.supplyError = "";
  },
  "sr-recreate": (d) => {
    const j = supplyRunById(state, Number(d.id));
    if (!j || !baseById(state, Number(d.base))) return;
    ui.supplyForm = jobForm(state, j, Number(d.base), "recreate");
    if (ui.baseView) ui.baseView.id = ui.supplyForm.originId;
    ui.supplyError = "";
  },
  "sr-cancel": () => { ui.supplyForm = null; ui.supplyError = ""; },
  "sr-save": () => {
    const res = saveSupplyRun(state, ui.supplyForm);
    if (res.error) { ui.supplyError = res.error; return; }
    ui.supplyForm = null;
    ui.supplyError = "";
    ui.baseMsg = `Supply run saved. ${res.job.nextDay != null && !res.job.partyId ? `First departure day ${res.job.nextDay}, or press Dispatch now.` : ""}`;
  },
  "sr-crew": (d) => { const c = ui.supplyForm.crew, id = Number(d.id); const i = c.indexOf(id); i >= 0 ? c.splice(i, 1) : c.push(id); },
  "sr-vehicle": (d) => { ui.supplyForm.vehicleId = d.v ? Number(d.v) : null; },
  "sr-stance": (d) => { ui.supplyForm.stance = d.v; },
  "sr-atdest": (d) => { ui.supplyForm.atDest = d.v; },
  "sr-sched": (d) => { ui.supplyForm.schedule = d.v; },
  "sr-partial": () => { ui.supplyForm.allowPartial = !ui.supplyForm.allowPartial; },
  "sr-addline": (d) => {
    const list = ui.supplyForm[d.list];
    list.push({ key: SUPPLY_KEYS.find((k) => !list.some((l) => l.key === k)) || "food", qty: 10 });
  },
  "sr-delline": (d) => { ui.supplyForm[d.list].splice(Number(d.i), 1); },
  // From the Teams tab (no base screen open) the answer goes to the log.
  "sr-dispatch": (d) => { const j = supplyRunById(state, Number(d.id)); if (j) baseSay(dispatchSupplyRun(state, j, true)); },
  "sr-pause": (d) => { const j = supplyRunById(state, Number(d.id)); if (j) baseSay(pauseSupplyRun(state, j, true)); },
  "sr-resume": (d) => { const j = supplyRunById(state, Number(d.id)); if (j) baseSay(pauseSupplyRun(state, j, false)); },
  "sr-release": (d) => { const j = supplyRunById(state, Number(d.id)); if (j) baseSay(releaseHeld(state, j, d.how)); },
  "sr-delete": (d) => {
    const j = supplyRunById(state, Number(d.id));
    if (!j || ask(ui, d, "sr-delete", { kind: "delrun", title: "Delete this supply run?", text: "Its schedule, crew, cargo lists and stops are gone for good (a convoy already on the road finishes its trip).", yes: "Delete it" })) return;
    baseSay(deleteSupplyRun(state, j));
  },
  makemedic: (d) => { const s = survivorById(state, Number(d.id)); ui.baseMsg = makeMedic(state, s); if (s && s.location.kind === "base") assignStations(state, baseById(state, s.location.baseId)); }, // a graduated trainee (sim/training.js)
  "tier-place": (d) => { const b = baseOf(d); if (b) openForJob(state, ui, b, d.type); }, // a step up (sim/buildings.js tierUp): the build map opens with it picked to place or move
  "tier-pick": (d) => { const b = baseOf(d); if (b && !openToPlace(state, ui, b, d.type)) ui.baseMsg = "The build map cannot open now."; }, // a step up not queued yet: the build map opens with it picked from the Build list, queued where it is clicked (ui/basemap.js openToPlace)
  queuebuild: (d) => { const b = baseOf(d), n = b ? b.construction.length : 0; ui.baseMsg = queueBuild(state, b, d.type, { ...(d.mat ? { mat: Number(d.mat) } : {}), ...(d.kind ? { kind: d.kind } : {}) }); if (b && b.construction.length > n) openForJob(state, ui, b, d.type); }, // a building with a footprint: the base map opens to place its outline (ui/basemap.js)
  // Construction tab (sim/buildings.js): a water barrel's next tier, and pulling a building down (asks first: ui/confirm.js) to free its plot.
  "barrel-up": (d) => { ui.baseMsg = queueBarrelUpgrade(state, baseOf(d), Number(d.id)); },
  "bunk-expand": (d) => { ui.baseMsg = queueBunkhouseExpand(state, baseOf(d), Number(d.id)); },
  "reload-up": (d) => { ui.baseMsg = queueReloadUpgrade(state, baseOf(d), Number(d.id)); }, // sim/reloading.js: an ammo bench into a reloading bench
  "canner-up": (d) => { ui.baseMsg = queueCannerUpgrade(state, baseOf(d), Number(d.id)); }, // sim/buildings.js: a pressure canner fitted to a preserving room (machines-2)
  "gen-up": (d) => { ui.baseMsg = queueGenUpgrade(state, baseOf(d), Number(d.id)); }, // sim/buildings.js: a generator upgraded a tier where it stands (gen-tiers)
  demolish: (d) => {
    const id = Number(d.id), b = baseOf(d), what = b && b.buildings.find((x) => x.id === id);
    const name = what && BUILDINGS[what.type] ? BUILDINGS[what.type].name : "this building";
    if (ask(ui, d, "demolish", { kind: "demolish", title: `Pull down ${name}${b ? ` at ${b.name}` : ""}?`, text: `It is gone for good and its plot is free again. About half its scrap and parts come back${what ? ` (${demolishText(what)})` : ""}.`, yes: "Pull it down" })) return;
    ui.baseMsg = demolish(state, b, id);
    if (state.combat && state.combat.layout && b && !b.buildings.some((x) => x.id === id)) { state.combat.layout.pick = null; refreshBaseMap(state); state.combat.layout.msg = ui.baseMsg; } // a wall piece pulled down on the base map (ui/basemap.js)
  },
  // The camp fire (sim/fieldheat.js): a camp's or shelter's (data-base) or a resting team's (data-team).
  campfire: (d) => {
    const lit = d.lit === "1";
    if (d.base) { ui.baseMsg = setFire(state, baseOf(d), lit); return; }
    if (d.team) { ui.xpMsg = setFire(state, partyById(d.team), lit); return; }
  },
  // Break out (sim/poirooms.js, issue #71): a camp inside a POI that is cut off fights a route open on its map.
  breakout: (d) => { const b = baseOf(d); if (!b) return; const why = breakOut(state, b.id); ui.baseMsg = why || ""; if (!why && state.combat) ui.baseView = null; },
  // Strike camp (sim/staging.js strikeCamp): everyone there forms a team with what they can carry; the rest is a cache.
  strikecamp: (d) => {
    const b = baseOf(d);
    if (!b) return;
    if (ask(ui, d, "strikecamp", { kind: "strikecamp", title: `${STRIKE_LABEL}: ${b.name}?`, text: "Everyone there forms one team with the vehicles that run and what they can carry of the stores and armory (water and food first). What is left stays on the tile as a cache to recover, and the camp is gone.", yes: STRIKE_LABEL })) return;
    const r = strikeCamp(state, b);
    if (r.error) { ui.baseMsg = r.error; return; }
    ui.baseView = null; ui.baseMsg = "";
    if (r.party) { ui.expedition = r.party.id; ui.xpMsg = r.text; }
    else log(state, r.text, "info");
  },
  // Medical: treat at a base with the base's meds. In the field it is a 1-hour team order (xp-order, type treat).
  treat: (d) => { baseSay(treatAtBase(state, baseOf(d), Number(d.id))); },
  cancelbuild: (d) => { ui.baseMsg = cancelBuild(state, baseOf(d), Number(d.id)) || "Cancelled."; },
  // Hand crafting (base Crafting tab).
  queuecraft: (d) => { ui.baseMsg = queueCraft(state, baseOf(d), d.recipe); },
  cancelcraft: (d) => { ui.baseMsg = cancelCraft(state, baseOf(d), Number(d.id)); },
  refuel: (d) => { ui.baseMsg = refuel(state, baseOf(d), state.vehicles.find((v) => v.id === Number(d.id))); },
  repairv: (d) => { ui.baseMsg = repair(state, baseOf(d), state.vehicles.find((v) => v.id === Number(d.id))); },
  vupgrade: (d) => { ui.baseMsg = queueUpgrade(state, baseOf(d), state.vehicles.find((v) => v.id === Number(d.id)), d.key, d.op || "fit"); }, // sim/vehicles.js: a garage job (glass, plating)
  vgaragecancel: (d) => { ui.baseMsg = cancelGarageJob(state, baseOf(d), Number(d.id)); },
  stripv: (d) => {
    const v = state.vehicles.find((x) => x.id === Number(d.id));
    if (!v || ask(ui, d, "stripv", { kind: "stripv", title: `Strip the ${v.name} for parts?`, text: "It is gone for good: car parts by its condition, scrap and the fuel in its tank go into the base's stores.", yes: "Strip it" })) return;
    ui.baseMsg = stripVehicle(state, baseOf(d), v); // vehicles.js
  },
  burybody: (d) => { ui.baseMsg = buryBody(state, baseOf(d), Number(d.id)); }, // sim/carriers.js: a body brought home
  burnbody: (d) => { ui.baseMsg = burnBodyHome(state, baseOf(d), Number(d.id)); },
  survivor: (d) => { ui.survivor = Number(d.id); },
  // A captive's line (People tab, sim/ransom.js): ask their captors' price; send the team to an agreed handover.
  "rescue-talk": (d) => { const msg = openNegotiation(state, Number(d.id)); if (msg) log(state, msg, "info"); },
  "rescue-send": (d) => { const deal = dealsOf(state).find((x) => x.id === Number(d.id)); const r = deal ? sendHandover(state, deal) : "That deal is off."; if (typeof r === "string") log(state, r, "info"); },
  closesurv: () => { ui.survivor = null; ui.lookEdit = null; ui.relMsg = ""; ui.skillTree = null; ui.skillMsg = ""; },
  unequip: (d) => {
    const s = survivorById(state, Number(d.id));
    const b = baseOf(d);
    if (!s || !b) return;
    if (s.gear[d.slot]) b.armory.push(s.gear[d.slot]);
    s.gear[d.slot] = null;
  },
  // Teams and orders.
  orders: (d) => {
    const p = partyById(d.id);
    if (p && !state.cards.some((c) => c.partyId === p.id)) addCard(state, ordersCard(state, p, ""));
  },
  "pick-cancel": (d) => { if (d.what === "move") endMoveMode(); else if (d.what === "fw") fwPlaceCancel(ui); else meetPickCancel(ui); },
  // The map's keys as buttons on a phone or tablet (ui/responsive.js): N / Shift+N, Shift+1–9 / Ctrl+1–9.
  "team-next": (d) => { nextWaitingTeam(state, ui, actions, d.back === "1"); },
  "cam-spot": (d) => { camSpot(state, ui, d.n, d.save === "1"); },
  movemode: (d) => {
    const on = ui.moveParty !== Number(d.id);
    endMoveMode();
    if (on) ui.moveParty = Number(d.id);
    ui.baseView = null;
    const p = partyById(d.id);
    if (p) centerOn(state, partyTile(p));
  },
  gohome: (d) => {
    const p = partyById(d.id);
    if (!p) return;
    startReturn(state, p);
    if (!state.parties.includes(p) || p.phase === "back") log(state, "Team ordered home.", "info");
  },
  // Team panel (right sidebar) and the order queue. Orders given while paused start when the clock runs again.
  "xp-open": (d) => { if (ui.expedition !== Number(d.id)) ui.qSel = null; ui.expedition = Number(d.id); ui.xpMsg = ""; const p = partyById(d.id); if (p && contactable(p)) { ui.selected = partyTile(p); view.selected = ui.selected; } },
  "xp-close": () => { ui.expedition = null; ui.xpMsg = ""; ui.qSel = null; },
  "xp-queuemode": () => { ui.xpQueue = !ui.xpQueue; },
  "xp-night": (d) => { const p = partyById(d.id); if (p && (contactable(p) || commandable(state, p))) ui.xpMsg = setNightPlan(state, p, d.plan); }, // sim/nightmarch.js
  "xp-order": (d) => {
    const p = partyById(d.id);
    if (!p || !(contactable(p) || commandable(state, p))) return; // the radio rule is checked for every team order below
    // ui/landorder.js: a land job's hours and what they would bring (where it starts: here, or where the queue ends)
    const now = startsNow(p);
    if (askLand(state, ui, d, { via: "xp", type: d.type, tile: now ? partyTile(p) : queueEndTile(state, p), startHour: state.hour + (now ? 0 : queueAhead(state, p)) })) return;
    // ui/whopick.js: who does it (a team of two or more; the land jobs asked it in their box above)
    if (!asksHours(d.type) && splittable([xpOrderOf(d)]) && askWho(state, ui, d, { via: "xp", label: describeOrder(state, xpOrderOf(d)) })) return;
    if (askQty(state, ui, d)) return; // ui/carry.js: how much water to fetch (the box gives d.qty)
    const o = xpOrderOf(d);
    // Some of the team picked (sim/detach.js): they go off and do it now; the rest stay.
    const who = whoIds(d.who);
    if (who && isSome(state, p, who) && splittable([o])) {
      const r = detach(state, p, who, (q) => startOrder(state, q, o), { type: o.type, job: o.type !== "move" });
      ui.xpMsg = r.text;
      log(state, r.text, "info");
      return;
    }
    issueOrder(p, o);
  },
  // Build a boat and cross one water tile (sim/crossing.js). Hours and materials are fixed now.
  "xp-cross": (d) => {

    const p = partyById(d.id);
    if (!p) return;
    const o = boatOrder(state, p, startsNow(p) ? partyTile(p) : queueEndTile(state, p), Number(d.tile), d.mode);
    if (o.error) { ui.xpMsg = o.error; return; }
    issueOrder(p, o);
  },
  "xp-move": (d) => {
    const p = partyById(d.id);
    if (!p) return;
    endMoveMode();
    ui.moveParty = p.id;
    // A team on the move (or with queue mode on) gets the move added to its queue.
    ui.moveQueue = !startsNow(p);
    centerOn(state, ui.moveQueue ? queueEndTile(state, p) : partyTile(p));
  },
  "xp-stop": (d) => { const p = partyById(d.id); if (p) ui.xpMsg = stopTask(state, p); },
  "xp-callback": (d) => { const q = partyById(d.id); if (q) { ui.xpMsg = callBack(state, q); log(state, ui.xpMsg, "info"); } }, // sim/detach.js: some of a team out on a job, back now
  "xp-resume": (d) => { const p = partyById(d.id); if (p) ui.xpMsg = resumeQueue(state, p); },
  "xp-unqueue": (d) => {
    const p = partyById(d.id);
    if (!p) return;
    const i = Number(d.i);
    ui.xpMsg = removeQueued(state, p, i);
    if (ui.qSel != null && ui.expedition === p.id) ui.qSel = ui.qSel === i ? null : ui.qSel > i ? ui.qSel - 1 : ui.qSel; // the selection follows its order
  },
  "xp-clearq": (d) => { const p = partyById(d.id); if (p) { p.orders = []; ui.xpMsg = "Queue cleared."; ui.qSel = null; } },
  // The queue's "Now" line: cancel the move under way (sim/orders.js cancelMove; the team stops where it is).
  "xp-cancelmove": (d) => { const p = partyById(d.id); if (p) ui.xpMsg = cancelMove(state, p); },
  // Reordering the queue: select a line (click; again to unselect), move it with ▲ ▼ (or ↑ ↓, keydown below),
  // or drag it onto another line (xp-qdrop, from the drop listener). The selection follows the order it was on.
  "xp-qsel": (d) => { const i = Number(d.i); ui.qSel = ui.qSel === i ? null : i; },
  "xp-qmove": (d) => {
    const p = partyById(d.id);
    if (!p) return;
    const i = Number(d.i), to = i + Number(d.dir);
    const msg = reorderQueued(state, p, i, to);
    if (!msg) return;
    ui.xpMsg = msg;
    if (ui.expedition === p.id && (ui.qSel === i || ui.qSel == null)) ui.qSel = to;
  },
  "xp-qdrop": (d) => {
    const p = partyById(d.id);
    if (!p) return;
    const from = Number(d.from), to = Number(d.to);
    const msg = reorderQueued(state, p, from, to);
    if (!msg) return;
    ui.xpMsg = msg;
    if (ui.expedition === p.id && ui.qSel != null) ui.qSel = ui.qSel === from ? to : from < ui.qSel && to >= ui.qSel ? ui.qSel - 1 : from > ui.qSel && to <= ui.qSel ? ui.qSel + 1 : ui.qSel;
  },
  radiotalk: (d) => { log(state, radioTalk(state, factionById(state, Number(d.id))), "info"); },
  routesetup: (d) => {
    ui.routeSetup = { factionId: Number(d.id), sendKey: "food", sendQty: 20, recvKey: "a_9mm_fmj", recvQty: 60, interval: 5, escort: "standard", escortIds: new Set() };
  },
  "rt-escort": (d) => { ui.routeSetup.escort = d.v; ui.routeSetup.escortIds = new Set(); },
  "rt-crew": (d) => {
    const set = ui.routeSetup.escortIds, id = Number(d.id);
    if (set.has(id)) set.delete(id);
    else if (set.size < ESCORTS[ui.routeSetup.escort].people) set.add(id);
  },
  "rt-cancel": () => { ui.routeSetup = null; },
  "rt-create": () => {
    const r = ui.routeSetup;
    if (!routeCheck(state, r).ok) return; // the form says why and keeps Start disabled
    if (TradeSim.createRoute) {
      // trade.js checks the terms again and sets the route up.
      if (TradeSim.createRoute(state, { ...r, escortIds: [...r.escortIds] }).error) return;
    } else {
      const route = { id: newId(), factionId: r.factionId, sendKey: r.sendKey, sendQty: r.sendQty, recvKey: r.recvKey, recvQty: r.recvQty, interval: Math.max(2, r.interval), escort: r.escort, escortIds: [...r.escortIds], nextDay: day(state), active: true };
      state.routes.push(route);
      for (const id of route.escortIds) survivorById(state, id).location = { kind: "route", routeId: route.id };
      log(state, `Trade route to ${factionById(state, r.factionId).name} set up. The first convoy leaves at the next dawn.`, "good");
    }
    ui.routeSetup = null;
  },
  cancelroute: (d) => {
    const r = state.routes.find((x) => x.id === Number(d.id));
    if (!r) return;
    const rf = factionById(state, r.factionId);
    if (ask(ui, d, "cancelroute", { kind: "endroute", title: `End the trade route${rf ? ` with ${rf.name}` : ""}?`, text: "No more convoys go; its escorts come home. A new route needs the trade pact and the setup again.", yes: "End the route" })) return;
    r.active = false;
    releaseEscorts(state, r);
    log(state, "Trade route ended.", "info");
  },
  plan: (d) => {
    const pl = { dest: Number(d.tile), mission: d.mission, crew: new Set(), vehicleId: null, stance: "normal", supplies: {} };
    if (d.preset) applyPreset(pl, d.preset); // "Hunting trip" / "Fishing trip" (right-click, tile panel)
    ui.planner = pl;
    ui.plannerError = "";
    endMoveMode();
    autofill(pl);
    useArmedTemplate(state, ui, pl, autofill); // a template picked on the Teams tab (ui/trips.js)
    hideCtx();
  },
  "pl-tabs": () => { ui.planner.tabs = !ui.planner.tabs; ui.plannerError = ""; }, // a tube of purification tablets from the armory
  "pl-lights": () => { ui.planner.lights = ui.planner.lights === false; ui.plannerError = ""; }, // a light each from the armory (sim/lights.js), on by default
  "pl-spares": () => { ui.planner.spares = ui.planner.spares === false; ui.plannerError = ""; }, // spare car parts for a long drive (sim/vehicles.js carSpares), on by default
  "pl-crew": (d) => { const s = ui.planner.crew, id = Number(d.id); s.has(id) ? s.delete(id) : s.add(id); autofill(ui.planner); ui.plannerError = ""; },
  "pl-vehicle": (d) => { // ui/fleetpick.js: up to four vehicles, click to take or leave each; vehicleId the lead
    const pl = ui.planner;
    const r = toggleFleetIds(state, pl.vehicleIds && pl.vehicleIds.length ? pl.vehicleIds : pl.vehicleId ? [pl.vehicleId] : [], d.v ? Number(d.v) : null);
    pl.vehicleIds = r.ids;
    pl.vehicleId = leadId(state, r.ids);
    autofill(pl);
    ui.plannerError = r.msg;
  },
  "pl-stance": (d) => { ui.planner.stance = d.v; autofill(ui.planner); },
  "pl-autofill": () => { autofill(ui.planner); ui.plannerError = ""; },
  "pl-cancel": () => { ui.planner = null; view.preview = null; },
  // The move-out planner's destination: another of your bases, or "" (pick a tile on the map once they are out).
  "pl-dest": (d) => { ui.planner.dest = d.tile === "" || d.tile == null ? null : Number(d.tile); autofill(ui.planner); ui.plannerError = ""; },
  moveout: (d) => openMoveOut(Number(d.base)),
  // sim/occupy.js: Abandon outpost, asked on a card first.
  abandonbase: (d) => {
    const b = baseById(state, Number(d.base));
    const why = abandonProblem(state, b);
    if (why) { ui.baseMsg = why; return; }
    if (!state.cards.some((c) => c.abandonBase === b.id)) addCard(state, abandonCard(state, b));
    ui.baseView = null;
  },
  "pl-launch": () => {
    const pl = ui.planner;
    const c = plannerLoad(state, pl);
    if (c.over) { ui.plannerError = c.why; return; }
    if (pl.moveOut) {
      const res = moveTeamOut(state, { baseId: pl.fromBaseId, memberIds: [...pl.crew], dest: pl.dest, stance: pl.stance, vehicleId: pl.vehicleId, vehicleIds: pl.vehicleIds || [], supplies: { ...pl.supplies }, tabs: !!pl.tabs, lights: pl.lights !== false });
      if (res.error) { ui.plannerError = res.error; return; }
      ui.planner = null;
      view.preview = null;
      ui.baseView = null;
      // Nowhere picked yet: straight to move mode, so the next click on the map sends them (Esc: they wait outside).
      if (pl.dest == null) {
        endMoveMode();
        ui.moveParty = res.party.id;
        ui.expedition = res.party.id;
        ui.xpMsg = "";
        centerOn(state, partyTile(res.party));
      }
      return;
    }
    const res = launchExpedition(state, { memberIds: [...pl.crew], dest: pl.dest, mission: pl.mission, stance: pl.stance, vehicleId: pl.vehicleId, vehicleIds: pl.vehicleIds || [], supplies: { ...pl.supplies }, packFood: pl.packFood || null, plan: Parties.SETTLE_MISSIONS.includes(pl.mission) ? null : planLaunchOpts(pl), sweep: pl.sweep, tabs: !!pl.tabs, lights: pl.lights !== false, spares: pl.spares !== false });
    if (res.error) { ui.plannerError = res.error; return; }
    rememberLaunch(state, res.party, pl); // sim/trips.js: for Repeat trip when it gets home, and its retreat policy
    plannerVolAsk(state, pl, res.party); // ui/volunteers.js: volunteers asked for in the planner (the answer is in the log)
    ui.planner = null;
    view.preview = null;
  },
  choice: (d) => {
    const card = state.cards[0];
    const c = card && card.choices[Number(d.i)];
    if (!c) return;
    state.cards.shift();
    // Answering a team's card is a moment of contact: orders from its panel work for the rest of this hour.
    if (card.partyId != null) { const cp = partyById(card.partyId); if (cp) cp.contactHour = state.hour; }
    const text = c.resolve(state);
    if (Parties.pruneCards) Parties.pruneCards(state); // cards about a team or person that is gone now (parties.js)
    // sim/poiwalk.js: a place picked on the POI dialogue is walked to first, and the clock stays stopped until you run it.
    // The tile view (ui/poipick.js) follows the walk: the team's dot moves on the tile map as the clock runs.
    const walker = card.poiPick ? partyById(card.partyId) : null;
    if (walker && walker.phase === "task" && walker.task && walker.task.type === "poiwalk") {
      if (ui.speed > 0) { if (ui.speed <= MAX_SPEED) ui.lastSpeed = ui.speed; ui.speed = 0; }
      const w = walker.task;
      ui.pauseWhy = w.exit ? `Ready to walk to the tile's edge (${w.mins} min), then on to ${w.name}` : `Ready to walk to ${String(w.name).toLowerCase()} (${w.mins} min), then raid it`;
      ui.tileView = { partyId: walker.id };
    }
    if (c.uiAction && c.uiAction.type === "saveFight") saveBeforeFight(state, ui, c.uiAction.name); // sim/loneattack.js: "Save and fight": the game saved as the fight opens
    if (c.uiAction && c.uiAction.type === "move") {
      endMoveMode();
      ui.moveParty = c.uiAction.partyId;
      if (c.leavePick) ui.moveExit = c.uiAction.partyId; // the POI dialogue's "Leave for another tile…": the walk to the edge first (pickMove)
      const p = partyById(c.uiAction.partyId);
      if (p) centerOn(state, partyTile(p));
      return;
    }
    if (c.uiAction && c.uiAction.type === "expedition") {
      actions["xp-open"]({ id: c.uiAction.partyId });
      return;
    }
    if (c.uiAction && c.uiAction.type === "plan") { // sim/hivebirth.js: the planner aimed at a gathering or a new hive
      centerOn(state, c.uiAction.tile);
      actions.plan({ tile: c.uiAction.tile, mission: c.uiAction.mission });
      return;
    }
    if (c.uiAction && c.uiAction.type === "volpick") { openVolPick(ui, c.uiAction.askId); return; } // sim/volunteers.js: a group's ask, choose who goes
    if (c.uiAction && c.uiAction.type === "moveout") { openMoveOut(c.uiAction.baseId); return; } // the Overcrowded card (sim/moveout.js)
    if (c.uiAction && c.uiAction.type === "basemap") { const why = openBuildMap(state, ui, c.uiAction.baseId); if (why) ui.cardResult = { title: card.title, text: why }; return; } // sim/staging.js: Open the build map (a camp set up, a base gone up a tier)
    if (c.uiAction && c.uiAction.type === "meetCaravan") { // a group asked to meet halfway (sim/trademeet.js): the planner aimed at the tile
      if (!openMeetPlan(state, ui, c.uiAction.factionId) && text) ui.cardResult = { title: card.title, text };
      return;
    }
    if (c.uiAction && c.uiAction.type === "radioCaravan") { // a group asked you to bring your side (sim/radiotrade.js): the planner for that deal
      const deal = radioDeals(state).find((x) => x.factionId === c.uiAction.factionId);
      if (deal) TRADE_ACTIONS["rd-dealcaravan"](state, ui, { id: deal.id });
      else if (text) ui.cardResult = { title: card.title, text };
      return;
    }
    // Orders that take time, and choices that open a battle: the result goes to the log instead of a screen.
    if (c.order || state.combat) {
      if (text) log(state, text, "info");
      return;
    }
    // Orders that lead straight into another card skip the result screen.
    if (text) ui.cardResult = { title: card.title, text };
  },
  cardok: () => { ui.cardResult = null; },
  // The POI dialogue (ui/poipick.js): a place picked on its tile map or in its list; the list of places opened or folded.
  poisel: (d) => { const c = state.cards[0]; if (c && c.poiPick) c.poiPick.sel = Number(d.poi); },
  poilist: () => { const c = state.cards[0]; if (c && c.poiPick) c.poiPick.list = !c.poiPick.list; },
  // The tile view (ui/poipick.js): closed (the walk goes on), or the walk stopped (the team waits where it was).
  "tv-close": () => { ui.tileView = null; },
  "tv-stop": () => { const p = ui.tileView && partyById(ui.tileView.partyId); if (p) log(state, stopTask(state, p), "info"); ui.tileView = null; },
  // The card's "Retreat if it goes badly" buttons (breakoff.js): kept on the team for fights resolved by the numbers.
  "retreat-policy": (d) => { const card = state.cards[0]; const p = card && card.partyId != null ? partyById(card.partyId) : null; if (p) setTeamPolicy(state, p, d.v); },
  approach: (d) => { state.engagement.approach = d.v; },
  engscout: (d) => { const p = engagementParty(state); if (p && !engScout(state, p, Number(d.id))) tickHour(state); }, // sim/raidplan.js: the scout's hour
  engnight: () => { engWaitNight(state); }, // sim/raidplan.js: the clock runs to nightfall
  search: () => { searchHour(state); tickHour(state); },
  extract: () => { extract(state); },
  engclose: () => { state.engagement = null; },
  offer: (d) => { const o = state.trade.offer; o[d.k] = Math.max(0, (o[d.k] || 0) + Number(d.d)); ui.tradeMsg = ""; },
  ask: (d) => { const o = state.trade.ask; o[d.k] = Math.max(0, (o[d.k] || 0) + Number(d.d)); ui.tradeMsg = ""; },
  dotrade: () => { ui.tradeMsg = executeTrade(state); },
  gift: () => { ui.tradeMsg = giftAll(state); },
  pact: (d) => { const f = factionById(state, state.trade.factionId); ui.tradeMsg = proposePact(state, f, d.k); },
  tradeleave: () => TRADE_ACTIONS.tradeleave(state, ui), // ui/tradewindow.js (the trade window's own handler)
  reroll: () => gen(() => newWorld(randomSeed()), null),
  // New start position (ui/newgame.js): where you start rolled again on the same map and seed (sim/startpick.js), away
  // from where it is now. The crew on screen is carried over as edited (the groups' dice move with the start, and a
  // normal start's colonists come after them); looking at the map stays open so the new spot can be seen.
  "nr-start": () => {
    if (ui.started) return;
    realThen(() => gen(() => { // the real map first (a preview's start is on its tiny one), then the new spot on it
      const was = playerTile(state), onMap = ui.nrMap;
      ui.startPick = { roll: 1 + Math.floor(Math.random() * 2147483646), not: was };
      ui.crewEdited = true;
      newWorld(state.seed, true, null, true); // the real map: the new spot is on it
      ui.nrMap = onMap;
      ui.nrPick = false; // the dice's start again
      const now = playerTile(state);
      ui.nrMsg = now === was ? "There is nowhere else to start on this map: try another seed or size."
        : `New start position: ${state.bases[0] ? state.bases[0].name : isCrashRun(state) ? "another crash site, your unit's base across the map from it" : "another spot on the road"}, ${state.grid.distance(was, now)} hexes from the last one.${onMap ? "" : " View map to see it."}`;
    }, state.seed, true));
  },
  // Random run (ui/newgame.js rollRandomRun): every setting rolled, a new seed, a random crew and its gear, then Start.
  // The settings are rolled before gen (the box names the size rolled); the steps inside build under the one box.
  "nr-random": () => {
    if (ui.started) return;
    const line = rollRandomRun(ui, freshRng());
    gen(() => {
      newWorld(randomSeed());
      if (ui.freeEdit && !ui.ironman) { // Customize: random builds within the points (and the starting vehicles' backs to their limits)
        const before = state;
        actions["nr-everything"]();
        if (state === before) actions["nr-allcrew"]();
      } else actions["nr-allcrew"](); // a new seed's crew is the dice's already; this shuffles the gear among them too
      actions.begin(); // the real map is built there (a preview until then), under this box
      if (ui.started) log(state, line, "info");
    }, null, true);
  },
  // New map (the new-run screen): a new seed with the survivors as they are (names, looks, skills, traits, the leader,
  // a Customize build); who they were is kept too, the dice's ones carried as rolled (ui/newgame.js crewWithBackgrounds).
  "nr-newmap": () => {
    if (ui.started) return;
    gen(() => {
      const crew = crewSnapshot(state).map((c, i) => (c.background || !state.survivors[i].background ? c : { ...c, background: state.survivors[i].background, rolled: true }));
      newWorld(randomSeed(), true, { crew, crewRoll: ui.crewRoll, pickRoll: ui.pickRoll });
    }, null);
  },
  // Randomize all (ui/newgame.js): in Hardcore the world is built again on the same seed with the new crew roll.
  "nr-allcrew": () => gen(() => { state = randomizeAllCrew(state, ui, (crew, crewRoll, pickRoll) => { newWorld(state.seed, true, { crew, crewRoll, pickRoll }); return state; }); }),
  // Randomize everything (Customize, ui/newgame.js): every colonist's build and every starting vehicle's back to its limit, the world built again.
  "nr-everything": () => gen(() => { state = randomizeEverything(state, ui, (crew, crewRoll, pickRoll) => { newWorld(state.seed, true, { crew, crewRoll, pickRoll }); return state; }); }),
  // A crew card's Background: a random preset, as picking it in Background does (ui/newgame.js randomBackground).
  "nr-rand-bg": (d) => {
    const s = survivorById(state, Number(d.id));
    if (!s || ui.ironman || ui.started || isCrashRun(state)) return; // Crashlanding: the background is the soldier's
    const key = randomBackground(state, s);
    const crew = key && crewWithBackground(state, s.id, key);
    if (!crew) return;
    const i = state.survivors.indexOf(s);
    gen(() => { newWorld(state.seed, true, pickRebuild(crew)); pointsLoad([i]); });
  },
  // A crew card's Gear and All (ui/newgame.js): the world again on the same seed where they need it (under the box
  // either way: a draw that builds nothing lets it go within two frames).
  "nr-rand-gear": (d) => gen(() => { state = randomizeGear(state, ui, survivorById(state, Number(d.id)), cardRebuild); }),
  "nr-all": (d) => gen(() => { state = randomizeOne(state, ui, survivorById(state, Number(d.id)), cardRebuild); }),
  // 👁 Inventory's 🎲 Reroll what they carry (ui/newgame.js rerollCarried): the world again as the card's Gear builds it,
  // the window still open on the same survivor with what they carry now.
  "crew-inv-reroll": (d) => gen(() => { const keep = ui.crewInv; state = rerollCarried(state, ui, state.survivors[Number(d.i)], cardRebuild); ui.crewInv = keep && state.survivors[keep.i] ? keep : null; }),
  "bg-close": () => closeBackgrounds(), // Done in the custom backgrounds window: the world is built again if a colonist's background changed
  pickleader: (d) => { state.survivors.forEach((s) => (s.leader = s.id === Number(d.id))); ui.crewEdited = true; },
  // A new game starts paused: look around and give the first orders, then press Space.
  begin: () => {
    // Ironman starts with the crew as rolled (ui/newgame.js): the Ironman box puts it back, this is the last word.
    if (ui.ironman && crewCustomized(state)) { ui.nrMsg = "Ironman starts with the crew as rolled: untick Ironman to keep your customized colonists, or tick it again to put them back."; return; }
    // Customize (sim/custompoints.js): nobody may start over their points.
    const over = ui.freeEdit && !ui.ironman ? overText(state) : "";
    if (over) { ui.nrMsg = over; return; }
    // Starting vehicles (sim/startfleet.js, every mode): no back over its own point limit or its room.
    const fleetOver = fleetText(state);
    if (fleetOver) { ui.nrMsg = fleetOver; return; }
    // The map is built now (the user's request 2026-10-24): the screen's world was a preview; the same crew goes in.
    if (isPreview(state)) { realThen(() => actions.begin()); return; }
    ui.started = true;
    ui.speed = 0;
    ui.lastSpeed = 1;
    ui.lookEdit = null;
    ui.nrMsg = "";
    state.started = true;
    state.campaign = newCampaignId(); // ui/saves.js: this run's saves group together and its autosaves rotate
    // Ironman (ui/settings.js): one slot the game writes itself, no saving or loading by hand, no going back.
    if (ui.ironman) {
      state.ironman = { id: `iron${Date.now().toString(36)}`, since: Date.now() };
      log(state, "Ironman: this game saves itself (at dawn, when a battle starts and ends, when you leave it). There is no going back.", "info");
    }
    if (ui.childrenOff) state.childrenOff = true; // the new-run screen's Children box (sim/family.js)
    // The World… dials (ui/worldcfg.js): in the world since it was built (createWorld); said once in the log, and kept for the next run here.
    if (!isDefaultCfg(state.worldCfg)) log(state, `World configuration: ${cfgSummary(state.worldCfg)}`, "info");
    if (JSON.stringify(options.worldCfg || null) !== JSON.stringify(isDefaultCfg(uiCfg(ui)) ? null : uiCfg(ui))) { options.worldCfg = isDefaultCfg(uiCfg(ui)) ? null : { ...uiCfg(ui) }; saveOptions(options); }
    if (crewCustomized(state)) state.customStart = true; // customized on the new-run screen (Customize, custom backgrounds)
    clearStartGear(state); // sim/startgear.js: picked gear is ordinary gear from here on
    loadUpAll(state); // sim/itemacts.js: every gun and magazine your people carry loaded with real rounds (what each carries, then the hub's stores): the badges count only rounds that are in them (2026-10-20)
    ui.gearEdit = null;
    ui.fleetEdit = null;
    ui.fleetView = null;
    ui.crewInv = null;
    assignStartingRoles(state); // jobs by skill, after any edits made on this screen (world.js)
    centerOn(state, playerTile(state));
    const lead = state.survivors.find((s) => s.leader) || state.survivors[0];
    if (lead) log(state, `${lead.name} leads the group.`, "info");
    // The first-week guide (ui/guide.js) if its box was ticked; later campaigns start with the box off.
    startGuide(state, ui.guide);
    if (!options.guideSeen) { options.guideSeen = true; saveOptions(options); }
    ui.guide = false;
  },
  restart: () => gen(() => newWorld(randomSeed()), null),
  // Victory screen: carry on in the same world (sim/world.js checkGameOver does not end it again for the hives).
  keepplaying: () => { if (state.victory) { state.victoryKept = true; state.gameOver = false; } },
};

for (const k of ["cb-sel", "cb-act", "cb-plan", "cb-log", "cb-target", "cb-end", "cb-confirm", "cb-auto", "cb-close", "cb-deploy", "cb-prison", "cb-retreat", "cb-view", "cb-fallback", "cb-redeploy", "cb-clear", "cb-autoplay", "cb-volorder", "cb-inv", "cb-bar", "cb-store", "cb-store-take", "cb-store-force"]) actions[k] = (d) => combatAction(state, k, d, ui); // cb-store: a store on the base map (sim/basemap.js); cb-store-take, cb-store-force: an assault's stores (ui/basemap.js takeButtons)
// Prisoners tab of a base (ui/prisoners.js): question, ransom, trade back, release, recruit, execute.
for (const [k, fn] of Object.entries(PRISON_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
// The planner's PLAN section (ui/plan.js): presets, steps, conditions; supplies are packed again for the new plan.
for (const [k, fn] of Object.entries(PLAN_ACTIONS)) actions[k] = (d) => { if (!ui.planner) return; fn(state, ui, d); autofill(ui.planner); ui.plannerError = ""; };
// The World… window (ui/worldcfg.js): Done builds the world again on the same seed if a dial moved (the groups' starting kit is dealt as it is made).
for (const [k, fn] of Object.entries(WC_ACTIONS)) actions[k] = (d) => { const changed = k === "wc-close" && !ui.started && wcChanged(ui); fn(state, ui, d); if (changed) gen(() => newWorld(state.seed, true)); };
// Look editor, new-run randomizers and zombie look settings (ui/newgame.js).
for (const [k, fn] of Object.entries(LOOK_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
// View map and Pick start on map look at the real map: from a preview it is built first, the crew as it stands.
for (const k of ["nr-map", "nr-pick"]) { const fn = actions[k]; actions[k] = (d) => (!ui.started && !ui.nrMap && isPreview(state) ? realThen(() => fn(d)) : fn(d)); }
// Custom backgrounds window (ui/backgrounds.js); its Done is bg-close in the table above.
// Starting gear window (ui/startgear.js): a change builds the world again on the same seed, the window kept open.
// A starting vehicle's change returns "fleet" (the world again with ui.fleet, the crew as it stands).
for (const [k, fn] of Object.entries(SG_ACTIONS)) actions[k] = (d) => { const r = fn(state, ui, d); if (r) gen(() => gearRebuild(r === "fleet")); };
for (const [k, fn] of Object.entries(BG_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
// Inventory and loot screens (ui/inventory.js).
for (const [k, fn] of Object.entries(BN_ACTIONS)) actions[k] = (d) => fn(state, ui, d); // ui/basename.js
for (const [k, fn] of Object.entries(CS_ACTIONS)) actions[k] = () => fn(state); // ui/campsite.js: Set up camp here, Let the game pick
for (const [k, fn] of Object.entries(INV_ACTIONS)) actions[k] = (d, ev) => fn(state, ui, d, ev); // ev: Shift+click on a supply stack (raid search window)
for (const [k, fn] of Object.entries(TEAMINV_ACTIONS)) actions[k] = (d, ev) => fn(state, ui, d, ev); // ui/teaminv.js
for (const [k, fn] of Object.entries(TEAMMEET_ACTIONS)) actions[k] = (d) => fn(state, ui, d); // ui/teammeet.js
for (const [k, fn] of Object.entries(UNPACK_ACTIONS)) actions[k] = (d) => fn(state, ui, d); // ui/teaminv.js: Home from a trip
for (const [k, fn] of Object.entries(TEAMFORM_ACTIONS)) actions[k] = (d, ev) => { fn(state, ui, d, ev); hideCtx(); }; // ui/teamform.js
for (const [k, fn] of Object.entries(CARRY_ACTIONS)) actions[k] = (d, ev) => fn(state, ui, d, ev, actions); // ui/carry.js
for (const [k, fn] of Object.entries(LAND_ACTIONS)) actions[k] = (d, ev) => fn(state, ui, d, ev, actions); // ui/landorder.js
for (const [k, fn] of Object.entries(WHO_ACTIONS)) actions[k] = (d, ev) => fn(state, ui, d, ev, actions); // ui/whopick.js
for (const [k, fn] of Object.entries(ARMV_ACTIONS)) actions[k] = (d) => fn(state, ui, d); // ui/armoryview.js: the armory list's groups, view, find box and type chips
for (const [k, fn] of Object.entries(ITEMMENU_ACTIONS)) actions[k] = (d) => fn(state, ui, d); // ui/itemmenu.js: the item right-click menu
for (const [k, fn] of Object.entries(BOX_ACTIONS)) actions[k] = (d) => fn(state, ui, d); // ui/boxview.js: take things out of an opened box
// The gun builder (ui/gunbuilder.js): open, pick a slot, fit, remove; the Ammo list.
for (const [k, fn] of Object.entries(GB_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
// Farming tab and illness (ui/farming.js, ui/health.js).
for (const [k, fn] of Object.entries({ ...FARM_ACTIONS, ...HEALTH_ACTIONS })) actions[k] = (d) => fn(state, ui, d);
// Skills, perks, teaching and reading in the survivor screen (ui/skills.js).
for (const [k, fn] of Object.entries(SKILL_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
// Production orders, power, standing craft orders, stewards and pins (ui/production.js).
for (const [k, fn] of Object.entries(PROD_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
for (const [k, fn] of Object.entries(COOK_ACTIONS)) actions[k] = (d) => fn(state, ui, d); // ui/cooking.js: bills at the Kitchen and the cook fire
// Trade window, radio panel and trade caravans (ui/tradewindow.js); these replace the older trade handlers above.
for (const [k, fn] of Object.entries(TRADE_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
// Outsiders (ui/visitors.js): the Groups tab's radio calls, trading with merchants, robbing them.
for (const [k, fn] of Object.entries(VISITOR_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
// Jobs, market board, world affairs and the coalition (ui/diplomacy.js); some reuse the handlers above (plan, center, rd-open).
for (const [k, fn] of Object.entries(DIPLO_ACTIONS)) actions[k] = (d) => fn(state, ui, d, actions);
for (const [k, fn] of Object.entries(VOL_ACTIONS)) actions[k] = (d) => fn(state, ui, d, actions); // ui/volunteers.js
// Timelapse viewer (ui/timelapse.js). It never opens over a battle (the battle screen would cover it).
for (const [k, fn] of Object.entries(TL_ACTIONS)) actions[k] = (d) => {
  if (k === "tl-open" && state.combat) return;
  fn(state, ui, d);
  if (k === "tl-open") watchFloating($("timelapse")); // its boxes resize from the corner (ui/windows.js)
};
// Relationships, the mood breakdown and the memorial wall (ui/relations.js).
for (const [k, fn] of Object.entries(REL_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
// Diary, log filters and links, alerts and the roster (ui/diary.js, ui/alerts.js, ui/roster.js); links and alerts
// use the handlers above (center, openbase, xp-open).
for (const [k, fn] of Object.entries({ ...DIARY_ACTIONS, ...ALERT_ACTIONS, ...ROSTER_ACTIONS, ...GUIDE_ACTIONS, ...WHY_ACTIONS, ...THREAT_ACTIONS })) actions[k] = (d) => fn(state, ui, d, actions); // GUIDE: the first-week guide (ui/guide.js); WHY: Why? on deaths and lost bases (ui/causes.js)
for (const [k, fn] of Object.entries(LEDGER_ACTIONS)) actions[k] = (d) => fn(state, ui, d); // the Ledger and the run summary (ui/ledger.js)
for (const [k, fn] of Object.entries(ACH_ACTIONS)) actions[k] = (d) => fn(state, ui, d); // the achievements window (ui/achievements.js)
for (const [k, fn] of Object.entries(HALL_ACTIONS)) actions[k] = (d) => fn(state, ui, d); // the hall of fame (ui/halloffame.js)
for (const [k, fn] of Object.entries(NB_ACTIONS)) actions[k] = (d) => fn(state, ui, d); // the Needs panel's base chips (ui/needsbar.js)
// Repairs, and opening locks in a raid (ui/explore.js, ui/locks.js).
for (const [k, fn] of Object.entries({ ...EXPLORE_ACTIONS, ...LOCK_ACTIONS, ...CAR_ACTIONS })) actions[k] = (d) => fn(state, ui, d);
// The city crawl window: places, street events, encounters, the next block, leaving (ui/citycrawl.js).
for (const [k, fn] of Object.entries(CRAWL_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
// The hive crawl window: the chambers, the brood, the core (ui/hivecrawl.js).
for (const [k, fn] of Object.entries(HIVE_CRAWL_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
// Needs (ui/needs.js): a team's rations and who eats first, a treat used by hand.
for (const [k, fn] of Object.entries(NEEDS_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
for (const [k, fn] of Object.entries(PACE_ACTIONS)) actions[k] = (d) => fn(state, ui, d); // the card tray, Options → Pause for… (ui/pacing.js)
for (const [k, fn] of Object.entries(MAPSEL_ACTIONS)) actions[k] = (d) => { fn(state, ui, d); mapClicked = true; }; // ui/mapselect.js: the "On this tile" row
actions["tray-rules"] = () => openSettings(ui, "options");
for (const [k, fn] of Object.entries(LISTEN_ACTIONS)) actions[k] = (d) => fn(state, ui, d); // xp-listen, bl-listen
for (const [k, fn] of Object.entries(INTEL_ACTIONS)) actions[k] = (d) => fn(state, ui, d); // hide-silent, intel-decoy
// The Watching panel and map notes (ui/watchlist.js): pin, go, unpin, the note editor; going there uses center and xp-open.
for (const [k, fn] of Object.entries(WATCHLIST_ACTIONS)) actions[k] = (d) => fn(state, ui, d, actions);
// Display options and the minimap's button (ui/display.js); the confirmation box (ui/confirm.js): Yes runs the order again.
for (const [k, fn] of Object.entries(DISPLAY_ACTIONS)) actions[k] = (d) => fn(ui, d);
for (const [k, fn] of Object.entries(ASK_ACTIONS)) actions[k] = (d) => fn(ui, d, actions);
// The menu: save, load, save and exit, options (ui/settings.js; settingsApi below).
for (const [k, fn] of Object.entries(SETTINGS_ACTIONS)) actions[k] = (d) => fn(state, ui, d, settingsApi);
for (const [k, fn] of Object.entries(CONTROLS_ACTIONS)) actions[k] = (d) => fn(state, ui, d, settingsApi); // Menu → Controls (ui/controls.js)
for (const [k, fn] of Object.entries(CODEX_ACTIONS)) actions[k] = (d) => fn(state, ui, d); // the Codex (ui/codex.js)
// The Work tab: priority cells take the click event (right-click counts down, Shift+click edits the role) (ui/work.js).
for (const [k, fn] of Object.entries(WORK_ACTIONS)) actions[k] = (d, ev) => fn(state, ui, d, ev);
// The Defence tab: the watch roster and the defence plan's drill (ui/defence.js).
for (const [k, fn] of Object.entries(DEFENCE_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
for (const [k, fn] of Object.entries(BASEMAP_ACTIONS)) actions[k] = (d) => fn(state, ui, d); // the base map (ui/basemap.js)
for (const [k, fn] of Object.entries(BUILDMAP_ACTIONS)) actions[k] = (d) => fn(state, ui, d); // Open the build map (ui/buildmap.js)
for (const [k, fn] of Object.entries(STORAGE_ACTIONS)) actions[k] = (d) => fn(state, ui, d); // the Storage tab (ui/storage.js): move goods between containers, tidy up

// Inventory drag and drop: tiles carry data-drag (their location), slots and storage boxes data-drop.
// The team panel's order queue (ui/expedition.js queueBlock): lines carry data-qdrag / data-qdrop (their index);
// dropping one on another puts it in that place (xp-qdrop). The dragged line is dimmed, the target underlined.
const QDRAG = "queue:"; // the queue's dataTransfer payload: queue:<party id>:<index>
const clearQueueDrag = () => { for (const li of document.querySelectorAll(".xpqueue li.over, .xpqueue li.dragging")) li.classList.remove("over", "dragging"); };
// A finger never drags a tile or a line: a tap picks it and a tap on the place moves it (inv-click, xp-qsel), a long
// press is the item menu (ui/touch.js). Where a mouse or trackpad is also there the tiles stay draggable="true"
// (ui/inventory.js dragAttr), so the drag a finger's press would start (Android, iPadOS) is cancelled here; a mouse's,
// or a pen's, goes on as before.
let fingerDown = false;
document.addEventListener("pointerdown", (ev) => { fingerDown = ev.pointerType === "touch"; }, true);
document.addEventListener("dragstart", (ev) => {
  const q = ev.target.closest && ev.target.closest("[data-qdrag]");
  if (fingerDown && (q || (ev.target.closest && ev.target.closest("[data-drag]")))) { ev.preventDefault(); return; }
  if (q) {
    ev.dataTransfer.setData("text/plain", `${QDRAG}${q.dataset.id}:${q.dataset.qdrag}`);
    ev.dataTransfer.effectAllowed = "move";
    q.classList.add("dragging");
    hideTip();
    return;
  }
  const el = ev.target.closest && ev.target.closest("[data-drag]");
  if (!el || !ui.inv) return;
  ev.dataTransfer.setData("text/plain", el.dataset.drag);
  ev.dataTransfer.effectAllowed = "move";
  hideTip();
});
document.addEventListener("dragover", (ev) => {
  const q = ev.target.closest && ev.target.closest("[data-qdrop]");
  if (q) {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
    if (!q.classList.contains("over")) { for (const li of document.querySelectorAll(".xpqueue li.over")) li.classList.remove("over"); q.classList.add("over"); }
    return;
  }
  if (ui.inv && ev.target.closest && ev.target.closest("[data-drop]")) ev.preventDefault();
});
document.addEventListener("dragleave", (ev) => {
  const q = ev.target.closest && ev.target.closest("[data-qdrop]");
  if (q && !q.contains(ev.relatedTarget)) q.classList.remove("over");
});
document.addEventListener("dragend", clearQueueDrag);
document.addEventListener("drop", (ev) => {
  const q = ev.target.closest && ev.target.closest("[data-qdrop]");
  if (q) {
    ev.preventDefault();
    clearQueueDrag();
    releaseHold();
    const data = ev.dataTransfer.getData("text/plain") || "";
    if (data.startsWith(QDRAG)) {
      const [id, from] = data.slice(QDRAG.length).split(":");
      if (id === q.dataset.id) act(() => actions["xp-qdrop"]({ id, from, to: q.dataset.qdrop }));
    }
    refresh();
    return;
  }
  const el = ev.target.closest && ev.target.closest("[data-drop]");
  if (!el || !ui.inv) return;
  ev.preventDefault();
  releaseHold();
  const from = ev.dataTransfer.getData("text/plain");
  if (from && ui.inv.form) { teamFormDrop(state, ui, from, el.dataset.drop); refresh(); return; } // ui/teamform.js: between a team and the armory
  if (from) { invDrop(state, ui, from, el.dataset.drop, ev.shiftKey, ev.ctrlKey || ev.metaKey, dropPoint(ev)); refresh(); } // a supply stack: a popover asks how many (Shift: half, Ctrl: one)
});

const changeActions = {
  "hl-f": (el) => haulFormChange(ui, el), // ui/hauling.js: the Add order form
  uiscale: (el) => { ui.scale = Number(el.value); document.documentElement.style.setProperty("--ui-scale", ui.scale); setTimeout(() => { resize(); fitWindows(); }, 50); options.uiScale = ui.scale; saveOptions(options); },
  // A work role ("w:…", priorities) or a fixed job (Manual) (ui/work.js).
  role: (el) => {
    const s = survivorById(state, Number(el.dataset.id));
    if (!s) return;
    const msg = applyRoleChoice(state, s, el.value);
    if (msg && ui.baseView) ui.baseMsg = msg;
  },
  medicop: (el) => {
    if (!el.value) return;
    const s = survivorById(state, Number(el.value));
    toManual(state, s); // a job picked by hand: off work priorities
    s.role = "medic";
    s.station = null;
    if (s.location.kind === "base") assignStations(state, baseById(state, s.location.baseId));
    ui.baseMsg = `${s.name} now works as a medic.`;
  },
  traineeop: (el) => {
    if (!el.value) return;
    const s = survivorById(state, Number(el.value));
    toManual(state, s); // a job picked by hand: off work priorities
    s.role = "trainee";
    s.station = null;
    if (s.location.kind === "base") assignStations(state, baseById(state, s.location.baseId));
    ui.baseMsg = `${s.name} now trains as a medic on the ward.`;
  },
  craftop: (el) => {
    if (!el.value) return;
    const s = survivorById(state, Number(el.value));
    toManual(state, s);
    s.role = "craft";
    s.station = null;
    if (s.location.kind === "base") assignStations(state, baseById(state, s.location.baseId));
    ui.baseMsg = `${s.name} now crafts by hand.`;
  },
  "barrel-holds": (el) => { ui.baseMsg = setBarrelHolds(baseOf(el.dataset), Number(el.dataset.id), el.value); },
  stationop: (el) => {
    const b = baseOf(el.dataset);
    const stationId = Number(el.dataset.station);
    // Whoever was on this station is freed up. Only people at this base change role: an operator away on a
    // trip keeps their job and takes a free station when they are back.
    for (const s of state.survivors) {
      if (s.station !== stationId) continue;
      s.station = null;
      if (s.role === "operate" && b && s.location.kind === "base" && s.location.baseId === b.id) s.role = "rest";
    }
    ui.baseMsg = "Station has no operator.";
    if (el.value) {
      const s = survivorById(state, Number(el.value));
      toManual(state, s);
      s.role = "operate";
      s.station = stationId;
      ui.baseMsg = `${s.name} now runs this station.`;
    }
  },
  equip: (el) => {
    if (el.value === "") return;
    const s = survivorById(state, Number(el.dataset.id));
    const b = baseOf(el.dataset);
    if (!b || !s) return;
    const item = b.armory.splice(Number(el.value), 1)[0];
    if (!item) return;
    const slot = GEAR[item.key].slot;
    if (s.gear[slot]) b.armory.push(s.gear[slot]);
    s.gear[slot] = item;
  },
  layer: (el) => { el.checked ? view.layers.add(el.dataset.k) : view.layers.delete(el.dataset.k); },
  rt: (el) => { const f = el.dataset.f; ui.routeSetup[f] = el.tagName === "SELECT" ? el.value : Math.max(0, Math.floor(Number(el.value) || 0)); },
  "sr-dest": (el) => { ui.supplyForm.destId = Number(el.value); },
  "sr-line": (el) => {
    const l = ui.supplyForm[el.dataset.list][Number(el.dataset.i)];
    if (!l) return;
    if (el.dataset.f === "key") l.key = el.value;
    else l.qty = Math.max(0, Math.floor(Number(el.value) || 0));
  },
  "sr-every": (el) => { ui.supplyForm.every = Math.max(1, Math.floor(Number(el.value) || 1)); },
  "pl-mission": (el) => { ui.planner.mission = el.value; autofill(ui.planner); ui.plannerError = ""; },
  "pl-supply": (el) => { ui.planner.supplies[el.dataset.k] = Math.max(0, Math.floor(Number(el.value) || 0)); ui.plannerError = ""; },
  "pl-packfood": (el) => { ui.planner.packFood = el.value || null; }, // sim/foods.js packPick: a food to pack first
  ...Object.fromEntries(Object.entries(LOOK_CHANGE_ACTIONS).map(([k, fn]) => [k, (el) => fn(state, ui, el)])),
  ...Object.fromEntries(Object.entries(WC_CHANGE).map(([k, fn]) => [k, (el) => fn(state, ui, el)])), // the World… window's dials (ui/worldcfg.js)
  ...Object.fromEntries(Object.entries(TRADE_CHANGE_ACTIONS).map(([k, fn]) => [k, (el) => fn(state, ui, el)])),
  ...Object.fromEntries(Object.entries(DIPLO_CHANGE).map(([k, fn]) => [k, (el) => fn(state, ui, el)])),
  ...Object.fromEntries(Object.entries(VOL_CHANGE).map(([k, fn]) => [k, (el) => fn(state, ui, el)])),
  seed: (el) => { const seed = cleanSeed(el.value); gen(() => newWorld(seed, true), seed); },
  factioncount: (el) => { ui.factionCount = clampGroups(ui.worldSize, el.value); gen(() => newWorld(state.seed, true)); },
  // A new world size: the same seed on the new map, with that size's usual number of groups (sim/worldsize.js).
  // Custom (experimental): the width × height below the row, starting from the map on screen.
  worldsize: (el) => {
    if (el.value === "custom") { ui.worldSize = "custom"; ui.customW = state.grid.width; ui.customH = state.grid.height; }
    else ui.worldSize = sizeDef(el.value).key;
    ui.startPick = null; // a new map: the start is its own again
    ui.factionCount = (ui.worldSize === "custom" ? customDef(ui.customW, ui.customH) : sizeDef(ui.worldSize)).defGroups;
    gen(() => newWorld(state.seed, true));
  },
  customw: (el) => { ui.startPick = null; ui.customW = clampCustomW(el.value); gen(() => newWorld(state.seed, true)); },
  customh: (el) => { ui.startPick = null; ui.customH = clampCustomH(el.value); gen(() => newWorld(state.seed, true)); },
  hivecount: (el) => { ui.hiveCount = clampHives(el.value); gen(() => newWorld(state.seed, true)); },
  // Normal or Hardcore (sim/hardcore.js): the same seed and the edited crew (the first three in Hardcore, or the Starting people).
  // The new-run screen's Ironman box (ui/newgame.js): an Ironman crew starts as rolled, so ticking it turns Customize
  // off and, if the crew was customized (skills, traits, a picked background), builds the world again on the same seed
  // with only the names, looks and leader kept.
  // Ironman also leaves the starting vehicles' backs as rolled (runOpts; sim/startfleet.js): a world built with backs set
  // is built again without them, and unticking it brings them back (Customize being on: without it the backs are as
  // rolled anyway).
  ironman: (el) => {
    ui.ironman = !!el.checked;
    const backs = !!ui.freeEdit && (ui.fleet || []).some((f) => f && f.load);
    if (!ui.ironman) { if (backs && !ui.started) gen(() => newWorld(state.seed, true)); return; }
    ui.freeEdit = false;
    ui.fleetEdit = null;
    ui.fleetView = null;
    ui.crewInv = null; // its reroll is off in Ironman: the window shut with the rest
    if (crewCustomized(state)) {
      // The crew's dice as they were before the first pick (pickRoll: main.js gave them dice of their own for it).
      gen(() => {
        newWorld(state.seed, true, { crew: ironmanCrew(state), crewRoll: ui.pickRoll ? null : ui.crewRoll });
        ui.nrMsg = "Ironman: the crew is back as rolled (skills, traits and who they were). Names, looks and the leader are kept.";
      });
    } else if (backs && !ui.started) gen(() => newWorld(state.seed, true));
  },
  // Customize (not with Ironman; sim/custompoints.js): ticked, every colonist starts blank and is built on points (the
  // world again on the same seed, with a crew roll of its own so the map and the groups stay put); what was built
  // before in this screen comes back if the crew is the same size. Unticked, the crew goes back as rolled (names, looks
  // and the leader kept), the build kept aside for ticking it again. The starting vehicles' backs go with it (2026-10-24,
  // user request: "Remove points left and setting gear in vehicles when no having customize toggled"): runOpts builds
  // the world with them as rolled while Customize is off, the backs set waiting in ui.fleet for ticking it again.
  "nr-free": (el) => {
    if (ui.ironman || ui.started) { el.checked = false; return; }
    const on = !!el.checked;
    if (on === !!ui.freeEdit) return;
    if (on) {
      const back = ui.pointsCrew && ui.pointsCrew.length === state.survivors.length ? ui.pointsCrew : null;
      ui.freeEdit = true;
      gen(() => {
        newWorld(state.seed, true, pickRebuild(back || blankCrew(state)));
        ui.nrMsg = back ? "Customize: your build is back." : `Customize: everyone starts blank with ${ui.pointsMax} points to spend (Points each). Start from the dice loads what was rolled.`;
      });
    } else {
      ui.pointsCrew = crewSnapshot(state);
      ui.freeEdit = false;
      ui.fleetEdit = null; // a vehicle's back window: shut (the backs are as rolled without Customize)
      gen(() => {
        newWorld(state.seed, true, { crew: ironmanCrew(state), crewRoll: ui.pickRoll ? null : ui.crewRoll });
        ui.nrMsg = `Customize off: the crew is back as rolled (names, looks and the leader kept)${(ui.fleet || []).some((f) => f && f.load) ? ", the vehicles' backs too" : ""}. Tick it again for your build.`;
      });
    }
  },
  // Customize: the points each colonist may spend (the crew's max; sim/custompoints.js). Every colonist goes back on it,
  // their own points set on their card too (custompoints.js maxFor).
  "nr-points": (el) => {
    ui.pointsMax = clampMax(el.value); state.pointsMax = ui.pointsMax; el.value = ui.pointsMax;
    for (const s of state.survivors) delete s.ownMax;
  },
  // Customize (Normal and Hardcore): who a colonist was (a preset, a custom background, or "" for the dice). The world is built
  // again on the same seed (a crew roll of its own from now on, so the map and the groups stay put).
  "nr-bg": (el) => {
    if (ui.ironman || ui.started || isCrashRun(state)) return; // Crashlanding: the background is the soldier's
    const id = Number(el.dataset.id), i = state.survivors.findIndex((s) => s.id === id);
    const crew = crewWithBackground(state, id, el.value);
    if (!crew) return;
    gen(() => { newWorld(state.seed, true, pickRebuild(crew)); pointsLoad([i]); });
  },
  "nr-guide": (el) => { ui.guide = !!el.checked; }, // and its First-week guide box (ui/guide.js)
  children: (el) => { ui.childrenOff = !el.checked; }, // the new-run screen's Children box (sim/family.js)
  // Normal, Hardcore, Custom or Crashlanding: each keeps its own Starting people, Points each and Start with a vehicle
  // (ui.modeSets); the crew goes on the new mode's Points each (their own points set on a card too). Custom
  // (sim/custommode.js) is a normal start with ui.custom's counts; Crashlanding (sim/crashmode.js) a normal-mode world
  // with the crash (runOpts).
  gamemode: (el) => {
    const mode = el.value === "hardcore" ? "hardcore" : el.value === "custom" ? "custom" : el.value === "crash" ? "crash" : "normal";
    if (mode === ui.mode) return;
    stashModeSet(ui);
    takeModeSet(ui, mode);
    for (const s of state.survivors) delete s.ownMax;
    gen(() => newWorld(state.seed, true));
  },
  // Start with a vehicle (2026-10-24, user request; every mode, Ironman too): the world again on the same seed.
  "nr-vehicle": (el) => { if (ui.started) return; ui.startVehicle = !!el.checked; gen(() => newWorld(state.seed, true)); },
  // Custom mode's counts (ui/newgame.js customInputs; sim/custommode.js CUSTOM_RUN): each 1 or more, capped; the world
  // again on the same seed. Starting survivors is ui.startPeople (Custom's own, in ui.modeSets.custom).
  "nr-custom": (el) => {
    if (ui.started) return;
    const k = el.dataset.k, v = clampCustomCount(k, el.value);
    if (k === "people") { ui.startPeople = v; ui.fleet = (ui.fleet || []).slice(0, v); } // one vehicle a survivor at most (sim/startfleet.js)
    else if (k in ui.custom) ui.custom[k] = v;
    else return;
    el.value = v;
    gen(() => newWorld(state.seed, true));
  },
  // Starting people (ui/newgame.js): Normal 1–8 hold the hub, Hardcore 1–4 flee together; the same seed and the edited
  // crew (as many as fit).
  startpeople: (el) => { ui.startPeople = clampStartPeople(el.value, ui.mode); ui.fleet = (ui.fleet || []).slice(0, ui.startPeople); gen(() => newWorld(state.seed, true)); }, // one starting vehicle a survivor at most (sim/startfleet.js)
  rename: (el) => {
    // Empty names and a full name someone else already has are refused (world.renameSurvivor).
    const s = survivorById(state, Number(el.dataset.id));
    const before = s ? s.name : "";
    const why = renameSurvivor(state, s, String(el.value ?? "").slice(0, 40));
    ui.nrMsg = why || "";
    if (why) { if (s) el.value = s.name; if (ui.started) log(state, why, "info"); }
    else if (s && s.name !== before && !ui.started) ui.crewEdited = true;
  },
  // Any base can be renamed from its screen (the name shows on the map, in the log and in the timelapse).
  baserename: (el) => {
    const b = baseOf(el.dataset);
    if (!b) return;
    const before = b.name, why = renameBase(state, b, el.value); // sim/basenames.js: cleaned, no two bases alike
    if (why) { ui.baseMsg = why; el.value = b.name; return; }
    if (b.name !== before) ui.baseMsg = `${before} is now called ${b.name}.`;
  },
};
for (const [k, fn] of Object.entries({ ...FARM_CHANGE, ...HEALTH_CHANGE })) changeActions[k] = (el) => fn(state, ui, el);
for (const [k, fn] of Object.entries(BG_CHANGE)) changeActions[k] = (el) => fn(state, ui, el); // the custom backgrounds window (ui/backgrounds.js)
for (const [k, fn] of Object.entries(SG_CHANGE)) changeActions[k] = (el) => { const r = fn(state, ui, el); if (r) gen(() => gearRebuild(r === "fleet")); }; // the starting gear window and the Starting vehicles (ui/startgear.js)
for (const [k, fn] of Object.entries(SKILL_CHANGE)) changeActions[k] = (el) => fn(state, ui, el);
Object.assign(changeActions, fieldworksChange(() => state, ui)); // ui/fieldworks.js: post a lookout
for (const [k, fn] of Object.entries(PROD_CHANGE)) changeActions[k] = (el) => fn(state, ui, el);
for (const [k, fn] of Object.entries(COOK_CHANGE)) changeActions[k] = (el) => fn(state, ui, el); // ui/cooking.js
for (const [k, fn] of Object.entries(PLAN_CHANGE)) changeActions[k] = (el) => { if (!ui.planner) return; fn(state, ui, el); autofill(ui.planner); ui.plannerError = ""; };
for (const [k, fn] of Object.entries({ ...DIARY_CHANGE, ...ROSTER_CHANGE })) changeActions[k] = (el) => fn(state, ui, el);
for (const [k, fn] of Object.entries(EXPLORE_CHANGE)) changeActions[k] = (el) => fn(state, ui, el);
for (const [k, fn] of Object.entries(SETTINGS_CHANGE)) changeActions[k] = (el) => fn(state, ui, el, settingsApi);
for (const [k, fn] of Object.entries(CODEX_CHANGE)) changeActions[k] = (el) => fn(state, ui, el); // the Codex's find box
for (const [k, fn] of Object.entries(DISPLAY_CHANGE)) changeActions[k] = (el) => fn(ui, el); // ui/display.js
for (const [k, fn] of Object.entries(WORK_CHANGE)) changeActions[k] = (el) => fn(state, ui, el);
for (const [k, fn] of Object.entries(DEFENCE_CHANGE)) changeActions[k] = (el) => fn(state, ui, el);
for (const [k, fn] of Object.entries(INTEL_CHANGE)) changeActions[k] = (el) => fn(state, ui, el); // intel-discipline
for (const [k, fn] of Object.entries(PRISON_CHANGE)) changeActions[k] = (el) => fn(state, ui, el); // prisoners-tab: the rations and work selects (ui/prisoners.js)
for (const [k, fn] of Object.entries(INV_CHANGE)) changeActions[k] = (el) => fn(state, ui, el);
for (const [k, fn] of Object.entries(STORAGE_CHANGE)) changeActions[k] = (el) => fn(state, ui, el); // ui/storage.js: the mover's from / to and how many
for (const [k, fn] of Object.entries(TEAMINV_CHANGE)) changeActions[k] = (el) => fn(state, ui, el); // ui/teaminv.js: how many of a picked supply
for (const [k, fn] of Object.entries(TEAMMEET_CHANGE)) changeActions[k] = (el) => fn(state, ui, el); // ui/teammeet.js
for (const [k, fn] of Object.entries(TEAMFORM_CHANGE)) changeActions[k] = (el) => fn(state, ui, el); // ui/teamform.js: sort, supply amounts, days
for (const [k, fn] of Object.entries(CARRY_CHANGE)) changeActions[k] = (el) => fn(state, ui, el); // ui/carry.js
for (const [k, fn] of Object.entries(LAND_CHANGE)) changeActions[k] = (el) => fn(state, ui, el); // ui/landorder.js
for (const [k, fn] of Object.entries(GB_CHANGE)) changeActions[k] = (el) => fn(state, ui, el); // the gun builder's Ammo list // how many of a supply stack to move (ui/inventory.js)

// The new-run screen's settings as createWorld's options (newWorld): Custom mode (sim/custommode.js) is a normal start
// with ui.custom's counts (its Starting survivors: ui.startPeople); vehicle: Start with a vehicle; fleet: the Starting
// vehicles (each its kind, point limit and back). Crashlanding (sim/crashmode.js, 2026-10-24): a normal-mode world with
// `crash`, which fixes the rest (the one survivor, no vehicle, no fleet, no Custom counts, the CRASH.W × CRASH.H map).
// Its world is shown, not set (the user, 2026-10-24: "Remove customization and setting starting hives etc just show how
// many exist on the map all things are just static values"): the map's own defaults go in, whatever the screen holds
// for the other modes: the AI groups of its size (ui/newgame.js crashSizeDef: the preset with CRASH's grid, else the
// custom def), the hives the map makes (null) and the standard World dials (null).
function runOpts() {
  const custom = ui.mode === "custom", crash = ui.mode === "crash";
  return {
    factionCount: ui.factionCount, size: ui.worldSize, customW: ui.customW, customH: ui.customH, hives: ui.hiveCount,
    mode: custom ? "normal" : ui.mode, crewRoll: ui.crewRoll, startPeople: ui.startPeople, start: ui.startPick, worldCfg: uiCfg(ui),
    vehicle: ui.startVehicle !== false, custom: custom ? { ...ui.custom, people: ui.startPeople } : null,
    fleet: ui.ironman || !ui.freeEdit ? (ui.fleet || []).map((f) => ({ ...f, load: null })) : ui.fleet, // Starting vehicles (sim/startfleet.js); Ironman or Customize off: the backs as rolled (the ones set wait on the screen for Customize)
    ...(crash ? { mode: "normal", crash: true, custom: null, vehicle: false, fleet: [], startPeople: 1, factionCount: crashSizeDef().defGroups, hives: null, worldCfg: null } : {}), // Crashlanding: the one survivor on foot, no fleet, no Custom counts; the map's own groups, hives and dials
  };
}

// A new world: new campaign, new map and colonists, or the same colonists on another seed or group count.
// Everything about the old run goes: open screens, selections, the team panel, card results, move mode, the
// speed (a new game starts paused), dev tools and their map overlays.
// keepCrew: carry colonists edited on the new-run screen into the rebuilt world (and their Hardcore crew roll).
// fresh: { crew, crewRoll } from Randomize all, in place of the edited colonists.
// real: the world on its real map (Start, View map, Pick start on map, New start position: needsMap); else, while the
// map is not being looked at, a preview on a tiny one (sim/world.js PREVIEW_MAP), the same crew in it.
function newWorld(seed, keepCrew = false, fresh = null, real = false) {
  const preview = !needsMap(real);
  if (seed !== state.seed) ui.startPick = null; // a new map: the start is its own again
  const crew = fresh ? fresh.crew : keepCrew && ui.crewEdited ? crewSnapshot(state) : null;
  if (!keepCrew && !fresh) ui.pointsCrew = null; // a new crew: no Customize build kept aside for it
  if (fresh) { ui.crewRoll = fresh.crewRoll; ui.pickRoll = !!fresh.pickRoll; } // pickRoll: the crew roll came from a background pick
  else if (!crew) { ui.crewRoll = null; ui.pickRoll = false; }
  if (ui.timelapse) closeTimelapse(state, ui);
  Object.assign(ui, freshUi());
  ui.crewEdited = !!crew;
  state = createWorld({ ...runOpts(), seed, crew, customBackgrounds: ui.ironman ? null : customLibrary(), preview });
  state.pointsMax = ui.pointsMax; // Customize: each colonist's max (sim/custompoints.js)
  // Customize: everyone is built on points; anyone the crew did not cover (a new map, more people in another mode)
  // starts blank, the crew's dice its own (the map and the groups stay the seed's).
  if (ui.freeEdit && !ui.ironman && !ui.title && state.survivors.some((s) => !s.startPoints)) {
    const snap = crewSnapshot(state), blank = blankCrew(state);
    if (ui.crewRoll == null) { ui.crewRoll = fixedCrewRoll(seed); ui.pickRoll = true; }
    ui.crewEdited = true;
    state = createWorld({ ...runOpts(), seed, crew: state.survivors.map((s, i) => (s.startPoints ? snap[i] : blank[i])), customBackgrounds: customLibrary(), preview });
    state.pointsMax = ui.pointsMax;
  }
  resetView();
  hideCtx();
  hideTip();
  $("tooltip").classList.add("hidden");
  acc = 0;
  fpsLog.length = 0;
  centerOn(state, playerTile(state));
}

// The "Generating map…" box (ui/newgame.js generating; the user's request 2026-10-24: "When you choose a map show a
// generating map popup until the map is loaded"): every action here that builds a world calls gen(fn) instead of fn():
// the box is painted first (with the size about to be built), fn and its newWorld run on the next frame, then everything
// is drawn again. newWorld itself stays synchronous for the callers that go on after it (pointsLoad, gearRebuild,
// cardRebuild), so the wrapping is here, at the actions. A handler that reads its box's value or sets ui first does so
// before gen, so the size shown is the one being built (worldsize, gamemode).
// seed: the seed fn builds on (null: a new one, rolled inside fn). A map already built on it with these settings' size
// is kept (sim/mapgen.js MAP_CACHE; the user's request 2026-10-24: "When changing a setting in the start menu it loads
// the map each time"): the world is built on it at once, with no box. real: fn builds the real map (needsMap); a
// preview (sim/world.js PREVIEW_MAP) is built at once, with no box, whatever the seed.
function gen(fn, seed = state.seed, real = false) {
  const quick = !needsMap(real) || (seed != null && worldMapCached({ ...runOpts(), seed }));
  generating(fn, { size: buildSize(), quick, after: () => { dirtyNow = true; refresh(); } });
}
// Whether a build now needs the real map: asked for (real), the map being looked at or picked on from the new-run
// screen, or a run under way. Otherwise the new-run screen's world is a preview (the user's request 2026-10-24).
function needsMap(real = false) { return real || ui.started || ui.nrMap || ui.nrPick; }
// The real world for the new-run screen's world (a preview until now), the crew as it stands, then then(): Start, View
// map and Pick start on map wait for it under the "Generating map…" box.
function realThen(then) {
  if (!isPreview(state) || ui.started) { then(); return; }
  gen(() => { newWorld(state.seed, true, null, true); then(); }, state.seed, true);
}
// The map about to be built, for the box: Crashlanding's, the custom width × height, or the preset's.
function buildSize() {
  const crash = ui.mode === "crash";
  const d = crash ? crashSizeDef() : ui.worldSize === "custom" ? customDef(ui.customW, ui.customH) : sizeDef(ui.worldSize);
  return { w: d.w, h: d.h, label: crash ? "Crashlanding" : d.label };
}

// A crew roll of its own for a seed (the first background picked on the new-run screen): from then on the crew's dice
// are not the world's, so picking again does not move the groups.
const fixedCrewRoll = (seed) => 1 + ((seed * 48271) % 2147483646);
// A rebuild for a background picked: the crew roll kept, else one of the seed's own (pickRoll: Ironman goes back to none).
const pickRebuild = (crew) => (ui.crewRoll != null ? { crew, crewRoll: ui.crewRoll, pickRoll: ui.pickRoll } : { crew, crewRoll: fixedCrewRoll(state.seed), pickRoll: true });
// The crew cards' dice (ui/newgame.js randomizeGear, randomizeOne): crew null builds the world again with the edited
// crew; else with this crew (pick: a background was picked, the crew roll as pickRebuild keeps it). Returns the new state.
function cardRebuild(crew, pick = false) {
  if (!crew) { ui.crewEdited = true; newWorld(state.seed, true); }
  else newWorld(state.seed, true, pick ? pickRebuild(crew) : { crew, crewRoll: ui.crewRoll, pickRoll: ui.pickRoll });
  return state;
}
// Closing the custom backgrounds window (ui/backgrounds.js): a colonist whose background was changed or deleted in it
// is built again from it (the dice if it is gone), the world on the same seed.
function closeBackgrounds() {
  const changed = (ui.bgEditor && ui.bgEditor.changed) || [];
  ui.bgEditor = null;
  if (ui.started) return;
  const hit = state.survivors.filter((s) => s.bgPicked && changed.includes(s.background));
  if (!hit.length) { if (changed.length) gen(() => newWorld(state.seed, true)); return; } // the new list goes into the world
  const at = hit.map((s) => state.survivors.indexOf(s));
  const crew = crewWithBackgrounds(state, Object.fromEntries(hit.map((s) => [s.id, customLibrary()[s.background] ? s.background : null])));
  gen(() => { newWorld(state.seed, true, pickRebuild(crew)); pointsLoad(at); });
}
// Customize: colonists whose background was just picked take what it gives (its skills, traits and kit, as the dice
// made them) as their picks, priced (ui/startgear.js loadDice), and the world is built once more with them.
function pointsLoad(list) {
  if (!ui.freeEdit || ui.ironman) return;
  let any = false;
  for (const i of list) { const s = state.survivors[i]; if (s && s.startPoints) { loadDice(state, s); any = true; } }
  if (any) { ui.crewEdited = true; newWorld(state.seed, true); }
}

// Starting gear picked or cleared (ui/startgear.js): the world again on the same seed with the edited crew (the picks go
// on after the dice, so nobody else's start changes), the gear window still open on the same colonist. fleet: a starting
// vehicle changed (its kind, the count, its back: sim/startfleet.js), the crew as it stands (edited or not), the vehicle's
// back window still open.
function gearRebuild(fleet = false) {
  const keep = ui.gearEdit, keepFleet = ui.fleetEdit, keepView = ui.fleetView, keepInv = ui.crewInv;
  if (!fleet) ui.crewEdited = true;
  newWorld(state.seed, true);
  ui.gearEdit = keep;
  ui.fleetEdit = keepFleet && state.fleet && state.fleet[keepFleet.i] && state.fleet[keepFleet.i].vid != null ? keepFleet : null; // an emptied slot: closed
  ui.fleetView = keepView && state.fleet && state.fleet[keepView.i] && state.fleet[keepView.i].vid != null ? keepView : null; // the look at a back: open on the new dice
  ui.crewInv = keepInv && state.survivors[keepInv.i] ? keepInv : null; // a crew card's 👁 Inventory: open on what they carry now
}

// A loaded world (ui/settings.js): like a new world, but already started, paused, and remembering its save slot.
function adopt(st, entry) {
  if (ui.timelapse) closeTimelapse(state, ui);
  Object.assign(ui, freshUi());
  ui.crewEdited = false;
  state = st;
  ui.title = false;
  if (!state.mode) state.mode = "normal"; // saves from before the modes
  const mode = isCrashRun(state) ? "crash" : isCustomRun(state) ? "custom" : state.mode; // a Custom run is a normal one with state.custom (sim/custommode.js), a Crashlanding run one with state.crash (sim/crashmode.js)
  if (ui.mode !== mode) { stashModeSet(ui); takeModeSet(ui, mode); } // each mode its own settings
  ui.mode = mode; // a new campaign from here keeps the mode you were playing
  if (mode === "custom") ui.custom = cleanCustom(state.custom); // and Custom's counts
  ui.startVehicle = startsWithVehicle(state); // and Start with a vehicle
  ui.ironman = !!state.ironman; // and Ironman, if this one is
  if (Number.isFinite(state.startPeople)) ui.startPeople = clampStartPeople(state.startPeople, mode); // and its Starting people
  ui.childrenOff = !!state.childrenOff; // and children off, if they were
  ui.worldCfg = cleanCfg(state.worldCfg); // and its World… dials (a new campaign from here starts from them)
  ui.started = true;
  ui.speed = 0;
  ui.slot = entry ? entry.id : null;
  ui.savedMark = { state, hour: state.hour };
  resetView();
  hideCtx();
  hideTip();
  $("tooltip").classList.add("hidden");
  acc = 0;
  fpsLog.length = 0;
  centerOn(state, playerTile(state)); // the hub, else the team on the road (hardcore before its first hub)
  dirtyNow = true;
}

// A small picture of the map (or the battle) for the save list. Empty when the canvas cannot be read.
function thumbnail() {
  try {
    const src = state.combat ? $("combatmap") : canvas;
    if (!src || !(src.width > 0) || !(src.height > 0)) return "";
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = Math.max(40, Math.min(120, Math.round((160 * src.height) / src.width)));
    const g = c.getContext("2d");
    g.drawImage(src, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg", 0.7);
    return typeof url === "string" && url.startsWith("data:image/") && url.length < 30000 ? url : "";
  } catch { return ""; }
}

// What the menu needs from here (ui/settings.js). Saves and loads are asynchronous (compression); track() keeps the
// promises so tools can wait for them (window.game.settle()).
const pendingIo = new Set();
const settingsApi = {
  options,
  desktop: inDesktopApp(),
  refresh: () => { dirtyNow = true; refresh(false); },
  track: (p) => { pendingIo.add(p); p.finally(() => pendingIo.delete(p)); },
  adopt,
  newWorld: () => gen(() => newWorld(randomSeed()), null), // New campaign: under the "Generating map…" box, as every build
  toTitle: () => gen(() => { newWorld(randomSeed()); showTitle(ui); }, null), // exit: back to the title screen (ui/title.js)
  thumb: thumbnail,
  quit: () => { try { window.close(); } catch { /* not allowed here */ } },
  autosaveInfo: autosaveState,
};
initSettings(settingsApi);
initCrash({ state: () => state, ui, adopt, toTitle: settingsApi.toTitle, desktop: settingsApi.desktop, track: settingsApi.track, refresh: settingsApi.refresh });
initDisplay(options, () => saveOptions(options)); // after initSettings: reduce motion overrides the map animations
initConfirm(options, () => saveOptions(options));
// The title screen (ui/title.js).
initTitle({ desktop: settingsApi.desktop, quit: settingsApi.quit });
for (const [k, fn] of Object.entries(TITLE_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
// Order templates and Repeat trip (ui/trips.js), the undo button and the build queue's ▲ ▼ (ui/undo.js); then every
// planner, build-queue and Work tab action is wrapped so its edits can be undone (installUndo, last).
// The People tab's view switch and find box (ui/panelfold.js; the box also filters as you type: the input listener).
Object.assign(actions, { "ppl-view": (d) => PANEL_ACTIONS["ppl-view"](d), "ppl-clear": (d) => PANEL_ACTIONS["ppl-clear"](d) });
Object.assign(actions, { "ppl-idle": () => togglePeopleIdle() }); // ui/activity.js: the People tab's Idle filter
// "Assign all idle" (the Work now panel, the Bases tab's Idle drop-downs): a preview to confirm, then the jobs (idlework.js).
actions["idle-assign"] = (d) => {
  const b = baseById(state, Number(d.base));
  if (!b) return;
  const pv = assignIdlePreview(state, b);
  if (!pv.plan.length) { baseSay(`${b.name}: nothing here has room for the idle now.`); return; }
  if (ask(ui, d, "idle-assign", { kind: "assignidle", title: `Put ${pv.plan.length} idle ${pv.plan.length === 1 ? "person" : "people"} at ${b.name} to work?`, text: `${pv.text}. They go on these jobs by hand (Manual).`, yes: "Assign" })) return;
  baseSay(`Assigned the idle at ${applyIdlePlan(state, b, pv.plan)}`);
};
// "Gear outdoor workers" (the Work now panel): the armory's spare weapons, lights, light armour and tourniquets to the
// people going out on the land (sim/tripgear.js; your own order: pinned people too).
actions["gear-out"] = (d) => {
  const b = baseById(state, Number(d.base));
  if (!b) return;
  const got = gearOutdoorWorkers(state, b, { pinned: true });
  baseSay(got.length ? `${b.name}: geared the outdoor workers: ${gearText(got)}.` : `${b.name}: nothing in the armory would help them.`);
};
Object.assign(changeActions, { "ppl-q": (el) => PANEL_INPUT["ppl-q"](el) });
for (const [k, fn] of Object.entries(BN_INPUT)) PANEL_INPUT[k] = (el) => fn(state, ui, el); // the naming window's box: the draft as you type
for (const [k, fn] of Object.entries(ARMV_INPUT)) PANEL_INPUT[k] = (el) => fn(state, ui, el); // the armory's find box (ui/armoryview.js)
for (const [k, fn] of Object.entries(GP_INPUT)) PANEL_INPUT[k] = (el) => fn(state, ui, el); // the starting-gear catalogue's find box (ui/gearpicker.js, via ui/startgear.js)
const tripApi = { plan: (d) => actions.plan(d), autofill: (pl) => autofill(pl) };
const tripAct = (fn) => (d) => fn(state, ui, d, tripApi), tripChange = (fn) => (el) => fn(state, ui, el);
Object.assign(actions, {
  "tpl-use": tripAct(TRIP_ACTIONS["tpl-use"]), "tpl-save": tripAct(TRIP_ACTIONS["tpl-save"]), "tpl-plan": tripAct(TRIP_ACTIONS["tpl-plan"]),
  "tpl-pick": tripAct(TRIP_ACTIONS["tpl-pick"]), "tpl-del": tripAct(TRIP_ACTIONS["tpl-del"]), "tr-repeat": tripAct(TRIP_ACTIONS["tr-repeat"]),
  "undo-step": tripAct(UNDO_ACTIONS["undo-step"]), "bq-move": tripAct(UNDO_ACTIONS["bq-move"]),
});
Object.assign(changeActions, { "tpl-name": tripChange(TRIP_CHANGE["tpl-name"]), "tpl-rename": tripChange(TRIP_CHANGE["tpl-rename"]), "pl-policy": tripChange(TRIP_CHANGE["pl-policy"]) });
Object.assign(actions, fieldworksActions(() => state, ui, { centerOn: (tile) => centerOn(state, tile), select: (tile) => { ui.selected = tile; view.selected = tile; } })); // ui/fieldworks.js: the Field works tab
installUndo(actions, changeActions, () => state, ui);
if (!/[?&]notitle\b/.test(location.search)) showTitle(ui); // ?notitle: straight to the new-run screen (tests)

function act(fn) {
  const before = armSnap();
  fn();
  armDiff(before);
}
// After a click the button would keep the keyboard focus (the panels are no longer rebuilt under it), and Space
// or Enter would press it again instead of pausing.
function dropFocus() {
  const a = document.activeElement;
  if (a && a.blur && (a.tagName === "BUTTON" || a.tagName === "SELECT" || (a.tagName === "INPUT" && a.type === "checkbox"))) a.blur();
}

// A press anywhere but on the item menu closes it (the click goes on as usual).
document.addEventListener("pointerdown", (ev) => {
  if (!ui.imenu || (ev.target.closest && ev.target.closest("#itemmenu"))) return;
  if (ev.button === 2 && ev.target.closest && ev.target.closest("[data-imenu], [data-loc]")) return; // another item: its own menu opens
  closeItemMenu(ui);
  dirtyNow = true;
}, true);
document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el || el.tagName === "SELECT" || (el.tagName === "INPUT" && el.type !== "checkbox")) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  if (el.tagName === "INPUT" && el.type === "checkbox" && el.dataset.action !== "layer") ev.preventDefault();
  releaseHold();
  if (ui.nrMsg) ui.nrMsg = "";
  act(() => fn(el.dataset, ev));
  dropFocus();
  refresh();
});
// Right-click on a Work tab cell counts down (ui/work.js); on an item in a window, the item menu (ui/itemmenu.js);
// elsewhere the browser's menu is left alone.
document.addEventListener("contextmenu", (ev) => {
  const it = ev.target.closest && ev.target.closest("[data-imenu], [data-loc]");
  if (it && $("modal").contains(it) && !(ev.target.closest("#itemmenu"))) {
    releaseHold();
    if (openItemMenu(state, ui, it.dataset, ev.clientX, ev.clientY)) { ev.preventDefault(); hideTip(); refresh(); return; }
  }
  const el = ev.target.closest && ev.target.closest("[data-rc]");
  if (!el) return;
  ev.preventDefault();
  const fn = actions[el.dataset.action];
  if (!fn) return;
  releaseHold();
  // A finger's long press (ui/touch.js sends it, untrusted): the Work tab opens its picker there instead (ui/work.js).
  const finger = !ev.isTrusted && (touchRecent() || inputMode() === "pad"); // a controller's X too (ui/padnav.js): no mouse to count down with
  act(() => fn(el.dataset, finger ? { button: 2, shiftKey: false, finger, x: ev.clientX, y: ev.clientY } : { button: 2, shiftKey: ev.shiftKey }));
  refresh();
});
// The gun builder's part row under the mouse: the stats panel shows before → after (ui/gunbuilder.js).
document.addEventListener("mouseover", (ev) => {
  if (!ui.gunb) return;
  const el = ev.target.closest && ev.target.closest("[data-gbhover]");
  if (GB_ACTIONS["gb-hover"](state, ui, { v: el ? el.dataset.gbhover : null })) refresh();
});
// The Work tab cell under the mouse takes the number keys (workKey).
document.addEventListener("mouseover", (ev) => {
  const el = ev.target.closest && ev.target.closest(".wcell");
  ui.workHover = el ? { ...el.dataset } : null;
});
document.addEventListener("input", (ev) => stackInput(ev.target));
// The custom backgrounds window: a number typed redraws its Total line in place (ui/backgrounds.js BG_INPUT; no refresh, so the box keeps its focus and caret).
document.addEventListener("input", (ev) => { const el = ev.target.closest && ev.target.closest("[data-action]"); const fn = el && BG_INPUT[el.dataset.action]; if (fn) fn(state, ui, el); }); // the stack mover's slider: the panel follows as it moves
document.addEventListener("wheel", (ev) => { const w = stackWheel(state, ui, ev); if (w) ev.preventDefault(); if (w > 1) refresh(); }, { passive: false }); // the wheel over a stack, the slider or the box: how many (else it scrolls)
document.addEventListener("change", (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el) return;
  const fn = changeActions[el.dataset.action];
  if (!fn) return;
  fn(el);
  if (el.tagName === "SELECT" || el.type === "checkbox") { releaseHold(); dropFocus(); }
  refresh(); // a panel with the mouse button down on it waits (so the click on a button after typing lands)
});
// Typing that filters as you go (the People tab's find box, ui/panelfold.js): every key press redraws.
document.addEventListener("input", (ev) => {
  const el = ev.target.closest && ev.target.closest("[data-action]");
  const fn = el && PANEL_INPUT[el.dataset.action];
  if (!fn) return;
  fn(el);
  refresh();
});

// ---------- hover descriptions ----------
const tipEl = $("tip");
let tipTarget = null;
function hideTip() {
  tipEl.classList.add("hidden");
  tipTarget = null;
}
document.addEventListener("mouseover", (e) => {
  if (touchRecent()) return; // the mouse events after a tap: a finger shows a tip by a long press (ui/touch.js)
  const el = e.target.closest("[data-tip]");
  if (!el || !el.dataset.tip) return hideTip();
  showTip(el, e);
});
// The tip of el at e's clientX / clientY (the mouse over it; a long press, e.touch: above the finger, ui/touch.js).
function showTip(el, e) {
  tipTarget = el;
  if (showTipText(el, e.shiftKey)) { tipEl.classList.remove("hidden"); placeTip(e); return; } // an item row: short, Shift the whole (ui/itemlabels.js)
  tipEl.textContent = devText(el.dataset.tip, state.combat ? "battle" : "map"); // a finger's or a pad's words for the keys and clicks (ui/hints.js)
  tipEl.classList.toggle("pre", el.hasAttribute("data-tip-pre")); // multi-line tips (the weather report)
  if (el.dataset.tipSpark) tipEl.appendChild(sparkNode(el.dataset.tipSpark)); // a stock's last 14 days (ui/ledger.js)
  tipEl.classList.remove("hidden");
  placeTip(e);
}
document.addEventListener("mousemove", (e) => {
  if (held && e.buttons === 0) releaseHold(); // the button was let go where we did not see it (a drop-down, another window)
  if (tipTarget && !touchRecent()) placeTip(e);
});
// An item row's tip (data-tip-full: ui/itemlabels.js tipAttrs): the short one, the whole one while Shift is held.
// Returns false for any other tip.
function showTipText(el, full) {
  if (!el || !el.dataset.tipFull) return false;
  tipEl.textContent = devText(full ? el.dataset.tipFull : el.dataset.tip);
  tipEl.classList.toggle("pre", !full);
  return true;
}
for (const ev of ["keydown", "keyup"]) document.addEventListener(ev, (e) => { if (e.key === "Shift" && tipTarget && document.contains(tipTarget)) showTipText(tipTarget, ev === "keydown"); });
function placeTip(e) {
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  if (e.touch) { // over the finger, not under it
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, e.clientX - w / 2)), y = e.clientY - h - 28;
    tipEl.style.left = `${x}px`;
    tipEl.style.top = `${y >= 8 ? y : Math.min(window.innerHeight - h - 8, e.clientY + 28)}px`;
    return;
  }
  let x = e.clientX + 14, y = e.clientY + 16;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
  if (y + h > window.innerHeight - 8) y = e.clientY - h - 12;
  tipEl.style.left = `${x}px`;
  tipEl.style.top = `${y}px`;
}

// A finger (ui/touch.js): a long press is a right-click (the contextmenu listeners above), else it shows the data-tip
// under it until the next touch (an item row's whole tip: there is no Shift to hold). The maps and the minimap have
// gestures of their own.
initTouch({ showTip: (el, x, y) => showTip(el, { clientX: x, clientY: y, touch: true, shiftKey: true }), hideTip, tipShown: () => !tipEl.classList.contains("hidden"), skip: "#map, #combatmap, #minimap canvas" });

// ---------- map input ----------
let drag = null;
let tipKey = ""; // what the map's tooltip shows (tile | worker | panel redraw)
canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y, moved: false };
  hideCtx();
});
window.addEventListener("mousemove", (e) => {
  const r = canvas.getBoundingClientRect();
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) {
      camera.x = drag.cx - dx / camera.zoom;
      camera.y = drag.cy - dy / camera.zoom;
      canvas.style.cursor = "grabbing";
    }
  }
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  const tip = $("tooltip");
  if (inside && !drag && e.target === canvas && !ui.started && ui.nrMap && ui.nrPick && !ui.title) { // Pick start on map: can it be a start?
    const id = screenToTile(state, e.clientX - r.left, e.clientY - r.top);
    view.hover = id;
    if (id >= 0) {
      tip.innerHTML = startTipHTML(id);
      tip.style.left = `${e.clientX - r.left + 16}px`;
      tip.style.top = `${e.clientY - r.top + 16}px`;
      tip.classList.remove("hidden");
    } else tip.classList.add("hidden");
    tipKey = "";
  } else if (inside && !drag && e.target === canvas && !ui.timelapse && ui.started) { // the timelapse shows no live tile info
    hoverAt(e.clientX - r.left, e.clientY - r.top);
  } else {
    view.hover = -1;
    view.workerHover = null;
    tip.classList.add("hidden");
    tipKey = "";
  }
});
// What is under a point of the map (sx, sy: px in the map's box): the hover ring, a move's route, the tile's tooltip
// beside it. The mouse's, and a controller's cursor (pad: the tooltip kept inside the map).
function hoverAt(sx, sy, pad = false) {
  const tip = $("tooltip");
  const id = screenToTile(state, sx, sy);
  if (id !== view.hover && ui.moveParty) {
    // Preview the route the team would take.
    const p = partyById(ui.moveParty);
    const res = p && id >= 0 ? planPath(state, ui.moveQueue ? queueEndTile(state, p) : partyTile(p), id, p.vehicle) : null;
    view.preview = res ? res.path : null;
  }
  view.hover = id;
  if (id >= 0) {
    const wk = workerAt(sx / camera.zoom + camera.x, sy / camera.zoom + camera.y); // ui/workermap.js: a base worker out on a job trip
    view.workerHover = wk && wk.sid != null ? wk.sid : null; // ui/workermap.js: their route drawn faintly
    // The same tile and worker since the last redraw of the panels (nothing on it has changed): the text stays.
    const key = `${id}|${wk ? wk.sid : ""}|${drawn}|${inputMode()}`; // the device's words (devText) too
    if (key !== tipKey) {
      tipKey = key;
      const tt = padHtml(devText(tileTooltip(state, id), "map")); // by touch and pad: tap, Ⓐ, Ⓧ for click and right-click (ui/hints.js; the mouse's words unchanged)
      tip.innerHTML = wk ? `${wk.html}<hr style="border:0;border-top:1px solid #ffffff22;margin:4px 0">${tt}` : tt;
    }
    let x = sx + 16, y = sy + 16;
    if (pad) { // beside the tile, flipped to stay on the map (a mouse's tooltip goes where the mouse is)
      tip.classList.remove("hidden"); // measured shown
      const W = canvas.clientWidth, H = canvas.clientHeight, w = tip.offsetWidth, h = tip.offsetHeight;
      x = sx + 24 + w > W - 4 ? Math.max(4, sx - 24 - w) : sx + 24;
      y = sy + 18 + h > H - 4 ? Math.max(4, sy - 18 - h) : sy + 18;
    }
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    tip.classList.remove("hidden");
  } else tip.classList.add("hidden");
}
window.addEventListener("mouseup", (e) => {
  if (!drag) return;
  if (!drag.moved) mapClick(e.clientX, e.clientY, e.shiftKey);
  drag = null;
  canvas.style.cursor = "grab";
});
// A left click on the map at a page point (x, y: clientX / clientY): the mouse's release, a tap (touchGestures below).
function mapClick(x, y, shift) {
  const r = canvas.getBoundingClientRect();
  if (!ui.started && ui.nrMap && ui.nrPick && !ui.title) { // Pick start on map (ui/newgame.js)
    const id = screenToTile(state, x - r.left, y - r.top);
    if (id >= 0) { act(() => pickStartAt(id)); dirtyNow = true; }
    return;
  }
  if (ui.timelapse || !ui.started) return;
  const id = screenToTile(state, x - r.left, y - r.top);
  const p = ui.moveParty != null && id >= 0 ? partyById(ui.moveParty) : null;
  const wk = !ui.fwPlace && !ui.meetPick && !p && ui.moveParty == null && !shift ? workerAt((x - r.left) / camera.zoom + camera.x, (y - r.top) / camera.zoom + camera.y) : null;
  if (ui.meetPick && id >= 0) act(() => meetPickClick(state, ui, id)); // ui/tradewindow.js: the meeting tile (or why not)
  else if (ui.fwPlace && id >= 0) act(() => fwPlaceClick(state, ui, id)); // ui/fieldworks.js: a field work placed here (or why not)
  else if (p) act(() => pickMove(p, id));
  else if (wk && wk.sid != null) { ui.survivor = wk.sid; mapClicked = true; } // a base worker out on the map: their survivor screen (ui/workermap.js)
  else if (id >= 0 && ui.moveParty == null) {
    // A team, another group's party, a band or outsiders on the tile are selected first (a team opens its panel),
    // the same tile again goes on to the next and then the tile; Shift+click picks the tile (ui/mapselect.js).
    clickPick(state, ui, id, shift);
    mapClicked = true; // its info is in the right panel: a folded one opens (autoShow)
  }
  ui.selected = id;
  view.selected = id;
  dirtyNow = true;
}
// Move mode: a tile was picked. A pick that cannot work (water, no route, the team's own tile) says why and
// keeps the mode on, so the team is not left standing with the clock running.
function pickMove(p, id) {
  let msg, ok;
  if (!commandable(state, p)) { ui.moveMsg = NO_RADIO; if (ui.expedition === p.id) ui.xpMsg = NO_RADIO; return; } // radio rule (plans.js)
  if (ui.moveQueue) {
    const from = queueEndTile(state, p);
    ok = id !== from && !!planPath(state, from, id, p.vehicle);
    msg = ok ? queueOrder(state, p, { type: "move", tile: id }) :
      id === from ? "The team will already be there." : p.vehicle ? "The vehicle cannot get there from the end of the queue." : "No route there over land from the end of the queue.";
  } else if (ui.moveExit === p.id) { // from the POI dialogue: the walk out to this tile's edge on that side, then on (sim/poiwalk.js)
    msg = startExitWalk(state, p, null, id);
    const w = p.phase === "task" && p.task && p.task.type === "poiwalk" ? p.task : null;
    ok = (p.phase === "out" && p.dest === id) || (!!w && w.exit && w.exit.dest === id);
    if (ok && w) {
      if (ui.speed > 0) { if (ui.speed <= MAX_SPEED) ui.lastSpeed = ui.speed; ui.speed = 0; }
      ui.pauseWhy = `Ready to walk to the tile's edge (${w.mins} min), then on to ${w.name}`;
      ui.tileView = { partyId: p.id };
    }
  } else {
    msg = orderMove(state, p, id);
    ok = p.phase === "out" && p.dest === id;
  }
  if (ui.expedition === p.id) ui.xpMsg = msg;
  if (!ok) { ui.moveMsg = msg; return; }
  log(state, msg, "info");
  endMoveMode();
}
// Pick start on map (ui/newgame.js): the world built again on the same seed with its start at this tile, if it can be one
// (sim/startpick.js startWhyNot); the crew on screen is carried over as edited, and the map stays where it is.
function pickStartAt(id) {
  const why = startWhyNot(state, id);
  if (why) { ui.nrMsg = why; return; }
  if (id === playerTile(state)) { ui.nrMsg = "You already start there."; return; }
  gen(() => { // the world again under the "Generating map…" box (the mouse's and the pad's picks both come here)
    const cam = { x: camera.x, y: camera.y, zoom: camera.zoom };
    ui.startPick = { tile: id };
    ui.crewEdited = true;
    newWorld(state.seed, true);
    Object.assign(camera, cam);
    ui.nrMap = true;
    ui.nrPick = true;
    const now = playerTile(state);
    ui.nrMsg = now === id ? `You start ${state.bases[0] ? `at ${state.bases[0].name}` : "here, on the road"}.` : "That tile cannot be a start on this map.";
  });
}
function startTipHTML(id) {
  const t = state.tiles[id], why = startWhyNot(state, id);
  const name = t.loc ? `${esc(t.loc.name)} (${esc(t.loc.type)})` : esc(t.terrain);
  return `<b>${name}</b><br>${id === playerTile(state) ? "You start here." : why ? `<span class="danger">${esc(why)}</span>` : "Click to start here."}`;
}
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });
// Right-click on the map: the tile's menu. With a team selected (ui/teamsel.js) it leads with that team's actions for
// the tile (ui/teamctx.js; Shift+right-click adds them to its queue), the other teams and the hub's missions folded
// below; with none, the menu lists every team you are in touch with and the hub's missions.
let ctxAt = null; // { tile, x, y }: where the menu was opened (its toggles redraw it in place)
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  mapMenu(e.clientX, e.clientY, e.shiftKey);
});
// The tile menu at a page point: a right-click, a long press (touchGestures below).
function mapMenu(x, y, shift) {
  const r = canvas.getBoundingClientRect();
  const id = screenToTile(state, x - r.left, y - r.top);
  if (id < 0 || ui.timelapse || !ui.started) return;
  ui.selected = id;
  view.selected = id;
  ctxAt = { tile: id, x: x - r.left, y: y - r.top };
  ui.tcAppend = !!shift;
  showCtx();
}
// A finger on the map (ui/touch.js): a drag pans, two fingers pinch the zoom about their midpoint, a tap is the left
// click and a long press the right one. No hover: the tile's tooltip stays away (its info is in the right panel).
touchGestures(canvas, {
  down: () => { hideCtx(); $("tooltip").classList.add("hidden"); view.hover = -1; },
  pan: (dx, dy) => { camera.x -= dx / camera.zoom; camera.y -= dy / camera.zoom; },
  pinch: (f, x, y) => { const r = canvas.getBoundingClientRect(); zoomAt(x - r.left, y - r.top, f); },
  tap: (x, y) => mapClick(x, y, false),
  hold: (x, y) => mapMenu(x, y, false),
});

// ---------- a controller on the State Map (ui/gamepad.js) ----------
// A cursor (render.js view.cursor) the left stick or the D-pad moves a tile at a time, with repeat; the camera follows
// it near the edges, and its tile's hover shows as under the mouse (the ring, a move's route, the tooltip beside it).
// A clicks it (mapClick: select, a move's tile, a field work's or a meeting's tile), X opens its menu (mapMenu, then
// ▲ ▼ and A in it), Y the next team waiting (N), B is Esc (closeTopLayer), ☰ pauses and runs (Space; held, the game
// menu), LB / RB slower and faster, ⧉ the panels (ui/padnav.js: the ring in them, the map waiting; a phone's drawers
// in turn), ⧉ held map only (\, a desktop), the right stick pans, LT / RT zoom about the cursor, R3 centres on it. A
// window, the tile menu and the panels are ui/padnav.js's layer, above this one. None of it shows or runs until the
// controller is the device in use (ui/inputmode.js "pad").
// Before the run starts (the user's request 2026-10-23: the whole game by pad), the new-run screen's View map and Pick
// start on map: the same cursor; Y turns Pick start on and off, A picks the start there (pickStartAt; its hover line
// beside the cursor, as the mouse's), B goes back to the setup, ⧉ the banner's buttons (ui/padnav.js).
const padMap = { tile: -1, vx: 0, follow: false };
const tilePx = (id) => { const [x, y] = state.grid.toPixel(id, HEX); return [(x - camera.x) * camera.zoom, (y - camera.y) * camera.zoom]; };
const nrMapOn = () => !ui.started && ui.nrMap && !ui.title; // the new-run screen put aside: its map
const mapPadOn = () => (ui.started || nrMapOn()) && !ui.title && !state.combat && !ui.timelapse;
const mapWinUp = () => !!ui.ask || !!ui.imenu || !!ui.box || !!modalKind(state, ui);
const inMap = (id) => { const [x, y] = tilePx(id); return x >= 0 && y >= 0 && x <= canvas.clientWidth && y <= canvas.clientHeight; };
// The cursor put down: on the tile picked if it is in view, else the one in the middle of the map.
function padSeat() {
  const id = view.selected >= 0 && inMap(view.selected) ? view.selected : screenToTile(state, canvas.clientWidth / 2, canvas.clientHeight / 2);
  padMap.tile = id;
  padMap.vx = id >= 0 ? state.grid.toPixel(id, HEX)[0] : 0;
  padShow();
}
function padShow() {
  view.cursor = padMap.tile;
  if (padMap.tile < 0) return;
  if (!$("ctxmenu").classList.contains("hidden") || mapWinUp() || !inMap(padMap.tile)) { $("tooltip").classList.add("hidden"); return; } // panned away from it: no tooltip at the map's edge
  if (!ui.started) { startTipAt(padMap.tile, ...tilePx(padMap.tile)); return; } // the new-run screen's map
  hoverAt(...tilePx(padMap.tile), true);
}
// Before the run: the start's line beside the cursor while picking (startTipHTML, as under the mouse), else nothing.
function startTipAt(id, sx, sy) {
  const tip = $("tooltip");
  view.hover = id;
  if (!ui.nrPick || id < 0) { tip.classList.add("hidden"); return; }
  const html = startTipHTML(id);
  if (tip.innerHTML !== html) tip.innerHTML = html;
  tipKey = "";
  tip.classList.remove("hidden");
  const W = canvas.clientWidth, H = canvas.clientHeight, w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${sx + 24 + w > W - 4 ? Math.max(4, sx - 24 - w) : sx + 24}px`;
  tip.style.top = `${sy + 18 + h > H - 4 ? Math.max(4, sy - 18 - h) : sy + 18}px`;
}
// One tile toward (dx, dy). Straight up or down zigzags about the column it started in (the rows are offset half a
// tile), so it keeps going straight instead of drifting to one side.
function padStep(dx, dy) {
  const id = padMap.tile;
  if (id < 0 || !inMap(id)) return padSeat(); // panned away from it: back in view first
  const [wx, wy] = state.grid.toPixel(id, HEX), h = (HEX * Math.sqrt(3)) / 2;
  const nx = dy && !dx ? padMap.vx + (wx <= padMap.vx ? 0.1 : -0.1) * HEX : wx + dx * h * (dy ? 1 : 2);
  const to = state.grid.fromPixel(nx, wy + dy * HEX * 1.5, HEX);
  if (to < 0 || to === id) return;
  padMap.tile = to;
  if (dx) padMap.vx = state.grid.toPixel(to, HEX)[0];
  padMap.follow = true;
  padShow();
}
// The point on the page of the cursor's tile (what a click there would be).
const padClient = () => { const r = canvas.getBoundingClientRect(), [x, y] = tilePx(padMap.tile); return [r.left + x, r.top + y]; };
function padPause() {
  if (ui.speed > 0) { if (ui.speed <= MAX_SPEED) ui.lastSpeed = ui.speed; ui.speed = 0; } else ui.speed = ui.lastSpeed || 1; // Space (time.pause)
}
// LB / RB: one speed slower or faster (0.25× … 5×, the keys 0–5). Paused, the speed it will run at changes and the
// clock stays stopped (☰ runs it).
function padSpeed(d) {
  const steps = [SLOWEST_SPEED, ...SPEEDS], cur = ui.speed > 0 ? ui.speed : ui.lastSpeed || 1;
  let i = 0;
  steps.forEach((v, k) => { if (Math.abs(v - cur) < Math.abs(steps[i] - cur)) i = k; });
  const v = steps[Math.max(0, Math.min(steps.length - 1, i + d))];
  ui.lastSpeed = v;
  if (ui.speed > 0) ui.speed = v;
  else ui.flash = { text: `Runs at ${v}× when you unpause (☰).`, at: performance.now() };
}
const padDo = (fn) => { act(fn); refresh(); };
claimPad("map", {
  when: mapPadOn,
  dock: () => $("mapwrap"),
  legend: () => {
    if (mapWinUp()) return [["B", "Close"]];
    if (!ui.started) return [...(ui.nrPick ? [["A", "Start here"]] : []), ["Y", ui.nrPick ? "Stop picking" : "Pick start"], ["B", "Back to setup"], ["LT RT", "Zoom"], ["View", "Banner"]];
    const pick = ui.moveParty != null ? "Move here" : ui.fwPlace ? "Place here" : ui.meetPick ? "Meet here" : "Select";
    const back = ui.moveParty != null || ui.fwPlace || ui.meetPick ? "Cancel" : "Back";
    return [["A", pick], ["B", back], ["X", "Menu"], ["Y", "Next team"], ["Menu", ui.speed > 0 ? "Pause" : "Run"], ["LB RB", "Speed"], ["View", "Panels"]];
  },
  frame: (dt, a) => {
    if (padMap.tile < 0) padSeat();
    if (a.rx || a.ry) { const sp = (900 * dt) / camera.zoom; camera.x += a.rx * sp; camera.y += a.ry * sp; padMap.follow = false; }
    const z = a.rt - a.lt;
    if (Math.abs(z) > 0.1) { const [x, y] = padMap.tile >= 0 && inMap(padMap.tile) ? tilePx(padMap.tile) : [canvas.clientWidth / 2, canvas.clientHeight / 2]; zoomAt(x, y, Math.exp(z * 1.6 * dt)); }
    if (padMap.follow && padMap.tile >= 0) { // the camera after the cursor, smoothly, until it is well inside the map again
      const [x, y] = tilePx(padMap.tile), W = canvas.clientWidth, H = canvas.clientHeight, m = Math.min(140, W * 0.18, H * 0.2);
      const ex = x < m ? x - m : x > W - m ? x - (W - m) : 0, ey = y < m ? y - m : y > H - m ? y - (H - m) : 0;
      if (!ex && !ey) padMap.follow = false;
      else { const k = Math.min(1, dt * 10); camera.x += (ex * k) / camera.zoom; camera.y += (ey * k) / camera.zoom; }
    }
    padShow();
  },
  on: (ev) => {
    const n = ev.name, seen = view.cursor >= 0;
    if (!ui.started) return padStartOn(ev); // the new-run screen's map
    if (ev.type === "hold") { if (n === "Menu") { openSettings(ui); refresh(); } else if (n === "View" && !mapWinUp() && !$("rs-dock")) padDo(() => actions["panel-all"]()); return true; } // ☰ held: the game menu (Esc); ⧉ held: map only
    if (ev.type === "up") { if (n === "Menu" && !ev.long && !mapWinUp()) { padPause(); refresh(); } else if (n === "View" && !ev.long && !mapWinUp()) navPanels(); return true; }
    if (n === "B" && ev.type === "down") { if (closeTopLayer()) refresh(); return true; }
    if (mapWinUp() || n === "Menu") return true;
    if (["Up", "Down", "Left", "Right"].includes(n)) { padStep(ev.dx, ev.dy); return true; }
    if (ev.type !== "down") return true;
    if (!seen && (n === "A" || n === "X")) { padSeat(); return true; } // the first press shows the cursor: nothing is clicked unseen
    if (n === "A" && padMap.tile >= 0) { hideCtx(); mapClick(...padClient(), false); refresh(); }
    else if (n === "X" && padMap.tile >= 0) {
      mapMenu(...padClient(), false);
      $("tooltip").classList.add("hidden"); // the menu takes the pad now (ui/padnav.js; the map's frame waits under it)
      refresh();
    } else if (n === "Y") padDo(() => { actions["team-next"]({}); if (ui.selected >= 0) { padMap.tile = ui.selected; padMap.vx = state.grid.toPixel(ui.selected, HEX)[0]; } });
    else if (n === "LB" || n === "RB") padDo(() => padSpeed(n === "LB" ? -1 : 1));
    else if (n === "RS" && padMap.tile >= 0) centerOn(state, padMap.tile);
    return true;
  },
});
// The new-run screen's map by pad: ◀ ▶ ▲ ▼ the cursor, A picks the start there (with Pick start on), Y turns Pick start
// on and off, B back to the setup, ⧉ the banner's buttons (ui/padnav.js), R3 centres on the cursor.
function padStartOn(ev) {
  const n = ev.name;
  if (ev.type === "up") { if (n === "View" && !ev.long && !mapWinUp()) navPanels(); return true; }
  if (n === "B" && ev.type === "down") { if (closeTopLayer()) refresh(); return true; }
  if (mapWinUp()) return true;
  if (["Up", "Down", "Left", "Right"].includes(n)) { padStep(ev.dx, ev.dy); return true; }
  if (ev.type !== "down") return true;
  if (view.cursor < 0 && n === "A") { padSeat(); return true; } // the first press shows the cursor
  if (n === "A" && padMap.tile >= 0) {
    if (ui.nrPick) mapClick(...padClient(), false);
    else ui.nrMsg = "Press Y to pick where you start, then A on a tile.";
    refresh();
  } else if (n === "Y") padDo(() => actions["nr-pick"]({}));
  else if (n === "RS" && padMap.tile >= 0) centerOn(state, padMap.tile);
  return true;
}
// The mouse, a key or a finger used again: the cursors, the hover they kept and the focus ring go (the mouse's own
// hover comes back as soon as it moves over the map).
window.addEventListener("inputmode", (e) => {
  if (e.detail === "pad") return;
  if (view.cursor >= 0) { view.cursor = -1; view.hover = -1; view.workerHover = null; $("tooltip").classList.add("hidden"); tipKey = ""; }
  padMap.tile = -1;
  if (padCur.on) { combatPadOff(); dirtyNow = true; }
  for (const el of document.querySelectorAll(".pad-focus")) el.classList.remove("pad-focus");
});
function showCtx() {
  if (!ctxAt) return;
  const id = ctxAt.tile;
  const t = state.tiles[id];
  const acts = tileActions(state, id);
  const waiting = state.parties.filter((p) => contactable(p) && commandable(state, p)); // radio rule (plans.js)
  const own = state.bases.some((b) => b.tile === id);
  const none = own ? "Your base" : t.terrain === "water" && !t.bridge ? "Open water: teams cross it by boat from a shore" : "Nothing to do here";
  const menu = $("ctxmenu");
  const loc = mapLoc(state, id); // a hidden site nobody has found (sim/discovery.js) is just a tile
  const hubHtml = acts.map(([m, l, pre]) => `<button data-action="plan" data-tile="${id}" data-mission="${m}"${pre ? ` data-preset="${pre}"` : ""}>${l} (from hub)</button>`).join("");
  const sel = selectedTeam(state, ui) || teamOnTile(state, id); // none selected: your team on the tile (ui/teamsel.js)
  if (!sel) {
    menu.innerHTML = `<div class="head">${esc(loc ? loc.name : `Tile ${t.x},${t.y}`)}</div>` + ctxTeams(waiting, id) +
      ctxWatchlist(state, id) + formTeamCtx(state, id) + // 📌 watch, map notes (ui/watchlist.js); Form a team at your base (ui/teamform.js)
      (acts.length ? hubHtml : `<div class="small muted" style="padding:0.3rem 0.5rem">${none}</div>`);
  } else {
    const rest = ctxTeams(waiting.filter((p) => p !== sel), id) + hubHtml;
    menu.innerHTML = teamCtxHtml(state, ui, teamTileMenu(state, ui, sel, id, { append: !!ui.tcAppend })) +
      (rest ? `<button class="tcfold" data-action="tc-more" data-tip="Other teams you are in touch with, and teams sent from the hub">${ui.ctxMore ? "▾" : "▸"} Other teams and the hub</button>${ui.ctxMore ? rest : ""}` : "") +
      ctxWatchlist(state, id) + formTeamCtx(state, id);
  }
  placeCtx(menu, ctxAt.x, ctxAt.y);
  dirtyNow = true;
}
// Every team in touch: move here, survey, boats, food from the land, claims (the menu with no team selected, and the
// folded part of a selected team's menu).
function ctxTeams(teams, id) {
  const t = state.tiles[id];
  return teams.map((p) => `<button data-action="ctxmove" data-id="${p.id}" data-tile="${id}">Move team (${p.members.length}) here</button>`).join("") +
    (t.terrain === "water" && !t.bridge ? "" : teams.filter((p) => p.kind !== "convoy").map((p) => `<button data-action="ctxsweep" data-id="${p.id}" data-tile="${id}" data-tip="Go there and survey 3 tiles around it for 12 hours: hidden places and finds (sim/survey.js). Then it waits for orders.">Survey here with team (${p.members.length}): 3 tiles, 12h</button>`).join("")) +
    ctxBoats(teams, id) + ctxLand(teams, id) + ctxClaim(teams, id) + ctxField(teams, id) + ctxFieldPlan(id);
}
// Keep the menu on the map: flipped left or up at the edges, never taller than the map (it scrolls); sizes follow the
// interface scale (rem).
function placeCtx(menu, x, y) {
  const wrap = menu.parentElement;
  const W = wrap.clientWidth, H = wrap.clientHeight;
  menu.style.maxHeight = `${Math.max(120, H - 8)}px`;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.remove("hidden");
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const left = x + w > W - 4 ? Math.max(4, x - w) : x;
  const top = y + h > H - 4 ? (y - h >= 4 ? y - h : Math.max(4, H - 4 - h)) : y;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}
// A press anywhere outside the menu closes it (the map's own mousedown closes it too).
document.addEventListener("mousedown", (e) => {
  const menu = $("ctxmenu");
  if (!menu.classList.contains("hidden") && !menu.contains(/** @type {Node} */ (e.target))) hideCtx();
}, true);
Object.assign(actions, {
  // A selected team's item (ui/teamctx.js): replace its plan or queue; the confirmation box first when orders under way would go.
  "tc-do": (d) => {
    hideCtx();
    const land = d.asked === "1" ? null : landPick(state, ui, d); // ui/landorder.js: a land job asks its hours (and who) first
    if (land && askLand(state, ui, d, { via: "tc", ...land })) return;
    const split = d.whoAsked === "1" || land ? null : splitPick(state, ui, d); // ui/whopick.js: who does it
    if (split && askWho(state, ui, d, { via: "tc", label: split.label })) return;
    const msg = runTeamAction(state, ui, d, actions);
    if (msg === null) return; // asked first (ui/confirm.js): Yes runs it again
    if (msg) log(state, msg, "info");
    if (ui.expedition === Number(d.id)) ui.xpMsg = msg || "";
    endMoveMode();
  },
  "tc-mode": () => { ui.tcAppend = !ui.tcAppend; showCtx(); }, // replace ⇄ add to the queue
  "tc-more": () => { ui.ctxMore = !ui.ctxMore; showCtx(); },   // the other teams and the hub, folded
  "tc-all": () => { ui.ctxAll = !ui.ctxAll; showCtx(); },      // every order for the tile, and the team panel, folded (ui/teamctx.js)
});
// Right-click on the land straight across one water tile from a team you are in touch with: build a boat.
function ctxBoats(teams, id) {
  return teams.filter((p) => p.kind !== "convoy" && crossingTo(state, partyTile(p), id)).flatMap((p) =>
    (p.vehicleId ? ["raft", "leave"] : ["raft"]).map((m) => {
      const plan = boatPlan(state, p, partyTile(p), id, m);
      return `<button data-action="ctxcross" data-id="${p.id}" data-tile="${id}" data-mode="${m}" ${plan.ok ? "" : "disabled"} data-tip="${esc(boatTip(state, plan, id))}">Boat team (${p.members.length}) across${p.vehicleId ? (m === "raft" ? ", raft vehicle" : ", leave vehicle") : ""} · ${plan.mats.scrap} scrap, ${plan.hours}h</button>`;
    })).join("");
}
// Right-click a land tile with a team you are in touch with: go there and forage, hunt or fish (sim/foraging.js,
// sim/hunting.js), the hours asked first (ui/landorder.js). The team panel's low-food list uses the same action.
function ctxLand(teams, id) {
  const t = state.tiles[id];
  if (!t || t.terrain === "water") return "";
  const fish = !!fishSpot(state, id);
  return teams.filter((p) => p.kind !== "convoy").flatMap((p) => [
    forageAbundance(state, id) >= 0.05 ? `<button data-action="ctxhunt" data-id="${p.id}" data-tile="${id}" data-type="forage">${partyTile(p) === id ? "Forage here" : "Go and forage here"}, team (${p.members.length})…</button>` : "",
    gameAbundance(state, id) >= 0.08 ? `<button data-action="ctxhunt" data-id="${p.id}" data-tile="${id}" data-type="hunt">${partyTile(p) === id ? "Hunt here" : "Go and hunt here"}, team (${p.members.length})…</button>` : "",
    fish ? `<button data-action="ctxhunt" data-id="${p.id}" data-tile="${id}" data-type="fish">${partyTile(p) === id ? "Fish here" : "Go and fish here"}, team (${p.members.length})…</button>` : "",
    woodAbundance(state, id) >= 0.1 ? `<button data-action="ctxhunt" data-id="${p.id}" data-tile="${id}" data-type="wood">${partyTile(p) === id ? "Cut wood here" : "Go and cut wood here"}, team (${p.members.length})…</button>` : "", // sim/woodcutting.js
  ]).join("");
}
// Right-click a land tile with a team you are in touch with: go there and claim it (sim/claims.js: a marker post, the
// land counts for the coalition), or dig a well on a claim of yours next to one of your bases.
function ctxClaim(teams, id) {
  const t = state.tiles[id];
  if (!t || t.terrain === "water" || !state.bases.length) return "";
  const cw = canClaim(state, id), ww = wellProblem(state, null, id);
  if (cw && ww) return "";
  return teams.filter((p) => p.kind !== "convoy").flatMap((p) => [
    !cw ? `<button data-action="ctxclaim" data-id="${p.id}" data-tile="${id}" data-type="claim" data-tip="${esc(`Raise a marker post (${CLAIM.SCRAP} scrap carried): the tile counts as land the coalition holds, toward the 50% the alliance victory needs.`)}">${partyTile(p) === id ? "Claim this tile" : "Go and claim this tile"}, team (${p.members.length}) · ${CLAIM.HOURS}h</button>` : "",
    !ww ? `<button data-action="ctxclaim" data-id="${p.id}" data-tile="${id}" data-type="well" data-tip="${esc(`Dig a well on this claim (${CLAIM.WELL_SCRAP} scrap, ${CLAIM.WELL_PARTS} part carried): the people at your base next to it haul its water.`)}">${partyTile(p) === id ? "Dig a well here" : "Go and dig a well here"}, team (${p.members.length}) · ${CLAIM.WELL_HOURS}h</button>` : "",
  ]).join("");
}
// Field works (sim/fieldworks.js): a team's acts at a structure on the tile (load or leave finds at your stockpile; wreck,
// take or loot a group's), and planning one on land of yours from the base that holds it.
function ctxField(teams, id) {
  const fw = fieldWorkAt(state, id);
  if (!fw) return "";
  return teams.filter((p) => p.kind !== "convoy").flatMap((p) => teamFieldItems(state, p, id).map((it) =>
    `<button data-action="ctxfwork" data-id="${p.id}" data-tile="${id}" data-act="${it.order.act}" ${it.why && partyTile(p) === id ? "disabled" : ""} data-tip="${esc(it.why || it.hint)}">${partyTile(p) === id ? "" : "Go: "}${esc(it.label)}, team (${p.members.length})</button>`)).join("");
}
function ctxFieldPlan(id) {
  if (fieldWorkAt(state, id)) return "";
  return state.bases.flatMap((b) => FIELD.ORDER.filter((k) => !placeProblem(state, b, k, id)).map((k) =>
    `<button data-action="ctxfwplan" data-base="${b.id}" data-tile="${id}" data-kind="${k}" data-tip="${esc(`${FIELD.KINDS[k].desc} Paid now from ${b.name}'s stores; its builders walk out and put it up.`)}">Plan ${FIELD.KINDS[k].icon} ${FIELD.KINDS[k].name.toLowerCase()} here (${esc(b.name)})</button>`)).join("");
}
actions.ctxfwplan = (d) => {
  const b = baseById(state, Number(d.base));
  const r = b ? planFieldWork(state, b, d.kind, Number(d.tile)) : { error: "No base." };
  if (r.error) log(state, r.error, "info");
  hideCtx();
};
actions.ctxfwork = (d) => {
  const p = partyById(d.id);
  if (p) {
    const tile = Number(d.tile);
    const job = { type: "fwork", act: d.act };
    let msg;
    if (partyTile(p) === tile && (p.phase === "waiting" || p.phase === "task")) msg = startOrder(state, p, job);
    else {
      p.orders = [];
      msg = orderMove(state, p, tile);
      if (p.phase === "out" && p.dest === tile) msg = `${msg} ${queueOrder(state, p, { ...job, at: tile })}`;
    }
    if (msg) log(state, msg, "info");
    if (ui.expedition === p.id) ui.xpMsg = msg;
  }
  endMoveMode();
  hideCtx();
};
actions.ctxclaim = (d) => {
  const p = partyById(d.id);
  if (p) {
    const tile = Number(d.tile);
    const job = { type: d.type === "well" ? "well" : "claim" };
    let msg;
    if (partyTile(p) === tile && (p.phase === "waiting" || p.phase === "task")) msg = startOrder(state, p, job);
    else {
      p.orders = [];
      msg = orderMove(state, p, tile);
      if (p.phase === "out" && p.dest === tile) msg = `${msg} ${queueOrder(state, p, { ...job, at: tile })}`;
    }
    if (msg) log(state, msg, "info");
    if (ui.expedition === p.id) ui.xpMsg = msg;
  }
  endMoveMode();
  hideCtx();
};
actions.ctxhunt = (d) => {
  const p = partyById(d.id);
  if (p) {
    const tile = Number(d.tile);
    const type = ["fish", "forage", "wood", "stone"].includes(d.type) ? d.type : "hunt";
    const here = partyTile(p) === tile;
    // ui/landorder.js: the hours and what they would bring, first (from when the team would get there)
    if (askLand(state, ui, d, { via: "ctxhunt", type, tile, startHour: state.hour + (here ? 0 : (Parties.moveEstimate(state, p, tile) || { hours: 0 }).hours || 0) })) { endMoveMode(); hideCtx(); return; }
    const job = { type, hours: d.hours ? Number(d.hours) : 8, ...(d.qty != null && d.qty !== "" ? { qty: Number(d.qty) } : {}) };
    let msg;
    if (partyTile(p) === tile && (p.phase === "waiting" || p.phase === "task")) msg = startOrder(state, p, job);
    else {
      p.orders = [];
      msg = orderMove(state, p, tile);
      if (p.phase === "out" && p.dest === tile) msg = `${msg} ${queueOrder(state, p, { ...job, at: tile })}`;
    }
    if (msg) log(state, msg, "info");
    if (ui.expedition === p.id) ui.xpMsg = msg;
  }
  endMoveMode();
  hideCtx();
};
actions.ctxcross = (d) => {
  const p = partyById(d.id);
  if (p) {
    const o = boatOrder(state, p, partyTile(p), Number(d.tile), d.mode);
    const msg = o.error || startOrder(state, p, o);
    log(state, msg, "info");
    if (ui.expedition === p.id) ui.xpMsg = msg;
  }
  hideCtx();
};
actions.ctxsweep = (d) => {
  const p = partyById(d.id);
  if (p) {
    const msg = orderSweepAt(state, p, Number(d.tile), { radius: 3, hours: 12 });
    log(state, msg, "info");
    if (ui.expedition === p.id) ui.xpMsg = msg;
  }
  endMoveMode();
  hideCtx();
};
actions.ctxmove = (d) => {
  const p = partyById(d.id);
  if (p) log(state, orderMove(state, p, Number(d.tile)), "info");
  endMoveMode(); // the menu's move replaces a pick that was still open
  hideCtx();
};
// Order gate (sim/plans.js commandable): every team of yours takes orders wherever it is (no radio-range limit);
// convoys and anything not yours are refused here, and each order checks the team's state and path itself.
for (const k of ["orders", "movemode", "gohome", "xp-order", "xp-cross", "xp-move", "xp-stop", "xp-resume", "xp-unqueue", "xp-clearq", "xp-cancelmove", "xp-qmove", "xp-qdrop", "ctxmove", "ctxcross", "ctxhunt", "ctxsweep", "ctxclaim", "ctxfwork", "tc-do"]) {
  const fn = actions[k];
  actions[k] = (d) => {
    const p = partyById(d.id);
    if (p && !commandable(state, p)) { ui.xpMsg = NO_RADIO; if (k === "ctxmove" || k === "ctxcross" || k === "ctxhunt" || k === "ctxsweep" || k === "ctxclaim" || k === "ctxfwork" || k === "tc-do") hideCtx(); else if (ui.expedition == null) log(state, NO_RADIO, "info"); return; }
    return fn(d);
  };
}

// Team panel actions: start now if the team is waiting or working on the spot (unless queue mode is on in its
// panel), otherwise add to the end of its queue. Nothing here touches the speed: an order given while the game
// is paused starts when the player unpauses.
const startsNow = (p) => (p.phase === "waiting" || p.phase === "task") && !(ui.xpQueue && ui.expedition === p.id);
function issueOrder(p, o) {
  const msg = startsNow(p) ? startOrder(state, p, o) : queueOrder(state, p, o);
  ui.xpMsg = msg || "";
  if (msg) log(state, msg, "info");
}
function hideCtx() {
  $("ctxmenu").classList.add("hidden");
}

// ---------- combat input ----------
// The enemy turn keeps playing even when animation frames are throttled (hidden tab).
setInterval(() => { if (state.combat && !ui.settings && combatTick(state, performance.now())) refresh(false); }, 200);
const cbCanvas = $("combatmap");
const cbPos = (e) => { const r = cbCanvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
cbCanvas.addEventListener("mousemove", (e) => { if (state.combat) combatMouse(state, ...cbPos(e)); });
cbCanvas.addEventListener("mouseleave", () => { if (state.combat) combatLeave(); });
// The isometric view (ui/isoview.js), the only battle view: a press that moves pans the map, one that does not is the
// click (on release). Right click cancels the current action (on the release: a drag does not).
const cancelAction = () => { if (state.combat) { cui.mode = "move"; cui.msg = ""; refresh(); } };
cbCanvas.addEventListener("mousedown", (e) => {
  if (!state.combat) return;
  if (e.button === 1) e.preventDefault();
  combatPress(state, ...cbPos(e), e.button);
});
window.addEventListener("mouseup", (e) => {
  if (!state.combat) return;
  const what = combatRelease(state, ...cbPos(e));
  if (what === "click") { combatClick(state, ...cbPos(e)); refresh(); }
  else if (what === "cancel") cancelAction();
});
cbCanvas.addEventListener("wheel", (e) => { if (state.combat && combatWheel(state, ...cbPos(e), e.deltaY)) e.preventDefault(); }, { passive: false });
cbCanvas.addEventListener("contextmenu", (e) => e.preventDefault()); // right click cancels on the release (combatRelease)
// A finger on the battle map (ui/touch.js): a drag pans; a pinch steps the zoom (its steps are the wheel's, one each
// time the fingers spread or close by a fifth); a tap is the left click (what is under it shown first, as the mouse's
// hover would); a long press is the right click (cancel the current action, or Ally orders back a step).
let cbPinch = 1;
touchGestures(cbCanvas, {
  down: () => { cbPinch = 1; },
  pan: (dx, dy) => { if (state.combat) combatPan(state, dx, dy); },
  pinch: (f, x, y) => {
    cbPinch *= f;
    if (cbPinch > 0.8 && cbPinch < 1.25) return;
    const [px, py] = cbPos({ clientX: x, clientY: y });
    if (state.combat) combatWheel(state, px, py, cbPinch > 1 ? -1 : 1);
    cbPinch = 1;
  },
  // A tap that would send an order (move, shoot, throw, search...) previews it first, with a chip to confirm; the same
  // cell again or the chip's ✓ sends it (ui/combat.js combatTap, "cb-tap"). One that only selects is made at once.
  tap: (x, y) => {
    if (!state.combat) return;
    const [px, py] = cbPos({ clientX: x, clientY: y });
    combatMouse(state, px, py, false);
    combatPress(state, px, py, 0);
    if (combatRelease(state, px, py) === "click") { combatTap(state, px, py); refresh(); }
  },
  hold: (x, y) => {
    if (!state.combat) return;
    if (cui.tapAsk) cui.hover = null; // the preview a tap held goes with the cancel (and its path, cone or blast)
    cui.tapAsk = null; cui.tapFace = null;
    const [px, py] = cbPos({ clientX: x, clientY: y });
    combatPress(state, px, py, 2);
    if (combatRelease(state, px, py) === "cancel") cancelAction();
    else refresh();
  },
});
actions["cb-tap"] = (d) => combatTapChip(state, d.v); // the confirm chip a tap leaves on the battle map: ✓ or ✕

// A controller in a battle or a raid (ui/gamepad.js; the cursor and its moves are ui/combat.js combatPad…): the left
// stick or the D-pad moves a cell cursor with the hover's preview on it (the path and its cost, the hit chance); A acts
// on the cell as a finger's tap with the confirm always on (the first A previews with the chip, the second sends; one
// that only selects is made at once); B drops the preview or the mode (Esc); LB / RB the previous or next unit, the
// cursor with them; Y End turn as its button (it asks while anyone has actions: Y again); X takes the orders bar (◀ ▶,
// A, B back; a tray's button opens the tray and stays in the bar); the right stick pans, LT / RT zoom steps about the
// cursor, R3 centres on the selected unit; ☰ the game menu; ⧉ the battle panel and the raid's strip (ui/padnav.js). A
// window over the battle (a search's loot, a kit, the plan before a raid), the orders bar and a battle's question
// (the retreat, the fall back, End turn's) are ui/padnav.js's layer, above this one.
// The same screen with nobody on it (the user's request 2026-10-23: the whole game by pad): the camp's spot (b.site,
// ui/campsite.js) and the base map (b.layout, ui/basemap.js). The cursor is the mouse there too: its 5 × 5 or the
// pick's ghost, green or red, and the hover line in the panel; A clicks the cell (picks the spot; builds or puts the
// pick down, selects a placed thing, again lifts it to move, a piece of the land's card to clear it); Y sets up camp on
// the spot picked, or turns the pick (R); B puts the pick down, then lets the selection go (Esc; the camp's spot: no
// back, Let the game pick is its button); LB / RB turn the view (no units to go through); ⧉ the panel (the Build list,
// the lists, the selected thing's card: Demolish, Move, Clear), and a thing picked there to build or place gives the
// pad back to the cursor (ui/padnav.js).
const battleWinUp = () => !!(ui.ask || ui.imenu || ui.box) || !!modalKind(state, ui);
const barItems = () => [...document.querySelectorAll("#cbbar button:not([disabled])")].filter((el) => el.offsetParent !== null);
claimPad("battle", {
  when: () => !!state.combat && !ui.timelapse,
  dock: () => $("cbmapwrap"),
  legend: () => {
    const b = state.combat;
    if (battleWinUp()) return [["B", "Close"]];
    if (b.over) return [["Y", "Close"], ["Menu", "Menu"]];
    if (b.site) return [["A", "Pick spot"], ["Y", "Set up camp"], ["LB RB", "Turn view"], ["LT RT", "Zoom"], ["View", "Panel"], ["Menu", "Menu"]];
    if (b.layout && b.phase === "deploy") {
      const L = b.layout, held = !!(L.pickType || L.pick);
      return [["A", L.pickType ? "Build here" : L.pick ? "Put here" : "Select"], ...(held ? [["Y", "Rotate"]] : []), ...(held || L.sel ? [["B", held ? "Put back" : "Deselect"]] : []), ["LB RB", "Turn view"], ["LT RT", "Zoom"], ["View", L.sel || L.land ? "Card" : "Build list"], ["Menu", "Menu"]];
    }
    const asked = !!cui.tapAsk || !!cui.tapFace;
    return [["A", asked ? "Confirm" : "Act"], ["B", asked || cui.mode !== "move" ? "Cancel" : "Back"], ["X", "Orders"], ["Y", b.phase === "deploy" ? "Start" : "End turn"], ["LB RB", "Unit"], ["Menu", "Menu"]];
  },
  frame: (dt, a) => {
    if (battleWinUp()) return;
    combatPadOn(state); // the first time (a no-op after)
    if (a.rx || a.ry) combatPan(state, -a.rx * 900 * dt, -a.ry * 900 * dt);
    combatPadFrame(state);
  },
  on: (ev) => {
    const n = ev.name;
    if (n === "View" && ev.type === "up" && !ev.long && !battleWinUp()) { navBattle(); refresh(); return true; }
    if (ev.type === "up" || ev.type === "hold") return true;
    if (n === "B" && ev.type === "down") { if (closeTopLayer() || combatPadB(state)) refresh(); return true; }
    if (battleWinUp()) return true;
    if (["Up", "Down", "Left", "Right"].includes(n)) { if (!combatPadOn(state)) combatPadMove(state, ev.dx, ev.dy); refresh(false); return true; }
    if (n === "LT" || n === "RT") { combatPadZoom(state, n === "RT" ? -1 : 1); return true; } // held: a step every repeat
    if (ev.type !== "down") return true;
    if (combatPadOn(state) && (n === "A" || n === "X")) { refresh(); return true; } // the first press shows the cursor: nothing is done unseen
    if (n === "A") { act(() => combatPadA(state)); refresh(); }
    else if (n === "Y") { act(() => combatPadEnd(state)); refresh(); }
    else if ((n === "LB" || n === "RB") && (state.combat.site || state.combat.layout)) { combatAction(state, "cb-view", { v: n === "LB" ? "rotl" : "rotr" }); refresh(); } // nobody on the map: the view turns
    else if (n === "LB" || n === "RB") { combatPadCycle(state, n === "LB" ? -1 : 1); refresh(); }
    else if (n === "X" && barItems().length) { navBar(); refresh(); } // the orders bar (ui/padnav.js: A gives one and comes back, a tray stays)
    else if (n === "RS") { combatAction(state, "cb-view", { v: "center" }); refresh(); }
    else if (n === "Menu") { openSettings(ui); refresh(); }
    return true;
  },
});
// The windows, menus and panels (ui/padnav.js), above the map and the battle.
// mapPick: what is being picked on a map now ("" for nothing): a team's move, a field work's or a meeting's tile; the
// base map's thing to build or place (a new one hands the pad from its panel back to the cursor).
const padPickKey = () => {
  const L = state.combat && state.combat.layout;
  if (L) return L.pickType || L.pick ? `bm:${L.pickType || ""}:${L.pick || ""}` : "";
  return ui.moveParty != null ? `move:${ui.moveParty}` : ui.fwPlace ? "fw" : ui.meetPick ? "meet" : "";
};
initPadNav({ ui, state: () => state, actions, refresh: () => refresh(), mapPick: padPickKey });
// A question over anything (ui/confirm.js): A says yes, B cancels, as Enter and Esc. Claimed after the map, the
// battle and the windows, so it is above them.
claimPad("ask", {
  when: () => !!ui.ask,
  legend: () => [["A", "Yes"], ["B", "Cancel"]],
  on: (ev) => { if (ev.type === "down" && (ev.name === "A" || ev.name === "B")) { act(() => askKey(ui, { code: ev.name === "A" ? "Enter" : "Escape" }, actions)); refresh(); } return true; },
});

// ---------- keyboard ----------
// Esc closes one layer per press, the topmost first. Returns false when there was nothing of ours to close.
function closeTopLayer() {
  if (closeItemMenu(ui)) return true; // ui/itemmenu.js
  if (ui.box) { ui.box = null; return true; } // ui/boxview.js
  if (!$("ctxmenu").classList.contains("hidden")) { hideCtx(); return true; }
  if (ui.workPick) { ui.workPick = null; return true; } // the Work tab's picker (a long press, ui/work.js)
  if (ui.zombieLook) { ui.zombieLook = false; return true; }
  if (ui.hall) { ui.hall = null; return true; } // ui/halloffame.js (over the title and the end screens)
  if (ui.wcOpen) { actions["wc-close"](); return true; } // the World… window (ui/worldcfg.js): the world again if a dial moved
  if (ui.bgEditor) { closeBackgrounds(); return true; }
  if (ui.gearEdit) { ui.gearEdit = null; return true; } // the starting gear window (ui/startgear.js)
  if (ui.fleetEdit) { ui.fleetEdit = null; return true; } // a starting vehicle's back window (ui/startgear.js)
  if (ui.fleetView) { ui.fleetView = null; return true; } // the look at a starting vehicle's back (ui/startgear.js)
  if (ui.crewInv) { ui.crewInv = null; return true; } // a crew card's 👁 Inventory (ui/newgame.js)
  if (!ui.started && ui.nrMap) { backToSetup(ui); return true; } // looking at the map from the new-run screen: back to it
  if (ui.settings) { // a question first, then the menu itself (not while a save or load is running)
    if (ui.settings.confirm) ui.settings.confirm = null;
    else if (!ui.settings.busy) ui.settings = null;
    return true;
  }
  if (ui.gunb) { // the gun builder: the part list first, then the window (back to the inventory under it)
    if (ui.gunb.slot) { ui.gunb.slot = null; ui.gunb.hover = null; }
    else ui.gunb = null;
    return true;
  }
  if (ui.inv && ui.inv.form && teamFormEsc(state, ui)) return true; // ui/teamform.js: asks before closing with gear moved
  if (ui.inv) { // drops the selection first, then closes
    if (ui.invSel) ui.invSel = null;
    else { ui.inv = null; ui.invMsg = ""; }
    return true;
  }
  if (ui.meet) { ui.meet = null; return true; } // ui/teammeet.js (in a battle: Teams together from the plan's window, ui/raidplan.js)
  if (state.combat && planEsc(state)) return true; // ui/raidplan.js: the Leave question, or the map put aside, back to the window
  if (state.combat) return false; // the battle has its own Esc (cancel the current action)
  if (ui.volPick) { ui.volPick = null; return true; } // ui/volunteers.js
  if (ui.volReq) { ui.volReq = null; return true; }
  if (ui.why) { ui.why = null; return true; } // ui/causes.js: the "Why?" panel
  if (!ui.started) {
    if (ui.lookEdit == null) return false;
    ui.lookEdit = null;
    return true;
  }
  if (ui.ledger) { ui.ledger = null; return true; } // ui/ledger.js (it can open over the end screen)
  if (ui.achView) { ui.achView = null; return true; } // ui/achievements.js (the same)
  if (state.gameOver) return false;
  if (ui.cardResult) { ui.cardResult = null; return true; }
  if (trayEsc(state, ui)) return true; // a card opened from the tray goes back to it (ui/pacing.js)
  if (meetPickCancel(ui)) return true; // ui/tradewindow.js: picking a meeting tile: back to the radio (or its trade window)
  if (!state.autopilot && (cardUp(state, ui) || state.engagement || state.trade || activeCrawl(state))) return false; // these need an answer
  if (ui.planner) { ui.planner = null; view.preview = null; return true; }
  if (ui.routeSetup) { ui.routeSetup = null; return true; }
  if (ui.diplo) { ui.diplo = null; ui.diploMsg = ""; return true; } // ui/diplomacy.js (it opens over the radio panel)
  if (ui.radioWith != null) { ui.radioWith = null; ui.radioMsg = ""; return true; }
  if (ui.caravanPlan) { ui.caravanPlan = null; ui.cvMsg = ""; return true; }
  if (ui.skillTree != null) { ui.skillTree = null; ui.skillMsg = ""; return true; } // ui/skills.js: back to the survivor screen
  if (ui.survivor != null) {
    if (ui.lookEdit != null) ui.lookEdit = null;
    else ui.survivor = null;
    return true;
  }
  if (ui.tileView) { ui.tileView = null; return true; } // ui/poipick.js: the walk goes on
  if (ui.memorial) { ui.memorial = null; ui.memorialMsg = ""; return true; } // ui/relations.js
  if (ui.baseView) {
    if (ui.supplyForm) { ui.supplyForm = null; ui.supplyError = ""; }
    else { ui.baseView = null; ui.baseMsg = ""; }
    return true;
  }
  if (ui.roster) { ui.roster = null; return true; }
  if (ui.diary) { ui.diary = null; return true; }
  if (ui.codex) { ui.codex = null; return true; } // ui/codex.js
  if (ui.moveParty != null) { endMoveMode(); return true; }
  if (fwPlaceCancel(ui)) return true; // ui/fieldworks.js: placing a field work: back to the base's tab
  if (ui.expedition != null && ui.qSel != null) { ui.qSel = null; return true; } // a selected queued order: unselect first
  if (ui.expedition != null) { ui.expedition = null; ui.xpMsg = ""; return true; }
  return false;
}

window.addEventListener("keydown", (e) => {
  // Menu → Controls waiting for a key (ui/controls.js): the next key press is the new binding.
  if (controlsKey(ui, e, settingsApi)) { e.preventDefault(); refresh(); return; }
  const t = e.target || {};
  if (stackKey(state, ui, e)) { e.preventDefault(); refresh(); return; } // the stack mover (ui/stackmove.js): Enter moves, Esc cancels, from its number box too
  if (bnKey(state, ui, e)) { e.preventDefault(); refresh(); return; } // the naming window (ui/basename.js): Enter names it, Esc keeps the name
  if (t.tagName === "SELECT" || t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && t.type !== "checkbox")) return;
  // A question before an order that cannot be undone (ui/confirm.js) takes the keyboard: Enter yes, Esc cancel.
  if (ui.ask) { e.preventDefault(); act(() => askKey(ui, e, actions)); refresh(); return; }
  if (ui.carry) { e.preventDefault(); act(() => carryKey(state, ui, e, actions)); refresh(); return; } // ui/carry.js: Enter collects, Esc cancels
  if (ui.landAsk) { e.preventDefault(); act(() => landKey(state, ui, e, actions)); refresh(); return; } // ui/landorder.js: Enter gives the order, Esc cancels
  if (ui.whoAsk) { e.preventDefault(); act(() => whoKey(state, ui, e, actions)); refresh(); return; } // ui/whopick.js: Enter sends them, Esc cancels
  // The timelapse viewer takes the keyboard (play, step, speed, pan, Esc closes).
  if (ui.timelapse) {
    if (tlKey(state, ui, e)) { e.preventDefault(); refresh(); }
    return;
  }
  if (e.code === "Escape" && closeTopLayer()) { e.preventDefault(); refresh(); return; }
  // The menu's question (ui/settings.js): Enter answers yes, like the map's confirmation box.
  if (ui.settings && ui.settings.confirm && (e.code === "Enter" || e.code === "NumpadEnter")) { e.preventDefault(); actions["set-yes"]({}); refresh(); return; }
  // Esc with nothing of ours to close opens the menu (in a battle Esc cancels the current action; ⚙ Menu is in the panel).
  if (ui.title) { if (!ui.settings && !ui.zombieLook && !ui.hall && titleKey(ui, e)) e.preventDefault(); return; } // the title screen (ui/title.js): only the menu's keys
  if (e.code === "Escape" && !state.combat) { e.preventDefault(); openSettings(ui); refresh(); return; }
  if (ui.inv && ui.inv.form && !ui.gunb && !ui.settings && teamFormKey(state, ui, e)) { e.preventDefault(); refresh(); return; } // ui/teamform.js: tabs, picking people, Enter
  if (ui.zombieLook || ui.wcOpen || ui.bgEditor || ui.gearEdit || ui.fleetEdit || ui.fleetView || ui.crewInv || ui.inv || ui.gunb || ui.settings || ui.hall) return; // these screens take the keyboard
  if (state.combat) {
    if (combatKey(state, e)) { e.preventDefault(); refresh(); }
    return;
  }
  // Ctrl+K or / (ui/keymap.js win.palette): the search box (ui/cmdpalette.js), over any window but a card.
  if (ui.started && keyIs(e, "win.palette") && !["card", "result", "over", "newrun"].includes(modalKind(state, ui))) { e.preventDefault(); openPalette(); return; }
  // A selected order in the team panel's queue (ui/expedition.js queueBlock): ↑ ↓ move it, Delete removes it.
  const qk = ui.expedition != null && ui.qSel != null ? keyAction(e, "queue") : null;
  if (qk) {
    e.preventDefault();
    const p = partyById(ui.expedition);
    if (p) {
      if (qk === "queue.remove") actions["xp-unqueue"]({ id: p.id, i: ui.qSel });
      else actions["xp-qmove"]({ id: p.id, i: ui.qSel, dir: qk === "queue.up" ? -1 : 1 });
    }
    refresh();
    return;
  }
  if (undoKey(state, ui, e)) { e.preventDefault(); refresh(); return; } // Ctrl+Z in the planner, the build queue, the Work tab (ui/undo.js)
  // The Work tab: 1–5, 0 / Backspace / Delete and R on the cell under the mouse (ui/work.js).
  if (ui.workHover ? undoable(state, ui, "work", () => workKey(state, ui, e), null, "priority") : workKey(state, ui, e)) { e.preventDefault(); refresh(); return; }
  if (ledgerKey(state, ui, e, modalKind(state, ui))) { e.preventDefault(); refresh(); return; } // E: the Ledger (ui/ledger.js)
  // M the minimap, ` the dev tools (when they are shown), Shift+P autopilot only with them (ui/display.js).
  if (displayKey(ui, e, modalKind(state, ui))) { e.preventDefault(); refresh(); return; }
  // Tabs, next waiting team, bases, camera spots, diary, roster and codex (ui/alerts.js); J, R and C also close their window.
  if (buildMapKey(state, ui, e, modalKind(state, ui))) { e.preventDefault(); refresh(); return; } // U: the selected base's build map (ui/buildmap.js)
  if (mapHotkey(state, ui, e, actions, modalKind(state, ui))) { e.preventDefault(); refresh(); return; }
  // Map shortcuts do nothing behind a window (a card, the planner, a base, help) or on the new-run screen. The tile
  // view (a team walking on its tile, ui/poipick.js) lets Space and the speeds through: the clock runs under it.
  const mk = modalKind(state, ui);
  if (mk && !(mk === "tileview" && /^time\./.test(keyAction(e, "map") || ""))) return;
  // The rest of the map's keys, by the key table (ui/keymap.js; Menu → Controls rebinds them).
  const k = keyAction(e, "map");
  // Panels (ui/layout.js): [ left, ] right, L log, Shift+] alerts, \ map only (Shift+[ opens the left panel on the
  // Orders tab: ui/alerts.js mapHotkey, above). A panel's key
  // opens it whether it is folded or closed completely. Alt + the key closes the panel completely (strip and
  // all), and brings a closed one back.
  const shut = { "panel.closeLeft": "left", "panel.closeRight": "right", "panel.closeLog": "log" }[k];
  if (shut) { e.preventDefault(); actions["panel-close"]({ p: shut }); refresh(); return; }
  const fold = { "panel.left": "left", "panel.right": "right", "panel.log": "log", "panel.alerts": "alerts" }[k];
  if (fold) { e.preventDefault(); actions["panel-toggle"]({ p: fold }); refresh(); return; }
  if (k === "panel.all") { e.preventDefault(); actions["panel-all"](); refresh(); return; }
  const speed = /^time\.speed([1-5])$/.exec(k || "");
  if (k === "time.pause") {
    e.preventDefault();
    if (ui.speed > 0) { if (ui.speed <= MAX_SPEED) ui.lastSpeed = ui.speed; ui.speed = 0; } else ui.speed = ui.lastSpeed || 1;
  } else if (k === "time.speed0") { // 0: 0.25× (ui/pacing.js SLOWEST_SPEED)
    ui.speed = SLOWEST_SPEED;
    ui.lastSpeed = ui.speed;
  } else if (speed) { // 1–5: 0.5× 1× 2× 3× 5× (ui/pacing.js SPEEDS; the keys by the key table)
    ui.speed = SPEEDS[Number(speed[1]) - 1];
    ui.lastSpeed = ui.speed;
  } else if (k === "map.hub") centerOn(state, playerTile(state));
  else if (k === "map.infection") view.layers.has("infection") ? view.layers.delete("infection") : view.layers.add("infection");
  else {
    const pan = 40 / camera.zoom;
    if (k === "map.panUp") camera.y -= pan;
    else if (k === "map.panDown") camera.y += pan;
    else if (k === "map.panLeft") camera.x -= pan;
    else if (k === "map.panRight") camera.x += pan;
    else return;
    if (e.code.startsWith("Arrow")) e.preventDefault();
    return; // panning changes no panel
  }
  refresh();
});
// Space let go on a focused button or checkbox must not press it as well.
window.addEventListener("keyup", (e) => {
  if (state.combat) combatKeyUp(state, e); // the battle view's held pan keys
  const t = e.target || {};
  if (e.code === "Space" && (t.tagName === "BUTTON" || (t.tagName === "INPUT" && t.type === "checkbox"))) e.preventDefault();
});

initPalette({ getState: () => state, ui, actions, options, refresh: () => refresh() }); // the search box (ui/cmdpalette.js)
installSelectSearch(); // long drop-downs open a box you can type in to filter (ui/selectsearch.js)
initGamepad(); // ui/gamepad.js: a controller, once one is connected (its layers: map input, combat input)

// Expose for debugging in the console.
window.game = {
  get state() { return state; }, ui, tickHour: () => { tickHour(state); refresh(); }, refresh: () => refresh(),
  frameErrors, devSpeeds: DEV_SPEEDS,
  crashTest: (msg = "a test crash from the console") => reportCrash(new Error(msg), "the console (a test)"), // the error screen (ui/crash.js)
  options, layout, windowSizes,
  // Saves and loads in flight (ui/settings.js): await game.settle() before reading their result.
  skipTitle: () => { ui.title = false; refresh(); }, // the title screen's New game without a fresh world
  palette: { open: () => openPalette(), index: () => paletteIndex(state, ui) }, // ui/cmdpalette.js
  dev: (on = true) => { ui.dev = !!on; refresh(); }, // open the dev tools for this session (tools, the desktop perf driver), whatever Show dev tools says
  settle: async () => { while (pendingIo.size) await Promise.allSettled([...pendingIo]); refresh(); },
  combat: {
    ui: cui,
    start: (setup) => { const b = startCombat(state, setup); refresh(); return b; },
    act: (a) => { const err = combatAct(state, a); refresh(); return err; },
    enemyPhase: () => { runEnemyPhase(state); cui.sel = null; refresh(); },
  },
};
refresh();
requestAnimationFrame(frame);
