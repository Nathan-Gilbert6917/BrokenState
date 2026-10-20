// Choices before a raid (docs/suggestions-5.md #23): the side to come in from, a scout sent first, or waiting for night.
// Played out with what is already there: the raid map's extraction zones (combat.js genRaidMap, buildingmaps.js),
// the guards' notice range and the dark (stealth.js noticeRange, vision.js DARK), night vision and the optics
// (optics.js battleOptic), the fog of war's memory (b.seenMemo, b.ghosts).
//
// Where: a raid on a site played on its map (scavenge.js startScavenge in the browser), the storming of a group's base
// (conquest.js startAssault) and a rescue raid (rescueraid.js startRescueRaid): their setups carry plan: true, and the
// battle opens with the plan (setup.plan, plain data: a save keeps it) offered before anyone acts, as a site's choice of
// building is (combat.js R.choose). While the plan is open the team is not on the map yet (the user's request
// 2026-10-18): the battle screen shows the site under the fog of war with nobody of yours placed (ui/combat.js view,
// ui/isoview.js), and the plan is a window over it (ui/raidplan.js, ui.js pickModal). Going in is picking the side to
// come in from (enterFrom: the side, then goIn), with or without a scout first; a scout's marks can be looked at on
// the map before going in (Look at the map first, only once a scout has been). Leave (callOff) turns the team back
// without going in: the battle ends at once with nobody hurt (a raid as called off: scavenge.js afterRaid; an assault
// or a rescue as a retreat with everyone out), the hours a scout or the wait took spent. Acting with anyone (the
// bots), or Go in, closes the plan as before. Fights by the numbers (headless, the autopilot, auto-resolve) have no
// plan; the hour-by-hour search (state.engagement) has its own two below.
//
// Entry side (setEntry): the raid map's ways in and out are its extraction zones (west and east and one of north or
// south on a street map; a building's front, back and side exits); the one the team comes in at is zones[0], where it
// starts with its vehicle. Picking another side builds the same map again (the battle's dice from where they stood when
// the map was first made: plan.rs) with that zone first: the team, the vehicle and the enemy's distance from the
// entry follow it. A base (a fort) has one side here: the team's.
// Send a scout (sendScout): one of the team (the best by default) goes round the site first. One hour on the clock.
//   Their notice range N (stealth.js noticeRange: 8 − Stealth ÷ 4 tiles, at least 3; the dead at most 5; at night
//   × 0.6, at least 2), the scout's look L (by day SCOUT.DAY_LOOK tiles + the optics: binoculars or a spotting scope +3,
//   a monocular or a thermal +2; at night the dark's sight by the hour (4–7) or 12 with night vision or a thermal, + a
//   thermal's 2). Odds: SCOUT.BASE + SCOUT.PER_TILE × (L − N) + SCOUT.PER_SKILL × Scouting, SCOUT.MIN–SCOUT.MAX.
//   Success: everything within L × SCOUT.REACH tiles of the site's middle is known (the enemies there marked where they
//   stand, the rooms, containers and doors under the fog seen), and how many they are; a clean one (the roll under
//   half the odds) counts them all. Failure: the scout is seen: every person of theirs starts alerted, the dead near
//   the middle too, a raid's Heat +SCOUT.FAIL_HEAT, and SCOUT.WOUND of the time the scout comes back hurt
//   (SCOUT.HURT, never to death). Own dice (skills.js hash01), so the battle's dice are untouched.
// Wait for night (waitNight): by day the team holds at the site until 20:00, the clock running (the hours tick: they
//   eat, the world moves on). The same map, at night: vision.js night sight by the hour, lights as beams, the guards
//   notice at × 0.6 (stealth.js), the dead see 5, a raid's Heat starts at 0 instead of 5.
// The hour-by-hour search (state.engagement, scavenge.js) before its approach is picked: engScout (the same odds;
//   success: Heat −SCOUT.ENG_HEAT and × SCOUT.ENG_LOOT finds while they search; failure: Heat +SCOUT.ENG_FAIL_HEAT and
//   the wound) and engWaitNight (the hours to 20:00; the day's 5 starting Heat goes).
// AI: the battle screen's AI playing your side (ui/combat.js combatTick → botPlan) sends its best scout when the odds are at
//   least SCOUT.BOT_ODDS, waits for night when it is at most SCOUT.BOT_WAIT hours off and the team is stealthy (Stealth
//   SCOUT.BOT_STEALTH on average, or night vision on everyone), and keeps the side. The battle AI anywhere else (combat.js
//   autoPlayerTurn: headless tools, a fight the autopilot finishes) goes in as things are. The autopilot (engagements) scouts
//   a guarded or badly infested site with a scout of SCOUT.BOT_ODDS (autopilot.js engagementHour).
import { isNight, hourOfDay, skill, tickHour, hurt, localId } from "./world.js";
import { woundMult } from "./traits.js";
import { woundTrauma } from "./health.js";
import { hash01 } from "./skills.js";
import { battleOptic } from "./optics.js";
import { helmetNvg } from "./helmets.js";
import { VISION } from "./vision.js";
import { STEALTH } from "./stealth.js";
import { wakeLights } from "./ailights.js";
import { createBattle, combatants, startCombat, say, endCalledOff } from "./combat.js";
import { armsDropsEnd } from "./carry.js";
import { gunOut } from "./gunload.js"; // the rounds in each gun back onto the gun before the battle is made again
import { isStacked } from "./mags.js";
import { stackN } from "./roundstack.js";
import { partyMembers as membersOf } from "./parties.js";
import { partyMembers, wipeParty, tileLabel } from "./parties.js";

