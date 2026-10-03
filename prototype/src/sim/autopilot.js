// Autopilot: an AI governor that runs the player's holdout (a dev tool, also used headless by tools/autotest.js).
// While state.autopilot is on, the hourly tick (world.js) calls autopilotHour. The governor:
//   - resolves cards (travel events, conflicts, orders / "Done" cards, strangers, raid warnings), scavenging
//     searches (one search hour per tick), trade visits and battles (state.autoCombat is on while it runs);
//   - sets every role by need (food, threats, the injured, construction, stations, crafting), queues buildings
//     and crafts, hands out gear from the armory and treats the injured with base meds;
//   - once a day (07:00) plans a trip: scavenging the best known site for what the hub needs, checking finds,
//     recovering the dead or a vehicle, a trade visit, a rescue, or founding an outpost; and sends supply runs
//     to outposts that need materials or hands.
// It only uses the same calls as the UI (canBuild / queueBuild, queueCraft, treatAtBase, launchExpedition,
// startOrder, saveSupplyRun ...), plays by what the player knows of the map (knowledge snapshots, markers,
// known groups), and never draws from state.rng. Turning it off hands everything back as it is.
import { GEAR, LOCATIONS, SUPPLIES, FACTION_TYPES } from "./data.js";
import { log, day, hourOfDay, hub, alive, atBase, skill, combatPower, gearEffect, factionById } from "./world.js";
import {
  launchExpedition, estimateTrip, startReturn, partyMembers, partyTile, tileLabel, teamName, orderOptions, orderMove,
  hoursLeft, planPath, partyCapacity, cargoLoad, supplyLoad, carryCapacity, travelHours, awaitOrders, partySpeed,
} from "./parties.js";
import { startOrder, resumeQueue } from "./orders.js";
import { searchHour, extract, engagementParty, foundLoad } from "./scavenge.js";
import { tradeContext, sellPrice, buyPrice, executeTrade, endTrade, proposePact } from "./trade.js";
import { attitude, baseDefense, strength, isAggressiveType } from "./factions.js";
import { siteBonus } from "./economy.js";
import { BUILDINGS, RECIPES, canBuild, queueBuild, count, stations, baseBeds, baseWalls, farmSlots, assignStations } from "./buildings.js";
import { isHurt, hospitalDef, nextHospitalType, treatAtBase, treatAtBaseInfo, fieldTreatInfo } from "./medical.js";
import { CRAFTS, canCraft, queueCraft, craftQueue } from "./crafting.js";
import { vehiclesAtBase, refuel, repair, canRepair } from "./vehicles.js";
import { saveSupplyRun, dispatchSupplyRun, supplyRuns, jobParty, deleteSupplyRun } from "./supply.js";
import { autoPlayerTurn, runEnemyPhase, closeCombat } from "./combat.js";
import { allCaptives, ransomValue } from "./conflicts.js";
import { ensureInv } from "./inventory.js";

// Play styles. range = max tiles from the hub for a trip, maxHoursOut = longest way out, cooldown = days between
// launches, homeFrac = share of the hub that stays home, risk = lowest success chance worth a gamble,
// lossFear / fightBias / raidBias weigh fights on conflict cards, chain = extra sites a team may hit on one trip.
export const PERSONALITIES = {
  cautious: {
    name: "Cautious", crowdSlack: 0, desc: "One small, stealthy team at a time close to home, short searches, more guards, pays tribute, avoids fights.",
    maxTeams: 1, cooldown: 4, crew: 3, homeFrac: 0.6, minHealth: 80, range: 8, maxHoursOut: 18, stance: "stealthy",
    searchHours: 3, searchHeat: 25, hurtStop: 60, risk: 0.8, riskAversion: 1.5, lossFear: 12, fightBias: -1, raidBias: -3,
    curious: 0.5, baseGuards: 2, guardMargin: 1.4, restMood: 35, chain: 0, outposts: 1, outpostPop: 12, strangerDays: 8,
    holdRatio: 1.5, raid: false, rescue: false, tradeEvery: 14,
  },
  balanced: {
    name: "Balanced", crowdSlack: 2, desc: "Up to two teams out, scavenges what the hub needs, fights only good odds, grows with an outpost or two.",
    maxTeams: 2, cooldown: 2, crew: 2, homeFrac: 0.5, minHealth: 70, range: 11, maxHoursOut: 28, stance: "normal",
    searchHours: 5, searchHeat: 45, hurtStop: 45, risk: 0.65, riskAversion: 1, lossFear: 9, fightBias: 0, raidBias: -1,
    curious: 1, baseGuards: 1, guardMargin: 1.25, restMood: 28, chain: 1, outposts: 2, outpostPop: 9, strangerDays: 4,
    holdRatio: 1.25, raid: false, rescue: true, tradeEvery: 12,
  },
  aggressive: {
    name: "Aggressive", crowdSlack: 8, desc: "Many long trips, loud searches, raids hostile land, ambushes camps and robbers, expands fast.",
    maxTeams: 3, cooldown: 1, crew: 3, homeFrac: 0.4, minHealth: 60, range: 15, maxHoursOut: 40, stance: "normal",
    searchHours: 7, searchHeat: 62, hurtStop: 35, risk: 0.5, riskAversion: 0.6, lossFear: 7, fightBias: 1, raidBias: 2,
    curious: 1.4, baseGuards: 1, guardMargin: 1.1, restMood: 22, chain: 2, outposts: 3, outpostPop: 8, strangerDays: 3,
    holdRatio: 1.2, raid: true, rescue: true, tradeEvery: 0,
  },
};

