// Autopilot: an AI governor that runs the player's holdout (a dev tool, also used headless by tools/autotest.js).
// While state.autopilot is on, the hourly tick (world.js) calls autopilotHour. The governor:
//   - resolves cards (travel events, conflicts, orders / "Done" cards, strangers, raid warnings), scavenging
//     searches (one search hour per tick), trade visits and battles (state.autoCombat is on while it runs);
//   - sets every role by need (food, threats, the injured, construction, stations, crafting), queues buildings
//     and crafts, hands out gear from the armory and treats the injured with base meds;
//   - once a day (07:00) plans a trip: scavenging the best known site for what the hub needs, checking finds,
//     recovering the dead or a vehicle, a trade visit, a rescue, or founding an outpost; and sends supply runs
//     to outposts that need materials or hands;
//   - with the Cautious style, keeps every supply at a reserve target (reserveStatus) and goes for more (trips,
//     recon, radio deals, trade visits, the bench and med station) as soon as one drops below it.
// It only uses the same calls as the UI (canBuild / queueBuild, queueCraft, treatAtBase, launchExpedition,
// startOrder, saveSupplyRun ...), plays by what the player knows of the map (knowledge snapshots, markers,
// known groups), and never draws from state.rng. Turning it off hands everything back as it is.
import { GEAR, LOCATIONS, SUPPLIES, FACTION_TYPES } from "./data.js";
import { log, day, hourOfDay, hub, alive, atBase, skill, combatPower, gearEffect, factionById, snapshot } from "./world.js";
import {
  launchExpedition, estimateTrip, startReturn, partyMembers, partyTile, tileLabel, teamName, orderOptions, orderMove,
  hoursLeft, planPath, partyCapacity, cargoLoad, cargoRoom, supplyLoad, carryCapacity, travelHours, awaitOrders, partySpeed, pruneCards,
  STANCES, paceOpts, modeSpeed, partyPace,
} from "./parties.js";
import { startOrder, resumeQueue } from "./orders.js";
import { searchHour, extract, engagementParty, foundLoad } from "./scavenge.js";
import { tradeContext, sellPrice, buyPrice, executeTrade, endTrade, proposePact, available, maxBuyable, minSellable, giftAll, goodsWorth, demand } from "./trade.js";
import { autoCaravanTrade } from "./caravans.js";
import { autoVisitorTrade } from "./visitors.js";
import { radioTradeIfShort, hasNetwork, radioScan, dealQuote, radioDeal, refusal, inCoverage, canRadioGroup, RELAY_RANGE, GROUP_REACH } from "./radio.js";
import { attitude, baseDefense, strength, isAggressiveType, raidStakes } from "./factions.js";
import { holdCheck, defenceWishes, hordeThreat, DECOY_FUEL } from "./defences.js";
import { siteBonus, waterOutlook, foodOutlook, waterCapacity, waterProduction } from "./economy.js";
import { farmersWanted, farmOf, seasonKey, winterOutlook } from "./farming.js";
import { edibleFood, foodStore, storeCapacity } from "./storage.js";
import { conditionsOf, CONDITIONS, treatCondition, treatConditionInfo, medsToTreatAll } from "./health.js";
import { BUILDINGS, RECIPES, canBuild, queueBuild, count, stations, baseBeds, baseWalls, farmSlots, assignStations } from "./buildings.js";
import { isHurt, hospitalDef, nextHospitalType, treatAtBase, treatAtBaseInfo, fieldTreatInfo, careNeed } from "./medical.js";
import { CRAFTS, canCraft, queueCraft, craftQueue } from "./crafting.js";
import { vehiclesAtBase, carsAtBase, bikesAtBase, parkBikes, isBike, isCar, travelMode, refuel, repair, canRepair } from "./vehicles.js";
import { LOAD_BANDS, wornLoad, poolAtBand } from "./load.js";
import { saveSupplyRun, dispatchSupplyRun, supplyRuns, jobParty, deleteSupplyRun } from "./supply.js";
import { autoPlayerTurn, runEnemyPhase, closeCombat, WEAPONS } from "./combat.js";
import { allCaptives, ransomValue } from "./conflicts.js";
import { ensureInv, armorMult } from "./inventory.js";
import { weather as wxNow, severeSoon, season as wxSeason } from "./weather.js";
import { autoRecruitPick } from "./recruits.js";
import { planStudy } from "./skills.js";
import { planBlueprintStudy } from "./blueprints.js";
import { stationOrder, setStationOrder, orderHold } from "./production.js";
import { POWER, powerWanted } from "./power.js";
import { friendlyCrew, wantsRest, relAutopilotDaily } from "./relations.js";
import { autoDiplomacyDaily, hiveAllies, broodAfterAllies, goalsProgress, allianceMembers, ALLIANCE, isMember, inviteProblem, inviteToAlliance } from "./alliance.js";
import { jobTripCands, jobById, activeJobs } from "./jobs.js";
import { hiveAt, hiveForce, broodForce } from "./hives.js";
import { autopilotPrisoners } from "./prisoners.js";
import { isManaged } from "./work.js";

// Play styles. range = max tiles from the hub for a trip, maxHoursOut = longest way out, cooldown = days between
// launches, homeFrac = share of the hub that stays home, risk = lowest success chance worth a gamble,
// lossFear / fightBias / raidBias weigh fights on conflict cards, chain = extra sites a team may hit on one trip.
// hiveFrom = first day it storms hives, hiveOdds = squad power over the brood's strength it wants (hiveCandidate),
// hiveFires = fires it may set around a mound first, hiveRest = days between hive missions.
// reserves = keeps every supply at a target (reserveStatus) and acts as soon as one drops below it: shortCooldown
// days between trips, shortReach = how much farther a trip may go for it, homeHorde = people kept home while
// hordes are near.
export const PERSONALITIES = {
  cautious: {
    name: "Cautious", crowdSlack: 0, desc: "One small, stealthy team at a time close to home, short searches, more guards, pays tribute, avoids fights. Keeps a reserve of every supply and goes for more as soon as one runs below it.",
    maxTeams: 1, cooldown: 4, crew: 3, homeFrac: 0.6, minHealth: 80, range: 8, maxHoursOut: 18, stance: "stealthy",
    searchHours: 3, searchHeat: 25, hurtStop: 60, risk: 0.8, riskAversion: 1.5, lossFear: 12, fightBias: -1, raidBias: -3,
    curious: 0.5, baseGuards: 2, guardMargin: 1.4, restMood: 35, chain: 0, outposts: 1, outpostPop: 12, strangerDays: 8,
    holdRatio: 1.5, raid: false, rescue: false, tradeEvery: 14,
    reserves: true, shortCooldown: 2, shortReach: 2, homeHorde: 5,
    hiveFrom: 150, hiveOdds: 1.35, hiveFires: 3, hiveRest: 10,
  },
  balanced: {
    name: "Balanced", crowdSlack: 2, desc: "Up to two teams out, scavenges what the hub needs, fights only good odds, grows with an outpost or two.",
    maxTeams: 2, cooldown: 2, crew: 2, homeFrac: 0.5, minHealth: 70, range: 11, maxHoursOut: 28, stance: "normal",
    searchHours: 5, searchHeat: 45, hurtStop: 45, risk: 0.65, riskAversion: 1, lossFear: 9, fightBias: 0, raidBias: -1,
    curious: 1, baseGuards: 1, guardMargin: 1.25, restMood: 28, chain: 1, outposts: 2, outpostPop: 9, strangerDays: 4,
    holdRatio: 1.25, raid: false, rescue: true, tradeEvery: 12,
    hiveFrom: 90, hiveOdds: 1.2, hiveFires: 3, hiveRest: 6,
  },
  aggressive: {
    name: "Aggressive", crowdSlack: 8, desc: "Many long trips, loud searches, raids hostile land, ambushes camps and robbers, expands fast.",
    maxTeams: 3, cooldown: 1, crew: 3, homeFrac: 0.4, minHealth: 60, range: 15, maxHoursOut: 40, stance: "normal",
    searchHours: 7, searchHeat: 62, hurtStop: 35, risk: 0.5, riskAversion: 0.6, lossFear: 7, fightBias: 1, raidBias: 2,
    curious: 1.4, baseGuards: 1, guardMargin: 1.1, restMood: 22, chain: 2, outposts: 3, outpostPop: 8, strangerDays: 3,
    holdRatio: 1.2, raid: true, rescue: true, tradeEvery: 0,
    hiveFrom: 30, hiveOdds: 1.05, hiveFires: 3, hiveRest: 4,
  },
};

const PLAN_HOUR = 7;      // daily planning: teams leave in the morning
const STICKY = 2;         // bonus for keeping someone's current role (fewer flips)
const first = (s) => s.name.split(" ")[0];
const names = (list) => list.map(first).join(", ");
// While a base steward runs (stewardRun, steward.js) the governor's lines are not logged one by one (the steward
// writes one summary a day) and the steward's own style is used.
let stewardCtx = null;
const say = (state, text, kind = "info") => { if (!stewardCtx) log(state, `🤖 ${text}`, kind); };
const isDisabled = (state, ch) => (typeof ch.disabled === "function" ? ch.disabled(state) : !!ch.disabled);
const pctIn = (text) => { const m = /(\d+)%/.exec(text || ""); return m ? Number(m[1]) / 100 : null; };

// Governor memory (kept on the state so it travels with the world).
function gov(state) {
  if (!state.governor) {
    state.governor = {
      personality: "balanced", savedAutoCombat: null, busy: false,
      stats: { hours: 0, launched: 0, cards: 0, builds: 0, crafts: 0, treated: 0, equipped: 0, searches: 0, extractions: 0, supplyRuns: 0, outposts: 0, trades: 0, roleChanges: 0 },
      visited: {}, lastLaunch: -99, lastOutpost: -99, lastTrade: -99, lastRescue: -99, roleSummary: {}, treated: {}, farmShort: {}, threat: {},
    };
  }
  return state.governor;
}
const persona = (state) => PERSONALITIES[(stewardCtx && stewardCtx.style) || gov(state).personality] || PERSONALITIES.balanced;
export const autopilotPersonality = (state) => gov(state).personality;

// ---------- switching ----------
export function setAutopilot(state, on, personality) {
  const g = gov(state);
  if (personality && PERSONALITIES[personality]) g.personality = personality;
  if (!!on === !!state.autopilot) return;
  state.autopilot = !!on;
  if (on) {
    g.savedAutoCombat = !!state.autoCombat;
    state.autoCombat = true; // battles resolve by the numbers; scavenging uses the hour-by-hour search
    say(state, `Autopilot on (${persona(state).name}). The governor runs ${hub(state).name} until you take over.`);
    autopilotResolve(state);
  } else {
    state.autoCombat = !!g.savedAutoCombat;
    g.savedAutoCombat = null;
    say(state, "Autopilot off. You have control again.");
  }
}

export function setPersonality(state, key) {
  if (!PERSONALITIES[key]) return;
  const g = gov(state);
  if (g.personality === key) return;
  g.personality = key;
  if (state.autopilot) say(state, `Governor style: ${PERSONALITIES[key].name}.`);
}

// One line for the dev panel.
export function autopilotSummary(state) {
  const s = gov(state).stats;
  const out = state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy").length;
  const short = reserveShort(state); // Cautious: what is below its reserve (hover the line for the table)
  return `${persona(state).name} · ${out} team${out === 1 ? "" : "s"} out · launched ${s.launched} · cards ${s.cards} · built ${s.builds} · crafted ${s.crafts} · treated ${s.treated} · supply runs ${s.supplyRuns} · outposts ${s.outposts}${persona(state).reserves ? ` · ${short.length ? `short: ${short.join(", ")}` : "reserves full"}` : ""}`;
}
export const autopilotStats = (state) => ({ ...gov(state).stats });

// ---------- entry points ----------
// Hourly, from world.js tickHour (after everything else in the hour).
export function autopilotHour(state) {
  if (!state.autopilot || state.gameOver || !state.bases.length) return;
  const g = gov(state);
  if (g.busy) return; // a tick inside the governor's own work (a raid's hours, for example)
  g.busy = true;
  try {
    g.stats.hours++;
    state.autoCombat = true;
    resolvePending(state);
    engagementHour(state);
    resolvePending(state);
    guardArrivals(state);
    idleTeams(state);
    for (const b of [...state.bases]) governBase(state, b);
    if (hourOfDay(state) === PLAN_HOUR) autopilotDaily(state);
    for (const b of state.bases) governRoles(state, b);
    resolvePending(state);
  } catch (e) {
    fail(state, e);
  } finally {
    g.busy = false;
  }
}

// ---------- one base (the autopilot's hourly loop and base stewards, steward.js) ----------
// Areas a steward can hand over; the autopilot runs them all. A wish or a role in an area that is off is left as
// it is (the player's).
export const GOVERN_AREAS = ["roles", "building", "production", "medical", "food", "defence"];
const ALL_AREAS = Object.fromEntries(GOVERN_AREAS.map((k) => [k, true]));
// The per-base work of one hour: gear, treatment, construction, crafting and station orders.
export function governBase(state, base, areas = ALL_AREAS) {
  if (areas.production) equipFromArmory(state, base);
  if (areas.medical) planTreatment(state, base);
  if (areas.building) planBuilds(state, base, areas);
  if (areas.production) { govOrders(state, base); planCrafts(state, base); }
}
// Roles at one base (after the day's trip is planned). Returns the number of role changes.
export function governRoles(state, base, areas = ALL_AREAS) {
  return areas.roles ? planRoles(state, base, areas) : 0;
}
// A base steward's hour (steward.js): the same per-base work for the areas handed over, in the steward's style,
// with the governor's log lines held back. Never while the dev autopilot runs (it has the whole holdout then).
export function stewardRun(state, base, areas, style = "balanced") {
  if (state.autopilot || state.gameOver) return 0;
  const g = gov(state);
  if (g.busy) return 0;
  g.busy = true;
  stewardCtx = { style: PERSONALITIES[style] ? style : "balanced" };
  try {
    governBase(state, base, areas);
    return governRoles(state, base, areas);
  } finally {
    stewardCtx = null;
    g.busy = false;
  }
}

// Daily planning (07:00): role summary, supply runs and the day's trip.
export function autopilotDaily(state) {
  if (!state.autopilot || state.gameOver) return;
  roleSummaries(state);
  winterReport(state);
  tidySupplyJobs(state);
  planSupplyRuns(state);
  planTrip(state);
  const service = relAutopilotDaily(state); // relations.js: a memorial service when people grieve or spirits are low
  if (service) say(state, service);
  // Jobs, the coalition and wars (alliance.js): deliveries fetched, qualifying groups invited, Aggressive sells
  // ammo to groups at war. Job offers and war calls are cards (their choices carry the governor's scores).
  const diplo = autoDiplomacyDaily(state, gov(state).personality);
  if (diplo) say(state, diplo);
  // prisoners.js: question them, then trade back (Cautious), ransom (Balanced) or slowly recruit (Aggressive).
  const held = autopilotPrisoners(state);
  if (held) say(state, `Prisoners: ${held}`);
  // Cautious: scan the airwaves and make a radio deal for whatever is below its reserve (reserveRadio).
  if (persona(state).reserves && reserveRadio(state)) return;
  // Short of something and a group in radio reach has it: a radio deal (radio.js), their caravan brings it.
  const deal = radioTradeIfShort(state, needs(state));
  if (deal) say(state, `Radio: ${deal}.`);
}

// Cautious, with a radio station: scan the airwaves once a day (groups in reach become known), then one deal for
// the supply furthest below its reserve, paid with what is well above its own (the Groups tab's radio calls:
// dealQuote / radioDeal; their caravan brings the goods). Returns true when a deal was made.
const RADIO_CAP = { scrap: 60, ammo: 200, meds: 15, food: 60, water: 40, fuel: 15, parts: 6 };
function reserveRadio(state) {
  if (!hasNetwork(state)) return false;
  if (state.radioScanDay !== day(state)) radioScan(state);
  const h = hub(state);
  const rs = reserveStatus(state, h);
  const n = Math.max(1, atBase(state, h.id).length);
  const keep = (k) => (k === "food" ? n * (foodTarget(state, h) * 1.2 + 10) : rs[k] ? rs[k].target * 1.3 + 2 : Infinity);
  const spare = (k) => Math.max(0, Math.floor((h.stock[k] || 0) - keep(k)));
  const short = [...RESERVE_KEYS, "food"].filter((k) => rs[k] && rs[k].short).sort((a, b) => rs[a].have / Math.max(1, rs[a].target) - rs[b].have / Math.max(1, rs[b].target));
  const pays = Object.keys(RADIO_CAP).filter((k) => spare(k) >= 3).sort((a, b) => spare(b) * SUPPLIES[b].value - spare(a) * SUPPLIES[a].value);
  if (!short.length || !pays.length) return false;
  const groups = state.factions.filter((f) => f.known && !refusal(state, f, true));
  for (const want of short) {
    const gap = Math.ceil(rs[want].target * 1.3 - rs[want].have);
    for (const f of [...groups].sort((a, b) => available(b, want) - available(a, want))) {
      let wantQty = Math.min(RADIO_CAP[want] || 20, gap, available(f, want));
      if (wantQty < 2) continue;
      for (const pay of pays) {
        if (pay === want) continue;
        let q = dealQuote(state, f, { wantKey: want, wantQty, payKey: pay, payQty: spare(pay) });
        if (!q.ok && q.maxWant != null && q.maxWant >= 2 && q.maxWant < wantQty) { wantQty = q.maxWant; q = dealQuote(state, f, { wantKey: want, wantQty, payKey: pay, payQty: spare(pay) }); }
        if (!q.ok || q.minPay == null || q.minPay > spare(pay)) continue;
        const res = radioDeal(state, f, { wantKey: want, wantQty, payKey: pay, payQty: q.minPay });
        if (!res.ok) continue;
        gov(state).stats.trades++;
        say(state, `Radio: ${want} is below the reserve (${rs[want].have} of ${rs[want].target}). ${res.text}`);
        return true;
      }
    }
  }
  return false;
}

// Cards, trades and battles that need no time: resolved right away (the browser calls this every frame while
// the autopilot is on, so nothing waits on a click). Returns true if anything was handled.
export function autopilotResolve(state) {
  if (!state.autopilot || state.gameOver) return false;
  const g = gov(state);
  if (g.busy) return false;
  if (!state.cards.length && !state.trade && !state.combat) return false;
  g.busy = true;
  try {
    return resolvePending(state);
  } catch (e) {
    fail(state, e);
    return true;
  } finally {
    g.busy = false;
  }
}

function fail(state, e) {
  if (typeof window === "undefined") throw e; // headless tools should see the crash
  console.error("Autopilot error:", e);
  state.autopilot = false;
  state.autoCombat = !!gov(state).savedAutoCombat;
  say(state, `Autopilot stopped after an error (${e.message}). You have control.`, "danger");
}

function resolvePending(state) {
  let did = false;
  for (let guard = 0; guard < 40; guard++) {
    if (state.combat) finishLiveBattle(state);
    else if (state.cards.length) resolveCard(state);
    else if (state.trade) handleTrade(state);
    else break;
    did = true;
  }
  return did;
}