export const SCOUT = {
  DAY_LOOK: 8, NVG_LOOK: 12, BASE: 0.5, PER_TILE: 0.06, PER_SKILL: 0.02, MIN: 0.1, MAX: 0.95,
  REACH: 1.6, FAIL_HEAT: 6, WOUND: 0.5, HURT: [8, 18], HOURS: 1,
  ENG_HEAT: 5, ENG_LOOT: 1.15, ENG_FAIL_HEAT: 10,
  BOT_ODDS: 0.7, BOT_WAIT: 4, BOT_STEALTH: 5,
};
export const NIGHT_FROM = 20; // world.js isNight: 20:00–06:00
export const SIDES = ["north", "east", "south", "west"];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const first = (s) => String(s.name || "").split(" ")[0];
const isPlan = (p) => !!p && typeof p === "object";
// The plan of a battle still offered (null once anyone acted or the team went in).
export const planOf = (b) => (b && b.setup && isPlan(b.setup.plan) ? b.setup.plan : null);
export const planOpen = (b) => { const P = planOf(b); return !!(P && P.open && !b.over); };
// Hours from now to nightfall (0 at night).
export const hoursToNight = (state) => (isNight(state) ? 0 : NIGHT_FROM - hourOfDay(state));

// ---------- the scout's odds ----------
// ctx: { night, hour (the hour of the night, vision.js DARK), humans (their people are there, not only the dead) }.
// Returns { odds, look, notice, reach, optic, nvg }.
export function scoutOdds(s, ctx) {
  const stealth = skill(s, "stealth"), scouting = skill(s, "scouting");
  const range = Math.max(3, 8 - Math.floor(stealth / 4)); // stealth.js noticeRange
  let notice = ctx.humans ? range : Math.min(range, 5);
  if (ctx.night) notice = Math.max(2, Math.round(notice * STEALTH.NIGHT_DETECT));
  const tool = s.gear && s.gear.tool;
  const nvg = !!(tool && (tool.key === "nvg" || tool.key === "thermal")) || helmetNvg(s);
  const optic = battleOptic(s, !!ctx.night);
  const dark = VISION.DARK[Number.isFinite(ctx.hour) ? ctx.hour : 0] ?? VISION.DARK[0];
  const look = (ctx.night ? (nvg ? SCOUT.NVG_LOOK : dark) : SCOUT.DAY_LOOK) + optic;
  const odds = clamp(SCOUT.BASE + SCOUT.PER_TILE * (look - notice) + SCOUT.PER_SKILL * scouting, SCOUT.MIN, SCOUT.MAX);
  return { odds, look, notice, reach: Math.round(look * SCOUT.REACH), optic, nvg };
}
// What a battle's scout faces: the night and its hour, and whether people of theirs are there.
export function scoutCtx(b) {
  const humans = b.units.some((u) => u.side === "enemy" && u.kind === "human" && !u.dead);
  return { night: !!b.night, hour: b.hour, humans };
}
// The team's candidates, best first: [{ s, id, name, ...scoutOdds }].
export function scoutChoices(state, b) {
  const ctx = scoutCtx(b);
  return combatants(state, b.setup).filter((s) => s.alive).map((s) => ({ s, id: s.id, name: s.name, ...scoutOdds(s, ctx) }))
    .sort((a, c) => c.odds - a.odds || a.id - c.id);
}

