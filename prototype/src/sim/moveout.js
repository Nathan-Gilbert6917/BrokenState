// Moving people between your bases: the Overcrowded card, a team moved out of a crowded base, and a team that
// moves into another of your bases.
//
//   - The Overcrowded card: a base of yours with more people living there than beds (buildings.js baseBeds; crowding
//     costs mood every day, morale.js) says so with a card: once when it gets crowded, then again only after
//     CROWD_CARD.days days, or sooner when it got worse (CROWD_CARD.worse more people over its beds than at the last
//     card). Checked every hour, so a team coming home or a newcomer let in brings it up straight away. "Move a team
//     out…" opens the move-out planner (ui.js moveOutModal); "Leave it for now" does nothing. Not while the autopilot
//     plays (it has its own answer to a crowded hub: outposts and bunkhouses, autopilot.js); a card left open when it
//     takes over is answered "Leave it" (the planner choice needs a person).
//   - moveTeamOut: the team leaves through launchExpedition from that base (opts.fromBaseId: its people, vehicles,
//     stores and armory; it stays the team's home) as a "Moving out" team. With no destination it stands outside the
//     base waiting for orders and the map goes straight to move mode (main.js); with another of your bases as the
//     destination it walks or drives there. On the map it is a team like any other: Build outpost founds a new base
//     with it (it needs the 15 scrap carried, packed by default), Move to another tile takes it anywhere.
//   - The Enter card: a team of yours that ends a move on one of your bases that is not its home, with nothing queued
//     after (parties.js arrive), is asked "Enter <base>?". Yes: its people live there from now on, what it carries goes
//     into that base's stores and armory and its vehicle parks there (joinBase: the team is home there, parties.js
//     startReturn; the Overcrowded card there waits as if it had just been shown: the Enter card said how full it is).
//     No: it stays a team on the map and waits for orders (the orders card). Not for convoys, caravans or
//     crews (they have their own business at a base). The autopilot says yes when its own plan sent the team there
//     (p.joinBaseId, moveTeamOut's destination) or the base has a bed for each of them, else no.
//   - Enter base (an order, enterOption): any team of yours standing on one of your bases (its home too: one that
//     waited outside, ended another order there, or said No on the Enter card) moves in the same way, from the team
//     panel, the orders card, the Teams tab or the tile panel's team card.
import { log, addCard, baseById, residents } from "./world.js";
import { baseBeds } from "./buildings.js";
import { crowdInfo } from "./morale.js";
import { launchExpedition, partyMembers, partyTile, awaitOrders, startReturn, teamName } from "./parties.js";
import { partyVehicle } from "./vehicles.js";

export const CROWD_CARD = { days: 5, worse: 2 };
// What the move-out planner packs by default (main.js autofill): the trip there and back like any trip, plus
// days of food and water for the road ahead (the place they will settle is not picked yet), and the scrap an
// outpost needs when they may found one.
export const MOVE_OUT = { days: 3, ammo: 10, scrap: 15 };

const firstName = (s) => s.name.split(" ")[0];
const list = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const placeName = (b) => (b.type === "hub" ? `the hub (${b.name})` : b.name);

// People over a base's beds (0 or less: everyone has one).
export const overBeds = (state, b) => residents(state, b.id).length - baseBeds(b);
// Beds free at a base right now (negative: crowded).
export const freeBeds = (state, b) => -overBeds(state, b);

// ---------- the Overcrowded card ----------
export function crowdCardsHour(state) {
  if (state.autopilot || state.gameOver || !state.bases.length) return;
  for (const b of state.bases) {
    const over = overBeds(state, b);
    if (over <= 0) continue;
    if (state.cards.some((c) => c.crowdFor === b.id)) continue; // one open at a time per base
    const last = b.crowdNote;
    if (last && state.hour < last.hour + CROWD_CARD.days * 24 && over < last.over + CROWD_CARD.worse) continue;
    b.crowdNote = { hour: state.hour, over };
    addCard(state, overcrowdCard(state, b));
  }
}