// A battle already open when the autopilot took over: the AI plays both sides to the end, takes all it can carry.
function finishLiveBattle(state) {
  for (let i = 0; i < 400 && state.combat; i++) {
    const b = state.combat;
    if (b.over) closeCombat(state, { take: true });
    else if (b.phase === "player") autoPlayerTurn(state);
    else runEnemyPhase(state);
  }
  if (state.combat) state.combat = null; // never hang on a battle
}

// ======================================================================================
// Cards
// ======================================================================================
function resolveCard(state) {
  const card = state.cards[0];
  const g = gov(state);
  g.stats.cards++;
  const p = card.partyId != null ? state.parties.find((x) => x.id === card.partyId) : null;
  if (card.isOrders) {
    state.cards.shift();
    if (p) teamAct(state, p);
    return;
  }
  const opts = card.choices.filter((c) => !c.uiAction && !isDisabled(state, c));
  const choice = opts.length ? pickChoice(state, card, opts, p) || fallbackChoice(opts) : null;
  state.cards.shift();
  if (!choice) return; // nothing it can pick (needs a map click): dropped, like the headless tools do
  const text = choice.resolve(state);
  pruneCards(state); // cards about a team or a person that this choice just removed (parties.js)
  if (choice.label === "OK") return;
  const where = card.where ? ` (${card.where})` : "";
  say(state, `${card.title}${where} → ${choice.label}.${text ? ` ${clip(text)}` : ""}`);
}
const clip = (t) => (t.length > 160 ? `${t.slice(0, 157)}...` : t);

// simtest.js rule: "Return home" if offered, else the first choice that can be taken.
const fallbackChoice = (opts) => opts.find((c) => c.label === "Return home") || opts[0];

function pickChoice(state, card, opts, p) {
  const P = persona(state);
  const find = (re) => opts.find((c) => re.test(c.label));
  const chance = (re) => { const c = find(re); return c ? pctIn(c.hint) ?? 0.5 : 0; };
  const t = card.title;
  if (card.kind === "conflict") return bestByUtility(state, card, opts, P);
  // Newcomers (recruits.js) by the bed / food / water rule; hub events and morale warnings (hubevents.js, morale.js)
  // by the score each choice carries.
  if (card.recruit) return autoRecruitPick(state, card, opts, (k) => roomFor(state, k));
  // A group asks you to storm a hive (jobs.js): yes when the war on the hives would take it on.
  if (card.jobId != null) {
    const job = jobById(state, card.jobId);
    if (job && job.type === "hive" && hiveJobOk(state, job)) return find(/^Accept/) || null;
  }
  if (opts.some((c) => typeof c.ai === "function")) return [...opts].sort((a, b) => (b.ai ? b.ai(state) : -99) - (a.ai ? a.ai(state) : -99))[0];
  // Radio offers (radio.js): agree when the hub has the goods. A trade caravan's stop (caravans.js): move on.
  if (card.radioFrom != null) { const yes = find(/^Agree/); return yes && yes.affordable && yes.affordable(state) ? yes : find(/^No, thank/); }
  if (card.isCaravan) return find(/^Go on to/) || find(/^Return home/);
  if (/^After the fight/.test(t)) {
    const fit = p && partyMembers(state, p).every((s) => s.health >= 55) && carriedDays(state, p) >= 2;
    return (fit ? find(/^Continue/) : null) || find(/^Return home/) || find(/^Continue/);
  }
  if (/^Raiders heading for /.test(t)) return raidWarningChoice(state, card, opts, P);
  if (/ asks for help$/.test(t)) {
    const h = hub(state);
    const ammo = h.stock.ammo || 0;
    const fighters = atBase(state, h.id).sort((a, b) => combatPower(b) - combatPower(a));
    if (P.raid && fighters.length >= 7 && fighters.slice(0, 3).reduce((a, s) => a + combatPower(s), 0) >= 14) return find(/^Send a squad/) || find(/^Ignore/);
    const spare = P.reserves ? Math.max(200, reserveStatus(state, h).ammo.target + 40) : P.name === "Cautious" ? 200 : 110;
    return (ammo >= spare ? find(/^Send 40 ammo/) : null) || find(/^Ignore/);
  }
  if (/^A stranger at the gate/.test(t) || /^Refugees at the gate/.test(t)) {
    const h = hub(state);
    const n = atBase(state, h.id).length;
    const days = (k) => (edibleFood(h) - 5 * k) / Math.max(1, n + k);
    // Water too (economy.js): the well has to keep up with one more, or there is a stock to live on.
    const wo = waterOutlook(state, h);
    const wet = (k) => wo.dryNet - k * 1 >= -1.5 && (h.stock.water || 0) / Math.max(1, n + k) >= 3 && droughtWater(state, h, n + k);
    // Crops take weeks and winter brings none: a newcomer needs real reserves (a month's going into the cold).
    const minDays = Math.max(P.strangerDays * 2.5, seasonKey(state) === "autumn" || seasonKey(state) === "winter" ? 30 : 10);
    const ok = (k) => days(k) >= minDays && wet(k) && roomFor(state, k);
    if (/^Refugees/.test(t)) return (ok(2) ? find(/^Take them in/) : null) || (ok(1) ? find(/^Take one/) : null) || find(/^Turn them away/);
    return (ok(1) ? find(/^Let them in/) : null) || find(/^Turn them away/);
  }
  if (/^The leader is dead/.test(t)) {
    const lead = (c) => Number((/Leadership (\d+)/.exec(c.label) || [0, 0])[1]);
    return [...opts].sort((a, b) => lead(b) - lead(a))[0];
  }
  // Travel events (events.js) and the team's own finds (parties.js).
  if (/^Blocked highway/.test(t)) return (p && partyFuelOf(state, p) >= 12 ? find(/^Detour/) : null) || (chance(/^Squeeze/) >= 0.6 ? find(/^Squeeze/) : null) || find(/^Clear a path/);
  if (/^Breakdown/.test(t)) return find(/spare part/) || find(/^Repair/);
  if (/^Storm/.test(t)) return find(/^Shelter/);
  if (/^Bad footing/.test(t)) return ((p && (p.supplies.meds || 0) >= 2) || P.name === "Cautious" ? find(/^Treat it/) : null) || find(/^Keep moving/);
  if (/^The dead ahead/.test(t)) {
    const n = Number((/About (\d+)/.exec(card.text || "") || [0, 8])[1]);
    const power = p ? partyMembers(state, p).reduce((a, s) => a + combatPower(s), 0) * ((p.supplies.ammo || 0) >= n ? 1 : 0.5) : 0;
    if (P.raid && power > n * 0.9) return find(/^Fight/);
    return (chance(/^Sneak around/) >= P.risk ? find(/^Sneak around/) : null) || find(/long way/);
  }
  if (/^Bitten/.test(t)) return find(/^Amputate/) || find(/^Hope/);
  if (/^A hive/.test(t)) return find(/^Mark it/) || opts[opts.length - 1];
  // Storming a hive: only with the squad it was sent with (most of it still standing and healthy), by the odds.
  if (/^The hive: /.test(t)) return hiveChoice(state, card, opts, p, find);
  // A horde coming for a base (defences.js): a decoy fire when the defences would not hold and no Wallbreaker
  // leads it, else man the defences.
  if (/^Horde heading for /.test(t)) {
    const decoy = find(/decoy/);
    return (/cannot hold/.test(card.text) && !/Wallbreaker at its head/.test(card.text) && decoy && !isDisabled(state, decoy) ? decoy : null) || find(/^Man the defences/);
  }
  if (/^Stranded traders/.test(t)) return find(/^Help them/);
  if (/^A survivor alone/.test(t)) {
    if (!roomFor(state, 1)) return find(/^Leave them/);
    return (p && carriedDays(state, p, 1) >= tripHoursLeft(state, p) / 24 + 0.5 ? find(/^Take them along/) : null) || find(/^Point them/);
  }
  if (/ patrol$/.test(t)) return find(/^Share news/);
  if (/^Abandoned supply truck/.test(t)) return P.name === "Cautious" ? find(/^Leave it/) : find(/^Search it/);
  if (/^Crashed military vehicle/.test(t)) return (chance(/^Search it/) >= P.risk ? find(/^Search it/) : null) || find(/^Leave it/);
  if (/^Tempers flare/.test(t)) return (chance(/^Step in/) >= 0.5 ? find(/^Step in/) : null) || find(/^Let them/);
  if (/^Cold feet/.test(t)) return find(/^Convince/);
  if (/^Horde of /.test(t)) return (p && p.vehicle && partyFuelOf(state, p) >= 8 ? find(/^Outrun/) : null) || find(/^Hide/);
  if (/^A horde of /.test(t)) return (P.raid && (p?.supplies.ammo || 0) >= 30 ? find(/killzone/) : null) || find(/^Back off/);
  if (/^Wrecked car/.test(t)) return find(/^Restore/) || find(/^Strip/);
  return null;
}

// Beds for k more people: built, queued, or one more bunkhouse a base can still get (plus the style's slack).
function roomFor(state, k) {
  const people = alive(state).filter((s) => s.location.kind !== "captive").length;
  let beds = 0;
  for (const b of state.bases) {
    const queued = b.construction.filter((c) => c.type === "bunkhouse").length;
    beds += baseBeds(b) + queued * 6 + (count(b, "bunkhouse") + queued < BUILDINGS.bunkhouse.max ? 6 : 0);
  }
  if (people + k > beds + persona(state).crowdSlack) return false;
  // Food and water for them too (economy rework): every newcomer, whatever card brings them.
  const h = hub(state);
  const n = atBase(state, h.id).length;
  const foodDays = (edibleFood(h) - 5 * k) / Math.max(1, n + k);
  const wo = waterOutlook(state, h);
  if (!(foodDays >= Math.max(10, foodTarget(state)) && wo.dryNet - k >= -1.5 && (h.stock.water || 0) / Math.max(1, n + k) >= 3 && droughtWater(state, h, n + k))) return false;
  // No newcomers while the winter stores would not feed them too (farming.js winterOutlook with k more mouths).
  return !winterActive(state, h) || winterOutlook(state, h, { extra: k + homeMouths(state, h), also: winterPool(state, h) }).short <= 0;
}

// Water for n people through a dry, hot spell (wells at 60%, no rain, everyone drinking 1.5; filters at half): the
// sources keep up, or the stock covers the gap for three weeks. A hub that outgrows its water dies of thirst in a
// drought, so newcomers wait for more filters or wells.
function droughtWater(state, base, n) {
  const p = waterProduction(state, base);
  const dry = ((p.own + p.stream + p.wells) / (p.factor || 1)) * 0.6 + p.filters * 0.5; // filters wear out and cost scrap: half
  const gap = n * 1.5 - dry;
  return gap <= 0 || (base.stock.water || 0) >= gap * 21;
}

// ---------- food and the winter (the food planner) ----------
// Days of food (fresh + preserved) a base should hold now. Crops take weeks, nothing grows outdoors in winter and
// the first spring harvest comes weeks into spring, so the governor plans the year: from mid-summer to the first
// spring harvest the target comes from the winter outlook (farming.js winterOutlook: food eaten until the first
// spring harvest, more in the cold, plus spoilage by the storage there is and seed for the spring, less what the
// crops in the ground should still bring in, plus a 15% margin for bad luck), in days for the people here. Before
// mid-summer most of the year's crops are still to be sown: 15 days, ramping up from early summer. Never under 15.
// The target drives the farmers (planRoles), how much the hub wants food (needs: trips, trades, radio deals) and
// newcomers (roomFor).
export function foodTarget(state, base = hub(state)) {
  const s = wxSeason(state);
  const seasonal = s.key === "autumn" ? 55 : s.key === "winter" ? s.daysLeft + 25 : s.key === "summer" ? 12 + Math.max(0, 28 - s.daysLeft) * 1.5 : 15;
  if (!base || !winterActive(state, base)) return seasonal;
  // The stock this base must hold now: what the pool needs (with the safety margin) less what the fields bring in
  // and what the outposts hold, in days for the people here.
  const w = winterPlan(state, base);
  const req = w.need + w.spoil + w.seed + w.margin - w.crops - Math.max(0, w.have - edibleFood(base));
  return Math.max(15, Math.min(150, req / Math.max(1, atBase(state, base.id).length)));
}
// From mid-summer until the first spring harvest the winter outlook drives the plans.
function winterActive(state, base) {
  const s = wxSeason(state);
  if (s.key === "autumn" || s.key === "winter") return true;
  if (s.key === "summer") return s.dayOfSeason >= 14;
  const gap = winterPlan(state, base).gap;
  return gap.inGap && gap.start >= 0; // early spring, before the first harvest (not the campaign's first days)
}
// The winter outlook of a base, worked out once a day (it looks ahead day by day to the first spring harvest).
// Teams out from the base eat there when they come home: they count. The hub's plan pools the outposts (they ship
// it their surplus and it feeds them when they run short).
const winterPool = (state, base) => (base.type === "hub" ? state.bases.filter((b) => b.type === "outpost") : []);
const homeMouths = (state, base) => winterPool(state, base).concat([base]).reduce((a, b) => a + returning(state, b), 0);
function winterPlan(state, base) {
  const g = gov(state);
  const memo = g.winter || (g.winter = {});
  const m = memo[base.id];
  if (m && m.day === day(state)) return m;
  return (memo[base.id] = { day: day(state), ...winterOutlook(state, base, { extra: homeMouths(state, base), also: winterPool(state, base) }) });
}
// Food short of the winter plan, as a share of what the hungry gap needs (0 = covered).
const winterShort = (state, base) => (winterActive(state, base) ? winterPlan(state, base).short / Math.max(1, winterPlan(state, base).gapNeed) : 0);
// Weekly in autumn (and on the first day of winter): the winter stores, in the log.
function winterReport(state) {
  const s = wxSeason(state);
  if (!((s.key === "autumn" && (s.dayOfSeason - 1) % 7 === 0) || (s.key === "winter" && s.dayOfSeason === 1))) return;
  const h = hub(state);
  if (!h) return;
  const w = winterPlan(state, h);
  const st = foodStore(state, h);
  const fresh = Math.floor(st.fresh), pres = Math.floor(st.preserved);
  const verdict = w.short > 0
    ? `short by about ${w.short}${w.runsOut != null ? `, out of food around day ${w.runsOut + 1}` : ""}: more farmers, food trips and preserving, and no newcomers until it is covered`
    : `enough, about ${Math.max(0, w.end)} to spare`;
  say(state, `Winter stores at ${h.name}: ${fresh + pres} food (${fresh} fresh, ${pres} preserved; cellar room ${st.cap}${st.outside >= 1 ? `, ${Math.floor(st.outside)} stored outside` : ""})${w.bases > 1 ? ` plus ${Math.max(0, w.have - fresh - pres)} at the outposts` : ""}, about ${w.crops} still to come from the fields. The ${w.people} people${w.bases > 1 ? " (outposts and teams too)" : ""} need about ${w.need + w.spoil + w.seed} (eating ${w.need}, spoilage ${w.spoil}, spring seed ${w.seed}) to reach the first spring harvest around day ${w.gap.end + 1}, plus ${w.margin} to spare for bad luck: ${verdict}.`, w.short > 0 ? "danger" : "info");
}

const partyFuelOf = (state, p) => {
  const v = p.vehicleId ? state.vehicles.find((x) => x.id === p.vehicleId) : null;
  return (v ? v.fuel : 0) + (p.supplies.fuel || 0);
};
// Rough hours until a team is home: the way left, plus (going out) the job and the same way back.
const tripHoursLeft = (state, p) => (p.phase === "back" ? hoursLeft(state, p) : 2 * hoursLeft(state, p) + 10);
// Days of food and water a team carries on the move (extra = more mouths; a loaded team eats more, load.js).
function carriedDays(state, p, extra = 0) {
  const n = partyMembers(state, p).length;
  const perDay = (n ? partyPace(state, p).eatMove : 0) + extra;
  const have = (k) => (p.supplies[k] || 0) + ((p.cargo && p.cargo.supplies[k]) || 0);
  return Math.min(have("food"), have("water")) / Math.max(1, perDay);
}

// Conflict cards (conflicts.js): every option is scored from the odds the card shows.
function bestByUtility(state, card, opts, P) {
  let best = null, bestU = -Infinity;
  for (const ch of opts) {
    const u = utility(ch, P);
    if (u > bestU) { best = ch; bestU = u; }
  }
  return best;
}

function utility(ch, P) {
  const L = ch.label, H = ch.hint || "";
  let c = pctIn(H);
  if (c == null && /let you pass/.test(H)) c = 0.95;
  const k = c == null ? 0.5 : c;
  const fight = (win) => win * k - P.lossFear * (1 - k) - 2 + P.fightBias;
  if (/^Invoke your/.test(L)) return 6 * k - (1 - k);
  if (/toll|palms|Offer them supplies/.test(L)) return 5 * k - 7 * (1 - k) - 1.5;
  if (/^Talk|^Negotiate|^Ask them to let/.test(L)) return 5.5 * k - (1 - k);
  if (/^Run for it|^Floor it/.test(L)) return 5 * k - 5 * (1 - k);
  if (/^Hide/.test(L)) return 5 * k - 7 * (1 - k);
  if (/^Surrender|^Submit/.test(L)) return /dragged off/.test(H) ? -8 : /a fifth/.test(H) ? -1 : -4;
  if (/^Fight back|^Open fire|^Storm/.test(L)) return fight(5);
  if (/^Ambush|hit the dead|^Help /.test(L)) return fight(6.5) + P.raidBias;
  if (/^Watch them|^Follow them/.test(L)) return P.curious - 6 * k; // k: the risk they notice you
  if (/^Slip away/.test(L)) return 4 * k - 4 * (1 - k);
  if (/^Steal/.test(L)) return (6 + P.raidBias) * k - 8 * (1 - k);
  if (/^Approach openly/.test(L)) return /hostile/.test(H) ? -2 : 4;
  if (/^Join in/.test(L)) return P.raidBias - 1;
  if (/^Draw the dead/.test(L)) return 5 * k - 6 * (1 - k);
  if (/^Sneak in/.test(L)) return 8 * k - 7 * (1 - k);
  if (/^Pay (a|the) ransom|^Pay for them/.test(L)) return 5;
  if (/^Leave|^Not now/.test(L)) return 0.5;
  return 0;
}

// Raid warning: rally the guards first (roles change at once), then judge the odds with everyone on alert. Below
// the style's hold ratio it weighs the tribute against what a fight is likely to cost (factions.js raidStakes:
// stolen stock, wrecked buildings, wounds): Cautious pays when the tribute is under 1.4× that, Balanced under 1×,
// Aggressive under 0.6× (and it fights in person first when the odds are poor).
const TRIBUTE_LEAN = { Cautious: 1.4, Balanced: 1, Aggressive: 0.6 };
function raidWarningChoice(state, card, opts, P) {
  const find = (re) => opts.find((c) => re.test(c.label));
  const base = state.bases.find((b) => card.title === `Raiders heading for ${b.name}`);
  const raid = base && state.parties.find((q) => q.kind === "raid" && q.target && q.target.kind === "player" && q.target.baseId === base.id && !q.returning);
  if (!base || !raid) return find(/^Prepare/);
  planRoles(state, base);
  const stakes = raidStakes(state, base, raid);
  if (stakes.ratio >= P.holdRatio) return find(/^Prepare/);
  const pay = stakes.tribute < stakes.fight * (TRIBUTE_LEAN[P.name] ?? 1) ? find(/^Pay tribute/) : null;
  if (P.raid) return (stakes.ratio >= 0.9 ? find(/^Prepare/) : null) || find(/^Defend in person/) || pay || find(/^Prepare/);
  return pay || find(/^Prepare/);
}