// ---------- the plan on a battle ----------
// The sides a battle's team can come in from: a raid map's zones (ground floor), else the one it starts at.
export function sidesOf(b) {
  if (b.raid && b.raid.zones && b.raid.zones.length) {
    const have = new Set(b.raid.zones.map((z) => z.side).filter(Boolean));
    return SIDES.filter((x) => have.has(x));
  }
  return [b.evacSide === "right" ? "east" : "west"];
}
const entryOf = (b) => (b.raid && b.raid.zones && b.raid.zones[0] ? b.raid.zones[0].side : sidesOf(b)[0]);
// combat.js createRaid / createBattle, when the battle is made: a setup with plan: true gets its plan; a plan already
// there (the battle made again: a side, a scout, the night, a building picked) is applied to the new map.
// rs: the battle's dice before the map was made (the same map again: rebuild).
export function planStart(state, b, rs) {
  const setup = b.setup;
  if (!setup || !setup.plan) return;
  if (!isPlan(setup.plan)) setup.plan = { open: true, side: null, sides: [], rs, scout: null, night: null, hours: 0, kind: b.raid ? "raid" : setup.layout === "rescueRaid" ? "rescue" : "assault" };
  const P = setup.plan;
  if (!P.replay) P.rs = rs; // a new map (the first, or the building picked): its dice
  P.sides = sidesOf(b);
  P.side = entryOf(b);
  if (P.scout) applyScout(state, b, P.scout);
  if (P.open && !P.replay && !P.said) {
    P.said = true;
    say(b, `Before you go in: send a scout first, ${b.night ? "" : "wait for night, "}${P.sides.length > 1 ? "pick the side to come in from" : "go in"}, or leave. Nobody is on the map until you go in.`, "good");
  }
}
// Closed: the team goes in as it is (combat.js combatAct: anyone acted).
export function closePlan(b) {
  const P = planOf(b);
  if (P && P.open) P.open = false;
}
export function goIn(state) {
  const b = state.combat;
  const P = planOf(b);
  if (!P || !P.open) return "Nothing to plan now.";
  P.open = false;
  say(b, `The team goes in from the ${P.side}${P.scout ? (P.scout.ok ? ", knowing what the scout saw" : ", and they know you are here") : ""}${P.night ? ", under the dark" : ""}.`, "info");
  b.rev++;
  return "";
}
// Go in from a side (the window's North / East / South / West, or Go in where there is one way): the team is placed
// at that zone (setEntry: the same map again when it is another side) and the plan closes. side null: the side as it
// stands. Returns "" or why not.
export function enterFrom(state, side = null) {
  const b = state.combat;
  const P = planOf(b);
  if (!P || !P.open || b.over) return "Nothing to plan now.";
  if (side && side !== P.side) {
    const err = setEntry(state, side);
    if (err) return err;
    if (!state.combat || state.combat.over) return "";
  }
  return goIn(state);
}
// The team's kit before going in (the user's request 2026-10-18: the team inventory, and Teams together, from the
// window). The battle staged the team's loads as it was made (carry.js: what was carried in the arms went into the
// car or down on the start cell), so before a window that moves things about those go back to the team (unstage),
// and afterwards the same battle is made again (refit): its units take the field with what each member wears and
// holds now, the loads staged again, the scout's marks and the enemy's state as they were.
export function unstage(state) {
  const b = state.combat;
  if (!planOpen(b)) return false;
  armsDropsEnd(state, b, "victory"); // carry.js: the loads set down at the start back to the team
  return true;
}
export function refit(state) {
  const b = state.combat;
  if (!planOpen(b)) return null;
  const nb = rebuild(state);
  if (nb) say(nb, "The team sorted its kit before going in.", "info");
  return nb;
}
// The battle's own team (the window's inventory is theirs).
export function planParty(state, b = state.combat) {
  if (!b || !b.setup || b.setup.partyId == null) return null;
  const p = state.parties.find((x) => x.id === b.setup.partyId);
  return p && p.owner === "player" && membersOf(state, p).length ? p : null;
}
// Leave without going in: the team turns back from the site. Nobody steps onto the map, so nobody is hurt and nothing
// is searched; the hours a scout or the wait for night took are spent (the clock ran then). The battle ends at once
// (combat.js endCalledOff): a raid as called off (its result's raid.calledOff; scavenge.js afterRaid says so and
// takes no more time), an assault or a rescue as a retreat with everyone out. Returns "" or why not.
export function callOff(state) {
  const b = state.combat;
  const P = planOf(b);
  if (!P || !P.open || b.over) return "Nothing to plan now.";
  P.open = false;
  P.calledOff = true;
  b.calledOff = true;
  const hadVehicle = !!(b.raid && (b.raid.hasVehicle ?? b.raid.vehicleZone >= 0));
  for (const u of b.units) {
    if (u.side !== "player" || u.dead) continue;
    u.left = true; u.aboard = false; u.off = false; u.ap = 0; u.ow = u.hunker = false;
    if (b.raid) { u.exitZone = hadVehicle ? b.raid.vehicleZone : 0; u.exitVehicle = hadVehicle; }
  }
  say(b, `${b.raid ? "The raid" : P.kind === "rescue" ? "The rescue" : "The assault"} is called off: the team turns back without going in${P.hours ? ` (${P.hours} h spent)` : ""}.`, "info");
  endCalledOff(state);
  return "";
}