const PLAN_HOUR = 7;      // daily planning: teams leave in the morning
const STICKY = 2;         // bonus for keeping someone's current role (fewer flips)
const first = (s) => s.name.split(" ")[0];
const names = (list) => list.map(first).join(", ");
const say = (state, text, kind = "info") => log(state, `🤖 ${text}`, kind);
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
const persona = (state) => PERSONALITIES[gov(state).personality] || PERSONALITIES.balanced;
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
  return `${persona(state).name} · ${out} team${out === 1 ? "" : "s"} out · launched ${s.launched} · cards ${s.cards} · built ${s.builds} · crafted ${s.crafts} · treated ${s.treated} · supply runs ${s.supplyRuns} · outposts ${s.outposts}`;
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
    for (const b of [...state.bases]) {
      equipFromArmory(state, b);
      planTreatment(state, b);
      planBuilds(state, b);
      planCrafts(state, b);
    }
    if (hourOfDay(state) === PLAN_HOUR) autopilotDaily(state);
    for (const b of state.bases) planRoles(state, b);
    resolvePending(state);
  } catch (e) {
    fail(state, e);
  } finally {
    g.busy = false;
  }
}

// Daily planning (07:00): role summary, supply runs and the day's trip.
export function autopilotDaily(state) {
  if (!state.autopilot || state.gameOver) return;
  roleSummaries(state);
  tidySupplyJobs(state);
  planSupplyRuns(state);
  planTrip(state);
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
    const spare = P.name === "Cautious" ? 200 : 110;
    return (ammo >= spare ? find(/^Send 40 ammo/) : null) || find(/^Ignore/);
  }
  if (/^A stranger at the gate/.test(t) || /^Refugees at the gate/.test(t)) {
    const h = hub(state);
    const n = atBase(state, h.id).length;
    const days = (k) => ((h.stock.food || 0) - 5 * k) / Math.max(1, n + k);
    const ok = (k) => days(k) >= P.strangerDays && roomFor(state, k);
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
  if (/^A nest/.test(t)) return (chance(/^Burn it/) >= P.risk + 0.1 ? find(/^Burn it/) : null) || find(/^Mark it/);
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
  return people + k <= beds + persona(state).crowdSlack;
}