export function overcrowdCard(state, base) {
  const ci = crowdInfo(state, base);
  const room = state.bases.filter((b) => b !== base && freeBeds(state, b) > 0).map((b) => `${b.name} ${freeBeds(state, b)}`);
  return {
    title: `${base.name} is overcrowded`,
    text: `${ci.people} people live at ${base.name} with ${ci.beds} beds: ${ci.people - ci.beds} more than it has beds for. Crowding costs everyone there ${ci.penalty} mood a day, and illness spreads faster in crowded bunks. Build a bunkhouse (+6 beds), or move a team out: to found a new outpost, or to another of your bases with room (${room.length ? `free beds: ${room.join(", ")}` : "none has a free bed now"}).`,
    crowdFor: base.id,
    choices: [
      {
        label: "Move a team out…",
        hint: `Pick who goes, their transport and what they take from ${base.name}. Then send them anywhere on the map: build an outpost there, or go to another of your bases and move in.`,
        uiAction: { type: "moveout", baseId: base.id },
        ai: () => -1, // a person's call (the planner); the autopilot never takes it
        resolve: () => "",
      },
      {
        label: "Leave it for now",
        hint: `Nothing changes. Asked again in ${CROWD_CARD.days} days, or sooner if it gets worse. Move people out any time from the base screen.`,
        ai: () => 1,
        resolve: () => "",
      },
    ],
  };
}

// ---------- moving a team out ----------
// opts: { baseId, memberIds, vehicleId, stance, supplies, dest (a tile, or null: they wait outside), lights, tabs }.
// Returns { party } or { error }.
export function moveTeamOut(state, opts) {
  const base = baseById(state, opts.baseId);
  if (!base) return { error: "That base is no longer yours." };
  const dest = opts.dest != null && opts.dest !== base.tile ? opts.dest : null;
  const to = dest != null ? state.bases.find((b) => b.tile === dest) || null : null;
  const res = launchExpedition(state, {
    memberIds: opts.memberIds, dest: dest ?? base.tile, mission: "move", stance: opts.stance || "normal", vehicleId: opts.vehicleId || null,
    supplies: opts.supplies || {}, fromBaseId: base.id, lights: opts.lights !== false, tabs: !!opts.tabs, quiet: true,
  });
  if (res.error) return res;
  const p = res.party;
  p.teamMission = "moveout";
  const who = list(partyMembers(state, p).map(firstName));
  const v = partyVehicle(state, p);
  const how = v ? ` in the ${v.name}` : "";
  if (to) {
    p.joinBaseId = to.id; // the autopilot's answer to the Enter card there (and the team panel's line)
    log(state, `${who} moved out of ${base.name}${how}, for ${placeName(to)} (about ${p.etaOut}h). There they can move in.`, "info");
  } else {
    // Outside the gate, waiting: the team is on the map, nothing planned yet.
    p.phase = "waiting";
    p.path = [base.tile];
    p.idx = 0;
    p.dest = base.tile;
    p.planPath = [base.tile];
    p.etaOut = 0;
    log(state, `${who} moved out of ${base.name}${how} and wait outside for orders: send them where to found an outpost, or to another of your bases.`, "info");
  }
  return { party: p };
}

// ---------- moving into another base ----------
// The base of yours a team stands on when it is not the team's home (null otherwise, or not a team that may join).
export function enterTarget(state, p) {
  if (!p || p.owner !== "player" || p.kind !== "expedition" || p.caravan || p.crewRole != null) return null;
  const b = state.bases.find((x) => x.tile === partyTile(p));
  return b && b.id !== p.homeBaseId ? b : null;
}