// The rounds in each gun of yours back onto the gun before its unit is dropped (gunload.js gunOut: it.loaded with the
// stack): the battle made again loads exactly those (mags.js fillUnit reads the record), so nothing is lost and nothing
// is loaded twice. Without it every rebuild (another side, a scout, the night, the kit sorted) threw a magazine's
// worth a gun away: the fill at the start had taken them out of the pockets' boxes and the team's bags onto the unit
// (the user's report 2026-10-18: rounds moved onto a survivor before a raid gone when it started). A gun with a record
// already (its unit emptied by an earlier pass) is left as it is.
function gunsOut(b) {
  for (const u of b.units || []) {
    if (u.side !== "player" || u.dead || !isStacked(u) || !u.item || u.item.loaded || !(stackN(u.stack) > 0)) continue;
    gunOut(b, u, u.item);
  }
}
// The battle made again on the same setup from the same dice (the same map): what was set down at the start is
// picked up first, and the clock's dice go on from where they are now. Returns the new battle, or null when nobody is
// left to fight it (the battle is dropped, the next one queued opens).
function rebuild(state) {
  const b = state.combat;
  const setup = b.setup, P = setup.plan;
  armsDropsEnd(state, b, "victory"); // carry.js: the loads staged at the start back to the team
  gunsOut(b); // the guns keep what is in them
  if (!combatants(state, setup).length) {
    state.combat = null;
    const p = setup.partyId != null ? state.parties.find((x) => x.id === setup.partyId) : null;
    if (p && p.owner === "player" && !partyMembers(state, p).length) wipeParty(state, p);
    while (!state.combat && state.combatQueue && state.combatQueue.length) startCombat(state, state.combatQueue.shift());
    return null;
  }
  const keep = state.rng.state;
  state.rng.state = P.rs;
  P.replay = true;
  try {
    state.combat = createBattle(state, setup);
  } finally {
    P.replay = false;
    state.rng.state = keep;
  }
  return state.combat;
}

// Come in from another side (a raid map). Returns "" or why not.
export function setEntry(state, side) {
  const b = state.combat;
  const P = planOf(b);
  if (!P || !P.open || b.over) return "Nothing to plan now.";
  if (!b.raid) return "There is only the one way in here.";
  if (!P.sides.includes(side)) return `There is no way in from the ${side} here.`;
  if (P.side === side) return "";
  P.side = side;
  const nb = rebuild(state);
  if (nb) say(nb, `The team circles round to come in from the ${side}.`, "info");
  return "";
}