// ======================================================================================
// Teams in the field
// ======================================================================================
// What a waiting team does next (the "Done: ..." / "Orders" card, or a team left holding).
function teamAct(state, p) {
  if (!state.parties.includes(p) || p.phase !== "waiting") return;
  const P = persona(state);
  const home = state.bases.find((b) => b.id === p.homeBaseId) || hub(state);
  if (p.apCutOff && !planPath(state, partyTile(p), home.tile, false)) return; // across water: waits for you
  // Waiting at a site another team was searching (only one search runs at a time).
  if (p.apResume === "scavenge") {
    // Waiting draws attention (fieldheat.js): past Heat 60 the team gives up on the site and moves on or goes home.
    if (state.engagement && (p.heat || 0) < 60) return;
    if (state.engagement) say(state, `${teamName(state, p)} has waited too long at ${tileLabel(state, partyTile(p))} (Heat ${Math.round(p.heat)}): it moves on.`);
    delete p.apResume;
    if (!state.engagement && orderOptions(state, p).some((o) => o.mission === "scavenge" && !o.disabled)) {
      startOrder(state, p, { type: "mission", mission: "scavenge" });
      return;
    }
  }
  // A queue set up before the autopilot took over carries on (a search waits for its turn).
  if (p.orders && p.orders.length) {
    const next = p.orders[0];
    if (next.type === "mission" && next.mission === "scavenge" && state.engagement) return;
    resumeQueue(state, p);
    return;
  }
  // A hive set on fire (hiveChoice): storm it now, or set the next fire.
  if (hiveAgain(state, p)) return;
  // The badly hurt get carried meds before a long walk home.
  const back = planPath(state, partyTile(p), home.tile, p.vehicle);
  const hoursHome = back ? travelHours(state, back.path, { vehicle: p.vehicle, ...paceOpts(p) }).hours : 0;
  const hurt = partyMembers(state, p).filter((s) => (s.woundInfected || s.health < 35) && fieldTreatInfo(state, p, s).ok);
  if (hurt.length && hoursHome > 10) {
    p.orders = [...hurt.slice(1).map((s) => ({ type: "treat", survivorId: s.id })), { type: "home" }];
    say(state, `${teamName(state, p)}: treating ${names(hurt)} before heading home.`);
    startOrder(state, p, { type: "treat", survivorId: hurt[0].id });
    return;
  }
  // Cautious recon (planTrip): the team has had its look; it searches the site if it is worth it and the team is
  // fit, fed for the search and the way home, and no other search is running.
  if (p.ap && p.ap.mission === "recon" && !p.apReconDone && partyTile(p) === p.ap.tile) {
    p.apReconDone = true;
    const s = siteScore(state, p.ap.tile, needs(state), P);
    const fit = partyMembers(state, p).every((x) => x.health >= P.hurtStop + 10 && !x.woundInfected);
    const room = cargoRoom(state, p) >= partyCapacity(state, p) * 0.5;
    if (s && s.value >= 0.3 && fit && room && !state.engagement && carriedDays(state, p) >= ((hoursHome + P.searchHours + 2) / 24) * 1.25 &&
        orderOptions(state, p).some((o) => o.mission === "scavenge" && !o.disabled)) {
      say(state, `${teamName(state, p)} had a look around ${tileLabel(state, p.ap.tile)}: worth a search.`);
      startOrder(state, p, { type: "mission", mission: "scavenge" });
      return;
    }
  }
  // Fit, fed and with room to carry: try one more site nearby.
  if ((p.apChain || 0) < P.chain && p.mission !== "outpost" && chainNext(state, p)) return;
  startReturn(state, p);
  if (p.phase === "waiting" && !p.apCutOff) {
    p.apCutOff = true;
    say(state, `${teamName(state, p)} has no way home over land. It waits for you (a boat order from the team panel).`, "danger");
  }
}

function chainNext(state, p) {
  const members = partyMembers(state, p);
  if (!members.length || members.some((s) => s.health < 60 || s.woundInfected)) return false;
  const room = cargoRoom(state, p);
  if (room < partyCapacity(state, p) * 0.5) return false;
  const here = partyTile(p);
  const need = needs(state);
  const P = persona(state);
  let best = null;
  for (const id of state.grid.within(here, 3)) {
    if (id === here) continue;
    const s = siteScore(state, id, need, P);
    if (!s || s.value < 0.6) continue;
    const res = planPath(state, here, id, p.vehicle);
    if (!res) continue;
    const score = s.value / (1 + res.cost / 20);
    if (!best || score > best.score) best = { id, score, cost: res.cost };
  }
  if (!best) return false;
  const home = state.bases.find((b) => b.id === p.homeBaseId) || hub(state);
  const back = planPath(state, best.id, home.tile, p.vehicle);
  const hours = (best.cost + (back ? back.cost : 48)) / Math.max(0.3, partySpeed(p)) + P.searchHours + 6; // at its loaded pace
  if (carriedDays(state, p) < (hours / 24) * 1.25) return false;
  p.apChain = (p.apChain || 0) + 1;
  orderMove(state, p, best.id);
  p.orders = [{ type: "mission", mission: "scavenge" }];
  say(state, `${teamName(state, p)} moves on to ${tileLabel(state, best.id)} to search it too.`);
  return true;
}

// Only one scavenging search can run at a time (state.engagement): a second team about to start one holds at
// the site as a plain move and searches once the first is done.
function guardArrivals(state) {
  let busy = !!state.engagement;
  for (const p of state.parties) {
    if (p.owner !== "player" || p.kind === "convoy" || p.phase !== "out") continue;
    const queued = p.mission === "move" && p.orders && p.orders[0] && p.orders[0].type === "mission" && p.orders[0].mission === "scavenge";
    if (p.mission !== "scavenge" && !queued) continue;
    if (hoursLeft(state, p) > 1) continue;
    if (!busy) { busy = true; continue; }
    // In radio contact the governor redirects the team, as you could: it holds at the site as a plain move.
    // Out of contact it cannot give orders (the UI cannot either): the team arrives, finds the search slot
    // taken and waits there (parties.js). The note is the governor's own, so it sends the team in afterwards.
    if (p.radioLive) {
      if (queued) p.orders.shift();
      else p.mission = "move";
    }
    p.apResume = "scavenge";
  }
}

// Teams left waiting with no card (held, or the card was cleared), and teams stuck halted with nothing to resolve.
function idleTeams(state) {
  for (const p of [...state.parties]) {
    if (p.owner !== "player" || p.kind === "convoy" || !state.parties.includes(p)) continue;
    const hasCard = state.cards.some((c) => c.partyId === p.id);
    if (p.phase === "waiting" && !hasCard) teamAct(state, p);
    const halted = p.phase === "engaged" && !hasCard && !(state.engagement && state.engagement.partyId === p.id) &&
      !(state.trade && state.trade.partyId === p.id) && !state.combat;
    p.apStuck = halted ? (p.apStuck || 0) + 1 : 0;
    if (p.apStuck >= 2) {
      p.apStuck = 0;
      delete p.conflictResume;
      awaitOrders(state, p, "The team regroups.");
    }
  }
}

// ---------- scavenging searches ----------
function engagementHour(state) {
  const e = state.engagement;
  if (!e) return;
  const p = engagementParty(state);
  if (!p || e.done || !partyMembers(state, p).length) {
    state.engagement = null;
    return;
  }
  if (p.apResume) delete p.apResume; // this team is searching now: nothing left to resume
  const g = gov(state);
  if (e.apSince == null) {
    // The team just got there: pick an approach; the search starts next hour.
    e.apSince = state.hour;
    if (!e.approach) e.approach = chooseApproach(state, p, e);
    return;
  }
  if (!e.approach) e.approach = chooseApproach(state, p, e);
  searchHour(state);
  g.stats.searches++;
  if (e.done || !state.parties.includes(p)) {
    state.engagement = null;
    return;
  }
  if (!shouldExtract(state, p, e)) return;
  const t = state.tiles[e.tile];
  g.visited[e.tile] = { day: day(state), hour: state.hour, loot: t.loot };
  g.stats.extractions++;
  say(state, `${teamName(state, p)} leaves ${tileLabel(state, e.tile)} after ${e.hours}h (Heat ${Math.round(e.heat)}, ${foundLoad(e)} kg of finds).`);
  extract(state);
}

function chooseApproach(state, p, e) {
  const P = persona(state);
  const t = state.tiles[e.tile];
  const members = partyMembers(state, p);
  const power = members.reduce((a, s) => a + combatPower(s), 0);
  if (P.name === "Cautious" || e.guarded || t.infection > 0.5) return P.raid && power >= 16 && !e.guarded ? "normal" : "sneak";
  if (P.raid && power >= 12 && (p.supplies.ammo || 0) >= members.length * 18) return "loud";
  return t.infection > 0.35 ? "sneak" : "normal";
}

function shouldExtract(state, p, e) {
  const P = persona(state);
  const members = partyMembers(state, p);
  if (!members.length) return true;
  // Cautious: while the hub is short of something, two more hours (the Heat limit stays where it is).
  if (e.hours >= P.searchHours + (reserveShort(state).length ? 2 : 0) || e.heat >= P.searchHeat) return true;
  if (members.some((s) => s.health < P.hurtStop)) return true;
  const room = cargoRoom(state, p);
  if (foundLoad(e) >= room * 0.95) return true;
  if ((p.supplies.ammo || 0) < members.length * 2 && e.heat >= 25) return true;
  const recent = e.log.slice(-2);
  return e.hours >= 2 && recent.length === 2 && recent.every((l) => /Nothing useful/.test(l));
}

// ---------- trade visits ----------
function handleTrade(state) {
  const ctx = tradeContext(state);
  if (!ctx) {
    state.trade = null;
    return;
  }
  if (ctx.visitor) {
    // Merchants or travellers from outside (visitors.js): a manual nobody has studied, then what the hub is short of.
    say(state, `Outsiders (${ctx.f.name}) at ${ctx.base ? ctx.base.name : "the roadside"}: ${autoVisitorTrade(state, needs(state), gov(state).personality)}.`);
    return;
  }
  if (ctx.kind === "caravan") {
    // Their caravan at one of your bases (caravans.js): only the Aggressive style ever attacks one.
    say(state, `Caravan from ${ctx.f.name} at ${ctx.base.name}: ${autoCaravanTrade(state, needs(state), gov(state).personality).replace(/\.$/, "")}.`);
    return;
  }
  const { p, f, speech } = ctx;
  const have = {};
  for (const k of Object.keys(SUPPLIES)) have[k] = Math.floor(p.supplies[k] || 0) + Math.floor(p.cargo.supplies[k] || 0);
  const g = gov(state);
  const need = needs(state);
  const home = state.bases.find((b) => b.id === p.homeBaseId) || hub(state);
  const back = planPath(state, partyTile(p), home.tile, p.vehicle);
  const n = partyMembers(state, p).length;
  const road = Math.ceil((n * ((back ? back.cost : 24) + 8)) / 24 * 1.3) + 1;
  // Offer what the hub has plenty of (keeping food and water for the road), ask for what it needs most.
  const spare = {};
  const keep = { food: road, water: road, meds: 2, ammo: 5 * n, fuel: p.vehicle === true && back ? Math.ceil(back.cost) : 0 };
  for (const k of Object.keys(SUPPLIES)) if (need[k] <= 0.8) spare[k] = Math.max(0, (have[k] || 0) - (keep[k] || 0));
  // Prices move with the amount (trade.js: a big sale pays less a unit, a big buy costs more), so every amount is
  // priced as a whole, the way the trade window totals it; asking at single-unit prices got deals refused.
  let budget = Object.entries(spare).reduce((a, [k, q]) => a + (q > 0 ? q * sellPrice(state, f, k, speech, q) : 0), 0);
  const ask = {};
  const caps = { meds: 10, parts: 6, food: 40, fuel: 20, ammo: 120, scrap: 40, water: 20 };
  let askValue = 0;
  // Only what they can spare and the team can carry home (trade.js refuses the whole deal otherwise).
  let room = cargoRoom(state, p);
  for (const k of Object.keys(need).sort((a, b) => need[b] - need[a])) {
    if (need[k] < 1.2 || budget <= 0 || !SUPPLIES[k]) continue;
    const q = maxBuyable(state, f, k, speech, budget, Math.min(caps[k] || 10, Math.floor(room / SUPPLIES[k].weight)));
    if (q <= 0) continue;
    const cost = q * buyPrice(state, f, k, speech, q);
    room -= q * SUPPLIES[k].weight;
    ask[k] = q;
    askValue += cost;
    budget -= cost;
  }
  const offer = {};
  let offerValue = 0;
  for (const k of Object.keys(spare).sort((a, b) => need[a] / demand(state, f, a) - need[b] / demand(state, f, b))) { // what they want most first
    if (offerValue >= askValue) break;
    if (!(spare[k] > 0)) continue;
    let q = minSellable(state, f, k, speech, askValue - offerValue, spare[k]);
    if (!Number.isFinite(q)) q = spare[k];
    offer[k] = q;
    offerValue += q * sellPrice(state, f, k, speech, q);
  }
  let text = "";
  if (askValue > 0 && offerValue >= askValue && p.apEnvoy !== f.id) { // an envoy keeps its goods for the gift
    state.trade.offer = offer;
    state.trade.ask = ask;
    const res = executeTrade(state);
    const list = (o) => Object.entries(o).map(([k, q]) => `${q} ${k}`).join(", ");
    if (/^Traded/.test(res)) {
      g.stats.trades++;
      text = `traded ${list(offer)} for ${list(ask)}`;
    } else text = `no deal (${res})`; // e.g. more than the team can carry
  }
  if (!f.pact) {
    const r = proposePact(state, f, f.goodwill >= 20 ? "trade" : "nonaggression");
    if (/signed/.test(r)) text += `${text ? "; " : ""}${r.toLowerCase().replace(/\.$/, "")}`;
  }
  // An envoy (envoyCandidate) gives what it brought and did not trade as a gift while their goodwill is short.
  if (p.apEnvoy === f.id && f.goodwill < ALLIANCE.GOODWILL + 10 && state.trade) {
    const gift = {};
    for (const k of ["food", "ammo", "meds"]) { const q = Math.floor((p.supplies[k] || 0) - (keep[k] || 0)); if (q > 0) gift[k] = q; }
    if (Object.keys(gift).length) {
      state.trade.offer = gift;
      state.trade.ask = {};
      const r = giftAll(state);
      if (/accepts/.test(r)) text += `${text ? "; " : ""}gave ${Object.entries(gift).map(([k, q]) => `${q} ${k}`).join(", ")} as a gift (goodwill ${Math.round(f.goodwill)})`;
    }
  }
  if (!f.pact && attitude(f) !== "Hostile") {
    const r2 = proposePact(state, f, f.goodwill >= 20 ? "trade" : "nonaggression");
    if (/signed/.test(r2)) text += `${text ? "; " : ""}${r2.toLowerCase().replace(/\.$/, "")}`;
  }
  // The team at their gates counts as contact (alliance.js): a group that qualifies is invited there and then.
  if (!isMember(state, f) && !inviteProblem(state, f)) text += `${text ? "; " : ""}${inviteToAlliance(state, f).replace(/\.$/, "")}`;
  say(state, `Trade visit at ${f.name}: ${text || "nothing worth swapping"}.`);
  endTrade(state);
}

// ======================================================================================
// Bases: roles, buildings, crafting, gear, medicine
// ======================================================================================
// Hub needs per supply, 0 (plenty) .. 3 (urgent). Drives trips, trades and some buildings.
function needs(state) {
  const h = hub(state);
  const st = h.stock;
  const n = Math.max(1, atBase(state, h.id).length);
  const vehicle = state.vehicles.some((v) => isCar(v) && (v.loc.kind === "base" || v.loc.kind === "party"));
  const foodDays = edibleFood(h) / n; // fresh + preserved (storage.js)
  const pick = (v, steps) => { for (const [lim, w] of steps) if (v < lim) return w; return steps[steps.length - 1][1]; };
  const out = {
    food: (() => { const t = foodTarget(state); return pick(foodDays, [[Math.min(4, t * 0.3), 3], [t * 0.5, 2], [t, 1.4], [t * 2, 0.6], [Infinity, 0.2]]); })(),
    // Water by days left at the current rate (economy.waterOutlook), or by stock per person.
    water: (() => { const wo = waterOutlook(state, h); const d = wo.net >= 0 ? (st.water || 0) / n + 10 : wo.daysLeft; return pick(d, [[4, 2.5], [8, 1.6], [15, 0.8], [Infinity, 0.2]]); })(),
    meds: pick(st.meds || 0, [[2, 2.5], [n * 0.6, 1.8], [n * 1.5, 1], [Infinity, 0.3]]),
    scrap: pick(st.scrap || 0, [[20, 2.5], [45, 1.6], [90, 0.9], [Infinity, 0.35]]),
    parts: pick(st.parts || 0, [[2, 2], [6, 1.2], [12, 0.6], [Infinity, 0.2]]),
    ammo: pick(st.ammo || 0, [[n * 6, 2], [n * 15, 0.9], [n * 40, 0.35], [Infinity, 0.1]]),
    fuel: vehicle ? pick(st.fuel || 0, [[12, 1.6], [35, 0.8], [Infinity, 0.2]]) : 0.15,
    // Empty jars for the preserving kitchen (storage.js), once there is one.
    jars: count(h, "kitchen") ? pick(st.jars || 0, [[4, 1.3], [12, 0.7], [Infinity, 0.1]]) : 0,
  };
  return persona(state).reserves ? reserveNeeds(state, h, out) : out;
}
// Cautious: a supply below its reserve target is wanted (1.6, up to 3 when it is gone); one well above it
// (1.5× the target) is surplus to trade. Food stays as the food planner rates it.
function reserveNeeds(state, h, out) {
  const rs = reserveStatus(state, h);
  for (const k of RESERVE_KEYS) {
    const r = rs[k];
    if (!r || !(r.target > 0) || out[k] == null) continue;
    if (r.short) out[k] = Math.max(out[k], 1.6 + 1.4 * Math.max(0, 1 - r.have / r.target));
    else if (r.have >= r.target * 1.5) out[k] = Math.min(out[k], 0.4);
  }
  return out;
}

