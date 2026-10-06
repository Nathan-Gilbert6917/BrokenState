// Mental breaks: someone whose mood has sat under SNAP.at for SNAP.days mornings running at a base may break for
// good (every number in SNAP). Not the small breaks of relations.js (a day sat out, a binge, a fistfight: below 12
// mood, with relief after) but the ones that change the colony: they run off in the night, go for someone with a
// weapon (and may kill them), take their own life, set a building alight, wreck the stores, walk out past the walls
// into the dead, drive off with a car, or shut down for days. Which one is weighed by what is there (a car, a
// burnable building, other people) and who they are (grieving, armed, a coward, their rivals and partner).
//   - The counter (s.lowDays) counts mornings at a base with mood under SNAP.at; a morning at or over it resets it. On
//     the SNAP.days-th morning the log warns once and the People tab shows "May break down"; from then on each
//     morning there is SNAP.base + SNAP.per × (SNAP.at − mood) of a break. After one, SNAP.cooldown days before the
//     next, and whoever is still here and alive gets SNAP.relief mood (it is out of them, for now).
//   - An attack (snapAttack): the victim is the person they like least (a rival, else a stranger; the leader a third of
//     the time when they dislike them), struck with whatever is in their hand for SNAP.ATTACK.dmg (+ SNAP.ATTACK.armed
//     with a real weapon); killed outright at SNAP.ATTACK.kill (more when armed). The others pull them off: a card
//     (aftermathCard) asks what to do with them: confine them (SNAP.CONFINE days with no work, watched), cast them out
//     (gone like a deserter, with nothing from the stores), put them down (everyone's mood suffers), or forgive
//     (everyone uneasy, the victim most). Leaders break like anyone, but never run off, drive off or walk into the dead.
//   - Suicide and walking into the dead kill (world.js killSurvivor: grief, the memorial, their things to the armory);
//     everyone at the base takes SNAP.GRIM mood on top of the grief of friends.
//   - Running off is morale.js desert (the haul, a possible return); a car taken goes with them (the car is gone).
//   - A fire takes a burnable building (hubevents.js FIRE.burnable) as the fire event does when it is lost; wrecking
//     the stores spoils SNAP.STORES.share of the food and water (at most SNAP.STORES.max of each).
//   - Shutting down: SNAP.SHUTDOWN days in bed (the Rest role, no work), then back to their role.
// Every outcome is one log line (kind "death" where someone dies), a moment on the record where it fits, and a count
// in state.relStats.snaps[kind] for the tools. Only state.rng is drawn, only inside the daily tick (deterministic).
import { log, addCard, day, atBase, hurt, killSurvivor } from "./world.js";
import { BUILDINGS, count, assignStations } from "./buildings.js";
import { GEAR } from "./data.js";
import { desert, talker } from "./morale.js";
import { addMood, bumpPair, opinion, rivalsOf, partnerOf, addMoment, rec, friendsOf } from "./relations.js";
import { FIRE } from "./hubevents.js";
import { carsAtBase, vehicleLabel } from "./vehicles.js";