// Send one of the team (sid; the best scout when left out) round the site first. Returns "" or why not.
export function sendScout(state, sid = null) {
  const b = state.combat;
  const P = planOf(b);
  if (!P || !P.open || b.over) return "Nothing to plan now.";
  if (P.scout) return "The scout has been out already.";
  const list = scoutChoices(state, b);
  const c = sid == null ? list[0] : list.find((x) => x.id === Number(sid));
  if (!c) return "Nobody on the team can go.";
  // localId: survivor ids are process-wide (world.js newId), so the raw id gave a second world of the same seed other
  // rolls (tools/discoverytest.js determinism); the id counted from the world's start is the same in both.
  const roll = hash01(state.seed, "raidscout", b.tileId, state.hour, localId(state, c.id));
  const ok = roll < c.odds;
  const sc = { sid: c.id, name: c.name, odds: c.odds, look: c.look, notice: c.notice, reach: c.reach, roll, ok, clean: ok && roll < c.odds / 2, wound: 0, hour: state.hour, night: !!b.night };
  if (!ok && hash01(state.seed, "raidscout-wound", b.tileId, state.hour, localId(state, c.id)) < SCOUT.WOUND) {
    const s = c.s;
    const amt = woundOf(state, s, "raidscout-hurt");
    if (amt > 0) { scoutHurt(state, s, amt, b.tileId, `spotted scouting ${b.place}`); sc.wound = amt; }
  }
  P.scout = sc;
  // The hour it took: the clock runs (the world moves on), then the same map at the new hour.
  for (let i = 0; i < SCOUT.HOURS && !state.gameOver; i++) tickHour(state);
  P.hours += SCOUT.HOURS;
  if (state.combat !== b) return ""; // (never: the battle stays open while the hour passes)
  const nb = rebuild(state);
  if (nb) say(nb, scoutText(sc), sc.ok ? "good" : "danger");
  return "";
}
// The scout's wound when seen: SCOUT.HURT by its own dice, never to death (Frail people's 1.25 counted: world.js hurt).
function woundOf(state, s, key) {
  const amt = SCOUT.HURT[0] + Math.floor(hash01(state.seed, key, localId(state, s.id), state.hour) * (SCOUT.HURT[1] - SCOUT.HURT[0] + 1));
  return Math.max(0, Math.min(amt, Math.floor((s.health - 10) / Math.max(1, woundMult(s)))));
}
// The wound as said (−amt health), taken as it is: a scramble when spotted, a fall, a graze on the run, not a hit
// the armour worn takes (world.js hurt would shrink it by the armour and Tough, so a scout in a vest came back
// "hurt (−12)" and stood at 98: the user's report 2026-10-18). Never to death (woundOf). It may need dressing.
function scoutHurt(state, s, amt, tileId, cause) {
  hurt(state, s, amt, tileId, cause, { raw: true });
  if (s.alive) woundTrauma(state, s, amt); // health.js: a real wound may need dressing
}
export function scoutText(sc) {
  const who = first(sc);
  if (sc.ok) return `${who} scouted the site (${Math.round(sc.odds * 100)}%): ${sc.seen ? `${sc.seen} of them seen` : "nobody seen about"} within ${sc.reach} tiles of its middle${sc.clean ? `, ${sc.total} in all${sc.total > (sc.seen || 0) ? " (the rest further off or inside)" : ""}` : ""}. What ${who} saw is marked under the fog.`;
  return `${who} was seen scouting (${Math.round(sc.odds * 100)}%)${sc.wound ? ` and came back hurt (−${sc.wound} health)` : ""}: they know you are here.`;
}