// ---------- reserves (the Cautious style) ----------
// How much of each supply a base should not drop below, from what the player can see, and what is short. The
// Cautious governor acts as soon as something drops below its target (trips for it, trades, the bench or med
// station, no spending it on extras); the dev panel shows the table in the 🤖 line's tooltip.
// Threat (0..3): a horde in sight within 8 tiles (+1, +1 more if the defences would not hold it), a horde warning
// or the defences manned (+1), a hive or a hive build site known within 12 tiles (+1), two or more horde attacks
// on this base so far (+1).
export function reserveThreat(state, base) {
  const hz = hordeThreat(state, base);
  let t = 0;
  if (hz.size) t += holdCheck(state, base, hz.size, hz.bosses).holds ? 1 : 2;
  const warned = state.hordes.some((h) => h.warned && state.live.has(h.tile) && ((h.goal && h.goal.baseId === base.id) || h.target === base.tile));
  if (warned || (base.hordeAlert && state.hour < base.hordeAlert)) t++;
  if (state.grid.within(base.tile, 12).some((id) => { const k = state.knowledge[id]; return k && (k.hive || k.site); })) t++;
  if ((base.hordeHits || 0) >= 2) t++;
  return Math.min(3, t);
}

// Per supply { have, target, days, short, low, why }: days = how long it lasts at today's rate where that is known
// (food, water, meds), short = below target, low = below half of it. Targets:
//   food   fresh + preserved, the food planner's own target (foodTarget days × the people here, short too while
//          the winter outlook falls short);
//   water  7 days of drinking (10 in summer), at most 90% of what the base can hold; short only while the wells
//          do not keep up on a dry day or under 15 days are left;
//   meds   one treatment for everyone sick now, +1 per infected wound, plus a buffer (a third of the people + 2,
//          a quarter more in autumn and winter, when flu and pneumonia come);
//   ammo   N break-in battles: about 6 a defender (up to 8) plus the 3 a head every horde attack burns, N = 2 +
//          threat (up to 4: hordes near, a warning, a hive near, attacks so far);
//   fuel   a decoy fire (6), the floodlights (4), and 6 for the truck's next trip if there is a truck;
//   scrap  repairs and defences: 20 + 1.5 a head + 10 per threat level (at most 70);
//   parts  3, +2 with a vehicle.
let reserveMemo = { state: null, hour: -1, map: new Map() };
export function reserveStatus(state, base = hub(state)) {
  if (!base) return null;
  if (reserveMemo.state !== state || reserveMemo.hour !== state.hour) reserveMemo = { state, hour: state.hour, map: new Map() };
  const memo = reserveMemo.map.get(base.id);
  if (memo) return memo;
  const st = base.stock;
  const people = atBase(state, base.id);
  const n = Math.max(1, people.length + (base.type === "hub" ? returning(state, base) : 0));
  const threat = reserveThreat(state, base);
  const sk = wxSeason(state).key;
  const cold = sk === "autumn" || sk === "winter";
  const vehicle = base.type === "hub" ? state.vehicles.some((v) => isCar(v) && (v.loc.kind === "base" || v.loc.kind === "party")) : carsAtBase(state, base.id).length > 0;
  const row = (have, target, days, why, short = have < target) => ({ have: Math.floor(have), target: Math.round(target), days: days == null || !Number.isFinite(days) ? null : Math.round(days), short, low: have < target / 2, why });
  const out = { threat };
  // Food (fresh + preserved): the food planner's numbers (foodTarget, the winter outlook), not this table's.
  const eaters = Math.max(1, people.length);
  const fDays = foodTarget(state, base);
  const edible = edibleFood(base);
  const wShort = winterShort(state, base);
  out.food = row(edible, fDays * eaters, edible / eaters, `${Math.round(fDays)} days for ${people.length} (food planner${wShort > 0 ? ": the winter stores fall short" : ""})`, edible / eaters < fDays || wShort > 0);
  if (SUPPLIES.preserved) out.preserved = row(st.preserved || 0, 0, null, "part of the food above (food planner)", false);
  const wo = waterOutlook(state, base);
  const wDays = sk === "summer" ? 10 : 7;
  const wTarget = Math.min(waterCapacity(base) * 0.9, n * wDays);
  out.water = row(st.water || 0, wTarget, wo.daysLeft, `${wDays} days of drinking (well ${wo.dryNet >= 0 ? "keeps up" : "falls short"} on a dry day)`,
    ((st.water || 0) < wTarget && wo.dryNet < 0) || wo.daysLeft < 15);
  const sick = medsToTreatAll(state, base) + people.filter((s) => s.woundInfected).length;
  const buffer = Math.ceil((n / 3 + 2) * (cold ? 1.25 : 1));
  out.meds = row(st.meds || 0, sick + buffer, sick > 0 ? (st.meds || 0) / sick : null, `${sick} to treat now + ${buffer} spare`);
  const fight = 6 * Math.min(8, n) + 3 * n;
  const battles = Math.min(4, 2 + threat);
  out.ammo = row(st.ammo || 0, fight * battles, null, `${battles} break-in battles at about ${fight} each (threat ${threat})`);
  out.ammo.battles = Math.round(((st.ammo || 0) / fight) * 10) / 10;
  const flood = count(base, "floodlights") ? 4 : 0;
  out.fuel = row(st.fuel || 0, DECOY_FUEL + flood + (vehicle ? 6 : 0), null, `decoy fire${flood ? ", floodlights" : ""}${vehicle ? ", the truck" : ""}`);
  out.scrap = row(st.scrap || 0, Math.min(70, 20 + 1.5 * n + 10 * threat), null, `repairs and defences (threat ${threat})`);
  out.parts = row(st.parts || 0, 3 + (vehicle ? 2 : 0), null, vehicle ? "repairs and the truck" : "repairs");
  reserveMemo.map.set(base.id, out);
  return out;
}
const RESERVE_KEYS = ["water", "meds", "ammo", "fuel", "scrap", "parts"]; // food: the food planner's
// Supplies below target at a base (Cautious only; everyone else: none).
const reserveShort = (state, base = hub(state)) => {
  if (!persona(state).reserves || !base) return [];
  const rs = reserveStatus(state, base);
  return [...RESERVE_KEYS, "food"].filter((k) => rs[k] && rs[k].short);
};
// One line per supply for the dev panel's tooltip.
export function reserveText(state) {
  const rs = reserveStatus(state);
  if (!rs) return "";
  const lines = Object.entries(rs).filter(([, v]) => v && typeof v === "object").map(([k, v]) =>
    `${v.short ? "▼" : "·"} ${k}: ${v.have}${v.target ? ` / ${v.target}` : ""}${v.days != null ? ` (${v.days} d)` : ""}${v.battles != null ? ` (${v.battles} battles)` : ""} — ${v.why}`);
  const P = persona(state);
  return `Reserves at the hub (threat ${rs.threat})${P.reserves ? "" : ` — only the Cautious style acts on them`}:\n${lines.join("\n")}`;
}

// Who is coming back to a base (teams out from it), for beds.
const returning = (state, base) => state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy" && p.homeBaseId === base.id)
  .reduce((a, p) => a + partyMembers(state, p).length, 0);

// What could hit a base: urgent = a raid that has been spotted or a horde at the door; standing = known hostile
// raiders in reach and hordes in sight. Strength on the same scale as baseDefense.
function threatAt(state, base) {
  const g = state.grid;
  let urgent = 0, standing = 0;
  for (const q of state.parties) {
    if (q.kind !== "raid" || !q.target || q.target.kind !== "player" || q.target.baseId !== base.id || q.returning) continue;
    if (q.warned || q.phase === "siege" || state.live.has(partyTile(q))) urgent = Math.max(urgent, q.strength);
  }
  for (const f of state.factions) {
    if (!f.alive || !f.known || !f.bases.length || !(FACTION_TYPES[f.type] && FACTION_TYPES[f.type].raid > 0) || f.goodwill >= -30) continue;
    const d = Math.min(...f.bases.map((b) => g.distance(b, base.tile)));
    if (d <= 20) standing = Math.max(standing, strength(f) * 0.32 * 0.6);
  }
  for (const h of state.hordes) {
    if (!state.live.has(h.tile)) continue;
    const d = g.distance(h.tile, base.tile);
    if (d <= 2) urgent = Math.max(urgent, h.size * 0.14 * 1.1);
    else if (d <= 6) standing = Math.max(standing, h.size * 0.14 * 0.6);
  }
  // Remembered for a day, so guards do not stand down the moment a horde drifts out of sight.
  const mem = gov(state).threat;
  const m = mem[base.id];
  if (standing > 0 && (!m || state.hour >= m.until || standing >= m.standing)) mem[base.id] = { standing, until: state.hour + 24 };
  else if (m && state.hour < m.until) standing = Math.max(standing, m.standing);
  return { urgent, standing };
}

// The area each role belongs to (a steward leaves roles in an area it was not handed alone); rest and scavenge
// are plain Roles. Roles the governor does not plan (teaching, reading: skills.js) are always left as they are.
// teach / read (skills.js planStudy) belong to "roles": without them every reader counted as pinned and kept reading for good.
const ROLE_AREA = { farm: "food", medic: "medical", guard: "defence", operate: "production", craft: "production", build: "building", rest: "roles", scavenge: "roles", teach: "roles", read: "roles" };

function planRoles(state, base, areas = ALL_AREAS) {
  const people = atBase(state, base.id);
  if (!people.length) return 0;
  const g = gov(state);
  const P = persona(state);
  const free = new Set(people);
  const want = new Map();
  const give = (s, role, station = null) => { want.set(s.id, { role, station }); free.delete(s); };
  // 0. Pinned people (s.pinned, the survivor screen and the base's people list) keep what they do, and so does
  // anyone in a role whose area this base's steward was not handed.
  // People on work priorities (work.js) run themselves: a steward leaves them alone (the dev autopilot only with
  // its test switch governor.priorityRoles; otherwise it sets every role, as before).
  const byPriority = (s) => (!state.autopilot || g.priorityRoles) && isManaged(state, s);
  for (const s of people) if (s.pinned || !areas[ROLE_AREA[s.role]] || byPriority(s)) give(s, s.role, s.role === "operate" ? s.station : null);
  const ranked = (role, score, filter = () => true) => [...free].filter(filter)
    .sort((a, b) => score(b) + (b.role === role ? STICKY : 0) - (score(a) + (a.role === role ? STICKY : 0)));
  const st = base.stock;
  const isHub = base.type === "hub";
  const eaters = people.length;
  const foodDays = edibleFood(base) / Math.max(1, eaters); // fresh + preserved (storage.js)
  const slots = farmSlots(base);
  const fw = farmersWanted(state, base); // farming.js: what the planted and free plots can use

  // 1. Patients in a hospital bed do not work anyway; the worn-out rest before they walk away (up to a third,
  // and only while there is food, unless someone is about to leave).
  for (const s of [...free]) if (s.inBed) give(s, "rest");
  const low = [...free].filter((s) => (s.mood < P.restMood || wantsRest(state, s)) && !s.leader).sort((a, b) => a.mood - b.mood); // wantsRest: low after a rough trip (relations.js)
  low.forEach((s, i) => { if (s.mood < 18 || (i < Math.floor(people.length / 3) && foodDays >= 3)) give(s, "rest"); });

  // 1b. Water before food: a queued water filter gets its crafter first while the water is running short
  // (thirst kills in days; a hungry base still has its stock).
  if (areas.production) {
    const wo = waterOutlook(state, base);
    const fj = craftQueue(base).some((j) => j.recipe === "waterfilter");
    if (fj && wo.net < 0 && (wo.daysLeft < 6 || (st.water || 0) < people.length * 3)) {
      const c = ranked("craft", (x) => skill(x, CRAFTS.waterfilter.skill), (x) => !x.inBed && skill(x, CRAFTS.waterfilter.skill) >= CRAFTS.waterfilter.min)[0];
      if (c) give(c, "craft");
    }
  }

  // 2. Farming (farming.js): crops take days to ripen, and more and better farmers per plot give a bigger
  // harvest. Enough farmers for the plots in use (the "ideal" crew when food is short).
  let farmers = people.filter((s) => byPriority(s) && s.role === "farm").length; // farmers by priorities count too (farmShort)
  const farmTo = (target) => {
    if (!areas.food) return;
    for (const s of ranked("farm", (x) => skill(x, "farming"), (x) => !x.inBed)) {
      if (farmers >= target) break;
      farmers++;
      give(s, "farm");
    }
  };
  if (foodDays < 4) farmTo(fw.ideal);
  // The winter stores fall short (winterShort): the plots get their tenders before builders, medics and stations.
  if (winterShort(state, base) > 0) farmTo(fw.need);

  // 3. Guards for a raid that is on its way or a horde at the door.
  const threat = threatAt(state, base);
  const guards = new Set([...want].filter(([, w]) => w.role === "guard").map(([id]) => id));
  const defense = () => {
    let d = baseWalls(base) * 2;
    for (const s of people) d += combatPower(s) * (guards.has(s.id) || (want.get(s.id) || {}).role === "guard" ? 1.5 : base.alert ? 1.3 : 0.8);
    return (st.ammo || 0) < people.length * 3 ? d * 0.7 : d;
  };
  const addGuards = (target, cap) => {
    if (!areas.defence) return;
    for (const s of ranked("guard", (x) => combatPower(x) * 2, (x) => !x.inBed)) {
      if (defense() >= target || guards.size >= cap) break;
      guards.add(s.id);
      give(s, "guard");
    }
  };
  if (threat.urgent) addGuards(threat.urgent * P.guardMargin, Math.ceil(people.length * 0.7));

  // 4. Medics while anyone here is hurt (each hospital tier needs 1-3 to run).
  const hosp = hospitalDef(base);
  const staffed = people.some((s) => s.role === "medic"); // medics on duty stay until everyone is fully healed
  if (areas.medical && hosp.tier > 0 && people.some((s) => s.woundInfected || (isHurt(s) && s.health < (staffed ? 100 : 95)))) {
    for (const s of ranked("medic", (x) => skill(x, "medicine") - (isHurt(x) ? 6 : 0)).slice(0, hosp.staff)) give(s, "medic");
  }

  // 4b. Cautious (reserves): while food is not short, the stations that refill a short supply (the ammo bench,
  // the med station: stationWorth) get their operator before the plots take every hand, and standing guards
  // come first while hordes or raiders are near.
  if (P.reserves && foodDays >= Math.max(15, foodTarget(state, base)) && winterShort(state, base) <= 0) {
    for (const station of areas.production ? stations(base) : []) {
      const recipe = BUILDINGS[station.type].station;
      if (recipe === "power" || [...want.values()].some((w) => w.station === station.id) || !stationWorth(state, base, recipe, station)) continue;
      const op = ranked("operate", (x) => skill(x, RECIPES[recipe].skill) + (x.station === station.id ? 3 : 0), (x) => !x.inBed)[0];
      if (op) give(op, "operate", station.id);
    }
    addGuards(Math.max(threat.standing, threat.urgent * P.guardMargin), Math.ceil(people.length * 0.35));
  }

  // 4c. A manual or blueprint in the armory: the best qualified free person studies it (blueprints.js; the Read role).
  if (!threat.urgent && foodDays >= 4) planBlueprintStudy(state, base, free, give);

  // 5. Builders while something is queued: more for big jobs.
  if (areas.building && base.construction.length) {
    const left = base.construction.reduce((a, j) => a + j.hours - j.progress, 0);
    const n = Math.min(3, Math.max(1, Math.ceil(left / 40)), Math.max(1, Math.floor(free.size / 2)));
    for (const s of ranked("build", (x) => skill(x, "mechanics"), (x) => !x.inBed).slice(0, n)) give(s, "build");
  }

  // 6. Farming to the comfortable level. More plots are wanted when every plot is in use and food runs low.
  farmTo(foodDays < Math.max(15, foodTarget(state)) ? fw.ideal : fw.need);
  // Before winter (no outdoor harvests for four weeks) a month's stock is the aim.
  // ...and only while there are hands to tend them (a plot nobody tends gives little).
  g.farmShort[base.id] = fw.active + fw.toSow >= slots && (foodOutlook(state, base).daysLeft < 30 || winterShort(state, base) > 0) && farmers >= slots * 0.45;

  // 7. Workshop stations that are worth running today and whose standing order wants them run (production.js);
  // then generators for what the staffed stations and the other powered buildings would draw (power.js).
  const staffedIds = () => new Set([...want.values()].filter((w) => w.station != null).map((w) => w.station));
  for (const station of areas.production ? stations(base) : []) {
    const recipe = BUILDINGS[station.type].station;
    if (recipe === "power" || !stationWorth(state, base, recipe, station) || staffedIds().has(station.id)) continue; // (4b may have staffed it)
    const key = RECIPES[recipe].skill;
    const op = ranked("operate", (x) => skill(x, key) + (x.station === station.id ? 3 : 0), (x) => !x.inBed)[0];
    if (op) give(op, "operate", station.id);
  }
  if (areas.production) {
    const ids = staffedIds();
    let gens = Math.ceil(powerWanted(state, base, (b) => ids.has(b.id)) / POWER.genOut) - stations(base).filter((x) => BUILDINGS[x.type].station === "power" && ids.has(x.id)).length;
    for (const station of stations(base)) {
      if (gens <= 0) break;
      if (BUILDINGS[station.type].station !== "power" || ids.has(station.id) || !stationWorth(state, base, "power", station)) continue;
      const op = ranked("operate", (x) => skill(x, "mechanics") + (x.station === station.id ? 3 : 0), (x) => !x.inBed)[0];
      if (op) { give(op, "operate", station.id); gens--; }
    }
  }

  // 8. One crafter while the craft queue has a job someone here can do.
  const job = areas.production && craftQueue(base).find((j) => people.some((s) => skill(s, CRAFTS[j.recipe].skill) >= CRAFTS[j.recipe].min));
  if (job) {
    const r = CRAFTS[job.recipe];
    const c = ranked("craft", (x) => skill(x, r.skill), (x) => !x.inBed && skill(x, r.skill) >= r.min)[0];
    if (c) give(c, "craft");
  }

  // 9. Standing guards: known raiders in reach, hordes in sight, and a lookout at the hub.
  addGuards(Math.max(threat.standing, threat.urgent * P.guardMargin), Math.ceil(people.length * (threat.urgent ? 0.7 : 0.35)));
  if (areas.defence && isHub && people.length >= 4) {
    const need = P.baseGuards - guards.size - (people.length < 7 ? Math.max(0, P.baseGuards - 1) : 0);
    for (const s of ranked("guard", (x) => combatPower(x) * 2, (x) => !x.inBed).slice(0, Math.max(0, need))) { guards.add(s.id); give(s, "guard"); }
  }

  // 10. Everyone else: more hands on the plots while food is not plentiful (bigger harvests), rest when spirits
  // are low; base scavenging rarely finds anything, so only the last few go out to pick around.
  planStudy(state, base, free, give, { foodDays, urgent: !!threat.urgent }); // skills.js: a teacher and readers when food is comfortable
  if (foodDays < Math.max(40, foodTarget(state) * 1.5)) farmTo(Math.ceil(fw.ideal * 1.6));
  for (const s of [...free]) give(s, s.mood < 40 ? "rest" : "scavenge");

  let changed = 0;
  for (const s of people) {
    const w = want.get(s.id) || { role: "scavenge", station: null };
    if (s.role !== w.role) { s.role = w.role; changed++; }
    if (w.role === "operate") { if (s.station !== w.station) { s.station = w.station; changed++; } }
    else s.station = null;
  }
  if (changed) {
    g.stats.roleChanges += changed;
    assignStations(state, base);
  }
  return changed;
}