export const SNAP = {
  at: 10, days: 3, base: 0.12, per: 0.02, cooldown: 10, relief: 15,
  ATTACK: { dmg: [15, 35], armed: 12, kill: 0.15, killArmed: 0.3, leader: 0.33 },
  GRIM: 10,          // everyone at the base: a suicide, a killing, someone walking into the dead
  UNEASY: 4,         // everyone at the base: an attack, a fire, the stores wrecked
  CONFINE: 7, SHUTDOWN: [3, 6],
  STORES: { share: 0.15, max: 30 },
  DEAD: 0.2,         // walking into the dead needs this much Infection on the base's tile
  FORGIVE: { victim: -12, others: -6, killer: -10 }, // mood when a killer is forgiven (an attacker half)
  PUTDOWN: -8,       // everyone's mood when one of their own is put down
};
const first = (s) => s.name.split(" ")[0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const stat = (state, kind) => { const r = state.relStats || (state.relStats = { breaks: {} }); r.snaps = r.snaps || {}; r.snaps[kind] = (r.snaps[kind] || 0) + 1; };
const weaponOf = (s) => { const w = s.gear && s.gear.weapon; return w && GEAR[w.key] && GEAR[w.key].slot === "weapon" ? w : null; };
const here = (st, s, base) => s.alive && s.location && s.location.kind === "base" && s.location.baseId === base.id;

// The People tab and the alerts (morale.js moodRisk asks): on the edge of a break?
export const nearSnap = (s) => !!s && s.alive && (s.lowDays || 0) >= SNAP.days && s.mood < SNAP.at;

// ---------- daily (economy.js basesDaily, after relationsDaily) ----------
export function mentalBreaksDaily(state) {
  if (state.gameOver) return;
  const d = day(state);
  if (state.snapDay === d) return;
  state.snapDay = d;
  const rng = state.rng;
  for (const base of state.bases) {
    for (const s of [...atBase(state, base.id)]) {
      if (!s.alive) continue;
      if (s.mood >= SNAP.at) { if (s.lowDays) s.lowDays = 0; continue; }
      s.lowDays = (s.lowDays || 0) + 1;
      if (s.lowDays === SNAP.days) log(state, `${s.name} has been at rock bottom for ${SNAP.days} days (mood ${Math.round(s.mood)}). Nobody knows what they might do.`, "danger");
      if (s.lowDays < SNAP.days || (s.snapCd || 0) > d) continue;
      if (!rng.chance(SNAP.base + SNAP.per * (SNAP.at - s.mood))) continue;
      snap(state, base, s, rng);
    }
  }
}

// The break itself: which kind, by what is at hand. Returns the kind.
export function snap(state, base, s, rng, force = null) {
  const d = day(state);
  const t = state.tiles[base.tile];
  const others = atBase(state, base.id).filter((o) => o !== s);
  const cars = carsAtBase(state, base.id);
  const kinds = [];
  if (!s.leader) kinds.push(["runoff", 3]);
  if (others.length) kinds.push(["attack", 3 * (rivalsOf(state, s).length ? 1.5 : 1)]);
  kinds.push(["suicide", 1 + (s.grief ? 1 : 0) + (partnerOf(state, s) ? 0 : 0.3)]);
  if (base.buildings.some((b) => FIRE.burnable.includes(b.type))) kinds.push(["fire", 1.5]);
  if ((base.stock.food || 0) + (base.stock.water || 0) >= 20) kinds.push(["stores", 1.5]);
  if (!s.leader && t && (t.infection || 0) >= SNAP.DEAD) kinds.push(["dead", 1]);
  if (!s.leader && cars.length) kinds.push(["car", 1]);
  kinds.push(["shutdown", 2 + (s.traits.includes("coward") ? 1 : 0)]);
  const kind = force && kinds.some((k) => k[0] === force) ? force : rng.weighted(kinds, (k) => k[1])[0];
  s.snapCd = d + SNAP.cooldown;
  s.lowDays = 0;
  s.snaps = [...(s.snaps || []), { d, kind }];
  stat(state, kind);
  const name = first(s);
  const mood = Math.round(s.mood);
  if (kind === "runoff") {
    desert(state, base, s, { why: `${s.name} snapped: they walked out of ${base.name} in the night without a word to anyone (mood ${mood})` });
  } else if (kind === "car") {
    const car = cars[0];
    state.vehicles.splice(state.vehicles.indexOf(car), 1);
    desert(state, base, s, { why: `${s.name} snapped: they took the ${vehicleLabel(car)} and drove off from ${base.name} in the night (mood ${mood})` });
    (state.deserters || []).filter((e) => e.id === s.id).forEach((e) => { e.car = car.type; });
  } else if (kind === "suicide") {
    log(state, `${s.name} could not go on (mood ${mood}).`, "death");
    killSurvivor(state, s, base.tile, `by their own hand at ${base.name}`);
    grim(state, base, `${name}'s death`);
  } else if (kind === "dead") {
    log(state, `${s.name} walked out through the gate of ${base.name} in the night and kept walking (mood ${mood}). They were found at dawn among the dead, past helping.`, "death");
    killSurvivor(state, s, base.tile, `walking out into the dead from ${base.name}`);
    grim(state, base, `${name} walked into the dead`);
  } else if (kind === "fire") {
    const b = rng.pick(base.buildings.filter((x) => FIRE.burnable.includes(x.type)));
    const bn = BUILDINGS[b.type].name.toLowerCase();
    base.buildings.splice(base.buildings.indexOf(b), 1);
    if (b.type === "watchtower") base.watchtower = count(base, "watchtower") > 0;
    assignStations(state, base);
    s.onBreak = true;
    log(state, `${s.name} set fire to the ${bn} at ${base.name} in the night (mood ${mood}). It burned to the ground before anyone could stop it.`, "death");
    addMoment(state, s, `Burned down the ${bn} at ${base.name}, day ${d}`);
    uneasy(state, base, s, `${name} burned down the ${bn}`);
    aftermath(state, base, s, null, `${s.name} burned down the ${bn}.`);
  } else if (kind === "stores") {
    const lost = {};
    for (const k of ["food", "water"]) { const n = Math.min(SNAP.STORES.max, Math.floor((base.stock[k] || 0) * SNAP.STORES.share)); if (n > 0) { base.stock[k] -= n; lost[k] = n; } }
    s.onBreak = true;
    log(state, `${s.name} tore through the stores at ${base.name} in the night, smashing and spilling what they could (mood ${mood}): ${Object.entries(lost).map(([k, n]) => `${n} ${k}`).join(" and ") || "nothing much"} lost.`, "danger");
    uneasy(state, base, s, `${name} wrecked the stores`);
    aftermath(state, base, s, null, `${s.name} wrecked the stores.`);
  } else if (kind === "shutdown") {
    const days = rng.int(SNAP.SHUTDOWN[0], SNAP.SHUTDOWN[1]);
    if (s.role !== "rest") s.restPrev = s.role;
    s.role = "rest"; s.station = null; s.restUntil = d + days; s.onBreak = true;
    log(state, `${s.name} has stopped answering. They lie in their bunk at ${base.name} staring at the wall and will not get up (mood ${mood}): ${days} days, at least.`, "danger");
  } else snapAttack(state, base, s, others, rng);
  if (s.alive && here(state, s, base) && kind !== "shutdown") addMood(state, s, SNAP.relief, "It is out of them, for now");
  return kind;
}

// Everyone at the base after a death: grim.
function grim(state, base, label) {
  for (const o of atBase(state, base.id)) addMood(state, o, -SNAP.GRIM, label);
}
function uneasy(state, base, s, label) {
  for (const o of atBase(state, base.id)) if (o !== s) addMood(state, o, -SNAP.UNEASY, label);
}

// ---------- an attack ----------
// The person they like least; the leader only when they dislike them and the roll says so (or nobody else is here).
function victimOf(state, s, others, rng) {
  const leader = others.find((o) => o.leader);
  if (leader && opinion(state, s, leader) < 0 && rng.chance(SNAP.ATTACK.leader)) return leader;
  const pool = others.filter((o) => !o.leader);
  const from = pool.length ? pool : others;
  const low = Math.min(...from.map((o) => opinion(state, s, o)));
  return rng.pick(from.filter((o) => opinion(state, s, o) === low));
}
function snapAttack(state, base, s, others, rng) {
  const d = day(state);
  const v = victimOf(state, s, others, rng);
  const w = weaponOf(s);
  const armed = !!w; // anything in their hand counts
  const dmg = rng.int(SNAP.ATTACK.dmg[0], SNAP.ATTACK.dmg[1]) + (armed ? SNAP.ATTACK.armed : 0);
  const kills = rng.chance(armed ? SNAP.ATTACK.killArmed : SNAP.ATTACK.kill);
  const how = w ? `with ${w.name.toLowerCase().startsWith("a ") ? "" : "a "}${w.name.toLowerCase()}` : "with their bare hands";
  const vname = first(v);
  bumpPair(state, s, v, -40);
  if (kills) {
    log(state, `${s.name} went for ${v.name} ${how} in the night at ${base.name} (mood ${Math.round(s.mood)}). ${vname} was dead before anyone could pull ${first(s)} off.`, "death");
    killSurvivor(state, v, base.tile, `at the hands of ${s.name} at ${base.name}`);
    rec(s).killsH = (rec(s).killsH || 0) + 1;
    addMoment(state, s, `Killed ${v.name} in a breakdown, day ${d}`);
    grim(state, base, `${first(s)} killed ${vname}`);
    stat(state, "kill");
    aftermath(state, base, s, v, `${s.name} killed ${v.name} ${how}.`, true);
    return;
  }
  hurt(state, v, Math.min(dmg, Math.max(1, v.health - 1)), base.tile, `attacked by ${s.name} at ${base.name}`, { raw: true });
  addMood(state, v, -10, `Attacked by ${first(s)}`);
  log(state, `${s.name} went for ${v.name} ${how} in the night at ${base.name} (mood ${Math.round(s.mood)}): ${vname} took ${dmg} health before the others pulled ${first(s)} off.`, "death");
  addMoment(state, s, `Attacked ${v.name} in a breakdown, day ${d}`);
  uneasy(state, base, s, `${first(s)} attacked ${vname}`);
  aftermath(state, base, s, v, `${s.name} attacked ${v.name} ${how}; ${vname} is hurt (health ${Math.round(v.health)}).`);
}

// ---------- the morning after: what to do with them ----------
function aftermath(state, base, s, victim, what, killed = false) {
  if (!s.alive || state.cards.some((c) => c.snapFor === s.id)) return;
  addCard(state, aftermathCard(state, base, s, victim, what, killed));
}
export function aftermathCard(state, base, s, victim, what, killed) {
  const name = first(s);
  const live = () => here(state, s, base);
  const gone = () => `${s.name} is no longer at ${base.name}.`;
  const friends = friendsOf(state, s).length;
  const t = talker(state, base, s);
  return {
    title: killed ? `${s.name} killed ${victim.name}` : `${s.name} broke down`,
    text: `${what} ${name} has been at rock bottom for days (mood ${Math.round(s.mood)})${s.grief ? `, grieving for ${s.grief.name}` : ""}. The others are waiting to hear what happens to them.`,
    snapFor: s.id,
    choices: [
      {
        label: `Confine them (${SNAP.CONFINE} days)`,
        hint: `Locked in and watched for ${SNAP.CONFINE} days: no work, the Rest role; mood +10 for the rest${t.who ? `, and ${first(t.who)} talks to them each day` : ""}`,
        ai: () => (killed ? 6 : 12),
        resolve: (st) => {
          if (!live()) return gone();
          if (s.role !== "rest") s.restPrev = s.role;
          s.role = "rest"; s.station = null; s.restUntil = day(st) + SNAP.CONFINE; s.confined = day(st) + SNAP.CONFINE;
          addMood(st, s, 10, "Time to come back to themselves");
          return `${name} is shut in a room with someone at the door. ${SNAP.CONFINE} days to come back to themselves.`;
        },
      },
      {
        label: "Cast them out",
        hint: `${name} leaves ${base.name} for good with what they carry and nothing from the stores${friends ? `; their ${friends} friend${friends > 1 ? "s" : ""} take it hard` : ""}`,
        ai: () => (killed ? 14 : 4),
        resolve: (st) => {
          if (!live()) return gone();
          desert(st, base, s, { why: `${s.name} was cast out of ${base.name}`, haul: false });
          return `${name} is put outside the gate with their things. Nobody watches them go.`;
        },
      },
      {
        label: "Put them down",
        hint: `${name} is executed: everyone's mood ${SNAP.PUTDOWN}, their friends grieve`,
        ai: () => (killed && !friends ? 8 : -5),
        resolve: (st) => {
          if (!live()) return gone();
          const leader = atBase(st, base.id).find((o) => o.leader && o !== s);
          killSurvivor(st, s, base.tile, `at the hands of their own people at ${base.name}, for ${killed ? `killing ${victim.name}` : "what they did"}`);
          for (const o of atBase(st, base.id)) addMood(st, o, SNAP.PUTDOWN, `${name} was put down`);
          return `${leader ? first(leader) : "Someone"} does it quickly, out past the walls. Nobody talks about it.`;
        },
      },
      {
        label: "Forgive them",
        hint: killed ? `A killer stays among them: everyone's mood ${SNAP.FORGIVE.others}, ${name} ${SNAP.FORGIVE.killer}` : `Everyone's mood ${SNAP.FORGIVE.others / 2}${victim ? `, ${first(victim)} ${SNAP.FORGIVE.victim / 2}` : ""}; ${name} is grateful (+8)`,
        ai: () => (killed ? -4 : 8),
        resolve: (st) => {
          if (!live()) return gone();
          const k = killed ? 1 : 0.5;
          for (const o of atBase(st, base.id)) if (o !== s && o !== victim) addMood(st, o, SNAP.FORGIVE.others * k, `${name} was forgiven`);
          if (victim && victim.alive) { addMood(st, victim, SNAP.FORGIVE.victim * k, `${name} was forgiven`); bumpPair(st, s, victim, -10); }
          if (killed) addMood(st, s, SNAP.FORGIVE.killer, `Has to live with it`);
          else addMood(st, s, 8, "Forgiven");
          return killed ? `${name} stays. People give them a wide berth.` : `${name} is let off with a warning. Not everyone agrees.`;
        },
      },
    ],
  };
}