// What the scout found, on a (new) battle: success marks the enemies and the ground within reach of the site's middle;
// failure alerts them.
export function applyScout(state, b, sc) {
  const cx = Math.floor(b.w / 2), cy = Math.floor(b.h / 2);
  const near = (x, y, r) => Math.hypot(x - cx, y - cy) <= r;
  const foes = b.units.filter((u) => u.side === "enemy" && !u.dead && !u.off);
  sc.total = foes.length;
  if (sc.ok) {
    const g = b.ghosts || (b.ghosts = {});
    let seen = 0;
    for (const e of foes) if ((e.f || 0) === 0 && near(e.x, e.y, sc.reach)) { g[e.id] = [e.x, e.y, b.turn, 0]; seen++; }
    sc.seen = seen;
    if (b.raid) {
      // The fog's memory (ui/combat.js rememberSeen reads it): the cells within reach seen, the containers there as they are.
      const memo = b.seenMemo || (b.seenMemo = {});
      const old = memo[0] && typeof memo[0].cells === "string" && memo[0].cells.length === b.w * b.h ? memo[0].cells : null;
      let cells = "";
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) cells += near(x, y, sc.reach) || (old && old.charCodeAt(y * b.w + x) === 49) ? "1" : "0";
      const boxes = { ...((memo[0] && memo[0].boxes) || {}) };
      for (const c of b.raid.containers) if ((c.f || 0) === 0 && near(c.x, c.y, sc.reach)) boxes[c.id] = { searched: !!c.searched, quick: !!c.quick, partial: !!c.partial, lock: c.lock ? { ...c.lock } : null };
      memo[0] = { cells, boxes };
      b.raid.scouted = { x: cx, y: cy, r: sc.reach };
    } else b.scouted = { x: cx, y: cy, r: sc.reach };
    return;
  }
  const woke = [];
  for (const e of foes) {
    if (e.aware || e.side !== "enemy") continue;
    if (e.kind === "human" || near(e.x, e.y, sc.look + 3)) { e.aware = true; woke.push(e); }
  }
  if (woke.length) wakeLights(b, woke); // ailights.js: their flashlights on in the dark
  if (b.raid) b.raid.heat = Math.min(100, (b.raid.heat || 0) + SCOUT.FAIL_HEAT);
}

// Hold until dark, then the same map at night. Returns "" or why not.
export function waitNight(state) {
  const b = state.combat;
  const P = planOf(b);
  if (!P || !P.open || b.over) return "Nothing to plan now.";
  const n = hoursToNight(state);
  if (!n) return "It is night already.";
  const from = state.hour;
  for (let i = 0; i < n && !state.gameOver; i++) tickHour(state);
  P.night = { from, to: state.hour, hours: n };
  P.hours += n;
  const setup = b.setup;
  if (setup.raid) setup.raid.heat0 = 0; // scavenge.js: a raid by night starts quiet
  if (setup.context && "night" in setup.context) setup.context.night = isNight(state); // rescueraid.js: the guards asleep
  if (state.combat !== b) return "";
  const nb = rebuild(state);
  if (nb) say(nb, `The team waited ${n} hour${n === 1 ? "" : "s"} out of sight for the dark.`, "info");
  return "";
}

// What waiting for night would do, for the card: { hours, notice: [day, night], dead, sight, heat }.
export function nightTradeoff(state, b) {
  const s = combatants(state, b.setup).filter((x) => x.alive);
  const stealth = s.length ? Math.max(...s.map((x) => skill(x, "stealth"))) : 0;
  const range = Math.max(3, 8 - Math.floor(stealth / 4));
  const nvg = s.filter((x) => { const t = x.gear && x.gear.tool; return !!(t && (t.key === "nvg" || t.key === "thermal")) || helmetNvg(x); }).length;
  const dusk = VISION.DARK[NIGHT_FROM];
  return { hours: hoursToNight(state), notice: [range, Math.max(2, Math.round(range * STEALTH.NIGHT_DETECT))], dead: STEALTH.NIGHT_ZOMBIE_SIGHT, dark: [VISION.DARK[0], dusk], nvgSight: SCOUT.NVG_LOOK, nvg, team: s.length, heat: b.raid ? (b.setup.raid && b.setup.raid.heat0) || 0 : null };
}