// station: the building, when known. Its standing order (production.js; the governor's own from govOrders, or the
// player's) comes first: a station it holds is never staffed, and an until / keep order replaces the stock check.
function stationWorth(state, base, recipe, station = null) {
  if (station && orderHold(state, base, station)) return false;
  const byOrder = !!station && stationOrder(base, station).mode !== "forever";
  const st = base.stock;
  const n = Math.max(1, atBase(state, base.id).length);
  // Cautious: a short supply is made from the scrap there is (down to the last day's worth when it is low).
  if (persona(state).reserves && (recipe === "ammo" || recipe === "meds")) {
    const r = reserveStatus(state, base)[recipe];
    if (r.short && (st.scrap || 0) >= (recipe === "ammo" ? (r.low ? 3 : 10) : (r.low ? 2 : 8)) && (recipe === "ammo" || (st.food || 0) >= n * 6)) return true;
  }
  if (recipe === "ammo") return (byOrder || (st.ammo || 0) < n * 15 + 60) && (st.scrap || 0) >= 30;
  if (recipe === "meds") return (byOrder || (st.meds || 0) < Math.max(5, n)) && (st.scrap || 0) >= 15 && (st.food || 0) >= n * 6;
  if (recipe === "parts") return (byOrder || (st.parts || 0) < 8) && (st.scrap || 0) >= 45 && atBase(state, base.id).some((s) => skill(s, "mechanics") >= 4);
  if (recipe === "preserve") return preserveWorth(state, base);
  if (recipe === "still") return stillWorth(state, base);
  if (recipe === "power") return (st.fuel || 0) >= fuelFloor(state, base) + POWER.genFuel;
  return false;
}
// Fuel the governor keeps out of the generator: a decoy fire, the floodlights and the truck (Cautious: its reserve).
const fuelFloor = (state, base) => (persona(state).reserves ? reserveStatus(state, base).fuel.target : 10);
// The ethanol still (power.js): only the surplus, never while the winter stores fall short.
function stillWorth(state, base) {
  const st = base.stock;
  const n = Math.max(1, atBase(state, base.id).length);
  if ((st.water || 0) < n * 2 + RECIPES.still.in.water || winterShort(state, base) > 0) return false;
  return foodStore(state, base).outside >= 1 || edibleFood(base) / n >= Math.max(30, foodTarget(state, base) * 1.3);
}

// Standing orders for the stations (production.js), so operators are not flipped hour by hour: make ammo, meds
// and parts until the stock target (they start again 10% below it), run the still only on the surplus and the
// generator only above the fuel the base keeps. The player's own orders (by: "player") stand.
function govOrders(state, base) {
  const P = persona(state);
  const n = Math.max(1, atBase(state, base.id).length + returning(state, base));
  const rs = P.reserves ? reserveStatus(state, base) : null;
  for (const station of stations(base)) {
    const cur = stationOrder(base, station);
    if (cur.by === "player") continue;
    const recipe = BUILDINGS[station.type].station;
    let want = null;
    if (recipe === "ammo") want = { mode: "until", n: Math.max(n * 15 + 60, rs ? Math.ceil(rs.ammo.target) + 20 : 0) };
    else if (recipe === "meds") want = { mode: "until", n: Math.max(5, n, rs ? Math.ceil(rs.meds.target) + 2 : 0) };
    else if (recipe === "parts") want = { mode: "until", n: Math.max(8, rs ? Math.ceil(rs.parts.target) + 2 : 0) };
    else if (recipe === "still") want = { mode: "keep", key: "food", n: n * 25 };
    else if (recipe === "power") want = { mode: "keep", key: "fuel", n: Math.ceil(fuelFloor(state, base)) };
    if (!want) continue;
    if (cur.mode === want.mode && (want.key || cur.key) === cur.key && Math.abs(cur.n - want.n) <= Math.max(2, want.n * 0.1)) continue;
    setStationOrder(state, base, station.id, want, "ai");
    const g = gov(state);
    g.stats.orders = (g.stats.orders || 0) + 1;
  }
}
// The preserving kitchen (storage.js): jars fresh food that would otherwise spoil (stored outside, or the summer
// and autumn surplus going into the winter store), never the food eaten in the next two weeks, and only with
// jars, water and a little scrap to spare.
function preserveWorth(state, base) {
  const st = base.stock;
  const n = Math.max(1, atBase(state, base.id).length);
  const r = RECIPES.preserve;
  if ((st.jars || 0) < r.in.jars || (st.water || 0) < n * 2 + r.in.water || (st.scrap || 0) < 4) return false;
  if ((st.food || 0) < n * 14 + r.in.food) return false;
  const store = foodStore(state, base);
  const sk = wxSeason(state).key;
  return store.outside >= 1 || ((sk === "summer" || sk === "autumn") && (st.food || 0) >= Math.min(store.cap * 0.6, n * 25));
}

// Daily: one log line per base when its roles changed since the last one.
function roleSummaries(state) {
  const g = gov(state);
  for (const b of state.bases) {
    const counts = {};
    for (const s of atBase(state, b.id)) counts[s.role] = (counts[s.role] || 0) + 1;
    const text = Object.entries(counts).sort((a, b2) => b2[1] - a[1]).map(([r, n]) => `${n} ${r}`).join(", ");
    if (text && g.roleSummary[b.id] !== text) {
      say(state, `${b.name} roles: ${text}${g.roleSummary[b.id] ? ` (was ${g.roleSummary[b.id]})` : ""}.`);
      g.roleSummary[b.id] = text;
    }
  }
}

// ---------- construction ----------
// The steward area each kind of building belongs to (anything else is plain Building).
const BUILD_AREA = {
  walls: "defence", barricades: "defence", spike_pits: "defence", trench: "defence", gate: "defence", floodlights: "defence", watchtower: "defence",
  infirmary: "medical", field_hosp: "medical", clinic: "medical", hospital: "medical", med_station: "medical",
  farm_plot: "food", greenhouse: "food", cellar: "food", coldstore: "food", storehouse: "food", smoker: "food", kitchen: "food", rain_catcher: "food", well: "food", cistern: "food",
  ammo_bench: "production", machine_shop: "production", still: "production", generator: "production",
};
function planBuilds(state, base, areas = ALL_AREAS) {
  if (base.construction.length >= (base.type === "hub" ? 2 : 1)) return;
  const g = gov(state);
  for (const w of buildWishes(state, base)) {
    const def = BUILDINGS[w.type];
    if (!def || !areas[BUILD_AREA[w.type] || "building"]) continue;
    const chk = canBuild(state, base, w.type);
    if (!chk.ok) {
      if (w.save && /^Needs \d+ scrap/.test(chk.reason)) return; // save up for it rather than spend on less
      continue;
    }
    const cost = def.cost;
    // Cautious: anything not urgent is built only from what is above the reserves (reserveStatus).
    const rs = persona(state).reserves && !w.save ? reserveStatus(state, base) : null;
    const reserve = rs ? rs.scrap.target : w.save || base.type !== "hub" ? 0 : 10;
    if ((base.stock.scrap || 0) - (cost.scrap || 0) < reserve) { if (w.save) return; continue; }
    if (rs && ["meds", "parts", "fuel"].some((k) => cost[k] && (base.stock[k] || 0) - cost[k] < rs[k].target)) continue;
    if (!w.save && cost.meds && (base.stock.meds || 0) - cost.meds < 2) continue;
    if (!w.save && cost.parts && (base.stock.parts || 0) - cost.parts < 1) continue;
    const msg = queueBuild(state, base, w.type);
    g.stats.builds++;
    say(state, `${msg.replace(/\.$/, "")}: ${w.why}.`);
    return;
  }
}

function buildWishes(state, base) {
  const g = gov(state);
  const out = [];
  const add = (type, why, save = false) => out.push({ type, why, save });
  const here = atBase(state, base.id);
  const people = here.length + returning(state, base);
  const isHub = base.type === "hub";
  const queued = (t) => base.construction.filter((c) => c.type === t).length;
  const beds = baseBeds(base) + queued("bunkhouse") * 6;
  const threat = threatAt(state, base);
  const st = base.stock;
  const pop = alive(state).length;
  const best = (k) => Math.max(0, ...here.map((s) => skill(s, k)));
  // Water first when it is about to run out (economy.js).
  const wo0 = waterOutlook(state, base);
  if (wo0.net < 0 && wo0.daysLeft < 8 && count(base, "rain_catcher") + base.construction.filter((c) => c.type === "rain_catcher").length < BUILDINGS.rain_catcher.max) add("rain_catcher", "water is about to run out", true);
  if (people + (isHub ? 1 : 0) > beds) add("bunkhouse", `${people} people for ${beds} beds`, true);
  // Water first when it runs short (economy.js): cheap rain catchers, then wells; cisterns once it overflows.
  const wo = waterOutlook(state, base);
  const wDays = wo.net >= 0 ? Infinity : wo.daysLeft;
  if (wo.dryNet < 1 || wDays < 20) {
    if (count(base, "rain_catcher") + queued("rain_catcher") < BUILDINGS.rain_catcher.max) add("rain_catcher", "water is running short", true);
    if (count(base, "well") + queued("well") < BUILDINGS.well.max) add("well", "water is running short", (st.parts || 0) >= 1);
  }
  if ((st.water || 0) >= waterCapacity(base) * 0.85 && waterCapacity(base) < people * 10 && count(base, "cistern") + queued("cistern") < BUILDINGS.cistern.max) add("cistern", "room to store more water");
  if (g.farmShort[base.id] && count(base, "farm_plot") + queued("farm_plot") < (isHub ? BUILDINGS.farm_plot.max : 3)) add("farm_plot", "the farmers need more plots", true);
  for (const w of foodStoreWishes(state, base, people, queued)) out.push(w);
  if (isHub && count(base, "greenhouse") + queued("greenhouse") < (pop >= 12 ? 2 : 1) && pop >= 6 && (st.parts || 0) >= 4) add("greenhouse", "something to grow through the winter", wxSeason(state).key === "autumn" || winterShort(state, base) > 0);
  if (!isHub && count(base, "farm_plot") + queued("farm_plot") < 1) add("farm_plot", "an outpost should feed itself", true);
  if (Math.max(threat.urgent, threat.standing) > baseDefense(state, base) * 0.9) add("walls", "raiders or hordes nearby", true);
  // Hordes (defences.js): walls when a horde in sight would break in, then barricades, spike pits and the rest.
  const hz = hordeThreat(state, base);
  if (hz.size && !holdCheck(state, base, hz.size, hz.bosses).holds && count(base, "walls") + queued("walls") < BUILDINGS.walls.max) add("walls", `a horde of ${hz.size} would break in`, true);
  if (hz.any) for (const w of defenceWishes(state, base, true)) if (!queued(w.type)) out.push(w);
  // A radio relay (radio.js) at an outpost within reach of the network, when it would bring a group you know into
  // radio reach: greetings, pacts and the coalition need it.
  if (!isHub && !count(base, "relay") && !queued("relay") && hasNetwork(state) && inCoverage(state, base.tile, RELAY_RANGE)) {
    const gain = state.factions.some((f) => f.alive && f.known && !canRadioGroup(state, f) && f.bases.some((b) => state.grid.distance(b, base.tile) <= RELAY_RANGE + GROUP_REACH));
    if (gain) add("relay", "radio reach to a group out of contact");
  }
  if (!isHub) return out;
  const hostileNear = state.factions.some((f) => f.alive && f.known && attitude(f) === "Hostile" && f.bases.some((b) => state.grid.distance(b, base.tile) <= 20));
  if (!base.watchtower && (hostileNear || state.hordes.some((h) => state.live.has(h.tile)))) add("watchtower", "earlier warning of raids and hordes");
  const next = nextHospitalType(base);
  if (next === "infirmary" && pop >= 5) add("infirmary", "somewhere to treat the injured");
  if (next === "field_hosp" && pop >= 8 && (st.parts || 0) >= 3 && (st.meds || 0) >= 8) add("field_hosp", "more beds and no infected wounds");
  if (next === "clinic" && pop >= 11 && (st.parts || 0) >= 6 && (st.meds || 0) >= 12) add("clinic", "surgery and cleaned wounds");
  if (next === "hospital" && pop >= 16 && (st.parts || 0) >= 10 && (st.meds || 0) >= 16) add("hospital", "a proper trauma hospital");
  if (!count(base, "med_station") && pop >= 6 && best("medicine") >= 3 && (st.meds || 0) < pop) add("med_station", "meds are short");
  if (!count(base, "storehouse") && (hostileNear || state.stats.raidsRepelled > 0)) add("storehouse", "raiders steal less");
  if (!count(base, "machine_shop") && pop >= 7 && (st.parts || 0) < 6 && best("mechanics") >= 4) add("machine_shop", "spare parts");
  // Mood (relations.js): a common room once the hub is a real community and spirits are not sky high (saved up for
  // when they sag below 75), or as planned comfort for a big hub: at 12+ people once there is scrap for it, saved up
  // for at 15+. A hub with only beds and food settles in the 70s-80s; comfort is what takes it near 100.
  if (BUILDINGS.common_room && count(base, "common_room") + queued("common_room") < (here.length > 15 ? 2 : 1)) {
    const avgMood = here.reduce((a, s) => a + s.mood, 0) / Math.max(1, here.length);
    const none = !count(base, "common_room") && !queued("common_room");
    if (pop >= 8 && avgMood < 75) add("common_room", "spirits are low (mood)", none);
    else if (pop >= 8 && (st.scrap || 0) >= 35 && avgMood < 85) add("common_room", "somewhere to unwind (mood)");
    else if (none && here.length >= 15) add("common_room", "somewhere to unwind for a big hub", true);
    else if (none && here.length >= 12 && (st.scrap || 0) >= 35) add("common_room", "somewhere to unwind for a growing hub");
  }
  // Power (power.js): a still for the surplus once the hub is big enough, then a generator for what it powers.
  if (!count(base, "still") && !queued("still") && pop >= 9 && (st.parts || 0) >= 4 && stillWorth(state, base)) add("still", "turn the surplus food into fuel");
  if (count(base, "generator") + queued("generator") < 1 && pop >= 10 && (count(base, "still") || (st.fuel || 0) >= 40) && (count(base, "machine_shop") || count(base, "coldstore")) && (st.parts || 0) >= 8 && best("mechanics") >= 3) add("generator", "power for the machine shop and the cold store");
  if (!base.radio && pop >= 8 && (st.parts || 0) >= 9 && best("mechanics") >= 4) add("radio", "live contact with teams out in the field");
  // The coalition is made on the radio (greetings, pacts, invitations: alliance.js): from a dozen people with a
  // Mechanics 4 builder, the station is built once the parts are there (not saved up for: scrap goes to walls first).
  else if (!base.radio && pop >= 12 && day(state) >= 60 && (st.parts || 0) >= BUILDINGS.radio.cost.parts && best("mechanics") >= 4 && state.factions.some((f) => f.alive && f.known && !isMember(state, f))) add("radio", "radio contact with the groups for the coalition");
  if (!count(base, "garage") && carsAtBase(state, base.id).length && (st.parts || 0) >= 5) add("garage", "cheaper vehicle repairs");
  if (people + 2 > beds && (st.scrap || 0) >= 45) add("bunkhouse", "room for newcomers");
  if (count(base, "walls") < 2 && (st.scrap || 0) >= 70) add("walls", "stronger defense");
  // Cautious (reserves): a med station as soon as meds run short (the surest source), and a radio station once
  // there are parts for it: scanning finds the groups in reach, and radio deals bring what runs short without a
  // trip (reserveRadio).
  if (persona(state).reserves) {
    const rs = reserveStatus(state, base);
    if (!count(base, "med_station") && pop >= 5 && rs.meds.short) add("med_station", "meds are below the reserve", true);
    if (!base.radio && (st.parts || 0) >= 6 + rs.parts.target && best("mechanics") >= 4) add("radio", "radio deals for what runs short", true);
    // Hordes are a known danger here: a second wall tier (each holds back 54 more of a horde, a Wallbreaker's 60%).
    if (rs.threat >= 1 && count(base, "walls") + queued("walls") < 2) add("walls", "hordes are near: a stronger wall", true);
  }
  return out;
}

// Food storage and preserving (storage.js), before it is needed: room for the winter stock (the fresh food now
// and what the fields still bring in, from mid-summer), a cold store before winter, a drying rack and a
// preserving kitchen for the summer surplus. Food already stored outside makes the next store urgent.
function foodStoreWishes(state, base, people, queued) {
  const out = [];
  if (base.type !== "hub") return out;
  const st = base.stock;
  const add = (type, why, save = false) => out.push({ type, why, save });
  const can = (t) => count(base, t) + queued(t) < BUILDINGS[t].max;
  const cap = storeCapacity(base) + queued("cellar") * 200 + queued("storehouse") * 150 + queued("coldstore") * 150;
  const fresh = st.food || 0;
  const s = wxSeason(state);
  const coming = winterActive(state, base) ? winterPlan(state, base).crops : 0;
  const outside = fresh > cap;
  if (outside || fresh + coming * 0.7 > cap * 0.9) {
    const why = outside ? `${Math.floor(fresh - cap)} food is stored outside and spoiling fast` : `room for the winter stock (${Math.floor(fresh)} in store, about ${Math.floor(coming)} still to come, room for ${cap})`;
    if (can("cellar")) add("cellar", why, outside);
    else if (s.key !== "summer" && can("coldstore")) add("coldstore", why, outside);
    else if (can("storehouse")) add("storehouse", why, outside);
  }
  if (can("smoker") && !count(base, "smoker") && people >= 4 && (outside || ((s.key === "summer" || s.key === "autumn") && fresh >= people * 20))) add("smoker", "dry the surplus for the winter");
  if (can("kitchen") && !count(base, "kitchen") && people >= 5 && (st.jars || 0) >= 8 && (st.parts || 0) >= 2 && (outside || (winterActive(state, base) && fresh >= people * 20))) add("kitchen", "jar the surplus for the winter");
  return out;
}

