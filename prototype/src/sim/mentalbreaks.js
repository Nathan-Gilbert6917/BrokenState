// Mental breaks: someone whose mood has sat under SNAP.at for SNAP.days mornings running may break for good (every
// number in SNAP). Not the small breaks of relations.js (a day sat out, a binge, a fistfight: below 12 mood, with
// relief after) but the ones that change the colony: they run off in the night, go for someone with a weapon (and
// may kill them), take their own life, set a building alight, wreck the stores, walk out past the walls into the
// dead, drive off with a car, or shut down for days. At a base or on the road with a team (a "place": placeOf):
// which one is weighed by what is there (a car, a burnable building, other people, infected ground) and who they are
// (grieving, armed, a coward, a hothead, their rivals and partner).
//   - The counter (s.lowDays) counts mornings with mood under SNAP.at, at a base or on a team; a morning at or over it
//     resets it. On the SNAP.days-th morning the log warns once and the People tab shows "May break down"; from then
//     on each morning there is SNAP.base + SNAP.per × (SNAP.at − mood) of a break (half that with Iron Will: traits.js). After one, SNAP.cooldown days
//     before the next, and whoever is still here and alive gets SNAP.relief mood (it is out of them, for now).
//   - An attack (snapAttack): the victim is the person they like least (the leader only when they dislike them, a
//     third of the time), struck with whatever is in their hand for SNAP.ATTACK.dmg (+ SNAP.ATTACK.armed with a
//     weapon); killed outright at SNAP.ATTACK.kill (more when armed). The others pull them off: a card (aftermathCard)
//     asks what to do with them: confine them (SNAP.CONFINE days with no work, watched; on the road, walked along
//     under guard), cast them out (gone like a deserter, with nothing from the stores; on the road, left where the
//     team stands), put them down (everyone's mood suffers), or forgive (everyone uneasy, the victim most). Leaders
//     break like anyone, but never run off, drive off or walk into the dead.
//   - Suicide and walking into the dead kill (world.js killSurvivor: grief, the memorial, their things to the armory
//     at a base, a death site on the road); everyone at the place takes SNAP.GRIM mood on top of the grief of friends.
//   - Running off is morale.js desert at a base (the haul from the stores, a possible return: recruits.js); on the
//     road they slip away from the camp with what they carry and a little of the team's food and water (leaveParty),
//     and may come back to the hub the same way. A car taken at a base goes with them (the car is gone).
//   - A fire takes a burnable building (hubevents.js FIRE.burnable) as the fire event does when it is lost; wrecking
//     the stores spoils SNAP.STORES.share of the food and water (at most SNAP.STORES.max of each); on the road the
//     team's own packs (p.supplies).
//   - Shutting down: SNAP.SHUTDOWN days in bed (the Rest role, no work); on the road the team loses SNAP.ROAD_HALT
//     hours getting them walking again (events.js-style delay) and they do nothing that day.
// Every outcome is one log line (kind "death" where someone dies), a moment on the record where it fits, and a count
// in state.relStats.snaps[kind] for the tools. Only state.rng is drawn, only inside the daily tick (deterministic).
import { HARD } from "./hardrules.js";
import { isHardcore } from "./roadstart.js";
import { foodIn, takeFood, FOODS, foodWord } from "./foods.js"; // days of food
import { hasTrait, traitFx, breakMult } from "./traits.js"; // Iron Will, Hothead
import { log, addCard, day, atBase, hurt, killSurvivor, hub, skill } from "./world.js";
import { BUILDINGS, count, assignStations } from "./buildings.js";
import { GEAR } from "./data.js";
import { desert, talker } from "./morale.js";
import { addMood, bumpPair, opinion, rivalsOf, partnerOf, addMoment, rec, friendsOf, onLeave } from "./relations.js";
import { FIRE } from "./hubevents.js";
import { carsAtBase, vehicleLabel } from "./vehicles.js";
import { partyMembers, partyTile, partySpeed, tileLabel, teamName } from "./parties.js";
import { allItems } from "./inventory.js";
import { keyWord } from "./water.js"; // "un-purified water" in texts

