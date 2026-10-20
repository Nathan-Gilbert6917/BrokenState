// Night on the road: a team of yours still on its way when night falls (NIGHT_MARCH.FROM, 22:00, the sleep night of
// sleep.js) is asked what to do with a "Night falls" card (once a night, parties.js playerPartyHour, before it moves):
//   Make camp until dawn: it stops where it is and rests until NIGHT_MARCH.TO (06:00) on the internal rest task
//     (orders.js "camp": the hurt heal a little, spirits lift by the fire, the night's sleep is had); its trip goes
//     back on the front of its queue (a move to where it was going and the mission there, or the way home), so it
//     moves on by itself at first light.
//   Push through the night: it keeps moving in the dark (p.nightMarch = this night). While it marches: road events
//     ×EVENTS (events.js rollTravelEvent, in place of the night's 1.2), encounters with the dead and with other groups
//     ×CONFLICT and up to CONFLICT_CAP (conflicts.js conflictChance, in place of the night's 1.25 and its 0.35 cap), and
//     nobody sleeps: each hour on the move they owe TIRED sleep (sleep.js tiredHour), so a whole night's march leaves
//     them Tired (aim −5) until they sleep it off (the next night, or resting in camp by day). The dark already blinds
//     a team to all but its own tile (parties.js sightRadius): it can walk straight into a horde.
//   Every night this trip, either way: p.nightPlan, the card is not asked again on this trip (a log line instead).
// Not asked: under the governor (autopilot.js plays its own night stops), for convoys, caravans and crews (kind other
// than "expedition"), when it gets there within NIGHT_MARCH.NEAR hours, too close to dawn (under MIN_CAMP hours), or
// when its trip cannot be put back on its queue (a hidden mission: requeue below). Those go on as before.
import { log, addCard, hourOfDay, baseById, hub } from "./world.js";
import { MISSIONS, partyTile, tileLabel, teamName, onTheMove, hoursLeft } from "./parties.js";
import { startOrder } from "./orders.js";
import { roadTentLine } from "./tents.js"; // the team's tent bags go up for the night (call-time only)

export const NIGHT_MARCH = { FROM: 22, TO: 6, EVENTS: 1.8, CONFLICT: 1.6, CONFLICT_CAP: 0.45, TIRED: 4, NEAR: 1.5, MIN_CAMP: 2 };

const inNight = (h) => h >= NIGHT_MARCH.FROM || h < NIGHT_MARCH.TO;
// Which night it is: the same number from 22:00 to 05:59 the next morning.
export const nightKey = (state) => Math.floor((state.hour + 24 - NIGHT_MARCH.FROM) / 24);
// Hours of rest from now to first light (0 by day).
export const hoursToDawn = (state) => { const h = hourOfDay(state); return inNight(h) ? (NIGHT_MARCH.TO - h + 24) % 24 : 0; };
// Is this team pushing on through the dark right now?
export const marchingNow = (state, p) => !!p && p.nightMarch != null && p.nightMarch === nightKey(state) && inNight(hourOfDay(state)) && onTheMove(p);

// Where the team was going, as queued orders: the move and the mission there, or the way home. null: it cannot be
// put back (a hidden mission's trip), so the team is not asked.
export function resumeOrders(state, p) {
  if (p.phase === "back") return [{ type: "home" }];
  if (p.phase !== "out" || p.dest == null || p.path[p.path.length - 1] !== p.dest) return null;
  const back = [{ type: "move", tile: p.dest }];
  const m = p.mission === "recon" ? "survey" : p.mission;
  if (m === "move") return back;
  if (!MISSIONS[m] || (MISSIONS[m].hidden && m !== "survey")) return null;
  back.push({ type: "mission", mission: m, at: p.dest });
  return back;
}

const whereTo = (state, p) => {
  if (p.phase === "back") { const b = baseById(state, p.homeBaseId) || hub(state); return b ? b.name : "home"; }
  return tileLabel(state, p.dest);
};

// Stop and rest until first light; the trip carries on from the queue in the morning. Returns the line for the card.
export function makeCamp(state, p) {
  if (!state.parties.includes(p) || !onTheMove(p)) return "The team is no longer on the road.";
  const hours = hoursToDawn(state);
  if (hours < 1) return "Dawn is already breaking: the team moves on.";
  const back = resumeOrders(state, p);
  if (!back) return "The team cannot stop here: it keeps moving.";
  const to = whereTo(state, p);
  delete p.nightMarch;
  p.orders = [...back, ...(p.orders || [])];
  startOrder(state, p, { type: "camp", hours });
  return `The team makes camp at ${tileLabel(state, partyTile(p))} for ${hours} hours and moves on to ${to} at first light.${roadTentLine(state, p)}`;
}