// ---------- crafting ----------
// Water filters a base wants: what its wells and streams would leave short on a dry, hot day (wells at 60%, the
// worst wellFactor; everyone drinking 1.5), 3 a filter (economy.js), up to 12: a big base outgrows its wells,
// and thirst kills faster than hunger. planCrafts queues them ahead of everything else.
function filtersWanted(state, base, n) {
  const p = waterProduction(state, base);
  const dry = ((p.own + p.stream + p.wells) / (p.factor || 1)) * 0.6;
  return Math.max(0, Math.min(12, Math.ceil((n * 1.5 - dry) / 3)));
}
const slotOf = (key) => (GEAR[key] ? GEAR[key].slot : null);
function planCrafts(state, base) {
  const q = craftQueue(base);
  const people = atBase(state, base.id);
  if (!people.length || q.length >= 4) return;
  const st = base.stock;
  const n = people.length;
  // Water first: a filter for the dry spell goes in ahead of everything else (and past a full queue of three).
  const fw0 = filtersWanted(state, base, n);
  const f0 = [...base.armory, ...people.map((s) => s.gear.tool)].filter((it) => it && it.key === "waterfilter").length + q.filter((j) => j.recipe === "waterfilter").length;
  if (f0 < fw0 && (st.scrap || 0) >= 4 && canCraft(state, base, "waterfilter").ok) {
    queueCraft(state, base, "waterfilter");
    gov(state).stats.crafts++;
    say(state, `Queued ${GEAR.waterfilter.name} at ${base.name}: water for a dry spell (${f0 + 1} of ${fw0} filters).`);
    return;
  }
  if (q.length >= 3) return;
  const inQueue = (slot) => q.filter((j) => CRAFTS[j.recipe].gear && slotOf(CRAFTS[j.recipe].gear) === slot).length;
  const inArmory = (slot) => base.armory.filter((it) => slotOf(it.key) === slot).length;
  const lacking = (slot) => people.filter((s) => !s.gear[slot] || (slot === "weapon" && !gearEffect(s, s.gear.weapon).usable)).length - inArmory(slot) - inQueue(slot);
  // Cautious: past the essentials (a weapon, dressings, a water filter) gear is made only from scrap above the reserve.
  const rs = persona(state).reserves ? reserveStatus(state, base) : null;
  let floor = 0;
  const tryCraft = (keys, why, minScrap) => {
    for (const k of keys) {
      const r = CRAFTS[k];
      if (!r || (st.scrap || 0) - (r.in.scrap || 0) < Math.max(minScrap, floor)) continue;
      if (r.in.parts && (st.parts || 0) - r.in.parts < 2) continue;
      if (r.in.meds && (st.meds || 0) - r.in.meds < 3) continue;
      if (r.in.water && (st.water || 0) - r.in.water < 15) continue;
      if (!canCraft(state, base, k).ok) continue;
      queueCraft(state, base, k);
      gov(state).stats.crafts++;
      say(state, `Queued ${CRAFTS[k].name || GEAR[r.gear].name} at ${base.name}: ${why}.`);
      return true;
    }
    return false;
  };
  if (lacking("weapon") > 0 && tryCraft(["crossbow", "sawmachete", "spikedbat", "pipespear"], "someone has no usable weapon", 5)) return;
  if (((st.meds || 0) < Math.max(3, n / 2) || (rs && rs.meds.short)) && tryCraft(["dressings"], "meds are short", 5)) return;
  const filters = [...base.armory, ...people.map((s) => s.gear.tool)].filter((it) => it && it.key === "waterfilter").length + q.filter((j) => j.recipe === "waterfilter").length;
  if (rs && rs.water.short && filters < (base.type === "hub" ? 2 : 1) && tryCraft(["waterfilter"], "water is below the reserve", 4)) return;
  if (rs) floor = rs.scrap.target;
  if (lacking("armor") > 0 && tryCraft(["scrapvest", "tirevest"], "someone has no body armor", 35)) return;
  if ((st.water || 0) < n * 6 && filters < (base.type === "hub" ? 2 : 1) && tryCraft(["waterfilter"], "the well cannot keep up (and clean water means less dysentery)", 15)) return;
  const scav = people.filter((s) => s.role === "scavenge");
  if (scav.length >= 2 && !scav.some((s) => s.gear.tool) && !base.armory.some((it) => it.key === "crowbar") && tryCraft(["crowbar"], "better base scavenging", 45)) return;
  if (lacking("backpack") > n - 2 && tryCraft(["backpack"], "packs: more to carry on trips", 55)) return;
  if (lacking("arms") > 0 && tryCraft(["padding"], "cheap arm guards", 65)) return;
  if (lacking("legs") > 0) tryCraft(["shinguards"], "cheap shin guards", 65);
}

// ---------- gear from the armory ----------
function itemScore(s, item) {
  if (!item || !GEAR[item.key]) return 0;
  const d = GEAR[item.key];
  if (d.slot === "weapon") {
    const eff = gearEffect(s, item);
    return eff.usable ? 0.5 + d.power * eff.mult * (item.quality || 1) : -1;
  }
  if (d.slot === "backpack") return d.carry || 0;
  return d.power || 0;
}

function equipFromArmory(state, base) {
  if (!base.armory.length) return;
  const people = atBase(state, base.id).filter((s) => !s.pinned).sort((a, b) => combatPower(b) - combatPower(a)); // pinned people keep their kit too
  if (!people.length) return;
  const handed = [];
  for (const slot of ["weapon", "armor", "head", "arms", "legs", "backpack"]) {
    for (const s of people) {
      ensureInv(s);
      const items = base.armory.filter((it) => slotOf(it.key) === slot);
      if (!items.length) break;
      const best = items.sort((a, b) => itemScore(s, b) - itemScore(s, a))[0];
      if (itemScore(s, best) < itemScore(s, s.gear[slot]) + (s.gear[slot] ? 0.3 : 0.05)) continue; // only real upgrades
      base.armory.splice(base.armory.indexOf(best), 1);
      if (s.gear[slot]) base.armory.push(s.gear[slot]);
      s.gear[slot] = best;
      handed.push(`${first(s)} ${best.name}`);
    }
  }
  // Tools for the off hand: a crowbar to a scavenger, a med kit to a medic (else the best Medicine), anything
  // else to whoever has the skill for it. Water filters work from the armory and stay there.
  for (const item of [...base.armory]) {
    const d = GEAR[item.key];
    if (!d || d.slot !== "tool" || d.water) continue;
    const forScav = !!(d.bonus && d.bonus.scavenging);
    const free = people.filter((s) => !s.gear.tool && (!d.skill || gearEffect(s, item).usable) && (!forScav || s.role === "scavenge"));
    if (!free.length) continue;
    const want = forScav ? (s) => skill(s, "scavenging") : d.medKit ? (s) => (s.role === "medic" ? 20 : 0) + skill(s, "medicine") : (s) => (d.skill ? skill(s, d.skill) : 0);
    const s = free.sort((a, b) => want(b) - want(a))[0];
    base.armory.splice(base.armory.indexOf(item), 1);
    s.gear.tool = item;
    handed.push(`${first(s)} ${item.name}`);
  }
  if (handed.length) {
    gov(state).stats.equipped += handed.length;
    say(state, `Gear handed out at ${base.name}: ${handed.join(", ")}.`);
  }
}

// ---------- medicine ----------
function planTreatment(state, base) {
  const g = gov(state);
  const people = atBase(state, base.id);
  const hurt = people.filter((s) => s.woundInfected || s.health < 50)
    .sort((a, b) => careNeed(b) - careNeed(a)); // worst off first (medical.careNeed, the same order as beds and night care)
  for (const s of hurt) {
    if (g.treated[s.id] != null && state.hour - g.treated[s.id] < 12) continue;
    const info = treatAtBaseInfo(state, base, s);
    if (!info.ok) continue;
    const reserve = s.woundInfected || s.health < 30 ? 0 : Math.ceil(people.length / 4) + 1;
    if ((base.stock.meds || 0) - info.cost < reserve) continue;
    const msg = treatAtBase(state, base, s.id);
    g.treated[s.id] = state.hour;
    g.stats.treated++;
    say(state, msg, "good");
  }
  // Illness and work injuries (health.js): anything that can kill at once, the rest while meds allow.
  const reserve = Math.ceil(people.length / 4) + 1;
  base.medsReserve = reserve; // the base's own daily treatment keeps this many back too
  const sick = [];
  for (const s of people) for (const c of conditionsOf(s)) sick.push({ s, c, d: CONDITIONS[c.key] });
  sick.sort((a, b) => b.d.hp * b.c.sev - a.d.hp * a.c.sev || b.c.sev - a.c.sev);
  for (const { s, c, d } of sick) {
    const urgent = c.key === "pneumonia" || d.hp * c.sev / 100 >= 5 || (c.key === "cut" && !s.woundInfected);
    if (!urgent && c.sev < 35) continue;
    const info = treatConditionInfo(state, base, s, c.key);
    if (!info.ok || (base.stock.meds || 0) - info.cost < (urgent ? 0 : reserve)) continue;
    say(state, treatCondition(state, base, s.id, c.key), "good");
    g.stats.treated++;
  }
}

// ======================================================================================
// Daily trips
// ======================================================================================
// What the player knows about a tile right now (live view or the last report), or null.
const intel = (state, id) => state.knowledge[id] || null;

// Tiles the player knows to hold another group's base: seen there (in view or in the last report), or the main
// base of a group you know (the Groups tab shows where that is). Never the real list of bases: the governor
// plays with the same knowledge as you.
let knownBasesMemo = { state: null, hour: -1, map: null };
function knownGroupBases(state) {
  if (knownBasesMemo.state === state && knownBasesMemo.hour === state.hour) return knownBasesMemo.map;
  const map = new Map();
  for (const f of state.factions) if (f.alive && f.known && f.bases.length) map.set(f.bases[0], f);
  for (let id = 0; id < state.knowledge.length; id++) {
    const k = state.knowledge[id];
    if (!k || k.factionBase == null) continue;
    const f = factionById(state, k.factionBase);
    if (f && f.alive) map.set(id, f);
  }
  knownBasesMemo = { state, hour: state.hour, map };
  return map;
}

// The area is picked over: fewer than EMPTY_SITES sites within the style's range believed to hold 30%+ loot.
export const EMPTY_SITES = 3, EMPTY_RING = 8, EMPTY_REACH = 1.6;

// Value of scavenging a site for what the hub needs, from what the player knows. null = do not go.
function siteScore(state, id, need, P) {
  const t = state.tiles[id];
  if (!t || t.terrain === "water" || state.bases.some((b) => b.tile === id)) return null;
  const k = intel(state, id);
  if (k && k.factionBase) return null;
  if (knownGroupBases(state).has(id)) return null;
  const owner = k && typeof k.owner === "number" ? factionById(state, k.owner) : null;
  const hostile = owner && owner.alive && attitude(owner) === "Hostile";
  if (hostile && !P.raid) return null;
  if (k && k.hordeSize > 0 && state.hour - k.hour < 72) return null;
  if (state.grid.neighbors(id).some((n) => { const s = intel(state, n); return s && s.hordeSize > 20 && state.hour - s.hour < 48; })) return null;
  const def = t.loc ? LOCATIONS[t.loc.type] : null;
  const memo = gov(state).visited[id];
  const kHour = k ? Math.max(k.hour, k.lootHour || 0) : -1; // radio news of a stripped site (aiscav.js) counts as a newer look
  let loot = memo && (!k || kHour <= memo.hour) ? memo.loot : k ? k.loot : def ? (def.richness || 0.5) * 0.9 : 0;
  if (memo && day(state) - memo.day < 6) loot *= 0.6; // just searched: the best is gone
  if (loot < 0.15) return null;
  const table = def ? def.loot : { scrap: 2, food: 1 };
  const total = Object.values(table).reduce((a, v) => a + v, 0) || 1;
  let value = 0;
  for (const [key, w] of Object.entries(table)) value += (w / total) * (need[key] || 0);
  if (def && def.gear && def.gear.some((gk) => slotOf(gk) === "weapon") && alive(state).some((s) => !s.gear.weapon)) value += 0.25;
  const danger = def ? (t.loc.zone === "town" || t.loc.zone === "rural" ? Math.min(1, def.danger ?? 1) : def.danger ?? 1) : 0;
  const infection = k ? k.infection : 0.3;
  const risk = danger * 0.12 + infection * 0.6 + (hostile ? 0.4 : 0) + (k ? 0 : 0.1);
  return { value: value * loot * Math.max(0.1, 1 - risk * P.riskAversion), loot, risk, hostile };
}

function planTrip(state) {
  const g = gov(state);
  const P = persona(state);
  const h = hub(state);
  if (!h) return;
  const today = day(state);
  const out = state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy");
  // Cautious: something below its reserve (reserveStatus) means trips come sooner, may go farther for it (trade
  // visits twice as far) and may take people 10 health below the style's minimum.
  const short = reserveShort(state, h);
  if (out.length >= P.maxTeams || today - g.lastLaunch < (short.length ? Math.min(P.cooldown, P.shortCooldown) : P.cooldown)) return;
  if (threatAt(state, h).urgent) return; // everyone stays to defend
  if (wxNow(state).severe) return; // no new trips into a storm or a blizzard (weather.js)
  const home = atBase(state, h.id);
  // Cautious: no trip while a horde in sight would break in, and P.homeHorde people stay home while one is in
  // sight or the defences are manned (a break-in is fought by whoever is there).
  const hz = P.reserves ? hordeThreat(state, h) : null;
  if (hz && hz.size && !holdCheck(state, h, hz.size, hz.bosses).holds) return;
  const hordeNear = hz && (hz.size > 0 || (h.hordeAlert && state.hour < h.hordeAlert));
  const keep = Math.max(2, Math.ceil(home.length * P.homeFrac), hordeNear ? Math.min(home.length, P.homeHorde) : 0);
  const pool = home.filter((s) => s.health >= P.minHealth - (short.length ? 10 : 0) && !s.woundInfected && !s.inBed && s.mood >= 20 && (!s.leader || home.length >= 9));
  const spareHands = Math.min(pool.length, home.length - keep);
  if (spareHands < 1) return;
  const need = needs(state);
  const cands = [];

  // Founding an outpost now and then. In the endgame (landPush: the coalition short of land with few hives left)
  // up to LAND_OUTPOSTS more, where they add the most land to the coalition.
  const outposts = state.bases.filter((b) => b.type === "outpost").length;
  const push = landPush(state);
  if (outposts < P.outposts + (push ? LAND_OUTPOSTS : 0) && alive(state).length >= P.outpostPop && today - g.lastOutpost >= 15 && (h.stock.scrap || 0) >= (push ? 25 : 50) && // the land push makes do with what founding takes
      (h.stock.food || 0) >= home.length * 10 && spareHands >= 2) {
    const land = push && outposts >= P.outposts ? landOutpostSite(state) : null;
    const site = land ? land.id : outpostSite(state);
    const crowded = alive(state).length > baseBeds(h) + 2;
    if (site != null) cands.push({ mission: "outpost", tile: site, score: land ? 3 : crowded ? 3.5 : 2.2, crew: spareHands >= 4 ? 3 : 2, reach: land ? 1.6 : 1,
      why: land ? `land for the coalition (+${land.gain} tiles)` : crowded ? "the hub is crowded: a new outpost" : "a new outpost", supplies: { scrap: 23 }, min: { scrap: 15 } });
  }
  // Your people held by another group.
  const held = allCaptives(state);
  if (P.rescue && held.length && today - g.lastRescue >= 8 && spareHands >= 3) {
    const f = factionById(state, held[0].location.factionId);
    if (f && f.alive && f.bases.length) {
      const ammo = Math.min(Math.max(0, (h.stock.ammo || 0) - 60), ransomValue(f, captivesAt(state, f.id)) * 2);
      cands.push({ mission: "rescue", tile: held[0].location.tile, score: 4, crew: 3, why: `get ${first(held[0])} back from ${f.name}`, supplies: { ammo } });
    }
  }
  // Finds the teams reported, our dead's gear, a vehicle left behind.
  for (const m of state.markers) {
    if (state.grid.distance(m.tile, h.tile) > P.range) continue;
    if (state.parties.some((p) => p.owner === "player" && p.dest === m.tile)) continue;
    if ((m.type === "cache" || m.type === "camp") && !(m.info && m.info.emptied)) cands.push({ mission: "investigate", tile: m.tile, score: m.type === "cache" ? 2.6 : 1.8, crew: 2, why: `check the ${m.label.toLowerCase()}` });
    if (m.type === "car" && !(m.info && m.info.emptied)) cands.push({ mission: "investigate", tile: m.tile, score: carsAtBase(state, h.id).length ? 1 : 2.2, crew: 2, why: "a wrecked car to restore or strip", supplies: { parts: 2, fuel: 6 } });
    if (m.type === "death" && m.info && m.info.items > 0) cands.push({ mission: "recover", tile: m.tile, score: Math.min(2.5, 0.8 + m.info.items * 0.3), crew: 2, why: "recover our dead's gear" });
    const lostBikes = m.type === "vehicle" && isBike(state.vehicles.find((x) => x.id === m.info?.vehicleId));
    if (lostBikes) cands.push({ mission: "getvehicle", tile: m.tile, score: 1.6, crew: 2, why: "bring our bikes home", supplies: { scrap: 1 } });
    else if (m.type === "vehicle" && !carsAtBase(state, h.id).length) {
      const bad = m.info && m.info.condition < 15;
      // It starts again only with 2 fuel between its tank and the team (no fuel to bring: no trip, not a wasted one).
      cands.push({ mission: "getvehicle", tile: m.tile, score: 2.4, crew: 2, why: "bring our vehicle home", supplies: { fuel: 12, parts: bad ? 1 : 0 }, min: { fuel: Math.max(0, 2 - ((m.info && m.info.fuel) || 0)) } });
    }
  }
  // A trade visit when the hub has goods to spare and a real need.
  if (P.tradeEvery && today - g.lastTrade >= (short.length ? Math.ceil(P.tradeEvery / 2) : P.tradeEvery) && !out.some((p) => p.mission === "trade")) {
    const goods = tradeGoods(state, need);
    if (goods && Object.values(need).some((v) => v >= 1.5)) {
      const f = state.factions.filter((x) => x.alive && x.known && x.bases.length && (attitude(x) === "Friendly" || attitude(x) === "Allied" || (attitude(x) === "Neutral" && !isAggressiveType(x))))
        .map((x) => ({ f: x, d: Math.min(...x.bases.map((b) => state.grid.distance(b, h.tile))) })).filter((x) => x.d <= P.range * (short.length ? 2 : 1))
        // The buyer that pays best for the load (trade.js goodsWorth: their kind and state), for the walk.
        .map((x) => ({ ...x, s: goodsWorth(state, x.f, goods) / (1 + x.d / 10) })).sort((a, b) => b.s - a.s || a.d - b.d)[0];
      if (f) cands.push({ mission: "trade", tile: f.f.bases.find((b) => state.grid.distance(b, h.tile) === f.d), score: 1.6, crew: 2, why: `trade with ${f.f.name}`, supplies: goods, reach: short.length ? P.shortReach : 1 });
    }
  }
  // An envoy (every style from day ENVOY_FROM): a known group out of radio reach that is not in the coalition gets
  // a visit with gifts every ENVOY_EVERY days (goodwill, a pact, a job at the gates, the invitation: handleTrade).
  const envoy = envoyCandidate(state, need);
  if (envoy) cands.push(envoy);
  // The war on the hives (every style once past its hiveFrom day): a squad of six against a known hive it can beat,
  // with fires first when that is what it takes (hiveCandidate). A hive mission may take more of the hub than the
  // style's homeFrac (the squad is back in days), but never leaves fewer than HIVE_KEEP at home.
  if (!out.some((p) => p.mission === "hive")) {
    const hc = hiveCandidate(state, home, pool);
    if (hc) cands.push(hc);
  }
  // Scavenging: the best known sites for what the hub needs.
  // Cautious, short of something: sites that have it may be farther out (shortReach), the most dangerous (risk
  // above 0.8) are left alone, and the crew is the full three.
  // As the area empties (other groups strip sites too and nothing grows back, aiscav.js): with fewer than
  // EMPTY_SITES sites near home it believes still hold loot (30%+), it looks EMPTY_RING tiles farther out and allows
  // trips EMPTY_REACH × as long.
  const sites = [];
  const gives = (t) => { const table = t.loc ? LOCATIONS[t.loc.type].loot : {}; return short.some((k) => (table[k] || 0) >= 1); };
  const radius = P.range + 5 + (short.length ? 4 : 0);
  const scan = (r, outer) => {
    for (const id of state.grid.within(h.tile, r)) {
      const t = state.tiles[id];
      if (!t.loc || id === h.tile || (outer && state.grid.distance(id, h.tile) <= radius)) continue;
      if (state.parties.some((p) => p.owner === "player" && (p.dest === id || (p.ap && p.ap.tile === id)))) continue;
      const s = siteScore(state, id, need, P);
      if (!s || s.value <= 0.05 || (P.reserves && s.risk > 0.8)) continue;
      const far = short.length && gives(t);
      sites.push({ mission: "scavenge", tile: id, score: (s.value * 4) / (1 + state.grid.distance(id, h.tile) / 6), crew: s.risk > 0.45 || s.hostile || far || outer ? 3 : P.crew,
        why: outer ? `${needText(need, t)} (the sites nearer home are picked over)` : needText(need, t), reach: Math.max(far ? P.shortReach : 1, outer ? EMPTY_REACH : 1),
        known: !!intel(state, id), gives: far, loot: s.loot, outer });
    }
  };
  scan(radius, false);
  const stocked = sites.filter((x) => x.loot >= 0.3 && state.grid.distance(x.tile, h.tile) <= P.range).length;
  if (stocked < EMPTY_SITES) scan(radius + EMPTY_RING, true);
  sites.sort((a, b) => b.score - a.score);
  cands.push(...sites.slice(0, P.reserves ? 16 : 6)); // Cautious looks further down the list: the best may be out of reach
  // Cautious: short of something no known site offers: a recon to the nearest unknown site that should have it
  // (the team looks around first and searches it if it is worth it: teamAct).
  if (short.length && !sites.some((x) => x.known && x.gives)) {
    const target = sites.filter((x) => !x.known && x.gives).sort((a, b) => state.grid.distance(a.tile, h.tile) - state.grid.distance(b.tile, h.tile))[0];
    if (target && cands.includes(target)) cands.splice(cands.indexOf(target), 1); // a look first instead of going straight in
    if (target) cands.push({ ...target, mission: "recon", why: `look for ${short.filter((k) => gives(state.tiles[target.tile]) && (LOCATIONS[state.tiles[target.tile].loc.type].loot[k] || 0) >= 1).join(" and ")} (none known nearby)` });
  }
  cands.push(...jobTripCands(state)); // jobs.js: scouting, fetching a package, a horde to cull (Aggressive)
  cands.sort((a, b) => b.score - a.score);

  for (const c of cands.slice(0, P.reserves ? 20 : 8)) {
    const res = launchTrip(state, c, pool, c.mission === "hive" ? HIVE_SQUAD : spareHands); // hiveCandidate checked who stays home
    if (!res) continue;
    if (c.outer) g.stats.farTrips = (g.stats.farTrips || 0) + 1;
    g.lastLaunch = today;
    if (c.mission === "outpost") g.lastOutpost = today;
    if (c.mission === "rescue") g.lastRescue = today;
    if (c.mission === "trade" && !c.envoy) g.lastTrade = today;
    if (c.envoy) { (g.lastEnvoy = g.lastEnvoy || {})[c.envoy] = today; res.apEnvoy = c.envoy; }
    if (c.mission === "hive") g.lastHive = today;
    return;
  }
}