// ---------- the AI playing your side ----------
export function botPlan(state, b) {
  if (!planOpen(b)) return;
  const best = scoutChoices(state, b)[0];
  if (best && best.odds >= SCOUT.BOT_ODDS && !planOf(b).scout) {
    sendScout(state, best.id);
    if (!state.combat || state.combat.over) return;
    b = state.combat;
  }
  const n = hoursToNight(state);
  if (n && n <= SCOUT.BOT_WAIT) {
    const team = combatants(state, b.setup).filter((x) => x.alive);
    const st = team.reduce((a, x) => a + skill(x, "stealth"), 0) / Math.max(1, team.length);
    if (team.length && (st >= SCOUT.BOT_STEALTH || nightTradeoff(state, b).nvg >= team.length)) {
      waitNight(state);
      if (!state.combat || state.combat.over) return;
    }
  }
  goIn(state);
}

// ---------- the hour-by-hour search (scavenge.js state.engagement) ----------
// The engagement's scout context: guarded by people, or the dead only (scavenge.js raidEnemies would say who).
export function engCtx(state, e) {
  return { night: isNight(state), hour: hourOfDay(state), humans: !!e.guarded };
}
export function engScoutChoices(state, p, e) {
  const ctx = engCtx(state, e);
  return partyMembers(state, p).map((s) => ({ s, id: s.id, name: s.name, ...scoutOdds(s, ctx) })).sort((a, c) => c.odds - a.odds || a.id - c.id);
}
// The scout's hour on an engagement (the caller moves the clock: main.js, the autopilot's own hour).
export function engScout(state, p, sid = null) {
  const e = state.engagement;
  if (!e || e.done || e.approach || e.scout) return "Not now.";
  const list = engScoutChoices(state, p, e);
  const c = sid == null ? list[0] : list.find((x) => x.id === Number(sid));
  if (!c) return "Nobody to send.";
  const roll = hash01(state.seed, "engscout", e.tile, state.hour, localId(state, c.id));
  const ok = roll < c.odds;
  e.scout = { sid: c.id, name: c.name, odds: c.odds, ok, wound: 0 };
  if (ok) {
    e.heat = Math.max(0, e.heat - SCOUT.ENG_HEAT);
    e.log.push(`${first(c)} scouted the site first (${Math.round(c.odds * 100)}%): the team knows where to look and where the dead are (Heat −${SCOUT.ENG_HEAT}, finds ×${SCOUT.ENG_LOOT}).`);
  } else {
    e.heat = Math.min(100, e.heat + SCOUT.ENG_FAIL_HEAT);
    if (hash01(state.seed, "engscout-wound", e.tile, state.hour, localId(state, c.id)) < SCOUT.WOUND) {
      const amt = woundOf(state, c.s, "engscout-hurt");
      if (amt > 0) { scoutHurt(state, c.s, amt, e.tile, `spotted scouting ${tileLabel(state, e.tile)}`); e.scout.wound = amt; }
    }
    e.log.push(`${first(c)} was seen scouting (${Math.round(c.odds * 100)}%)${e.scout.wound ? ` and came back hurt` : ""}: the site is stirred up (Heat +${SCOUT.ENG_FAIL_HEAT}).`);
  }
  return "";
}
// Wait for night before the search: the clock runs to 20:00 (n ticks); the day's starting Heat goes.
export function engWaitNight(state) {
  const e = state.engagement;
  if (!e || e.done || e.approach || e.night) return "Not now.";
  const n = hoursToNight(state);
  if (!n) return "It is night already.";
  for (let i = 0; i < n && !state.gameOver; i++) tickHour(state);
  if (state.engagement !== e) return "";
  e.night = { hours: n };
  e.heat = Math.max(0, e.heat - 5); // scavenge.js startScavenge: a day search starts at 5
  e.log.push(`The team waited ${n} hour${n === 1 ? "" : "s"} for the dark. Searching at night: Heat climbs 2 an hour slower.`);
  return "";
}
// Help → Choices before a raid (ui/help.js).
const P100 = (v) => `${Math.round(v * 100)}%`;
export const raidPlanHelp = () => `<p>A raid on a site played on its map (and the storming of a group's base, or a rescue raid) opens with the <b>Before you go in</b> window over the battle screen. Behind it the site lies under the fog of war with nobody of yours on it: the team is not placed until you go in. The window shows a small map of the site, all fog but for its ways in (green) until a scout has been round, then what the scout saw.</p>
<p><b>Go in from</b> North, East, South or West: the sides the map has a way in on (its extraction zones: on a street map the west, the east and one of north or south, both on a map past 40 × 30; a building's front, back and side exits). Picking one goes in: the team and the vehicle are placed at that zone, the enemy away from it, and the fight begins. A base has one way in: <b>Go in</b>. You can go in with or without a scout first; a scout only tells you more. No time lost.</p>
<p><b>Look at the map first</b> (once a scout has come back unseen): the window is put aside and you can look over the site under the fog with the scout's marks on it (pan and zoom as in a fight); <b>Back to the plan</b> on the panel, or Esc, brings the window back. <b>Leave</b> calls the raid off: the team turns back without going in, nobody is hurt and nothing is searched; the hours a scout or the wait for night took are spent.</p>
<p><b>Team inventory</b> opens the team's inventory window from the plan: every member's kit and the team's cargo (its vehicles' load) side by side, to move things between members and between a member and the cargo. <b>Teams together</b> (when another team of yours stands on the tile) hands goods across, cargo to cargo or onto a member. When the window closes the battle is made again with the kit as it is now: each one takes the field with what they wear and hold.</p>
<p>A scout who was seen and came back hurt loses exactly the health the message says (not a hit the armour worn would take); the battle made again after the scout shows it. A clean scout's marks, a seen scout's alerted guards and the Heat it added all carry into the battle however it is made again (another side, the night, a kit sorted).</p>
<p><b>Send a scout first</b> (${SCOUT.HOURS} hour on the clock; each of the team with their odds, the best starred). Their notice range: 8 tiles, one less for every 4 points of the scout's Stealth (at least 3); the dead at most 5; at night × ${STEALTH.NIGHT_DETECT} (at least 2). The scout's look: ${SCOUT.DAY_LOOK} tiles by day, +3 with binoculars or a spotting scope, +2 with a monocular or a thermal; at night what the dark lets them see by the hour (4–7 tiles) or ${SCOUT.NVG_LOOK} with night vision or a thermal. The odds of going unseen: ${P100(SCOUT.BASE)} + ${P100(SCOUT.PER_TILE)} for every tile the look beats their notice + ${P100(SCOUT.PER_SKILL)} a point of Scouting (${P100(SCOUT.MIN)}–${P100(SCOUT.MAX)}).</p>
<p>Unseen: within ${SCOUT.REACH} × the look of the site's middle, everyone of theirs is marked on the map where they stood (faded, as last seen), and the rooms, containers and locked doors there are seen under the fog of war; you learn how many they are (all of them on a clean look). Seen: every one of their people starts alerted, the dead near the middle too, the raid's Heat +${SCOUT.FAIL_HEAT}, and ${P100(SCOUT.WOUND)} of the time the scout comes back hurt (${SCOUT.HURT[0]}–${SCOUT.HURT[1]} health, never to death).</p>
<p><b>Wait for night</b> (by day): the team holds out of sight until ${NIGHT_FROM}:00 while the clock runs (they eat and drink; the world moves on), then the same site in the dark. Stealth up: they notice you at × ${STEALTH.NIGHT_DETECT} the range, the dead see ${STEALTH.NIGHT_ZOMBIE_SIGHT} tiles, a raid's Heat starts at 0 instead of 5. Sight down: your people see 4–7 tiles ahead in the dark, ${SCOUT.NVG_LOOK} with night vision; a light switched on is a beam that gives you away (see Help: Battles).</p>
<p>Searching hour by hour (no battle map: battles resolved by the numbers, the autopilot) the search card has the same <b>Scout first</b> (unseen: Heat −${SCOUT.ENG_HEAT} and the finds × ${SCOUT.ENG_LOOT}; seen: Heat +${SCOUT.ENG_FAIL_HEAT} and maybe the wound) and <b>Wait for night</b>. The AI playing your side sends a scout of ${P100(SCOUT.BOT_ODDS)} or better and waits for night when it is ${SCOUT.BOT_WAIT} hours off or less and the team is stealthy; the autopilot sends a good scout to a guarded or badly infested site.</p>`;

// The finds' multiplier of a search a scout prepared (scavenge.js searchHour).
export const engLootMult = (e) => (e && e.scout && e.scout.ok ? SCOUT.ENG_LOOT : 1);