const partyFuelOf = (state, p) => {
  const v = p.vehicleId ? state.vehicles.find((x) => x.id === p.vehicleId) : null;
  return (v ? v.fuel : 0) + (p.supplies.fuel || 0);
};
// Rough hours until a team is home: the way left, plus (going out) the job and the same way back.
const tripHoursLeft = (state, p) => (p.phase === "back" ? hoursLeft(state, p) : 2 * hoursLeft(state, p) + 10);
// Days of food and water a team carries (extra = more mouths).
function carriedDays(state, p, extra = 0) {
  const n = partyMembers(state, p).length + extra;
  const have = (k) => (p.supplies[k] || 0) + ((p.cargo && p.cargo.supplies[k]) || 0);
  return Math.min(have("food"), have("water")) / Math.max(1, n);
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

// Raid warning: rally the guards first (roles change at once), then judge the odds with everyone on alert.
function raidWarningChoice(state, card, opts, P) {
  const find = (re) => opts.find((c) => re.test(c.label));
  const base = state.bases.find((b) => card.title === `Raiders heading for ${b.name}`);
  const raid = base && state.parties.find((q) => q.kind === "raid" && q.target && q.target.kind === "player" && q.target.baseId === base.id && !q.returning);
  if (!base || !raid) return find(/^Prepare/);
  planRoles(state, base);
  const was = base.alert;
  base.alert = true;
  const ratio = baseDefense(state, base) / Math.max(1, raid.strength);
  base.alert = was;
  if (ratio >= P.holdRatio) return find(/^Prepare/);
  if (P.raid) return (ratio >= 0.9 ? find(/^Prepare/) : null) || find(/^Defend in person/) || find(/^Pay tribute/) || find(/^Prepare/);
  return (ratio < 1.15 ? find(/^Pay tribute/) : null) || find(/^Prepare/);
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
    if (state.engagement) return;
    delete p.apResume;
    if (orderOptions(state, p).some((o) => o.mission === "scavenge" && !o.disabled)) {
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
  // The badly hurt get carried meds before a long walk home.
  const back = planPath(state, partyTile(p), home.tile, p.vehicle);
  const hoursHome = back ? travelHours(state, back.path, { vehicle: p.vehicle, speed: partySpeed(p) }).hours : 0;
  const hurt = partyMembers(state, p).filter((s) => (s.woundInfected || s.health < 35) && fieldTreatInfo(state, p, s).ok);
  if (hurt.length && hoursHome > 10) {
    p.orders = [...hurt.slice(1).map((s) => ({ type: "treat", survivorId: s.id })), { type: "home" }];
    say(state, `${teamName(state, p)}: treating ${names(hurt)} before heading home.`);
    startOrder(state, p, { type: "treat", survivorId: hurt[0].id });
    return;
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
  const room = partyCapacity(state, p) - cargoLoad(p.cargo);
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
  const hours = best.cost + P.searchHours + (back ? back.cost : 48) + 6;
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
    if (queued) p.orders.shift();
    else p.mission = "move";
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
  say(state, `${teamName(state, p)} leaves ${tileLabel(state, e.tile)} after ${e.hours}h (Heat ${Math.round(e.heat)}, ${foundLoad(e)} carry space of finds).`);
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
  if (e.hours >= P.searchHours || e.heat >= P.searchHeat) return true;
  if (members.some((s) => s.health < P.hurtStop)) return true;
  const room = partyCapacity(state, p) - cargoLoad(p.cargo);
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
  const keep = { food: road, water: road, meds: 2, ammo: 5 * n, fuel: p.vehicle && back ? Math.ceil(back.cost) : 0 };
  for (const k of Object.keys(SUPPLIES)) if (need[k] <= 0.8) spare[k] = Math.max(0, (have[k] || 0) - (keep[k] || 0));
  let budget = Object.entries(spare).reduce((a, [k, q]) => a + q * sellPrice(state, f, k, speech), 0);
  const ask = {};
  const caps = { meds: 10, parts: 6, food: 40, fuel: 20, ammo: 120, scrap: 40, water: 20 };
  let askValue = 0;
  for (const k of Object.keys(need).sort((a, b) => need[b] - need[a])) {
    if (need[k] < 1.2 || budget <= 0) continue;
    const price = buyPrice(state, f, k, speech);
    const q = Math.min(caps[k] || 10, Math.floor(f.stock[k] || 0), Math.floor(budget / price));
    if (q <= 0) continue;
    ask[k] = q;
    askValue += q * price;
    budget -= q * price;
  }
  const offer = {};
  let offerValue = 0;
  for (const k of Object.keys(spare).sort((a, b) => need[a] - need[b])) {
    if (offerValue >= askValue) break;
    const price = sellPrice(state, f, k, speech);
    const q = Math.min(spare[k], Math.ceil((askValue - offerValue) / price));
    if (q <= 0) continue;
    offer[k] = q;
    offerValue += q * price;
  }
  let text = "";
  if (askValue > 0 && offerValue >= askValue) {
    state.trade.offer = offer;
    state.trade.ask = ask;
    executeTrade(state);
    g.stats.trades++;
    const list = (o) => Object.entries(o).map(([k, q]) => `${q} ${k}`).join(", ");
    text = `traded ${list(offer)} for ${list(ask)}`;
  }
  if (!f.pact) {
    const r = proposePact(state, f, f.goodwill >= 20 ? "trade" : "nonaggression");
    if (/signed/.test(r)) text += `${text ? "; " : ""}${r.toLowerCase().replace(/\.$/, "")}`;
  }
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
  const vehicle = state.vehicles.some((v) => v.loc.kind === "base" || v.loc.kind === "party");
  const foodDays = (st.food || 0) / n;
  const pick = (v, steps) => { for (const [lim, w] of steps) if (v < lim) return w; return steps[steps.length - 1][1]; };
  return {
    food: pick(foodDays, [[4, 3], [8, 2], [15, 1.2], [30, 0.6], [Infinity, 0.2]]),
    water: pick(st.water || 0, [[25, 1.5], [50, 0.6], [Infinity, 0.15]]),
    meds: pick(st.meds || 0, [[2, 2.5], [n * 0.6, 1.8], [n * 1.5, 1], [Infinity, 0.3]]),
    scrap: pick(st.scrap || 0, [[20, 2.5], [45, 1.6], [90, 0.9], [Infinity, 0.35]]),
    parts: pick(st.parts || 0, [[2, 2], [6, 1.2], [12, 0.6], [Infinity, 0.2]]),
    ammo: pick(st.ammo || 0, [[n * 6, 2], [n * 15, 0.9], [n * 40, 0.35], [Infinity, 0.1]]),
    fuel: vehicle ? pick(st.fuel || 0, [[12, 1.6], [35, 0.8], [Infinity, 0.2]]) : 0.15,
  };
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

function planRoles(state, base) {
  const people = atBase(state, base.id);
  if (!people.length) return;
  const g = gov(state);
  const P = persona(state);
  const free = new Set(people);
  const want = new Map();
  const give = (s, role, station = null) => { want.set(s.id, { role, station }); free.delete(s); };
  const ranked = (role, score, filter = () => true) => [...free].filter(filter)
    .sort((a, b) => score(b) + (b.role === role ? STICKY : 0) - (score(a) + (a.role === role ? STICKY : 0)));
  const st = base.stock;
  const isHub = base.type === "hub";
  const eaters = people.length;
  const foodDays = (st.food || 0) / Math.max(1, eaters);
  const bonus = siteBonus(state, base).farm;
  const slots = farmSlots(base);

  // 1. Patients in a hospital bed do not work anyway; the worn-out rest before they walk away (up to a third,
  // and only while there is food, unless someone is about to leave).
  for (const s of people) if (s.inBed) give(s, "rest");
  const low = [...free].filter((s) => s.mood < P.restMood && !s.leader).sort((a, b) => a.mood - b.mood);
  low.forEach((s, i) => { if (s.mood < 18 || (i < Math.floor(people.length / 3) && foodDays >= 3)) give(s, "rest"); });

  // 2. Farming: enough food for everyone here (more when stocks are low).
  let farmOut = 0, farmers = 0;
  const farmTo = (target) => {
    for (const s of ranked("farm", (x) => skill(x, "farming"))) {
      if (farmOut >= target * (s.role === "farm" ? 1.15 : 1)) break; // a farmer already at it stays a little past the target
      const inSlot = farmers < slots;
      if (!inSlot && !(isHub && foodDays < 5)) break; // extra farmers work at 30%: only when food is short
      farmOut += (2.2 + skill(s, "farming") * 0.12) * bonus * (inSlot ? 1 : 0.3);
      farmers++;
      give(s, "farm");
    }
  };
  if (foodDays < 4) farmTo(eaters);

  // 3. Guards for a raid that is on its way or a horde at the door.
  const threat = threatAt(state, base);
  const guards = new Set([...want].filter(([, w]) => w.role === "guard").map(([id]) => id));
  const defense = () => {
    let d = baseWalls(base) * 2;
    for (const s of people) d += combatPower(s) * (guards.has(s.id) || (want.get(s.id) || {}).role === "guard" ? 1.5 : base.alert ? 1.3 : 0.8);
    return (st.ammo || 0) < people.length * 3 ? d * 0.7 : d;
  };
  const addGuards = (target, cap) => {
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
  if (hosp.tier > 0 && people.some((s) => s.woundInfected || (isHurt(s) && s.health < (staffed ? 100 : 95)))) {
    for (const s of ranked("medic", (x) => skill(x, "medicine") - (isHurt(x) ? 6 : 0)).slice(0, hosp.staff)) give(s, "medic");
  }

  // 5. Builders while something is queued: more for big jobs.
  if (base.construction.length) {
    const left = base.construction.reduce((a, j) => a + j.hours - j.progress, 0);
    const n = Math.min(3, Math.max(1, Math.ceil(left / 40)), Math.max(1, Math.floor(free.size / 2)));
    for (const s of ranked("build", (x) => skill(x, "mechanics"), (x) => !x.inBed).slice(0, n)) give(s, "build");
  }

  // 6. Farming to the comfortable level.
  farmTo(eaters * (foodDays < 6 ? 1.3 : foodDays < 15 ? 1.1 : foodDays < 30 ? 0.95 : 0.8));
  g.farmShort[base.id] = farmers >= slots && farmOut < eaters * (foodDays < 15 ? 1.1 : 0.95);

  // 7. Workshop stations that are worth running today.
  for (const station of stations(base)) {
    const recipe = BUILDINGS[station.type].station;
    if (!stationWorth(state, base, recipe)) continue;
    const key = RECIPES[recipe].skill;
    const op = ranked("operate", (x) => skill(x, key) + (x.station === station.id ? 3 : 0), (x) => !x.inBed)[0];
    if (op) give(op, "operate", station.id);
  }

  // 8. One crafter while the craft queue has a job someone here can do.
  const job = craftQueue(base).find((j) => people.some((s) => skill(s, CRAFTS[j.recipe].skill) >= CRAFTS[j.recipe].min));
  if (job) {
    const r = CRAFTS[job.recipe];
    const c = ranked("craft", (x) => skill(x, r.skill), (x) => !x.inBed && skill(x, r.skill) >= r.min)[0];
    if (c) give(c, "craft");
  }

  // 9. Standing guards: known raiders in reach, hordes in sight, and a lookout at the hub.
  addGuards(Math.max(threat.standing, threat.urgent * P.guardMargin), Math.ceil(people.length * (threat.urgent ? 0.7 : 0.35)));
  if (isHub && people.length >= 4) {
    const need = P.baseGuards - guards.size - (people.length < 7 ? Math.max(0, P.baseGuards - 1) : 0);
    for (const s of ranked("guard", (x) => combatPower(x) * 2, (x) => !x.inBed).slice(0, Math.max(0, need))) { guards.add(s.id); give(s, "guard"); }
  }

  // 10. Everyone else: free farm slots while food is not plentiful, rest when spirits are low, else scavenge.
  if (foodDays < 12) for (const s of ranked("farm", (x) => skill(x, "farming")).slice(0, Math.max(0, slots - farmers))) { farmers++; give(s, "farm"); }
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
}

function stationWorth(state, base, recipe) {
  const st = base.stock;
  const n = Math.max(1, atBase(state, base.id).length);
  if (recipe === "ammo") return (st.ammo || 0) < n * 15 + 60 && (st.scrap || 0) >= 30;
  if (recipe === "meds") return (st.meds || 0) < Math.max(5, n) && (st.scrap || 0) >= 15 && (st.food || 0) >= n * 6;
  if (recipe === "parts") return (st.parts || 0) < 8 && (st.scrap || 0) >= 45 && atBase(state, base.id).some((s) => skill(s, "mechanics") >= 4);
  return false;
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
function planBuilds(state, base) {
  if (base.construction.length >= (base.type === "hub" ? 2 : 1)) return;
  const g = gov(state);
  for (const w of buildWishes(state, base)) {
    const def = BUILDINGS[w.type];
    if (!def) continue;
    const chk = canBuild(state, base, w.type);
    if (!chk.ok) {
      if (w.save && /^Needs \d+ scrap/.test(chk.reason)) return; // save up for it rather than spend on less
      continue;
    }
    const cost = def.cost;
    const reserve = w.save || base.type !== "hub" ? 0 : 10;
    if ((base.stock.scrap || 0) - (cost.scrap || 0) < reserve) { if (w.save) return; continue; }
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
  if (people + (isHub ? 1 : 0) > beds) add("bunkhouse", `${people} people for ${beds} beds`, true);
  if (g.farmShort[base.id] && count(base, "farm_plot") + queued("farm_plot") < (isHub ? 8 : 3)) add("farm_plot", "the farmers need more plots", true);
  if (!isHub && count(base, "farm_plot") + queued("farm_plot") < 1) add("farm_plot", "an outpost should feed itself", true);
  if (Math.max(threat.urgent, threat.standing) > baseDefense(state, base) * 0.9) add("walls", "raiders or hordes nearby", true);
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
  if (!base.radio && pop >= 8 && (st.parts || 0) >= 9 && best("mechanics") >= 4) add("radio", "live contact with teams out in the field");
  if (!count(base, "garage") && vehiclesAtBase(state, base.id).length && (st.parts || 0) >= 5) add("garage", "cheaper vehicle repairs");
  if (people + 2 > beds && (st.scrap || 0) >= 45) add("bunkhouse", "room for newcomers");
  if (count(base, "walls") < 2 && (st.scrap || 0) >= 70) add("walls", "stronger defense");
  return out;
}

// ---------- crafting ----------
const slotOf = (key) => (GEAR[key] ? GEAR[key].slot : null);
function planCrafts(state, base) {
  const q = craftQueue(base);
  if (q.length >= 3) return;
  const people = atBase(state, base.id);
  if (!people.length) return;
  const st = base.stock;
  const n = people.length;
  const inQueue = (slot) => q.filter((j) => CRAFTS[j.recipe].gear && slotOf(CRAFTS[j.recipe].gear) === slot).length;
  const inArmory = (slot) => base.armory.filter((it) => slotOf(it.key) === slot).length;
  const lacking = (slot) => people.filter((s) => !s.gear[slot] || (slot === "weapon" && !gearEffect(s, s.gear.weapon).usable)).length - inArmory(slot) - inQueue(slot);
  const tryCraft = (keys, why, minScrap) => {
    for (const k of keys) {
      const r = CRAFTS[k];
      if (!r || (st.scrap || 0) - (r.in.scrap || 0) < minScrap) continue;
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
  if ((st.meds || 0) < Math.max(3, n / 2) && tryCraft(["dressings"], "meds are short", 5)) return;
  if (lacking("armor") > 0 && tryCraft(["scrapvest", "tirevest"], "someone has no body armor", 35)) return;
  const filters = [...base.armory, ...people.map((s) => s.gear.tool)].filter((it) => it && it.key === "waterfilter").length;
  if (base.type === "hub" && (st.water || 0) < 35 && !filters && tryCraft(["waterfilter"], "the well cannot keep up", 15)) return;
  const scav = people.filter((s) => s.role === "scavenge");
  if (scav.length >= 2 && !scav.some((s) => s.gear.tool) && !base.armory.some((it) => it.key === "crowbar") && tryCraft(["crowbar"], "better base scavenging", 45)) return;
  if (lacking("backpack") > n - 2 && tryCraft(["backpack"], "more carry space for teams", 55)) return;
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
  const people = atBase(state, base.id).sort((a, b) => combatPower(b) - combatPower(a));
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
    .sort((a, b) => (b.woundInfected ? 1 : 0) - (a.woundInfected ? 1 : 0) || a.health - b.health);
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
}

// ======================================================================================
// Daily trips
// ======================================================================================
// What the player knows about a tile right now (live view or the last report), or null.
const intel = (state, id) => state.knowledge[id] || null;

// Value of scavenging a site for what the hub needs, from what the player knows. null = do not go.
function siteScore(state, id, need, P) {
  const t = state.tiles[id];
  if (!t || t.terrain === "water" || state.bases.some((b) => b.tile === id)) return null;
  const k = intel(state, id);
  if (k && k.factionBase) return null;
  if (state.factions.some((f) => f.alive && f.known && f.bases.includes(id))) return null;
  const owner = k && typeof k.owner === "number" ? factionById(state, k.owner) : null;
  const hostile = owner && owner.alive && attitude(owner) === "Hostile";
  if (hostile && !P.raid) return null;
  if (k && k.hordeSize > 0 && state.hour - k.hour < 72) return null;
  if (state.grid.neighbors(id).some((n) => { const s = intel(state, n); return s && s.hordeSize > 20 && state.hour - s.hour < 48; })) return null;
  const def = t.loc ? LOCATIONS[t.loc.type] : null;
  const memo = gov(state).visited[id];
  let loot = memo && (!k || k.hour <= memo.hour) ? memo.loot : k ? k.loot : def ? (def.richness || 0.5) * 0.9 : 0;
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
  if (out.length >= P.maxTeams || today - g.lastLaunch < P.cooldown) return;
  if (threatAt(state, h).urgent) return; // everyone stays to defend
  const home = atBase(state, h.id);
  const keep = Math.max(2, Math.ceil(home.length * P.homeFrac));
  const pool = home.filter((s) => s.health >= P.minHealth && !s.woundInfected && !s.inBed && s.mood >= 20 && (!s.leader || home.length >= 9));
  const spareHands = Math.min(pool.length, home.length - keep);
  if (spareHands < 1) return;
  const need = needs(state);
  const cands = [];

  // Founding an outpost now and then.
  const outposts = state.bases.filter((b) => b.type === "outpost").length;
  if (outposts < P.outposts && alive(state).length >= P.outpostPop && today - g.lastOutpost >= 15 && (h.stock.scrap || 0) >= 50 &&
      (h.stock.food || 0) >= home.length * 10 && spareHands >= 2) {
    const site = outpostSite(state);
    const crowded = alive(state).length > baseBeds(h) + 2;
    if (site != null) cands.push({ mission: "outpost", tile: site, score: crowded ? 3.5 : 2.2, crew: spareHands >= 4 ? 3 : 2, why: crowded ? "the hub is crowded: a new outpost" : "a new outpost", supplies: { scrap: 23 }, min: { scrap: 15 } });
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
    if (m.type === "car" && !(m.info && m.info.emptied)) cands.push({ mission: "investigate", tile: m.tile, score: vehiclesAtBase(state, h.id).length ? 1 : 2.2, crew: 2, why: "a wrecked car to restore or strip", supplies: { parts: 2, fuel: 6 } });
    if (m.type === "death" && m.info && m.info.items > 0) cands.push({ mission: "recover", tile: m.tile, score: Math.min(2.5, 0.8 + m.info.items * 0.3), crew: 2, why: "recover our dead's gear" });
    if (m.type === "vehicle" && !vehiclesAtBase(state, h.id).length) {
      const bad = m.info && m.info.condition < 15;
      cands.push({ mission: "getvehicle", tile: m.tile, score: 2.4, crew: 2, why: "bring our vehicle home", supplies: { fuel: 12, parts: bad ? 1 : 0 } });
    }
  }
  // A trade visit when the hub has goods to spare and a real need.
  if (P.tradeEvery && today - g.lastTrade >= P.tradeEvery && !out.some((p) => p.mission === "trade")) {
    const goods = tradeGoods(state, need);
    if (goods && Object.values(need).some((v) => v >= 1.5)) {
      const f = state.factions.filter((x) => x.alive && x.known && x.bases.length && (attitude(x) === "Friendly" || attitude(x) === "Allied" || (attitude(x) === "Neutral" && !isAggressiveType(x))))
        .map((x) => ({ f: x, d: Math.min(...x.bases.map((b) => state.grid.distance(b, h.tile))) })).filter((x) => x.d <= P.range).sort((a, b) => a.d - b.d)[0];
      if (f) cands.push({ mission: "trade", tile: f.f.bases.find((b) => state.grid.distance(b, h.tile) === f.d), score: 1.6, crew: 2, why: `trade with ${f.f.name}`, supplies: goods });
    }
  }
  // Scavenging: the best known sites for what the hub needs.
  const sites = [];
  for (const id of state.grid.within(h.tile, P.range + 5)) {
    const t = state.tiles[id];
    if (!t.loc || id === h.tile) continue;
    if (state.parties.some((p) => p.owner === "player" && (p.dest === id || (p.ap && p.ap.tile === id)))) continue;
    const s = siteScore(state, id, need, P);
    if (!s || s.value <= 0.05) continue;
    sites.push({ mission: "scavenge", tile: id, score: (s.value * 4) / (1 + state.grid.distance(id, h.tile) / 6), crew: s.risk > 0.45 || s.hostile ? 3 : P.crew, why: needText(need, t) });
  }
  sites.sort((a, b) => b.score - a.score);
  cands.push(...sites.slice(0, 6));
  cands.sort((a, b) => b.score - a.score);

  for (const c of cands.slice(0, 8)) {
    const res = launchTrip(state, c, pool, spareHands);
    if (!res) continue;
    g.lastLaunch = today;
    if (c.mission === "outpost") g.lastOutpost = today;
    if (c.mission === "rescue") g.lastRescue = today;
    if (c.mission === "trade") g.lastTrade = today;
    return;
  }
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
  const value = Object.entries(goods).reduce((a, [k, q]) => a + q * SUPPLIES[k].value, 0);
  return value >= 50 ? goods : null;
}

function outpostSite(state) {
  const h = hub(state);
  const g = state.grid;
  let best = null;
  for (const id of g.within(h.tile, 7)) {
    const d = g.distance(id, h.tile);
    const t = state.tiles[id];
    if (d < 3 || t.terrain === "water" || t.terrain === "mountain") continue;
    if (state.bases.some((b) => g.distance(b.tile, id) < 3)) continue;
    const k = intel(state, id);
    if (!k || (k.owner != null && k.owner !== "player") || k.factionBase || k.infection > 0.3 || k.hordeSize > 0) continue;
    if (state.factions.some((f) => f.alive && f.bases.some((b) => g.distance(b, id) <= 6) && (f.known || attitude(f) === "Hostile"))) continue;
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
  if (size < (c.mission === "rescue" ? 3 : c.mission === "outpost" ? 2 : 1)) return null;
  const fit = (s) => combatPower(s) + skill(s, "scavenging") * 0.25 + skill(s, "stealth") * 0.15 + skill(s, "scouting") * 0.15 +
    (c.mission === "trade" ? skill(s, "speech") * 0.5 : 0) + (c.mission === "rescue" ? skill(s, "stealth") * 0.3 + skill(s, "speech") * 0.2 : 0) +
    (c.mission === "outpost" ? skill(s, "farming") * 0.4 : 0) - (s.role === "medic" ? 3 : 0) - (s.role === "build" ? 1.5 : 0);
  const crew = [...pool].sort((a, b) => fit(b) - fit(a)).slice(0, size);
  const ids = crew.map((s) => s.id);
  const dist = state.grid.distance(h.tile, c.tile);
  // A vehicle for longer trips if it can make the round trip.
  let v = null;
  const cand = vehiclesAtBase(state, h.id).filter((x) => x.condition > 0).sort((a, b) => b.condition - a.condition)[0];
  if (cand && dist >= 3 && c.mission !== "outpost" && c.mission !== "rescue") {
    if (cand.condition < 50 && (h.stock.parts || 0) >= 2 && canRepair(state, h).ok) repair(state, h, cand);
    const vEst = cand.condition >= 30 && estimateTrip(state, { memberIds: ids, dest: c.tile, vehicle: true, stance: P.stance });
    if (vEst && vEst.fuel <= cand.fuel + Math.max(0, (h.stock.fuel || 0) - 4)) v = cand;
  }
  if (v) refuel(state, h, v);
  const est = estimateTrip(state, { memberIds: ids, dest: c.tile, vehicle: !!v, stance: P.stance, fuel: v ? v.fuel + (h.stock.fuel || 0) : 0 });
  if (!est || est.hoursOut > P.maxHoursOut * (v ? 1.3 : 1)) return null;
  const n = ids.length;
  const onSite = c.mission === "scavenge" ? P.searchHours + 4 : c.mission === "outpost" ? 0 : 4;
  const days = (est.hours + onSite) / 24;
  const stock = (k) => Math.floor(h.stock[k] || 0);
  const homeLeft = atBase(state, h.id).length - n;
  const sup = {
    food: Math.ceil(n * days * 1.25) + 1 + (c.mission === "outpost" ? 6 : 0),
    water: Math.ceil(n * days * 1.25) + 1 + (c.mission === "outpost" ? 4 : 0),
    ammo: Math.min(Math.max(0, stock("ammo") - 20), 15 * n),
    meds: stock("meds") >= 4 ? Math.min(2, Math.ceil(n / 2)) : 0,
    fuel: v ? Math.max(0, Math.min(stock("fuel"), Math.ceil(est.fuel * 1.25 - v.fuel))) : 0,
  };
  for (const [k, q] of Object.entries(c.supplies || {})) if (q > 0) sup[k] = (sup[k] || 0) + q;
  if (sup.food > stock("food") - Math.max(0, homeLeft) * 2 || sup.water > stock("water")) return null; // the hub cannot spare it
  for (const k of Object.keys(sup)) sup[k] = Math.max(0, Math.min(sup[k], stock(k)));
  // Too heavy: less ammo, then drop the extras down to what the job needs (an outpost needs 15 scrap).
  const cap = carryCapacity(state, crew, v);
  if (supplyLoad(sup) > cap) sup.ammo = Math.min(sup.ammo, 5 * n);
  for (const [k, q] of Object.entries(c.supplies || {})) {
    const over = supplyLoad(sup) - cap;
    if (over > 0) sup[k] = Math.max((c.min && c.min[k]) || 0, sup[k] - Math.ceil(over / SUPPLIES[k].weight));
  }
  if (supplyLoad(sup) > cap) return null;
  for (const [k, q] of Object.entries(c.min || {})) if ((sup[k] || 0) < q) return null;
  const res = launchExpedition(state, { memberIds: ids, dest: c.tile, mission: c.mission, stance: P.stance, vehicleId: v ? v.id : null, supplies: sup });
  if (res.error) return null;
  res.party.ap = { mission: c.mission, tile: c.tile, day: day(state) };
  g.stats.launched++;
  if (c.mission === "outpost") g.stats.outposts++;
  say(state, `Sent ${names(crew)} (${c.mission === "scavenge" ? "scavenge" : c.mission}) to ${tileLabel(state, c.tile)}${v ? ` in the ${v.name}` : " on foot"}: ${c.why}. Back in about ${Math.ceil(days)} day${Math.ceil(days) === 1 ? "" : "s"}.`);
  return res.party;
}

// ---------- supply runs to outposts ----------
function tidySupplyJobs(state) {
  for (const job of [...supplyRuns(state)]) {
    if (job.apMade && !jobParty(state, job) && (job.status === "done" || job.status === "disbanded")) deleteSupplyRun(state, job);
  }
}

function planSupplyRuns(state) {
  const h = hub(state);
  const g = gov(state);
  for (const o of state.bases.filter((b) => b.type === "outpost")) {
    if (supplyRuns(state).some((j) => j.apMade && j.destId === o.id && (jobParty(state, j) || j.status === "waiting"))) continue;
    const home = atBase(state, h.id);
    const crewPool = home.filter((s) => s.health >= 70 && !s.leader && !s.inBed && !s.woundInfected).sort((a, b) => combatPower(b) - combatPower(a));
    const staff = atBase(state, o.id).length;
    let form = null, why = "";
    if (staff < 2 && home.length >= 7 && crewPool.length) {
      const s = [...crewPool].sort((a, b) => skill(b, "farming") - skill(a, "farming"))[0];
      form = { crew: [s.id], deliver: [{ key: "food", qty: 6 }, { key: "scrap", qty: Math.min(8, Math.max(0, Math.floor((h.stock.scrap || 0) - 30))) }], atDest: "disband" };
      why = `${first(s)} joins the outpost (only ${staff} there)`;
    } else {
      const wish = buildWishes(state, o).find((w) => BUILDINGS[w.type] && canBuild(state, o, w.type).reason !== `Limit reached (${BUILDINGS[w.type].max})`);
      const scrap = wish ? BUILDINGS[wish.type].cost.scrap || 0 : 0;
      if (wish && (o.stock.scrap || 0) < scrap && (h.stock.scrap || 0) >= scrap + 25 && home.length >= 5 && crewPool.length >= 1) {
        const deliver = [{ key: "scrap", qty: scrap + 2 }];
        if ((o.stock.food || 0) < staff * 3) deliver.push({ key: "food", qty: 8 });
        // Enough hands to carry it (people stay home: at most a third of the hub goes).
        const load = deliver.reduce((a, l) => a + l.qty * SUPPLIES[l.key].weight, 0);
        const crew = [];
        for (const s of crewPool) if (carryCapacity(state, crew, null) < load && crew.length < Math.max(1, Math.floor(home.length / 3))) crew.push(s);
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