// ---------- envoys (alliance.js) ----------
// The coalition needs every group in it, and the radio reaches only 12 tiles from the hub (more with relays at
// outposts): a group out of reach is courted in person. Two people take the hub's surplus (food, ammo, meds) to
// the nearest such group that is not hostile and not a member, at most one envoy out and one visit per group every
// ENVOY_EVERY days; at their gates the team gives what it brought as a gift while their goodwill is short (up to
// 15 goodwill a day), proposes a pact and invites them once they qualify (handleTrade). A team at their gates
// also hears of jobs (jobs.js), and a job done for them is what the invitation needs without a council.
const ENVOY_FROM = 40, ENVOY_EVERY = 20, ENVOY_REACH = 2;
function envoyGoods(state) {
  const h = hub(state);
  const n = Math.max(1, atBase(state, h.id).length);
  const goods = {};
  if ((h.stock.food || 0) > n * 30 + 20) goods.food = Math.min(20, Math.floor(h.stock.food - n * 30));
  if ((h.stock.ammo || 0) > n * 15 + 100) goods.ammo = Math.min(60, Math.floor(h.stock.ammo - n * 15 - 60));
  if ((h.stock.meds || 0) > n + 8) goods.meds = Math.min(4, Math.floor(h.stock.meds - n - 6));
  const value = Object.entries(goods).reduce((a, [k, q]) => a + q * SUPPLIES[k].value, 0);
  return value >= 40 ? goods : null;
}
function envoyCandidate(state, need) {
  const g = gov(state);
  const P = persona(state);
  const h = hub(state);
  const today = day(state);
  if (today < ENVOY_FROM || state.parties.some((p) => p.owner === "player" && p.apEnvoy)) return null;
  const goods = envoyGoods(state);
  const last = g.lastEnvoy || {};
  const f = state.factions
    .filter((x) => x.alive && x.known && x.bases.length && !isMember(state, x) && attitude(x) !== "Hostile" && !canRadioGroup(state, x) &&
      today - (last[x.id] ?? -99) >= ENVOY_EVERY)
    .map((x) => ({ x, d: Math.min(...x.bases.map((b) => state.grid.distance(b, h.tile))) }))
    .filter((o) => o.d <= P.range * ENVOY_REACH).sort((a, b) => a.d - b.d)[0];
  if (!f) return null;
  // Gifts while their goodwill is short; a group that trusts you already only needs the visit (the invitation).
  const courted = f.x.goodwill >= ALLIANCE.GOODWILL && f.x.pact;
  if (!courted && !goods) return null;
  return { mission: "trade", tile: f.x.bases.find((b) => state.grid.distance(b, h.tile) === f.d), score: courted ? 3 : 2.2, crew: 2, envoy: f.x.id, reach: ENVOY_REACH,
    why: `an envoy to ${f.x.name} (goodwill ${Math.round(f.x.goodwill)}${f.x.pact ? "" : ", no pact"}): ${courted ? "the invitation to the coalition" : "gifts and talk for the coalition"}`, supplies: courted ? {} : goods };
}

// ---------- the war on the hives (hives.js) ----------
// The odds are judged as the hive card shows them: the squad (stormValue) against the brood it expects
// (hives.js broodForce from the guard last seen at the mound, HIVE_GUESS if it was never seen up close; the
// fighters coalition members and job givers send take their share, alliance.js hiveAllies). The ratio squad
// value (stormValue) / (brood × its power / 5.2) it wants is the style's hiveOdds (calibrated against the battle
// played by the AI on both sides: about 1.3 costs a fighter in three storms, 1.1 about one a storm, 0.9 two or
// three and sometimes the squad). Fires around the mound (6 fuel each, up to hiveFires) burn
// 30% of the guard first when that is what it takes. Targets: known hives, nearest first, ahead of them those
// within 12 tiles of one of your bases (their hordes hit you first), those a group asked you to storm (their
// fighters join) and those with a small guard.
const HIVE_GUESS = 100;  // guard assumed at a hive never seen up close
const HIVE_SQUAD = 6;    // a storm is six fighters
const HIVE_KEEP = 3;     // people a hive mission leaves at the hub at least
const HIVE_HEALTH = 80;  // fit to storm a hive
const FIRE_FUEL = 6;     // hives.js "Set fires around it"
const HIVE_AMMO = 12;    // ammo a fighter wants for a storm
const FIRE_CUT = 0.7;    // the guard left after a fire
const knownHive = (state, id) => (state.live.has(id) ? state.tiles[id].hive : !!(state.knowledge[id] && state.knowledge[id].hive));
// A fighter's worth in a storm, as the tactical battle plays it (combat.js playerUnit): the hit chance times the
// damage of the gun they can use (an assault rifle below its Shooting 10 misses a lot more than its combat
// power suggests), more with armor, less when hurt. Melee counts for little: the brood is deadly up close.
// About 2 for a shotgun and a vest at Shooting 6, 1 for a pistol at Shooting 4.
function stormValue(s) {
  const item = s.gear.weapon;
  const eff = gearEffect(s, item);
  const key = item && eff.usable && WEAPONS[item.key] ? item.key : "fists";
  const w = WEAPONS[key];
  const mult = key === "fists" ? 1 : eff.mult;
  const dmg = ((w.dmg[0] + w.dmg[1]) / 2) * (0.6 + 0.4 * mult) * (0.75 + 0.25 * (key === "fists" ? 1 : item.quality || 1));
  const hit = w.melee ? 0.2 : Math.max(0.05, Math.min(0.95, (40 + skill(s, "shooting") * 2.5 - (1 - mult) * 30 + (w.aim || 0) + (s.traits.includes("brave") ? 5 : 0) - (s.traits.includes("coward") ? 5 : 0)) / 100));
  return ((hit * dmg) / 10) * (0.5 + s.health / 200) * Math.sqrt(1 / Math.max(0.3, armorMult(s)));
}
const hiveSquad = (pool) => [...pool].filter((s) => s.health >= HIVE_HEALTH && !s.woundInfected).sort((a, b) => stormValue(b) - stormValue(a)).slice(0, HIVE_SQUAD);
const squadPower = (list) => list.reduce((a, s) => a + stormValue(s), 0);
// The guard you know of at a hive: what is in sight there now, else the last look (never below the 40 a hive
// rebuilds its guard to), else a guess.
function knownGuard(state, id) {
  if (state.live.has(id)) return Math.max(HIVE_GUARD_MIN, snapshot(state, id).hordeSize);
  const k = state.knowledge[id];
  return k && k.hordeSize ? Math.max(HIVE_GUARD_MIN, k.hordeSize) : HIVE_GUESS;
}
const HIVE_GUARD_MIN = 40;
// Squad power over the brood's strength after `fires` fires, with the allies' fighters off.
function stormRatio(state, hive, power, guard, fires) {
  const f = broodForce(Math.round(guard * FIRE_CUT ** fires));
  const count = broodAfterAllies(f.count, hiveAllies(state, hive).fighters);
  return power / (count * (f.power / 5.2));
}
// Fewest fires that bring the odds up to the style's margin (null: not even with every fire it may set).
function firesNeeded(state, hive, power, guard, maxFires) {
  const P = persona(state);
  for (let n = 0; n <= maxFires; n++) if (stormRatio(state, hive, power, guard, n) >= P.hiveOdds) return n;
  return null;
}
// planTrip's hive candidate (null: none this morning).
function hiveCandidate(state, home, pool) {
  const P = persona(state);
  const g = gov(state);
  const h = hub(state);
  const today = day(state);
  if (today < P.hiveFrom || today - (g.lastHive ?? -99) < P.hiveRest) return null;
  if (home.length - HIVE_SQUAD < Math.max(HIVE_KEEP, Math.ceil(home.length * P.homeFrac * 0.6))) return null;
  const squad = hiveSquad(pool);
  if (squad.length < HIVE_SQUAD || (h.stock.ammo || 0) < HIVE_SQUAD * HIVE_AMMO + 20) return null;
  const power = squadPower(squad);
  const fuel = Math.max(0, Math.floor(((h.stock.fuel || 0) - 4) / FIRE_FUEL));
  const jobs = new Set(activeJobs(state).filter((j) => j.type === "hive").map((j) => j.target));
  let best = null;
  for (const hive of state.hives || []) {
    if (!knownHive(state, hive.tile)) continue; // the governor plays by what you know
    const d = state.grid.distance(hive.tile, h.tile);
    if (d > 60) continue;
    const guard = knownGuard(state, hive.tile);
    const fires = firesNeeded(state, hive, power, guard, Math.min(P.hiveFires, fuel));
    if (fires == null) continue;
    const nearBase = state.bases.some((b) => state.grid.distance(b.tile, hive.tile) <= 12);
    const score = (jobs.has(hive.tile) ? 3 : 0) + (nearBase ? 2 : 0) - d / 8 - fires * 0.5;
    if (!best || score > best.score) best = { hive, fires, score, d, guard };
  }
  if (!best) return null;
  const ratio = stormRatio(state, best.hive, power, best.guard, best.fires);
  return { mission: "hive", tile: best.hive.tile, score: 6, crew: HIVE_SQUAD, hive: true,
    why: `destroy ${best.hive.name} (squad ${power.toFixed(1)} against the brood's ${(power / ratio).toFixed(1)}${best.fires ? ` after ${best.fires} fire${best.fires > 1 ? "s" : ""}` : ""})`,
    supplies: { ammo: 80, meds: 4, fuel: best.fires * FIRE_FUEL }, min: { fuel: best.fires * FIRE_FUEL }, fires: best.fires };
}
// The hive card (hives.js): storm when the odds are there, else set fires while that helps and the fuel lasts
// (the team then storms on its next orders: teamAct), else back off.
function hiveChoice(state, card, opts, p, find) {
  const P = persona(state);
  const hive = p ? hiveAt(state, partyTile(p)) : null;
  if (!hive) return find(/^Back off/);
  const fit = partyMembers(state, p).filter((s) => s.health >= 60);
  const power = squadPower(fit);
  const guard = hiveForce(state, hive).guard; // the card says how many are packed around it
  const fired = p.apFires || 0;
  // Guns need ammo (an assault rifle 2 a shot): no storm with less than HIVE_AMMO a fighter.
  const ammo = (p.supplies.ammo || 0) + ((p.cargo && p.cargo.supplies && p.cargo.supplies.ammo) || 0);
  if (ammo < fit.length * HIVE_AMMO) return find(/^Back off/);
  if (fit.length >= HIVE_SQUAD - 1 && stormRatio(state, hive, power, guard, 0) >= P.hiveOdds) return find(/^Storm the hive/);
  const fire = find(/^Set fires/);
  const fuelHome = p.vehicle ? p.apFuelHome || 0 : 0;
  const canFire = fire && !isDisabled(state, fire) && partyFuelOf(state, p) - FIRE_FUEL >= fuelHome && fired < P.hiveFires;
  // Fires only when the storm comes within reach with the fires the team can still set.
  const left = Math.min(P.hiveFires - fired, Math.floor((partyFuelOf(state, p) - fuelHome) / FIRE_FUEL));
  if (canFire && fit.length >= HIVE_SQUAD - 1 && guard >= HIVE_GUARD_MIN && firesNeeded(state, hive, power, guard, left) != null) {
    p.apFires = fired + 1;
    p.apHiveAgain = true;
    return fire;
  }
  return find(/^Back off/);
}
// After the fires: the team storms (or sets the next fire) when it is still fit for it.
function hiveAgain(state, p) {
  if (!p.apHiveAgain) return false;
  delete p.apHiveAgain;
  const tile = partyTile(p);
  if (!hiveAt(state, tile) || partyMembers(state, p).filter((s) => s.health >= 60).length < HIVE_SQUAD - 1) return false;
  if (!orderOptions(state, p).some((o) => o.mission === "hive" && !o.disabled)) return false;
  startOrder(state, p, { type: "mission", mission: "hive" });
  return true;
}
// A job to storm a hive (jobs.js): taken when the governor would storm it anyway, with the givers' fighters along.
function hiveJobOk(state, job) {
  const P = persona(state);
  const h = hub(state);
  const hive = hiveAt(state, job.target);
  if (!hive || day(state) < P.hiveFrom - 30) return false;
  const home = atBase(state, h.id);
  const squad = hiveSquad(home);
  if (squad.length < HIVE_SQUAD) return false;
  const f = factionById(state, job.fid);
  const extra = f ? Math.max(1, Math.min(3, Math.round(f.pop / 10))) : 0; // their fighters once the job is taken
  const base = broodForce(Math.round(knownGuard(state, hive.tile) * FIRE_CUT ** Math.min(P.hiveFires, Math.floor(((h.stock.fuel || 0) - 4) / FIRE_FUEL))));
  const count = broodAfterAllies(base.count, hiveAllies(state, hive).fighters + extra);
  return squadPower(squad) / (count * (base.power / 5.2)) >= P.hiveOdds && state.grid.distance(h.tile, hive.tile) <= 40;
}

const captivesAt = (state, factionId) => allCaptives(state).filter((s) => s.location.factionId === factionId).length;

function needText(need, t) {
  const table = t.loc ? LOCATIONS[t.loc.type].loot : {};
  const top = Object.keys(table).filter((k) => need[k] >= 1).sort((a, b) => need[b] * table[b] - need[a] * table[a]).slice(0, 2);
  return top.length ? `the hub needs ${top.join(" and ")}` : "supplies";
}

// What a trade team can carry to sell: hub surplus of light, valuable goods.
function tradeGoods(state, need) {
  const h = hub(state);
  const n = Math.max(1, atBase(state, h.id).length);
  const goods = {};
  if (need.ammo <= 0.35 && (h.stock.ammo || 0) > n * 40 + 100) goods.ammo = Math.floor(Math.min(300, h.stock.ammo - n * 40));
  if (need.food <= 0.6 && (h.stock.food || 0) > n * 30) goods.food = Math.floor(Math.min(16, h.stock.food - n * 30));
  if (need.meds <= 0.3 && (h.stock.meds || 0) > n * 2 + 4) goods.meds = Math.floor(Math.min(6, h.stock.meds - n * 2));
  if (persona(state).reserves) {
    // Cautious: what is well above its reserve goes to market (parts, and food beyond the food planner's target).
    const rs = reserveStatus(state, h);
    if ((h.stock.parts || 0) > rs.parts.target + 4) goods.parts = Math.floor(Math.min(10, h.stock.parts - rs.parts.target - 2));
    const keepFood = n * (foodTarget(state, h) * 1.2 + 10);
    if (need.food <= 0.6 && (h.stock.food || 0) > keepFood + 10) goods.food = Math.floor(Math.min(40, h.stock.food - keepFood));
  }
  const value = Object.entries(goods).reduce((a, [k, q]) => a + q * SUPPLIES[k].value, 0);
  return value >= 50 ? goods : null;
}