export const SNAP = {
  at: 10, days: 3, base: 0.12, per: 0.02, cooldown: 10, relief: 15,
  ATTACK: { dmg: [15, 35], armed: 12, kill: 0.15, killArmed: 0.3, leader: 0.33 },
  GRIM: 10,          // everyone at the place: a suicide, a killing, someone walking into the dead
  UNEASY: 4,         // everyone at the place: an attack, a fire, the stores wrecked
  CONFINE: 7, SHUTDOWN: [3, 6], ROAD_HALT: 12,
  STORES: { share: 0.15, max: 30 },
  ROAD_HAUL: { food: [1, 2], water: [1, 2] }, // what one who slips away from a team takes from its packs
  DEAD: 0.2,         // walking into the dead needs this much Infection on the tile
  FORGIVE: { victim: -12, others: -6, killer: -10 }, // mood when a killer is forgiven (an attacker half)
  PUTDOWN: -8,       // everyone's mood when one of their own is put down
};
const first = (s) => s.name.split(" ")[0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const stat = (state, kind) => { const r = state.relStats || (state.relStats = { breaks: {} }); r.snaps = r.snaps || {}; r.snaps[kind] = (r.snaps[kind] || 0) + 1; };
const weaponOf = (s) => { const w = s.gear && s.gear.weapon; return w && GEAR[w.key] && GEAR[w.key].slot === "weapon" ? w : null; };

// ---------- where someone is ----------
// { base } or { party }: the people there, its tile and name, and whether s is still there.
export function placeOf(state, s) {
  const L = s.location || {};
  if (L.kind === "base") { const base = state.bases.find((b) => b.id === L.baseId); return base ? { base } : null; }
  if (L.kind === "party") { const party = state.parties.find((p) => p.id === L.partyId && p.owner === "player"); return party ? { party } : null; }
  return null;
}
const asPlace = (pl) => (pl && pl.id != null && pl.tile != null && !pl.base && !pl.party ? { base: pl } : pl); // a base alone
const peopleAt = (state, pl) => (pl.base ? atBase(state, pl.base.id) : partyMembers(state, pl.party));
const tileOf = (pl) => (pl.base ? pl.base.tile : partyTile(pl.party));
const nameOf = (state, pl) => (pl.base ? pl.base.name : `the camp at ${tileLabel(state, partyTile(pl.party))}`);
const here = (state, s, pl) => { const q = s.alive ? placeOf(state, s) : null; return !!q && (pl.base ? q.base === pl.base : q.party === pl.party); };
// The person best placed to talk to them: at a base morale.js talker; on a team the leader if along, else the best Speech.
function talkerAt(state, pl, s) {
  if (pl.base) return talker(state, pl.base, s);
  const others = partyMembers(state, pl.party).filter((o) => o !== s);
  const leader = others.find((o) => o.leader);
  const best = [...others].sort((a, b) => skill(b, "speech") - skill(a, "speech"))[0] || null;
  const score = (o) => (o ? (o.leader ? Math.max(skill(o, "speech"), skill(o, "leadership")) : skill(o, "speech")) : 0);
  const who = leader && (!best || score(leader) >= score(best)) ? leader : best;
  return { who, score: score(who), chance: who ? clamp(0.3 + 0.035 * score(who), 0.3, 0.95) : 0 };
}

// The People tab and the alerts (morale.js moodRisk asks): on the edge of a break?
/** The mood under which the mornings count: Hardcore breaks sooner (hardrules.js MOOD_BREAK). @param {any} [state] */
export const snapAt = (state) => SNAP.at + (isHardcore(state) ? HARD.MOOD_BREAK : 0);
export const nearSnap = (s, state = null) => !!s && s.alive && (s.lowDays || 0) >= SNAP.days && s.mood < snapAt(state);

// ---------- daily (economy.js basesDaily, after relationsDaily) ----------
// Every base, and every team of yours that is not in the middle of a fight.
export function mentalBreaksDaily(state) {
  if (state.gameOver) return;
  const d = day(state);
  if (state.snapDay === d) return;
  state.snapDay = d;
  const rng = state.rng;
  const fighting = (p) => p.phase === "engaged" || !!(state.combat && state.combat.setup && state.combat.setup.partyId === p.id);
  const places = [...state.bases.map((base) => ({ base })), ...state.parties.filter((p) => p.owner === "player" && !fighting(p)).map((party) => ({ party }))];
  for (const pl of places) {
    for (const s of [...peopleAt(state, pl)]) {
      if (!s.alive || !here(state, s, pl)) continue;
      if (s.mood >= snapAt(state)) { if (s.lowDays) s.lowDays = 0; continue; }
      s.lowDays = (s.lowDays || 0) + 1;
      if (s.lowDays === SNAP.days) log(state, `${s.name} has been at rock bottom for ${SNAP.days} days${pl.party ? " on the road" : ""} (mood ${Math.round(s.mood)}). Nobody knows what they might do.`, "danger");
      if (s.lowDays < SNAP.days || (s.snapCd || 0) > d) continue;
      if (!rng.chance((SNAP.base + SNAP.per * (snapAt(state) - s.mood)) * breakMult(s))) continue; // Iron Will (traits.js): half as likely
      snap(state, pl, s, rng);
    }
  }
}

// The break itself: which kind, by what is at hand. pl: { base } or { party } (a base alone is taken as { base }).
// Returns the kind.
export function snap(state, pl, s, rng, force = null) {
  pl = asPlace(pl);
  const d = day(state);
  const t = state.tiles[tileOf(pl)];
  const others = peopleAt(state, pl).filter((o) => o !== s);
  const cars = pl.base ? carsAtBase(state, pl.base.id) : [];
  const stock = pl.base ? pl.base.stock : pl.party.supplies;
  const kinds = [];
  if (!s.leader) kinds.push(["runoff", 3]);
  if (others.length) kinds.push(["attack", 3 * (rivalsOf(state, s).length ? 1.5 : 1) * (hasTrait(s, "hothead") ? traitFx(s, "hothead", "attack") : 1)]); // a Hothead (traits.js)
  kinds.push(["suicide", 1 + (s.grief ? 1 : 0) + (partnerOf(state, s) ? 0 : 0.3)]);
  if (pl.base && pl.base.buildings.some((b) => FIRE.burnable.includes(b.type))) kinds.push(["fire", 1.5]);
  if (foodIn(stock) + (stock.water || 0) + (stock.rawwater || 0) >= (pl.base ? 20 : 6)) kinds.push(["stores", 1.5]);
  if (!s.leader && t && (t.infection || 0) >= SNAP.DEAD) kinds.push(["dead", pl.party ? 1.5 : 1]);
  if (!s.leader && cars.length) kinds.push(["car", 1]);
  kinds.push(["shutdown", 2 + (s.traits.includes("coward") ? 1 : 0)]);
  const kind = force && kinds.some((k) => k[0] === force) ? force : rng.weighted(kinds, (k) => k[1])[0];
  s.snapCd = d + SNAP.cooldown;
  s.lowDays = 0;
  s.snaps = [...(s.snaps || []), { d, kind }];
  stat(state, kind);
  const name = first(s);
  const mood = Math.round(s.mood);
  const where = nameOf(state, pl);
  if (kind === "runoff") {
    if (pl.base) desert(state, pl.base, s, { why: `${s.name} snapped: they walked out of ${where} in the night without a word to anyone (mood ${mood})` });
    else leaveParty(state, pl.party, s, { why: `${s.name} snapped: they slipped away from ${where} in the night without a word to anyone (mood ${mood})` });
  } else if (kind === "car") {
    const car = cars[0];
    state.vehicles.splice(state.vehicles.indexOf(car), 1);
    desert(state, pl.base, s, { why: `${s.name} snapped: they took the ${vehicleLabel(car)} and drove off from ${where} in the night (mood ${mood})` });
    (state.deserters || []).filter((e) => e.id === s.id).forEach((e) => { e.car = car.type; });
  } else if (kind === "suicide") {
    log(state, `${s.name} could not go on (mood ${mood}).`, "death");
    killSurvivor(state, s, tileOf(pl), `by their own hand at ${where}`);
    grim(state, pl, `${name}'s death`);
  } else if (kind === "dead") {
    log(state, pl.base ? `${s.name} walked out through the gate of ${where} in the night and kept walking (mood ${mood}). They were found at dawn among the dead, past helping.` : `${s.name} walked out of ${where} in the night and kept walking (mood ${mood}). The team found them at dawn among the dead, past helping.`, "death");
    killSurvivor(state, s, tileOf(pl), `walking out into the dead from ${where}`);
    grim(state, pl, `${name} walked into the dead`);
  } else if (kind === "fire") {
    const base = pl.base;
    const b = rng.pick(base.buildings.filter((x) => FIRE.burnable.includes(x.type)));
    const bn = BUILDINGS[b.type].name.toLowerCase();
    base.buildings.splice(base.buildings.indexOf(b), 1);
    if (b.type === "watchtower") base.watchtower = count(base, "watchtower") > 0;
    assignStations(state, base);
    s.onBreak = true;
    log(state, `${s.name} set fire to the ${bn} at ${where} in the night (mood ${mood}). It burned to the ground before anyone could stop it.`, "death");
    addMoment(state, s, `Burned down the ${bn} at ${where}, day ${d}`);
    uneasy(state, pl, s, `${name} burned down the ${bn}`);
    aftermath(state, pl, s, null, `${s.name} burned down the ${bn}.`);
  } else if (kind === "stores") {
    const lost = {};
    for (const k of ["water", "rawwater"]) { const n = Math.min(SNAP.STORES.max, Math.floor((stock[k] || 0) * SNAP.STORES.share)); if (n > 0) { stock[k] -= n; lost[k] = n; } }
    { const n = Math.min(SNAP.STORES.max, Math.floor(foodIn(stock) * SNAP.STORES.share)); if (n > 0) { takeFood(stock, n); lost.food = n; } } // foods.js: days of food, the soonest to spoil first
    s.onBreak = true;
    const what = Object.entries(lost).map(([k, n]) => `${n} ${keyWord(k)}`).join(" and ") || "nothing much";
    log(state, pl.base ? `${s.name} tore through the stores at ${where} in the night, smashing and spilling what they could (mood ${mood}): ${what} lost.` : `${s.name} tore through the team's packs in the night at ${where}, flinging what they could into the dark (mood ${mood}): ${what} lost.`, "danger");
    uneasy(state, pl, s, `${name} wrecked the ${pl.base ? "stores" : "packs"}`);
    aftermath(state, pl, s, null, `${s.name} wrecked the ${pl.base ? "stores" : "team's packs"}.`);
  } else if (kind === "shutdown") {
    if (pl.base) {
      const days = rng.int(SNAP.SHUTDOWN[0], SNAP.SHUTDOWN[1]);
      if (s.role !== "rest") s.restPrev = s.role;
      s.role = "rest"; s.station = null; s.restUntil = d + days; s.onBreak = true;
      log(state, `${s.name} has stopped answering. They lie in their bunk at ${where} staring at the wall and will not get up (mood ${mood}): ${days} days, at least.`, "danger");
    } else {
      const p = pl.party;
      p.progress = (p.progress || 0) - SNAP.ROAD_HALT * partySpeed(p);
      s.onBreak = true;
      log(state, `${s.name} has stopped answering. They sit down at ${where} and will not get up (mood ${mood}); ${teamName(state, p)} loses half a day getting them walking again.`, "danger");
    }
  } else snapAttack(state, pl, s, others, rng);
  if (s.alive && here(state, s, pl) && kind !== "shutdown") addMood(state, s, SNAP.relief, "It is out of them, for now");
  return kind;
}

// One who slips away from a team on the road (a deserter, recruits.js may bring them back to the hub): what they
// carry and a little of the team's food and water (opts.haul false: nothing).
export function leaveParty(state, p, s, opts = {}) {
  s.alive = false;
  s.left = true;
  s.station = null;
  s.inBed = false;
  const took = {};
  if (opts.haul !== false) for (const [k, [lo, hi]] of Object.entries(SNAP.ROAD_HAUL)) {
    const n = Math.min(state.rng.int(lo, hi), Math.floor(Math.max(0, k === "food" ? foodIn(p.supplies) : p.supplies[k] || 0)));
    if (n > 0 && k === "food") { for (const [kk, q] of Object.entries(takeFood(p, n, { eggs: false, state }).items)) took[kk] = q; } // foods.js: days of food, the soonest to spoil first
    else if (n > 0) { p.supplies[k] -= n; took[k] = n; }
  }
  const parts = [...allItems(s).map((g) => g.name), ...Object.entries(took).map(([k, q]) => (FOODS[k] ? foodWord(k, q) : `${q} ${keyWord(k)}`))]; // food items in words (foods.js)
  log(state, `${opts.why || `${s.name} slipped away from the team in the night`}${parts.length ? `, taking ${parts.join(", ")}` : " with nothing but the clothes on their back"}.`, "death");
  const h = hub(state);
  (state.deserters || (state.deserters = [])).push({ id: s.id, baseId: h ? h.id : null, day: day(state), took, road: true });
  onLeave(state, s, h);
  for (let i = state.cards.length - 1; i >= 0; i--) if (state.cards[i].moraleFor === s.id || state.cards[i].snapFor === s.id) state.cards.splice(i, 1);
  return took;
}

// Everyone at the place after a death: grim.
function grim(state, pl, label) {
  for (const o of peopleAt(state, pl)) addMood(state, o, -SNAP.GRIM, label);
}
function uneasy(state, pl, s, label) {
  for (const o of peopleAt(state, pl)) if (o !== s) addMood(state, o, -SNAP.UNEASY, label);
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
function snapAttack(state, pl, s, others, rng) {
  const d = day(state);
  const where = nameOf(state, pl);
  const v = victimOf(state, s, others, rng);
  const w = weaponOf(s);
  const armed = !!w; // anything in their hand counts
  const dmg = rng.int(SNAP.ATTACK.dmg[0], SNAP.ATTACK.dmg[1]) + (armed ? SNAP.ATTACK.armed : 0);
  const kills = rng.chance(armed ? SNAP.ATTACK.killArmed : SNAP.ATTACK.kill);
  const how = w ? `with ${w.name.toLowerCase().startsWith("a ") ? "" : "a "}${w.name.toLowerCase()}` : "with their bare hands";
  const vname = first(v);
  bumpPair(state, s, v, -40);
  if (kills) {
    log(state, `${s.name} went for ${v.name} ${how} in the night at ${where} (mood ${Math.round(s.mood)}). ${vname} was dead before anyone could pull ${first(s)} off.`, "death");
    killSurvivor(state, v, tileOf(pl), `at the hands of ${s.name} at ${where}`);
    rec(s).killsH = (rec(s).killsH || 0) + 1;
    addMoment(state, s, `Killed ${v.name} in a breakdown, day ${d}`);
    grim(state, pl, `${first(s)} killed ${vname}`);
    stat(state, "kill");
    aftermath(state, pl, s, v, `${s.name} killed ${v.name} ${how}.`, true);
    return;
  }
  hurt(state, v, Math.min(dmg, Math.max(1, v.health - 1)), tileOf(pl), `attacked by ${s.name} at ${where}`, { raw: true });
  addMood(state, v, -10, `Attacked by ${first(s)}`);
  log(state, `${s.name} went for ${v.name} ${how} in the night at ${where} (mood ${Math.round(s.mood)}): ${vname} took ${dmg} health before the others pulled ${first(s)} off.`, "death");
  addMoment(state, s, `Attacked ${v.name} in a breakdown, day ${d}`);
  uneasy(state, pl, s, `${first(s)} attacked ${vname}`);
  aftermath(state, pl, s, v, `${s.name} attacked ${v.name} ${how}; ${vname} is hurt (health ${Math.round(v.health)}).`);
}

// ---------- the morning after: what to do with them ----------
function aftermath(state, pl, s, victim, what, killed = false) {
  if (!s.alive || state.cards.some((c) => c.snapFor === s.id)) return;
  addCard(state, aftermathCard(state, pl, s, victim, what, killed));
}
export function aftermathCard(state, pl, s, victim, what, killed) {
  pl = asPlace(pl);
  const name = first(s);
  const where = nameOf(state, pl);
  const live = () => here(state, s, pl);
  const gone = () => `${s.name} is no longer ${pl.base ? `at ${where}` : "with the team"}.`;
  const friends = friendsOf(state, s).length;
  const t = talkerAt(state, pl, s);
  const road = !!pl.party;
  return {
    title: killed ? `${s.name} killed ${victim.name}` : `${s.name} broke down`,
    text: `${what} ${name} has been at rock bottom for days (mood ${Math.round(s.mood)})${s.grief ? `, grieving for ${s.grief.name}` : ""}. The others are waiting to hear what happens to them.`,
    snapFor: s.id,
    partyId: road ? pl.party.id : undefined,
    choices: [
      {
        label: road ? `Keep them under guard (${SNAP.CONFINE} days)` : `Confine them (${SNAP.CONFINE} days)`,
        hint: road ? `Walked along with their hands tied for ${SNAP.CONFINE} days, no part in the work or a fight; mood +10 for the rest` : `Locked in and watched for ${SNAP.CONFINE} days: no work, the Rest role; mood +10 for the rest${t.who ? `, and ${first(t.who)} talks to them each day` : ""}`,
        ai: () => (killed ? 6 : 12),
        resolve: (st) => {
          if (!live()) return gone();
          if (s.role !== "rest") s.restPrev = s.role;
          s.role = "rest"; s.station = null; s.restUntil = day(st) + SNAP.CONFINE; s.confined = day(st) + SNAP.CONFINE;
          addMood(st, s, 10, "Time to come back to themselves");
          return road ? `${name} walks with the team under guard. ${SNAP.CONFINE} days to come back to themselves.` : `${name} is shut in a room with someone at the door. ${SNAP.CONFINE} days to come back to themselves.`;
        },
      },
      {
        label: road ? "Leave them behind" : "Cast them out",
        hint: `${name} ${road ? "is left where the team stands" : `leaves ${where} for good`} with what they carry and nothing from the ${road ? "packs" : "stores"}${friends ? `; their ${friends} friend${friends > 1 ? "s" : ""} take it hard` : ""}`,
        ai: () => (killed ? 14 : 4),
        resolve: (st) => {
          if (!live()) return gone();
          if (road) leaveParty(st, pl.party, s, { why: `${s.name} was left behind by the team at ${where}`, haul: false });
          else desert(st, pl.base, s, { why: `${s.name} was cast out of ${where}`, haul: false });
          return road ? `The team walks on. ${name} does not follow.` : `${name} is put outside the gate with their things. Nobody watches them go.`;
        },
      },
      {
        label: "Put them down",
        hint: `${name} is executed: everyone's mood ${SNAP.PUTDOWN}, their friends grieve`,
        ai: () => (killed && !friends ? 8 : -5),
        resolve: (st) => {
          if (!live()) return gone();
          const leader = peopleAt(st, pl).find((o) => o.leader && o !== s);
          killSurvivor(st, s, tileOf(pl), `at the hands of their own people at ${where}, for ${killed ? `killing ${victim.name}` : "what they did"}`);
          for (const o of peopleAt(st, pl)) addMood(st, o, SNAP.PUTDOWN, `${name} was put down`);
          return `${leader ? first(leader) : "Someone"} does it quickly, ${road ? "a little way off the road" : "out past the walls"}. Nobody talks about it.`;
        },
      },
      {
        label: "Forgive them",
        hint: killed ? `A killer stays among them: everyone's mood ${SNAP.FORGIVE.others}, ${name} ${SNAP.FORGIVE.killer}` : `Everyone's mood ${SNAP.FORGIVE.others / 2}${victim ? `, ${first(victim)} ${SNAP.FORGIVE.victim / 2}` : ""}; ${name} is grateful (+8)`,
        ai: () => (killed ? -4 : 8),
        resolve: (st) => {
          if (!live()) return gone();
          const k = killed ? 1 : 0.5;
          for (const o of peopleAt(st, pl)) if (o !== s && o !== victim) addMood(st, o, SNAP.FORGIVE.others * k, `${name} was forgiven`);
          if (victim && victim.alive) { addMood(st, victim, SNAP.FORGIVE.victim * k, `${name} was forgiven`); bumpPair(st, s, victim, -10); }
          if (killed) addMood(st, s, SNAP.FORGIVE.killer, `Has to live with it`);
          else addMood(st, s, 8, "Forgiven");
          return killed ? `${name} stays. People give them a wide berth.` : `${name} is let off with a warning. Not everyone agrees.`;
        },
      },
    ],
  };
}