// The Enter base order (parties.js orderOptions, MISSIONS.enter; the team panel, the orders card, the tile panel's
// team card): any team of yours standing on one of your bases, its home included (a team that waited outside, ended
// another order there or said No on the Enter card), moves in now: the same as Yes on the Enter card (joinBase).
// Not for convoys, caravans or crews (they have their own business at a base). Null when it does not apply.
export function enterOption(state, p, tile = partyTile(p)) {
  if (!p || p.owner !== "player" || p.kind !== "expedition" || p.caravan || p.crewRole != null) return null;
  const base = state.bases.find((b) => b.tile === tile);
  if (!base) return null;
  const n = partyMembers(state, p).length, free = freeBeds(state, base);
  const v = partyVehicle(state, p);
  const home = baseById(state, p.homeBaseId);
  return {
    mission: "enter", label: `Enter ${base.name}`, disabled: n ? null : "Nobody left on the team.",
    desc: `Move into ${base.name}: ${n === 1 ? "they live" : "everyone on the team lives"} and works there from now on${home && home !== base ? ` instead of ${home.name}` : ""}, what the team carries goes into its stores and armory${v ? `, the ${v.name} parks there` : ""}, and the team is disbanded. ${baseBeds(base)} beds for ${residents(state, base.id).length} people: ${free >= n ? "room for them" : `with them it is over by ${n - free} (crowding costs mood)`}.`,
  };
}

export function enterCard(state, p, base) {
  const people = partyMembers(state, p);
  const n = people.length;
  const free = freeBeds(state, base);
  const home = baseById(state, p.homeBaseId);
  const v = partyVehicle(state, p);
  const beds = `${base.name} has ${baseBeds(base)} beds for ${residents(state, base.id).length} people: ${free >= n ? `room for ${n === 1 ? "them" : `all ${n}`}` : free > 0 ? `room for ${free}, with them it is over by ${n - free}` : `with them it is over by ${n - free}`}.`;
  return {
    title: `Enter ${base.name}?`,
    text: `${list(people.map(firstName))} reached ${base.name}. Move in? They would live and work there from now on${home ? ` instead of ${home.name}` : ""}: what they carry goes into its stores and armory${v ? `, and the ${v.name} parks there` : ""}. ${beds}`,
    partyId: p.id,
    enterBase: base.id,
    choices: [
      {
        label: `Yes, move into ${base.name}`,
        hint: `They become people of ${base.name}; the team ends here.${free < n ? " Crowding there costs mood every day." : ""}`,
        ai: () => (p.joinBaseId === base.id || freeBeds(state, base) >= partyMembers(state, p).length ? 5 : -1),
        resolve: (st) => joinBase(st, p, base),
      },
      {
        label: "No, stay a team",
        hint: "They stay on the map outside the base and wait for your orders.",
        ai: () => 0,
        resolve: (st) => {
          if (!st.parties.includes(p)) return "";
          awaitOrders(st, p, `The team stays outside ${base.name}.`, { hold: true });
          return "";
        },
      },
    ],
  };
}

// The team moves into the base it stands on: home there from now on (parties.js startReturn unloads it there).
export function joinBase(state, p, base) {
  if (!state.parties.includes(p)) return "That team is gone.";
  if (!state.bases.includes(base)) {
    awaitOrders(state, p, `${base.name} is no longer yours.`, { failed: true, hold: true });
    return "";
  }
  if (partyTile(p) !== base.tile) { awaitOrders(state, p, `The team is not at ${base.name}.`, { failed: true, hold: true }); return ""; }
  const people = partyMembers(state, p), names = list(people.map(firstName));
  const name = teamName(state, p);
  const own = p.homeBaseId === base.id; // its own home: "is home", not "moved into"
  if (!own) p.movingIn = true; // returnHome's log line: "moved into", not "is home"
  p.homeBaseId = base.id;
  p.orders = [];
  startReturn(state, p);
  if (state.parties.includes(p)) return `${name} could not move into ${base.name}.`; // never expected: at the base already
  // You were told on the Enter card how full it is: no Overcrowded card for that straight after (crowdCardsHour).
  if (overBeds(state, base) > 0) base.crowdNote = { hour: state.hour, over: overBeds(state, base) };
  return own ? `${names} ${people.length === 1 ? "is" : "are"} home at ${base.name}.` : `${names} moved into ${base.name}.`;
}