// The alliance victory (alliance.js) needs over half the land held by you and the members. Once the coalition
// has a member, few hives are left (LAND_HIVES or fewer known to stand: the Goals panel's count) and the land is
// short, the governor founds outposts where they add the most uncovered land (CONTROL_RANGE around each), away
// from hives and other groups' bases.
const LAND_OUTPOSTS = 3, LAND_HIVES = 3, LAND_MIN_GAIN = 40, LAND_REACH = 16;
function landPush(state) {
  const gp = goalsProgress(state);
  return gp.alliance.members > 0 && !gp.alliance.landOk && gp.hives.left <= LAND_HIVES && alive(state).length >= 14;
}
function landOutpostSite(state) {
  const h = hub(state);
  const g = state.grid;
  const R = ALLIANCE.CONTROL_RANGE;
  const held = new Uint8Array(state.tiles.length);
  for (const c of [...state.bases.map((b) => b.tile), ...allianceMembers(state).flatMap((f) => f.bases)]) for (const id of g.within(c, R)) held[id] = 1;
  const theirs = [...knownGroupBases(state).keys()];
  const hives = (state.hives || []).filter((hv) => knownHive(state, hv.tile)).map((hv) => hv.tile);
  let best = null;
  for (const id of g.within(h.tile, LAND_REACH)) {
    const t = state.tiles[id];
    if (held[id] || t.terrain === "water" || t.terrain === "mountain") continue;
    const k = intel(state, id);
    if (!k || (k.owner != null && k.owner !== "player") || k.factionBase || k.infection > 0.4 || k.hordeSize > 0) continue;
    if (theirs.some((b) => g.distance(b, id) <= 3) || hives.some((x) => g.distance(x, id) <= 6)) continue;
    const gain = g.within(id, R).filter((x) => !held[x] && state.tiles[x].terrain !== "water").length;
    if (gain < LAND_MIN_GAIN) continue;
    const score = gain - g.distance(id, h.tile) * 3 + (t.loc && t.loc.type === "farm" ? 10 : 0);
    if ((!best || score > best.score) && planPath(state, h.tile, id, false)) best = { id, gain, score };
  }
  return best;
}
function outpostSite(state) {
  const h = hub(state);
  const g = state.grid;
  const theirs = [...knownGroupBases(state).keys()]; // only bases you know about keep an outpost away
  let best = null;
  for (const id of g.within(h.tile, 7)) {
    const d = g.distance(id, h.tile);
    const t = state.tiles[id];
    if (d < 3 || t.terrain === "water" || t.terrain === "mountain") continue;
    if (state.bases.some((b) => g.distance(b.tile, id) < 3)) continue;
    const k = intel(state, id);
    if (!k || (k.owner != null && k.owner !== "player") || k.factionBase || k.infection > 0.3 || k.hordeSize > 0) continue;
    if (theirs.some((b) => g.distance(b, id) <= 6)) continue;
    if (!planPath(state, h.tile, id, false)) continue;
    const farm = t.loc && t.loc.type === "farm" ? 1.3 : t.terrain === "plains" ? 1.3 : t.terrain === "forest" ? 0.8 : t.terrain === "hills" ? 0.7 : 1;
    const score = farm + (t.loc ? 0.5 : 0) + (t.road ? 0.4 : 0) - d * 0.05 - k.infection;
    if (!best || score > best.score) best = { id, score };
  }
  return best ? best.id : null;
}

// Pick the crew, a vehicle if it pays, pack supplies and send the team. Returns the party or null.
function launchTrip(state, c, pool, spareHands) {
  const P = persona(state);
  const h = hub(state);
  const g = gov(state);
  const size = Math.min(c.crew, spareHands);
  if (size < (c.mission === "rescue" ? 3 : c.mission === "outpost" ? 2 : c.mission === "hive" ? HIVE_SQUAD : 1)) return null;
  const fit = c.mission === "hive" ? (s) => (s.health >= HIVE_HEALTH && !s.woundInfected ? stormValue(s) * 5 + skill(s, "stealth") * 0.05 : -99) : (s) => combatPower(s) + skill(s, "scavenging") * 0.25 + skill(s, "stealth") * 0.15 + skill(s, "scouting") * 0.15 +
    (c.mission === "trade" ? skill(s, "speech") * 0.5 : 0) + (c.mission === "rescue" ? skill(s, "stealth") * 0.3 + skill(s, "speech") * 0.2 : 0) +
    (c.mission === "outpost" ? skill(s, "farming") * 0.4 : 0) - (s.role === "medic" ? 3 : 0) - (s.role === "build" ? 1.5 : 0);
  const crew = friendlyCrew(state, [...pool].sort((a, b) => fit(b) - fit(a)), size, fit); // near-equal picks: friends together, rivals apart (relations.js)
  const ids = crew.map((s) => s.id);
  const dist = state.grid.distance(h.tile, c.tile);
  // A vehicle for longer trips if it can make the round trip.
  let v = null;
  const cand = carsAtBase(state, h.id).filter((x) => x.condition > 0).sort((a, b) => b.condition - a.condition)[0];
  // The vehicle is repaired and refuelled for the estimate; if the trip is called off, the parts and the fuel
  // go back (a trip that never leaves costs nothing). Armor left home for the trip goes back on too.
  const before = cand ? { condition: cand.condition, fuel: cand.fuel, parts: h.stock.parts, hubFuel: h.stock.fuel } : null;
  const stashed = []; // [survivor, armor] left at the hub for this trip
  const off = () => {
    if (before) { cand.condition = before.condition; cand.fuel = before.fuel; h.stock.parts = before.parts; h.stock.fuel = before.hubFuel; }
    for (const [s, a] of stashed) { const i = h.armory.indexOf(a); if (i >= 0 && !s.gear.armor) { h.armory.splice(i, 1); s.gear.armor = a; } }
    stashed.length = 0;
    return null;
  };
  const n = ids.length;
  if (cand && dist >= 3 && c.mission !== "outpost" && c.mission !== "rescue") {
    if (cand.condition < 50 && (h.stock.parts || 0) >= 2 && canRepair(state, h).ok) repair(state, h, cand);
    const vEst = cand.condition >= 30 && estimateTrip(state, { memberIds: ids, dest: c.tile, vehicle: true, v: cand, stance: P.stance, supplies: roughSupplies(n, 2) });
    if (vEst && vEst.fuel <= cand.fuel + Math.max(0, (h.stock.fuel || 0) - 4)) v = cand;
  }
  if (v) refuel(state, h, v);
  // No car: bikes, one each, for anything past the next couple of tiles (no fuel, faster on roads, racks for the haul).
  if (!v && dist >= 2 && c.mission !== "outpost" && c.mission !== "rescue" && bikesAtBase(state, h.id) >= n) {
    const stack = parkBikes(state, h);
    if (stack && stack.condition >= 25) v = stack;
  }
  const plannedV = isBike(v) ? { ...v, count: n } : v;
  const onSite = c.mission === "scavenge" ? P.searchHours + 4 + (P.reserves ? 2 : 0) : c.mission === "outpost" ? 0 : c.mission === "recon" ? P.searchHours + 8 : 4;
  // The estimate with what the team would pack (its load sets its pace and rations, load.js).
  const tripOpts = (supplies) => ({ memberIds: ids, dest: c.tile, vehicle: travelMode(v), v: plannedV, stance: P.stance, fuel: isCar(v) ? v.fuel + (h.stock.fuel || 0) : 0, supplies });
  let est = estimateTrip(state, tripOpts(roughSupplies(n, 2)));
  if (!est || est.hoursOut > (c.mission === "hive" ? 96 : P.maxHoursOut * (v ? 1.3 : 1) * (c.reach || 1))) return off();
  if (est.hours > 24 && severeSoon(state, 2)) return off(); // a long trip with a storm or blizzard forecast: wait it out
  let days = (est.hours + onSite) / 24;
  // Cautious: no trip of more than half a day with a storm or blizzard forecast while it is out.
  if (P.reserves && est.hours > 12 && severeSoon(state, Math.ceil(days) + 1)) return off();
  const stock = (k) => Math.floor(h.stock[k] || 0);
  const homeLeft = atBase(state, h.id).length - n;
  // A long search trip without a car: heavy body armor (7 kg and up) stays home while the team would leave Heavy.
  const looting = ["scavenge", "recon", "investigate", "recover", "getvehicle"].includes(c.mission);
  const worstBand = (e) => (e && e.load ? Math.max(-1, ...e.load.people.map((x) => x.band)) : -1);
  if (looting && !isCar(v) && est.hours > 24) {
    for (const s of [...crew].sort((a, b) => wornLoad(b) - wornLoad(a))) {
      if (worstBand(estimateTrip(state, tripOpts(roughSupplies(n, days)))) < 2) break;
      const a = s.gear.armor;
      if (a && (GEAR[a.key]?.weight || 0) >= 7) { s.gear.armor = null; h.armory.push(a); stashed.push([s, a]); }
    }
  }
  // On foot the team keeps its loot to a band (parties.js cargoRoom): Medium for the cautious, Heavy otherwise, so the
  // way home is not a crawl; the rations count the way back at that load.
  const haulBand = !v && looting ? (P.reserves ? 1 : 2) : null;
  const ration = (e) => {
    let r = e.food + (n * onSite) / 24; // the planner's rations (more on the move under a load) and the time on site
    if (haulBand != null) {
      const b = LOAD_BANDS[haulBand];
      const haulPace = (STANCES[P.stance]?.speed || 1) * (1 - b.slow);
      r += (n * e.hoursBack * Math.max(0, ((e.pace.footSpeed || 1) / haulPace) * (1 + b.eat) - e.pace.eatFoot / Math.max(1, n))) / 24;
    }
    return r;
  };
  const sup = {
    food: 0, water: 0,
    ammo: Math.min(Math.max(0, stock("ammo") - 20), 15 * n),
    meds: stock("meds") >= 4 ? Math.min(2, Math.ceil(n / 2)) : 0,
    fuel: 0,
  };
  // Weighed twice: what the team packs changes its load, and so its pace and what it eats.
  for (let pass = 0; pass < 2; pass++) {
    const r = ration(est);
    sup.food = Math.ceil(r * 1.25) + 1 + (c.mission === "outpost" ? 6 : 0);
    sup.water = Math.ceil(r * 1.25) + 1 + (c.mission === "outpost" ? 4 : 0);
    sup.fuel = isCar(v) ? Math.max(0, Math.min(stock("fuel"), Math.ceil(est.fuel * 1.25 - v.fuel))) : 0;
    if (pass === 0) est = estimateTrip(state, tripOpts({ ...sup, ...(c.supplies || {}) })) || est;
  }
  days = (est.hours + onSite) / 24;
  for (const [k, q] of Object.entries(c.supplies || {})) if (q > 0) sup[k] = (sup[k] || 0) + q;
  if (P.reserves) {
    // Cautious: a farther trip packs a quarter more food and water; the ammo above the hub's reserve goes along
    // (at least 6 a head, never the hub's last 20).
    if ((c.reach || 1) > 1) { sup.food = Math.ceil(sup.food * 1.25); sup.water = Math.ceil(sup.water * 1.25); }
    sup.ammo = Math.min(sup.ammo, Math.max(6 * n, stock("ammo") - reserveStatus(state, h).ammo.target));
  }
  if (sup.food > stock("food") - Math.max(0, homeLeft) * 2 || sup.water > stock("water") - Math.max(0, homeLeft) * 2) return off(); // the hub cannot spare it
  for (const k of Object.keys(sup)) sup[k] = Math.max(0, Math.min(sup[k], stock(k)));
  // Too heavy: less ammo, then drop the extras down to what the job needs (an outpost needs 15 scrap).
  const cap = carryCapacity(state, crew, plannedV);
  if (supplyLoad(sup) > cap) sup.ammo = Math.min(sup.ammo, 5 * n);
  // Not Overloaded unless it has to be: on foot, less ammo before anyone leaves Overloaded.
  if (!v && worstBand(estimateTrip(state, tripOpts(sup))) >= 3) sup.ammo = Math.min(sup.ammo, 5 * n);
  for (const [k, q] of Object.entries(c.supplies || {})) {
    const over = supplyLoad(sup) - cap;
    if (over > 0) sup[k] = Math.max((c.min && c.min[k]) || 0, sup[k] - Math.ceil(over / SUPPLIES[k].weight));
  }
  if (supplyLoad(sup) > cap) return off();
  for (const [k, q] of Object.entries(c.min || {})) if ((sup[k] || 0) < q) return off();
  const res = launchExpedition(state, { memberIds: ids, dest: c.tile, mission: c.mission, stance: P.stance, vehicleId: v ? v.id : null, supplies: sup });
  if (res.error) return off();
  if (!isCar(v) && before) { cand.condition = before.condition; cand.fuel = before.fuel; h.stock.parts = before.parts; h.stock.fuel = before.hubFuel; } // repaired or looked at, but the car stayed
  res.party.ap = { mission: c.mission, tile: c.tile, day: day(state) };
  if (haulBand != null) res.party.haulCap = Math.max(poolAtBand(crew, haulBand), supplyLoad(sup) + 6 * n);
  if (isCar(v)) res.party.apFuelHome = Math.ceil((est.fuel / 2) * 1.2); // hiveChoice: fires never burn the fuel for the drive home
  if (c.mission === "hive") g.stats.hiveTrips = (g.stats.hiveTrips || 0) + 1;
  g.stats.launched++;
  if (c.mission === "outpost") g.stats.outposts++;
  say(state, `Sent ${names(crew)} (${c.mission === "scavenge" ? "scavenge" : c.mission}) to ${tileLabel(state, c.tile)}${isBike(v) ? " on bikes" : v ? ` in the ${v.name}` : " on foot"}: ${c.why}. Back in about ${Math.ceil(days)} day${Math.ceil(days) === 1 ? "" : "s"}.${stashed.length ? ` Heavy armor left home for the walk: ${stashed.map(([x, a]) => `${first(x)}'s ${a.name}`).join(", ")}.` : ""}`);
  return res.party;
}

// Food and water for a first estimate: n people for `days` with a quarter more, and some ammo (load.js weighs it).
const roughSupplies = (n, days) => ({ food: Math.ceil(n * days * 1.25) + 1, water: Math.ceil(n * days * 1.25) + 1, ammo: 10 * n });

// ---------- supply runs to outposts ----------
function tidySupplyJobs(state) {
  for (const job of [...supplyRuns(state)]) {
    if (job.apMade && !jobParty(state, job) && (job.status === "done" || job.status === "disbanded")) deleteSupplyRun(state, job);
  }
}

// An outpost about to run dry: under 5 days of water at today's rate, or under 3 a head with the spring not keeping up.
function outpostThirsty(state, o) {
  const wo = waterOutlook(state, o);
  const staff = atBase(state, o.id).length;
  return wo.net < 0.5 && (wo.daysLeft < 5 || (o.stock.water || 0) < staff * 3);
}
function planSupplyRuns(state) {
  const h = hub(state);
  const g = gov(state);
  for (const o of state.bases.filter((b) => b.type === "outpost")) {
    if (supplyRuns(state).some((j) => j.apMade && j.destId === o.id && (jobParty(state, j) || j.status === "waiting"))) continue;
    const home = atBase(state, h.id);
    // Like trips, supply runs leave the style's share of the hub at home.
    const spare = home.length - Math.max(2, Math.ceil(home.length * persona(state).homeFrac));
    if (spare < 1) continue;
    const crewPool = home.filter((s) => s.health >= 70 && !s.leader && !s.inBed && !s.woundInfected).sort((a, b) => combatPower(b) - combatPower(a));
    const staff = atBase(state, o.id).length;
    let form = null, why = "";
    if (staff < 2 && home.length >= 7 && crewPool.length) {
      const s = [...crewPool].sort((a, b) => skill(b, "farming") - skill(a, "farming"))[0];
      form = { crew: [s.id], deliver: [{ key: "food", qty: 6 }, { key: "scrap", qty: Math.min(8, Math.max(0, Math.floor((h.stock.scrap || 0) - 30))) }], atDest: "disband" };
      why = `${first(s)} joins the outpost (only ${staff} there)`;
    } else if (staff && outpostThirsty(state, o) && (h.stock.water || 0) - home.length * 5 >= 12 && crewPool.length) {
      // An outpost's spring gives 3 a day (less in a dry spell): water from the hub before anyone goes thirsty.
      const qty = Math.min(30, Math.floor((h.stock.water || 0) - home.length * 5));
      const crew = [];
      for (const s of crewPool) if (carryCapacity(state, crew, null) < qty * SUPPLIES.water.weight && crew.length < Math.min(spare, 2)) crew.push(s);
      const load = Math.min(qty, Math.floor(carryCapacity(state, crew, null) / SUPPLIES.water.weight));
      if (load >= 8) form = { crew: crew.map((s) => s.id), deliver: [{ key: "water", qty: load }], atDest: "return" };
      why = `${load} water (it is running dry)`;
    } else {
      const wish = buildWishes(state, o).find((w) => BUILDINGS[w.type] && canBuild(state, o, w.type).reason !== `Limit reached (${BUILDINGS[w.type].max})`);
      const scrap = wish ? BUILDINGS[wish.type].cost.scrap || 0 : 0;
      if (wish && (o.stock.scrap || 0) < scrap && (h.stock.scrap || 0) >= scrap + 25 && home.length >= 5 && crewPool.length >= 1) {
        const deliver = [{ key: "scrap", qty: scrap + 2 }];
        const parts = BUILDINGS[wish.type].cost.parts || 0; // a well needs a part too
        if (parts && (o.stock.parts || 0) < parts && (h.stock.parts || 0) >= parts + 2) deliver.push({ key: "parts", qty: parts });
        if ((o.stock.food || 0) < staff * 3) deliver.push({ key: "food", qty: 8 });
        // Enough hands to carry it (people stay home: at most a third of the hub goes).
        const load = deliver.reduce((a, l) => a + l.qty * SUPPLIES[l.key].weight, 0);
        const crew = [];
        for (const s of crewPool) if (carryCapacity(state, crew, null) < load && crew.length < Math.min(spare, Math.max(1, Math.floor(home.length / 3)))) crew.push(s);
        if (carryCapacity(state, crew, null) >= load) form = { crew: crew.map((s) => s.id), deliver, atDest: "return" };
        why = `scrap for a ${BUILDINGS[wish.type].name.toLowerCase()} (${wish.why})`;
      }
    }
    if (!form) continue;
    const res = saveSupplyRun(state, { jobId: null, originId: h.id, destId: o.id, vehicleId: null, pickup: [], schedule: "once", every: 5, stance: "normal", allowPartial: true, ...form });
    if (res.error) continue;
    res.job.apMade = true;
    dispatchSupplyRun(state, res.job, false); // logs why when it cannot leave
    if (res.job.partyId) {
      g.stats.supplyRuns++;
      say(state, `Supply run to ${o.name}: ${why}.`);
    } else deleteSupplyRun(state, res.job);
  }
}

// ---------- crew roles (crews.js, work.js) ----------
// The governor's judgement for one field team in a crew role's style, without its log lines (stewardCtx): what the
// hub needs, how good a site is, which answer a card gets, how to search and when to leave, a trade at the gates,
// an outpost running dry. The autopilot itself does not change.
function withStyle(style, fn) {
  const prev = stewardCtx;
  stewardCtx = { style: PERSONALITIES[style] ? style : "balanced" };
  try { return fn(); } finally { stewardCtx = prev; }
}
export const crewAI = {
  needs: (state, style) => withStyle(style, () => needs(state)),
  siteScore: (state, id, need, style) => withStyle(style, () => siteScore(state, id, need, persona(state))),
  needText,
  tradeGoods: (state, need, style) => withStyle(style, () => tradeGoods(state, need)),
  // The answer the governor would give (null: none it can pick; uiAction choices and disabled ones left out).
  answer: (state, card, style) => withStyle(style, () => {
    const p = card.partyId != null ? state.parties.find((x) => x.id === card.partyId) : null;
    const opts = (card.choices || []).filter((c) => !c.uiAction && !isDisabled(state, c));
    return opts.length ? pickChoice(state, card, opts, p) : null;
  }),
  approach: (state, p, e, style) => withStyle(style, () => chooseApproach(state, p, e)),
  extractNow: (state, p, e, style) => withStyle(style, () => shouldExtract(state, p, e)),
  trade: (state, style) => withStyle(style, () => handleTrade(state)),
  outpostThirsty: (state, o) => outpostThirsty(state, o),
  isDisabled,
};