// Keep moving through the dark this night.
export function pushOn(state, p) {
  if (!state.parties.includes(p)) return "The team is no longer on the road.";
  p.nightMarch = nightKey(state);
  return "The team pushes on through the night. Eyes open: the dark hides what waits on the road.";
}

// Called every hour for a player team about to move (parties.js playerPartyHour). True when it does not move this
// hour (it stopped to ask, or made camp).
export function nightFalls(state, p) {
  if (state.autopilot || p.owner !== "player" || p.kind !== "expedition" || !onTheMove(p)) return false;
  const h = hourOfDay(state), key = nightKey(state);
  if (!inNight(h) || p.nightAsked === key || p.nightMarch === key) return false;
  p.nightAsked = key;
  if (hoursToDawn(state) < NIGHT_MARCH.MIN_CAMP || hoursLeft(state, p) <= NIGHT_MARCH.NEAR || !resumeOrders(state, p)) return false;
  if (p.nightPlan === "push") { pushOn(state, p); log(state, `${teamName(state, p)} pushes on through the night toward ${whereTo(state, p)}.`, "info"); return false; }
  if (p.nightPlan === "camp") { log(state, `${teamName(state, p)}: ${makeCamp(state, p)}`, "info"); return true; }
  addCard(state, nightCard(state, p));
  return true;
}

export function nightCard(state, p) {
  const hours = hoursToDawn(state), left = Math.ceil(hoursLeft(state, p));
  const live = () => state.parties.includes(p) && onTheMove(p);
  const gone = "The team is no longer on the road.";
  const risk = `road events ×${NIGHT_MARCH.EVENTS} and run-ins with the dead or raiders ×${NIGHT_MARCH.CONFLICT}; it sees only its own tile, and nobody sleeps (Tired, aim −5, until they rest)`;
  const camp = `Stop here and rest until ${String(NIGHT_MARCH.TO).padStart(2, "0")}:00 (about ${hours} hours): a night's sleep, the hurt heal a little, spirits lift by the fire. It moves on by itself at first light`;
  return {
    title: "Night falls",
    text: `${teamName(state, p)} is still about ${left} hour${left === 1 ? "" : "s"} from ${whereTo(state, p)} as darkness falls. Make camp and move on in the morning, or push through the night?`,
    where: tileLabel(state, partyTile(p)),
    partyId: p.id,
    nightCard: true,
    choices: [
      { label: "Make camp until dawn", hint: camp, default: true, resolve: (s) => (live() ? makeCamp(s, p) : gone) },
      { label: "Push through the night", hint: `Keep moving in the dark: ${risk}`, resolve: (s) => (live() ? pushOn(s, p) : gone) },
      { label: "Camp every night this trip", hint: `${camp}. Not asked again on this trip`, resolve: (s) => { p.nightPlan = "camp"; return live() ? makeCamp(s, p) : gone; } },
      { label: "Push through every night this trip", hint: `Keep moving every night: ${risk}. Not asked again on this trip`, resolve: (s) => { p.nightPlan = "push"; return live() ? pushOn(s, p) : gone; } },
    ],
  };
}

// The team panel's night plan (ui/expedition.js nightRow): "ask" (the card each night), "camp" or "push" (every night
// of this trip, no card). Set at night to "camp" on a team still on its way: it makes camp now; to "push": it marches on.
export const NIGHT_PLANS = { ask: "Ask each night", camp: "Make camp", push: "Push through" };
export function setNightPlan(state, p, plan) {
  if (!p || !state.parties.includes(p) || !NIGHT_PLANS[plan]) return "";
  if (plan === "ask") delete p.nightPlan;
  else p.nightPlan = plan;
  for (let i = state.cards.length - 1; i >= 0; i--) if (state.cards[i].nightCard && state.cards[i].partyId === p.id && plan !== "ask") state.cards.splice(i, 1); // its open card is answered by the plan
  const night = inNight(hourOfDay(state)) && onTheMove(p) && p.phase !== "task";
  if (night && plan === "camp" && hoursToDawn(state) >= 1 && resumeOrders(state, p)) return `At night: make camp. ${makeCamp(state, p)}`;
  if (night && plan === "push") { pushOn(state, p); return "At night: push through. The team marches on through the dark."; }
  if (night && plan === "ask" && p.nightMarch === nightKey(state)) return "At night: ask each night. It keeps marching tonight; you will be asked from tomorrow night.";
  return plan === "ask" ? "At night: the team asks what to do when night falls on the road." : plan === "camp" ? "At night: the team makes camp on the road at 22:00 and moves on at first light." : "At night: the team pushes on through the dark (more trouble, and nobody sleeps).";
}
