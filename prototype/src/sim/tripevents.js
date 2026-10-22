// Trouble on job trips (trips-plus #2, user request: "events that can be handled by 1 single person; AI should gear
// them enough to survive these occurrences"). A worker out alone on a job trip (sim/jobtrips.js) can meet:
//   dead      1–3 of the wandering dead (more on infected ground, near a horde, at dusk)
//   deadbeast 1–3 of the worm's dead animals (deadbeasts.js beastMix: a dead stag on the hills, dead dogs by the farms …)
//   animal    a wolf, a wild boar, feral dogs or a bear, by the ground and the season (no bears in winter)
//   injury    the job's own accident (an axe slip, a fall through a rotten floor, a slip into cold water …) or a turned
//             ankle on the way
//   lost      lost in the woods or the fog: hours gone (Scouting and a light help)
//   stranger  a lone traveller with something to trade, or an armed one who wants the load
//   find      a small find: a little scrap, a few tins, meds, a knife or a light
// Rolled once a trip on the trip's own dice (a hash of the seed, the person, the day and the trip: never the world's
// rng): TRIP_EV.rate an hour out of the walls (walking and working) × the pace (tripland.js PACES ev) × the weather; a
// trip of six hours meets something about 2.4% of the time. The kind by TRIP_EV.kinds and the ground, the job, the hour.
//
// Resolved by that one person with what they are and carry (sim/tripgear.js tripKit): their fighting worth (world.js
// combatPower: their skill, weapon, armour, health; a gun needs rounds at the base, else it is a club), Scouting and
// Stealth to slip away, Medicine and a carried tourniquet or kit to stop a bleed, Speech with a stranger. Outcomes:
// they drive the trouble off or kill it (a boar brings 16 kg of meat home), flee (dropping the load), get hurt (real
// wounds: world.js hurt, a deep cut or a sprain: health.js), and rarely die when ungeared and unlucky. Gunshots spend
// rounds and make noise (base.tripNoise for the base's Heat, hordes.js baseHeat; roaming hordes within HUNT.drawRange
// may turn toward the shots, on the trip's own dice).
// The bigger moments (a bear, a stranger) bring a card with 2–3 choices while you run the base yourself (no governor,
// no base leader); the worker holds where they are until it is answered (TRIP_EV.hold hours at most, then they do what
// seems best: the default). The dead and the dead beasts bring the card "<name> was attacked by …" (loneattack.js
// attackCard): Save and fight, Fight (the battle map: that one person with what they carry, no stores; the worker
// holds while it is fought, holdTrip), or leave it to them (by the numbers, as below); the fight's outcome goes back
// into the trip (settleBattle). Everything else, and every base the governor or a leader runs, resolves at once by the
// worker's own good sense (the same choice the governor would make).
// Player-facing: one log line each; the map shows a "!" over the walker (base.tripAlerts, ui/workermap.js).
// The day's tally: base.tripTally.ev = { n, kinds, hurt, killed, fled, shots, noise, gunfire { tile: quiet } }.
// The run's: state.stats.tripEv (tools/tripeventstest.js reads it).
import { depositGame } from "./hunting.js"; // a boar's meat as raw boar (foods.js)
import { foodIn, payFood, giveFood, gainGoods } from "./foods.js"; // food by type: days of it paid, tins found
import { Rng } from "./rng.js";
import { hash01, gainXp } from "./skills.js";
import { GEAR } from "./data.js";
import { log, hurt, skill, combatPower, addCard, localId, survivorById } from "./world.js";
import { TEAM, crewAt, coveredBy, crewDead, namesText, shareLoot } from "./teamwork.js"; // a crew out on the same job and tile: one roll, the trouble shared
import { personKey } from "./members.js"; // dice the same in every world on the seed (call-time only)
import { woundMult, accidentMult } from "./traits.js";
import { armorMult, carriedSpots, lootItem } from "./inventory.js"; // lootItem: a find or a trade rolls its condition (itemcond.js)
import { addCondition, CONDITIONS } from "./health.js";
import { drawShots } from "./ammo.js";
import { gunMods } from "./gunmods.js";
import { tripKit } from "./tripgear.js";
import { TRIP_JOBS, paceOf } from "./tripland.js";
import { beastMix } from "./deadbeasts.js"; // the dead beasts of the land: a kind of trouble on a trip
import { ZTYPES } from "./hiveconst.js";
import { attackCard, tripAttackSetup, beastWords } from "./loneattack.js"; // the attack card and the lone fight on the battle map
import { tileLabel } from "./parties.js";
import { HUNT, meatAt, huntMixOf } from "./hunting.js";
import { stewardOn } from "./steward.js";
import { cutShort, loadText } from "./jobtrips.js";
import * as Weather from "./weather.js";
import { cfgOf } from "./worldcfg.js"; // the run's dials: Events

export const TRIP_EV = {
  rate: 0.004,       // trouble an hour out of the walls (× the pace's ev, × weather)
  kinds: { dead: 26, animal: 15, injury: 22, lost: 11, stranger: 8, find: 18, deadbeast: 12 }, // deadbeast: × the beasts' share of the tile's dead (BEAST_SHARE, at most BEAST_MAX)
  beastShare: 6, beastMax: 1.5,
  hold: 3,           // hours a card holds the worker before they take its default
  walker: 2.2,       // one of the dead in a fight (combatPower's scale: bare hands about 2, a machete 4, a rifle 7)
  hit: [8, 20],      // a blow from the dead, before armour (world.js woundMult, armorMult)
  caught: 0.55,      // caught running: the first foe lands a blow, each other one this often
  dragged: 0.04,     // caught by 2+ of the dead with no weapon to fight free: dragged down, × (n − 1)
  bleed: 25,         // damage at once that bleeds: more on the way home unless they carry a tourniquet or a kit
  bleedDmg: [6, 14], // (from 50 at once: bleedBad)
  bleedBad: [12, 24],
  flee: { base: 0.72, scouting: 0.012, stealth: 0.008, load: 0.12, hurt: 0.15, min: 0.35, max: 0.95 },
  fightAt: 0.5,      // their own good sense: they stand and fight from this share of the fight's worth (r)
  pop: 0.6,          // hours the map's "!" stays over them
};
// Wild animals: power (combatPower's scale), how many, the ground and the season they are met in, the chance they
// size the worker up and leave (×1.5 when the worker has a weapon), meat (kg) when killed, big (a card when managed).
export const TRIP_ANIMALS = {
  wolf: { name: "a wolf", power: 3.2, n: [1, 2], hit: [8, 20], terr: { forest: 1, hills: 1, mountain: 1.2, plains: 0.35 }, season: { winter: 2, autumn: 1.3, spring: 1, summer: 0.7 }, leave: 0.4, meat: 0 },
  boar: { name: "a wild boar", power: 4, n: [1, 1], hit: [10, 26], terr: { forest: 1.2, plains: 0.8, hills: 0.5, suburb: 0.2 }, season: { winter: 0.8, autumn: 1.2, spring: 1, summer: 1 }, leave: 0.25, meat: 16 }, // a wild hog (hunting.js ANIMALS.hog)
  dogs: { name: "feral dogs", power: 1.6, n: [2, 3], hit: [5, 14], terr: { suburb: 1.2, city: 1, plains: 0.5, forest: 0.2 }, season: { winter: 1.2, autumn: 1, spring: 1, summer: 1 }, leave: 0.35, meat: 0 },
  bear: { name: "a bear", power: 10, n: [1, 1], hit: [20, 45], maul: 2, terr: { forest: 0.35, mountain: 0.6, hills: 0.35 }, season: { winter: 0, autumn: 1.2, spring: 1.4, summer: 1 }, leave: 0.5, meat: 60, big: true },
};
// The job's accidents: at work (walk: false) or on the way (walk: true). cond: the condition (health.js), p its chance;
// dmg: health lost before armour; cold: a fall into the water (a chest cold below 8 °C, soaked above); drop: the load
// is lost.
export const TRIP_INJURY = {
  wood: [{ text: "slipped with the axe and opened a leg", cond: "cut", dmg: [6, 14], w: 3 }, { text: "was caught by a falling branch", cond: "sprain", p: 0.4, dmg: [8, 18], w: 2 }],
  scavenge: [{ text: "cut a hand open on broken glass", cond: "cut", dmg: [3, 8], w: 3 }, { text: "fell through a rotten floor", cond: "sprain", dmg: [8, 16], w: 1 }],
  forage: [{ text: "tore an arm open on wire in the brush", cond: "cut", dmg: [3, 8], w: 1 }, { text: "slipped down a bank", cond: "sprain", dmg: [2, 8], w: 2 }],
  hunt: [{ text: "cut themselves dressing the kill", cond: "cut", dmg: [3, 8], w: 1 }, { text: "fell down a gully", cond: "sprain", dmg: [6, 14], w: 2 }],
  fish: [{ text: "slipped into the water", cold: true, w: 3 }, { text: "drove a hook into a hand", cond: "cut", dmg: [1, 4], w: 1 }],
  water: [{ text: "slipped into the water filling the buckets", cold: true, drop: true, w: 3 }, { text: "turned an ankle under the full buckets", cond: "sprain", dmg: [0, 3], w: 1 }],
  walk: [{ text: "turned an ankle on the way", cond: "sprain", dmg: [0, 4], w: 3, walk: true }, { text: "took a bad fall on the way", cond: "sprain", p: 0.3, dmg: [5, 12], w: 1, walk: true }],
};
// Small finds: supplies to the deposit's stock, items to the base's armory.
export const TRIP_FINDS = [
  { give: { scrap: [1, 3] }, w: 30, text: (q) => `${q} scrap` },
  { give: { preserved: [1, 3] }, w: 18, text: (q) => `${q} tin${q > 1 ? "s" : ""} of food` },
  { give: { meds: [1, 1] }, w: 8, text: () => "a bottle of pills (1 meds)" },
  { item: "knife", w: 6 }, { item: "flashlight", w: 5 }, { item: "headlamp", w: 3 }, { item: "tourniquet", w: 4 }, { item: "bandagekit", w: 3 },
];
// A friendly stranger's offers: what they give for what (from the base's stock: they walk back to the gate together).
export const TRIP_OFFERS = [
  { give: { meds: 2 }, want: { food: 4 }, w: 3, text: "2 meds" },
  { item: "tourniquet", want: { scrap: 2 }, w: 2, text: "a tourniquet" },
  { item: "flashlight", want: { scrap: 3 }, w: 2, text: "a flashlight" },
  { item: "knife", want: { food: 2 }, w: 1, text: "a kitchen knife" },
  { give: { scrap: 4 }, want: { food: 3 }, w: 2, text: "4 scrap" },
  { give: { preserved: 4 }, want: { scrap: 3 }, w: 2, text: "4 tins of food" },
];

const r1 = (v) => Math.round((v || 0) * 10) / 10;
const r2 = (v) => Math.round((v || 0) * 100) / 100;
const first = (s) => s.name.split(" ")[0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const tallyDay = (now) => Math.floor((now - 1) / 24);
const hod = (h) => ((Math.floor(h) % 24) + 24) % 24;
const wpick = (rng, list) => rng.weighted(list, (x) => Math.max(0, x.w));
const sumStock = (st, want) => Object.entries(want).every(([k, q]) => (k === "food" ? foodIn(st) : st[k] || 0) >= q); // food: days of it (foods.js)
const managed = (state, base) => !state.autopilot && !stewardOn(base);
// The trip's own dice: the seed, the person, the day, the trip of the day and its job (never the world's rng; the
// person by their world-local id: ids are process-wide, tools/sameseedtest.js).
// personKey (members.js): one who joined from an AI group keeps their member id (MEMBER.ID0 up), the same in every world on
// the seed; localId would take the world's own first id off it, a different number in each (sameseedtest seed 42).
export const diceFor = (state, s, t, salt = "") => new Rng(Math.floor(hash01("tripev", state.seed, personKey(state, s.id), Math.floor(t.leave / 24), t.n || 0, t.job, salt) * 4294967296));
export const evStats = (state) => {
  if (!state.stats) state.stats = {};
  return state.stats.tripEv || (state.stats.tripEv = { trips: 0, n: 0, kinds: {}, hurt: 0, killed: 0, fled: 0, dropped: 0, won: 0, shots: 0, found: 0, cards: 0, meat: 0, lostHours: 0 });
};
function dayTally(state, base, now) {
  const d = tallyDay(now);
  if (!base.tripTally || base.tripTally.day !== d) base.tripTally = { day: d };
  return base.tripTally.ev || (base.tripTally.ev = { n: 0, kinds: {}, hurt: 0, killed: 0, fled: 0, shots: 0, noise: 0, gunfire: {} });
}

// ---------- the roll ----------
// The weather's part: storms, fog and snow make more trouble (slips, getting lost).
function wxMult(state, tile, h) {
  const w = Weather.weatherAt(state, tile, h);
  return w.key === "fog" || w.key === "blizzard" ? 1.3 : w.severe || w.key === "snow" ? 1.2 : 1;
}
// Once a trip (jobtrips.js stepPerson, the first hour it runs): t.ev = { at, seed } when something will happen.
export function armTripEvent(state, base, s, t) {
  t.evr = 1;
  const st = evStats(state);
  st.trips++;
  const by = coveredBy(state, s, t); // teamwork.js: a crew rolls once: a mate set out first and its roll covers this trip
  if (by) { t.evBy = by.id; return null; }
  t.evLead = 1;
  const rng = diceFor(state, s, t);
  const hours = Math.max(0, t.home - t.leave);
  const p = TRIP_EV.rate * hours * paceOf(state).ev * wxMult(state, t.at, t.leave) * cfgOf(state, "events"); // worldcfg.js: the run's Events dial
  if (!(rng.next() < p)) return null;
  t.ev = { at: r2(t.leave + rng.next() * hours * 0.98), seed: Math.floor(rng.next() * 1e9) };
  return t.ev;
}
// Where in the trip a time falls: "out", "work" or "back".
const phaseAt = (t, at) => (at < t.arrive ? "out" : at < t.workEnd ? "work" : "back");
// Roughly where they are: the work tile (the base's own tile when they work there).
const placeOf = (t) => t.at;
// The dead beasts' share of a tile's dead (deadbeasts.js beastMix), 0 where there are none.
const beastShareAt = (state, tile) => { const m = beastMix(state, tile); return m ? Object.values(m).reduce((a, v) => a + v, 0) : 0; };
// The kinds' weights here and now.
function kindWeights(state, base, s, t, phase, h) {
  const K = TRIP_EV.kinds;
  const tile = state.tiles[placeOf(t)] || {};
  const inf = Math.max(0, Math.min(1, tile.infection || 0));
  const dusk = h >= 18 || h < 7;
  const hordeNear = (state.hordes || []).some((x) => state.grid.distance(x.tile, placeOf(t)) <= 1);
  const terr = tile.terrain || "plains";
  const animalW = Object.values(TRIP_ANIMALS).reduce((a, x) => a + (x.terr[terr] || 0) * (x.season[Weather.season(state, h).key] ?? 1), 0);
  const w = {
    dead: K.dead * (0.5 + 2.5 * inf) * (dusk ? 1.3 : 1) * (hordeNear ? 2 : 1),
    deadbeast: K.deadbeast * Math.min(TRIP_EV.beastMax, beastShareAt(state, placeOf(t)) * TRIP_EV.beastShare) * (dusk ? 1.2 : 1), // deadbeasts.js: the worm's dead animals on this ground
    animal: K.animal * Math.min(1.4, animalW) * (t.job === "hunt" ? 1.4 : 1),
    injury: K.injury * ({ wood: 1.5, scavenge: 1.3, forage: 0.8, hunt: 1, fish: 0.9, water: 0.8 }[t.job] || 1) * accidentMult(s),
    lost: phase === "work" || t.d < 1 ? 0 : K.lost * ({ forest: 1.4, mountain: 1.6, hills: 1.2, plains: 0.5, suburb: 0.4, city: 0.5 }[terr] ?? 1) * wxMult(state, placeOf(t), h) * (dusk ? 1.3 : 1),
    stranger: K.stranger * (tile.road ? 1.4 : 1),
    find: K.find * (t.job === "scavenge" ? 1.5 : 1),
  };
  return w;
}

// ---------- fighting and getting away ----------
// Their fighting worth on a trip: combatPower with a gun or bow that has nothing to shoot counted as a club. A gun is
// also held quiet (a club) where shots are not wanted: a hunter while the base's hunting mix has no guns (Quiet, Bows,
// Traps: hunting.js huntMixOf), anyone from a base running silent (hiding.js).
export const holdFire = (base, t) => !!(base && (base.silent || (t && t.job === "hunt" && huntMixOf(base).guns <= 0)));
export function tripPower(state, base, s, t = null) {
  const k = tripKit(state, base, s);
  if (k.gun && k.ready && holdFire(base, t)) { k.ready = false; k.quiet = true; }
  let p = combatPower(s);
  if (k.weapon && !k.ready) { const d = GEAR[k.weapon.key]; p = Math.max(0.5, p - (d.power || 0) * (k.weapon.quality || 1) + 0.8); }
  return { p, k };
}
// The chance of slipping away from trouble. sk(key): a crew's best at a skill (teamwork.js), else s's own.
function fleeChance(state, s, t, phase, extra = 0, sk = null) {
  const F = TRIP_EV.flee;
  const load = phase === "back" && t.carry && !t.carry.empty;
  const sv = (key) => (sk ? sk(key) : skill(s, key));
  return clamp(F.base + F.scouting * sv("scouting") + F.stealth * sv("stealth") - (load ? F.load : 0) - ((s.health ?? 100) < 50 ? F.hurt : 0) + extra, F.min, F.max);
}
// A fight by the numbers: { win, hits: [dmg …], shots }. my: their worth; foe: one foe's; n: how many.
function fight(rng, my, foe, n, kit, hitDmg = TRIP_EV.hit) {
  const threat = foe * n;
  const r = my / (my + threat);
  const win = rng.next() < clamp(Math.pow(r, 1.5) * 1.6, 0.05, 0.97);
  const hp = clamp(0.5 * (1 - r), 0.03, 0.45) * (kit.gun && kit.ready ? 0.5 : 1);
  const hits = [];
  for (let i = 0; i < n; i++) if (rng.next() < hp) hits.push(rng.int(hitDmg[0], hitDmg[1]));
  if (!win) { hits.push(rng.int(hitDmg[0] + 3, hitDmg[1] + 6)); if (n > 1 && rng.next() < 0.5) hits.push(rng.int(hitDmg[0], hitDmg[1])); }
  const shots = kit.gun && kit.ready ? n * rng.int(1, 3) : kit.bow && kit.ready ? n * rng.int(1, 2) : 0;
  return { win, hits, shots, r };
}
// Shots fired: rounds from the base's stock (a bow's arrows, half picked up again), the noise for the day's tally.
function spendShots(state, base, s, kit, shots, now, tile) {
  if (!(shots > 0) || !kit.weapon) return 0;
  const T = dayTally(state, base, now);
  if (kit.bow) { const a = Math.min(base.stock.arrows || 0, Math.ceil(shots / 2)); base.stock.arrows = (base.stock.arrows || 0) - a; return 0; }
  const n = drawShots(base.stock, [s], shots).n;
  if (n > 0) {
    const d = GEAR[kit.weapon.key] || {};
    const quiet = (d.noise || 0) >= 1 ? gunMods(kit.weapon).noise : 1;
    T.shots += n;
    T.noise = r1(T.noise + (d.noise || 2) * quiet * n / 3); // hunting.js's rule: the gun's noise / 3 a shot
    T.gunfire[tile] = Math.max(T.gunfire[tile] || 0, quiet);
    evStats(state).shots += n;
  }
  return n;
}
// Wounds: each hit through their armour and toughness (world.js woundMult, armorMult), a deep cut from a bad one
// (own dice), a bleed after TRIP_EV.bleed at once unless they carry a tourniquet or a kit (used: a tourniquet is gone,
// a kit loses a use). Returns { dmg, dead, aid (what they used), bled }.
function wound(state, s, hits, rng, tile, cause) {
  let dmg = 0;
  const out = { dmg: 0, dead: false, aid: "", bled: 0 };
  for (const h of hits) {
    const a = Math.round(h * woundMult(s) * armorMult(s));
    if (a <= 0) continue;
    dmg += a;
    hurt(state, s, a, tile, cause, { raw: true });
    if (!s.alive) { out.dmg = dmg; out.dead = true; return out; }
    if (a >= 10 && rng.next() < 0.3) addCondition(state, s, "cut", "from the wound", { quiet: true, cause: "trip", sev: rng.int(CONDITIONS.cut.sev[0], CONDITIONS.cut.sev[1]) });
  }
  out.dmg = dmg;
  if (dmg >= TRIP_EV.bleed) {
    const aid = useAid(s);
    if (aid) out.aid = aid;
    else {
      const B = dmg >= 2 * TRIP_EV.bleed ? TRIP_EV.bleedBad : TRIP_EV.bleedDmg;
      out.bled = rng.int(B[0], B[1]);
      hurt(state, s, out.bled, tile, `bleeding out on the way home (${cause.replace(/^to /, "")})`, { raw: true });
      if (!s.alive) out.dead = true;
    }
  }
  if (dmg > 0) evStats(state).hurt++;
  return out;
}
// A tourniquet (gone) or a kit (a use less) they carry: its name, or "".
function useAid(s) {
  const spots = carriedSpots(s);
  const tq = spots.find((x) => GEAR[x.item.key] && GEAR[x.item.key].selfStab) || spots.find((x) => GEAR[x.item.key] && GEAR[x.item.key].medKit);
  if (!tq) return "";
  const name = tq.item.name;
  if (tq.item.dur != null) { tq.item.dur -= 1; if (tq.item.dur <= 0) tq.take(); }
  else if (GEAR[tq.item.key].dur === 1) tq.take();
  return name.toLowerCase();
}

// ---------- what the trouble does to the trip ----------
// Home now (cut short: on the way out they turn back, at work they pack up).
const goHome = (t, when, why) => cutShort(t, when, why);
// The load left behind (fled with nothing): what they carried, or what they would have brought.
function dropLoad(t) {
  const had = t.carry && !t.carry.empty ? loadText(t) : "";
  if (t.carry) t.carry = { empty: true };
  t.noLoad = true;
  return had;
}
// Hours lost: everything after `when` later by h (on the way out: less time at the work).
function delay(t, when, h, phase) {
  if (phase === "out") {
    t.arrive += h;
    if (t.arrive > t.workEnd) { const over = t.arrive - t.workEnd; t.workEnd = t.arrive; t.home += over; if (t.next != null) t.next += over; }
  } else if (phase === "work") t.workEnd = Math.max(when, t.workEnd - h); // the work's hours lost, home as planned
  else { t.home += h; if (t.next != null) t.next += h; }
}
// Holds the trip still for an hour (a card waiting): everything after `from` later by h.
function shiftAfter(t, from, h) {
  for (const k of ["arrive", "workEnd", "home", "next"]) if (t[k] != null && t[k] > from) t[k] = r2(t[k] + h);
}

// ---------- the events ----------
// Builds the event (what it is) from its dice: { kind, … }.
// sk(key): a crew's best at a skill (teamwork.js), else s's own.
function buildEvent(state, base, s, t, rng, phase, h, sk = null) {
  const w = kindWeights(state, base, s, t, phase, h);
  const kinds = Object.keys(w).filter((k) => w[k] > 0);
  const kind = rng.weighted(kinds, (k) => w[k]);
  const tile = state.tiles[placeOf(t)] || {};
  const sea = Weather.season(state, h).key;
  switch (kind) {
    case "dead": { const inf = tile.infection || 0; const n = rng.next() < 0.5 - inf * 0.3 ? 1 : rng.next() < 0.65 ? 2 : 3; return { kind, n }; }
    case "deadbeast": { // the dead beasts of this ground (deadbeasts.js): the likelier kind; packs of dogs and cats up to 3, the big ones 1–2
      const m = beastMix(state, placeOf(t));
      if (!m) return { kind: "dead", n: 1 };
      const kinds = Object.keys(m);
      const beast = kinds.length === 1 ? kinds[0] : rng.weighted(kinds, (k) => m[k]);
      const pack = beast === "deadhound" || beast === "deadcat";
      return { kind, beast, n: rng.int(1, pack ? 3 : 2) };
    }
    case "animal": {
      const list = Object.entries(TRIP_ANIMALS).map(([k, a]) => ({ k, w: (a.terr[tile.terrain] || 0) * (a.season[sea] ?? 1) })).filter((x) => x.w > 0);
      if (!list.length) return { kind: "find", find: TRIP_FINDS.indexOf(wpick(rng, TRIP_FINDS)) };
      const a = wpick(rng, list).k;
      const A = TRIP_ANIMALS[a];
      return { kind, animal: a, n: rng.int(A.n[0], A.n[1]) };
    }
    case "injury": {
      const key = phase === "work" && TRIP_INJURY[t.job] ? t.job : "walk"; // a job with no list of its own (haul) gets the road's
      const pool = TRIP_INJURY[key];
      return { kind, inj: pool.indexOf(wpick(rng, pool)), pool: key };
    }
    case "lost": return { kind, hours: r1(clamp(1 + 2 * rng.next() - 0.06 * (sk ? sk("scouting") : skill(s, "scouting")), 0.5, 3) * (h >= 19 || h < 6 ? 1.3 : 1)) };
    case "stranger": {
      if (rng.next() < 0.35) return { kind, threat: true, power: r1(3 + rng.next() * 4), gun: rng.next() < 0.4 };
      const o = TRIP_OFFERS.indexOf(wpick(rng, TRIP_OFFERS));
      return { kind, threat: false, offer: o };
    }
    case "find": return { kind, find: TRIP_FINDS.indexOf(wpick(rng, TRIP_FINDS)) };
    default: return { kind: "find", find: 0 };
  }
}

// The hour pass reaches the event's time (jobtrips.js stepPerson): fires it. A big moment at a base you run yourself
// raises a card and holds the worker (t.ev.pending); everything else resolves now.
export function fireTripEvent(state, base, s, t, now) {
  const ev = t.ev;
  ev.done = true;
  const rng = new Rng(ev.seed);
  const phase = phaseAt(t, ev.at);
  const h = hod(ev.at);
  // teamwork.js: everyone of the crew out with them now is in it (not those held by trouble of their own).
  const crew = crewAt(state, s, ev.at, ev.at + 1e-6, { free: true });
  const sk = crew.length > 1 ? (key) => Math.max(...crew.map((x) => skill(x, key))) : null;
  Object.assign(ev, ev.force ? { ...ev.force } : buildEvent(state, base, s, t, rng, phase, h, sk), { phase }); // force: a test's or a dev tool's event
  delete ev.force;
  if (crew.length > 1) {
    ev.crew = crew.map((x) => x.id);
    if (ev.kind === "dead" || ev.kind === "deadbeast") { ev.n0 = ev.n; ev.n = crewDead(ev.n, crew.length); } // more of the dead come at a crew
    for (const x of crew.slice(1)) x.trip.follow = { sid: s.id, at: ev.at, phase };
  }
  const st = evStats(state);
  st.n++;
  st.kinds[ev.kind] = (st.kinds[ev.kind] || 0) + 1;
  const T = dayTally(state, base, now);
  T.n++;
  T.kinds[ev.kind] = (T.kinds[ev.kind] || 0) + 1;
  const big = (ev.kind === "animal" && TRIP_ANIMALS[ev.animal].big) || ev.kind === "stranger";
  if ((big || ev.kind === "dead" || ev.kind === "deadbeast") && managed(state, base)) return raiseCard(state, base, s, t, now); // the dead, the dead beasts: the attack card (loneattack.js)
  return settle(state, base, s, t, null, now);
}

// ---------- a crew in trouble together (teamwork.js) ----------
// The crew the trouble on s's trip involves: [{ s, t }], s (whose roll it was) first, then the mates out with them
// when it fired (t.ev.crew; each mate's t.follow points at it). Alone: [{ s, t }].
function crewOf(state, s, t) {
  const out = [{ s, t }];
  const ev = t && t.ev;
  if (!ev || !ev.crew) return out;
  for (const id of ev.crew) {
    if (id === s.id) continue;
    const x = survivorById(state, id);
    const u = x && x.trip;
    if (u && u.follow && u.follow.sid === s.id && u.follow.at === ev.at) out.push({ s: x, t: u });
  }
  return out;
}
// What the crew meets the trouble with: { crew, many, my (their worth together), k (the kit: a ready gun or bow if any
// of them has one, any light, the first weapon), kits (each one's), shooter (the one whose gun or bow fires: an index
// or −1), sk(key) (the crew's best at a skill), best(key) (who that is), who ("Mara Lin" / "Mara and Ben") }.
function ctxOf(state, base, s, t) {
  const crew = crewOf(state, s, t).filter((c, i) => i === 0 || c.s.alive);
  const lead = tripPower(state, base, s, t);
  if (crew.length === 1) return { crew, many: false, my: lead.p, k: lead.k, kits: [lead.k], shooter: lead.k.weapon && lead.k.ready && (lead.k.gun || lead.k.bow) ? 0 : -1, sk: (key) => skill(s, key), best: () => s, who: s.name, fw: first(s) };
  const pw = crew.map((c, i) => (i === 0 ? lead : tripPower(state, base, c.s, c.t)));
  const kits = pw.map((x) => x.k);
  const my = pw.reduce((a, x) => a + x.p, 0);
  const shooter = kits.findIndex((x) => x.weapon && x.ready && x.gun);
  const sh = shooter >= 0 ? shooter : kits.findIndex((x) => x.weapon && x.ready && x.bow);
  const kw = sh >= 0 ? kits[sh] : kits.find((x) => x.weapon && x.ready) || kits.find((x) => x.weapon) || lead.k;
  const k = { ...lead.k, weapon: kw.weapon, gun: kw.gun && kw.ready, bow: kw.bow && kw.ready, melee: !!kw.melee, ready: !!kw.ready, light: kits.map((x) => x.light).find(Boolean) || lead.k.light };
  const people = crew.map((c) => c.s);
  const best = (key) => people.reduce((b, x) => (skill(x, key) > skill(b, key) ? x : b), people[0]);
  return { crew, many: true, my, k, kits, shooter: sh, sk: (key) => skill(best(key), key), best, who: namesText(people, true), fw: namesText(people) };
}
// The mates hold no more: their trips go on (the outcome already written to them).
function releaseCrew(C) { for (const c of C.crew.slice(1)) if (c.t && c.s.trip === c.t) delete c.t.follow; }

// The choices of a big moment: [{ key, label, hint, def? }] (the default first-marked).
function choicesFor(state, base, s, t, C = ctxOf(state, base, s, t)) {
  const ev = t.ev;
  const { my, k } = C;
  const phase = ev.phase;
  if (ev.kind === "animal") {
    const A = TRIP_ANIMALS[ev.animal];
    const fl = fleeChance(state, s, t, phase, 0.1, C.sk);
    const out = [{ key: "back", label: "Back away slowly", hint: `${Math.round(fl * 100)}% they get clear unhurt (the work stops; ${phase === "back" ? "the load is dropped" : "home empty-handed"})`, def: true }];
    out.push({ key: "hide", label: "Keep still and let it pass", hint: `Lose an hour or two; ${Math.round(clamp(0.6 + 0.02 * C.sk("stealth"), 0.5, 0.9) * 100)}% it wanders off, else it finds them` });
    const r = my / (my + A.power * ev.n);
    out.push({ key: "fight", label: k.gun && k.ready ? "Shoot it" : C.many ? "Stand and fight together" : "Stand and fight", hint: `About ${Math.round(clamp(Math.pow(r, 1.5) * 1.6, 0.05, 0.97) * 100)}% to bring it down${A.meat ? ` (+${A.meat} kg meat)` : ""}${k.gun && k.ready ? "; the shots carry" : ""}; badly hurt if not` });
    return out;
  }
  if (ev.kind === "stranger" && ev.threat) {
    const what = phase === "back" && t.carry && !t.carry.empty ? `the load (${loadText(t)})` : k.weapon ? `the ${k.weapon.name.toLowerCase()}` : "what they carry";
    const pb = backOff(state, s, my, ev, k, C.sk);
    return [
      { key: "give", label: "Hand it over", hint: `Give up ${what}: nobody gets hurt`, def: true },
      { key: "refuse", label: "Stand firm", hint: `${Math.round(pb * 100)}% the stranger thinks better of it; else a fight (${ev.gun ? "they have a gun" : "a knife"})` },
      { key: "run", label: "Run for it", hint: `${Math.round(fleeChance(state, s, t, phase, 0, C.sk) * 100)}% they get away${phase === "back" ? " (the load is dropped)" : ""}` },
    ];
  }
  const o = TRIP_OFFERS[ev.offer];
  const can = sumStock(base.stock, o.want);
  const price = Object.entries(o.want).map(([k2, q]) => `${q} ${k2}`).join(", ");
  return [
    { key: "trade", label: `Trade ${price} for ${o.text}`, hint: can ? `From ${base.name}'s stores: they walk back to the gate together (half an hour)` : `${base.name} has not got ${price}`, off: () => !sumStock(base.stock, o.want) },
    { key: "refuse", label: "Wave them on", hint: "No trade; they go on their way", def: true },
  ];
}
// What the worker (or the governor) picks by themselves (a crew: by their worth together).
function autoChoice(state, base, s, t, C = ctxOf(state, base, s, t)) {
  const ev = t.ev;
  const { my, k } = C;
  if (ev.kind === "animal") {
    const A = TRIP_ANIMALS[ev.animal];
    const r = my / (my + A.power * ev.n);
    return r >= TRIP_EV.fightAt + (A.big ? 0.1 : 0) || (!A.big && fleeChance(state, s, t, ev.phase, 0, C.sk) < 0.5 && r >= 0.35) ? "fight" : A.big ? "back" : "run";
  }
  if (ev.kind === "dead" || ev.kind === "deadbeast") return my / (my + foeWorth(ev) * ev.n) >= TRIP_EV.fightAt ? "fight" : "run";
  if (ev.kind === "stranger" && ev.threat) return backOff(state, s, my, ev, k, C.sk) >= 0.6 ? "refuse" : "give";
  if (ev.kind === "stranger") return sumStock(base.stock, TRIP_OFFERS[ev.offer].want) ? "trade" : "refuse";
  return "";
}
// A robber backs off: their worth against the stranger's, Speech (a crew's best), a gun in hand.
function backOff(state, s, my, ev, k, sk = null) {
  return clamp(0.3 + 0.35 * (my / (ev.power + (ev.gun ? 2 : 0)) - 0.8) + 0.015 * (sk ? sk("speech") : skill(s, "speech")) + (k.gun && k.ready ? 0.1 : 0), 0.1, 0.85);
}

// One of the dead on a trip is worth TRIP_EV.walker; a dead beast its kind's weight more (zombietypes.js).
const foeWorth = (ev) => (ev.kind === "deadbeast" && ev.beast && ZTYPES[ev.beast] ? TRIP_EV.walker * ZTYPES[ev.beast].weight : TRIP_EV.walker);
const foeWords = (ev) => (ev.kind === "deadbeast" && ev.beast ? beastWords(ev.beast, ev.n) : ev.n === 1 ? "one of the dead" : `${ev.n} of the dead`);

function raiseCard(state, base, s, t, now) {
  const ev = t.ev;
  ev.pending = true;
  ev.since = now;
  ev.f = r2(ev.phase === "out" ? (ev.at - t.leave) / Math.max(1e-6, t.arrive - t.leave) : ev.phase === "back" ? (ev.at - t.workEnd) / Math.max(1e-6, t.home - t.workEnd) : (ev.at - t.arrive) / Math.max(1e-6, t.workEnd - t.arrive)); // where they stand (the map)
  shiftAfter(t, ev.at, now + 1 - ev.at); // they stand where they are until the end of this hour
  const C = ctxOf(state, base, s, t);
  const people = C.crew.map((c) => c.s);
  const holdCrew = () => { for (const c of C.crew.slice(1)) { shiftAfter(c.t, ev.at, now + 1 - ev.at); Object.assign(c.t.follow, { what: ev.what, phase: ev.phase, f: ev.f }); } }; // the mates stand with them
  const where = tileLabel(state, placeOf(t));
  const job = TRIP_JOBS[t.job] ? TRIP_JOBS[t.job].ing.toLowerCase() : "working";
  const A = ev.kind === "animal" ? TRIP_ANIMALS[ev.animal] : null;
  if (ev.kind === "dead" || ev.kind === "deadbeast") { // the attack card (loneattack.js): Save and fight, Fight, or their own good sense
    const who = foeWords(ev);
    ev.what = `Attacked by ${who}`;
    holdCrew();
    const enemy = ev.kind === "deadbeast" && ev.beast
      ? { kind: "zombies", count: ev.n, power: Math.round((2 + (state.tiles[placeOf(t)].infection || 0) * 3) * 10) / 10, name: who, types: { [ev.beast]: ev.n }, mix: { [ev.beast]: 1 }, beast: ev.beast }
      : { kind: "zombies", count: ev.n, power: Math.round((2 + (state.tiles[placeOf(t)].infection || 0) * 3) * 10) / 10, name: who };
    const how = ev.kind === "deadbeast" ? `set upon by ${who}: thin, the hide split, the worm moving in the splits` : `set upon by ${who}`;
    const text = C.many
      ? `${C.who}, out ${job} together near ${where}${ev.phase === "back" ? " with the load on their backs" : ""}, are ${how}. Nobody else is near: it is ${C.fw} together, each with what they have on them.`
      : `${s.name}, out ${job} near ${where}${ev.phase === "back" ? " with the load on their back" : ""}, is ${how}. Nobody else is near: it is ${first(s)} alone, with what they have on them.`;
    const { my } = C;
    const r = my / (my + foeWorth(ev) * ev.n);
    const auto = autoChoice(state, base, s, t, C);
    const card = attackCard(state, s, enemy, {
      where, text, setup: tripAttackSetup(state, base, s, t, enemy, people), tags: { tripEv: s.id, tripEvAt: ev.at }, crew: people,
      byNumbers: { label: auto === "fight" ? `Leave it to them (they stand and fight${C.many ? " together" : ""})` : "Leave it to them (they run for it)", hint: auto === "fight" ? `By the numbers: about ${Math.round(clamp(Math.pow(r, 1.5) * 1.6, 0.05, 0.97) * 100)}% to put ${ev.n === 1 ? "it" : "them"} down; shots from the base's rounds` : `By the numbers: ${Math.round(fleeChance(state, s, t, ev.phase, 0, C.sk) * 100)}% they get clear${ev.phase === "back" ? " (the load is dropped)" : ""}`, resolve: (st) => settle(st, base, s, t, null, st.hour) },
    });
    const open = card.choices[1].resolve; // loneattack.js: starts the fight
    const fightChoice = (st) => { ev.battle = true; return open(st); };
    card.choices[0].resolve = fightChoice; card.choices[1].resolve = fightChoice; // the worker holds while the fight is on (holdTrip)
    addCard(state, card);
    evStats(state).cards++;
    alertPop(state, base, s, t, ev.what);
    return true;
  }
  ev.what = A ? `Facing ${A.name}` : ev.threat ? "Held up by a stranger" : "Talking to a stranger";
  holdCrew();
  const title = C.many
    ? A ? `${C.fw} face ${A.name}` : ev.threat ? `${C.fw} are held up` : `A stranger meets ${C.fw}`
    : A ? `${first(s)} and ${A.name}` : ev.threat ? `${first(s)} is held up` : `A stranger meets ${first(s)}`;
  const subj = C.many ? `${C.who}, out ${job} together near ${where},` : `${s.name}, out ${job} near ${where},`;
  const text = A
    ? `${subj} ${C.many ? "have" : "has"} come face to face with ${A.name}. ${ev.phase === "back" ? `They are carrying the load${C.many ? "s" : ""} home.` : ""}`.trim()
    : ev.threat
      ? `${subj} ${C.many ? "are" : "is"} stopped by a lone stranger${ev.gun ? " with a gun" : " with a knife"} who wants what they carry.`
      : `${subj} ${C.many ? "meet" : "meets"} a lone traveller who offers ${TRIP_OFFERS[ev.offer].text} in trade.`;
  const choices = choicesFor(state, base, s, t, C).map((c) => ({
    label: c.label, hint: c.hint, ...(c.def ? { default: true } : {}), ...(c.off ? { disabled: c.off } : {}),
    ai: () => (c.key === autoChoice(state, base, s, t) ? 5 : 1),
    resolve: (st) => settle(st, base, s, t, c.key, st.hour),
  }));
  addCard(state, { title, text, where, tripEv: s.id, tripEvAt: ev.at, ...(C.many ? { crew: people.map((x) => x.id) } : {}), choices });
  evStats(state).cards++;
  alertPop(state, base, s, t, ev.what);
  return true;
}
// Each hour a card waits (jobtrips.js stepPerson): true while the worker holds; after TRIP_EV.hold hours (or when the
// card is gone without an answer: a load, a dropped card) they do what seems best.
export function holdTrip(state, base, s, t, now) {
  const ev = t.ev;
  if (ev.battle) { // the fight on the battle map (loneattack.js): they hold while it is open or waits its turn; its handler settles the trip
    const mine = (x) => !!(x && x.handler === "tripAttack" && x.context && x.context.sid === s.id && x.context.at === ev.at);
    if ((state.combat && mine(state.combat.setup)) || (state.combatQueue || []).some(mine)) { shiftAfter(t, now, 1); return true; }
    ev.battle = false; ev.pending = false; // over (settled by its handler) or never made: the trip goes on
    releaseCrew({ crew: crewOf(state, s, t) });
    return false;
  }
  const i = (state.cards || []).findIndex((c) => c.tripEv === s.id && c.tripEvAt === ev.at);
  if (i >= 0 && now - ev.since < TRIP_EV.hold) { shiftAfter(t, now, 1); return true; }
  if (i >= 0) state.cards.splice(i, 1);
  settle(state, base, s, t, null, now, i >= 0 ? "timeout" : "gone");
  return false;
}
// A mate of a crew while trouble on another's trip holds them all (teamwork.js: t.follow): they hold while its card or
// its battle is open; then on (the outcome was written to their trip as it was settled).
export function followHold(state, base, s, t, now) {
  const f = t.follow;
  const lead = survivorById(state, f.sid);
  const lt = lead && lead.trip;
  if (lt && lt.ev && lt.ev.at === f.at && (lt.ev.pending || lt.ev.battle)) { shiftAfter(t, now, 1); return true; }
  delete t.follow;
  return false;
}

// The fight on the battle map is over (loneattack.js onTripAttack: combat.js result): the trip goes on (a win), is cut
// short (they ran: the load dropped on the way home or at the work) or ended with them (the battle killed them). The
// battle wrote their wounds and death itself; this only steers the trip and tells the log. A crew's (teamwork.js): each
// of them, one line.
export function settleBattle(state, base, s, t, result, enemy) {
  const ev = t.ev;
  const crew = crewOf(state, s, t);
  ev.battle = false;
  ev.pending = false;
  const now = state.hour;
  const when = Math.max(ev.at, Math.min(now, t.home - 0.01));
  const phase = ev.phase || phaseAt(t, when);
  const where = tileLabel(state, placeOf(t));
  const job = TRIP_JOBS[t.job] ? TRIP_JOBS[t.job].ing.toLowerCase() : "working";
  const st = evStats(state);
  const T = dayTally(state, base, now);
  const who = enemy && enemy.name ? enemy.name : foeWords(ev);
  if (crew.length > 1) {
    const dead = crew.filter((c) => !c.s.alive), live = crew.filter((c) => c.s.alive);
    for (const c of dead) { st.killed++; T.killed++; alertPop(state, base, c.s, t, "", "✝"); }
    for (const c of live) if (c !== crew[0]) delete c.t.follow;
    if (dead.length) log(state, `${namesText(dead.map((c) => c.s), true)} ${dead.length > 1 ? "were" : "was"} killed by ${who} out ${job} near ${where}.`, "death");
    for (const c of dead) delete c.s.trip;
    if (!live.length) return;
    const hurt = live.filter((c) => (result.survivorsHurt || []).includes(c.s.id));
    const hurtNote = hurt.length ? ` (${hurt.map((c) => `${first(c.s)} health ${Math.round(c.s.health)}`).join(", ")})` : "";
    const names = namesText(live.map((c) => c.s), true);
    if (result.outcome === "victory") {
      st.won++;
      log(state, `${names} put down ${who} together, out ${job} near ${where}${hurtNote}${dead.length ? `; ${namesText(dead.map((c) => c.s))} did not make it` : ""}.`, hurtNote || dead.length ? "danger" : "good");
      return;
    }
    const dropped = phase !== "out" ? live.map((c) => dropLoad(c.t)).filter(Boolean).join(" and ") : "";
    for (const c of live) goHome(c.t, when, "fled");
    st.fled++; T.fled++;
    if (dropped) st.dropped++;
    log(state, `${names} ${result.outcome === "retreat" ? "ran from" : "got away from"} ${who} near ${where} and ${live.length > 1 ? "are" : "is"} coming home${dropped ? `, leaving ${dropped}` : ""}${hurtNote}.`, "danger");
    return;
  }
  if (!s.alive) { st.killed++; T.killed++; alertPop(state, base, s, t, "", "✝"); delete s.trip; log(state, `${s.name} was killed by ${who} out ${job} near ${where}.`, "death"); return; }
  const hurtNote = (result.survivorsHurt || []).includes(s.id) ? ` (health ${Math.round(s.health)})` : "";
  if (result.outcome === "victory") {
    st.won++;
    log(state, `${s.name} put down ${who} alone, out ${job} near ${where}${hurtNote}.`, hurtNote ? "danger" : "good");
    return;
  }
  const dropped = phase !== "out" ? dropLoad(t) : "";
  goHome(t, when, "fled");
  st.fled++; T.fled++;
  if (dropped) st.dropped++;
  log(state, `${s.name} ${result.outcome === "retreat" ? "ran from" : "got away from"} ${who} near ${where} and is coming home${dropped ? `, leaving ${dropped}` : ""}${hurtNote}.`, "danger");
}
// The outcome: choice (a card's key, or null: their own good sense). Returns the text (a card's answer line).
// A crew (teamwork.js): their worth together, the crew's best skill where one is checked, the hits shared out among
// them by the dice, an accident on one of them, all of them running or holding; a find carried by one of them. Alone,
// every roll is the one it always was.
export function settle(state, base, s, t, choice, now, how = "") {
  const ev = t.ev;
  if (!ev || (choice && !ev.pending)) return "Too late: it is over.";
  const C = ctxOf(state, base, s, t);
  if (ev.pending && (!s.alive || s.trip !== t)) { ev.pending = false; releaseCrew(C); return `${first(s)} is no longer out there.`; }
  ev.pending = false;
  const rng = new Rng(ev.seed + 7919);
  const when = Math.max(ev.at, Math.min(now, t.home - 0.01));
  const phase = ev.phase || phaseAt(t, when);
  const tile = placeOf(t);
  const where = tileLabel(state, tile);
  const job = TRIP_JOBS[t.job] ? TRIP_JOBS[t.job].ing.toLowerCase() : "working";
  const pick = choice || autoChoice(state, base, s, t, C);
  const st = evStats(state);
  const T = dayTally(state, base, now);
  const { crew, many, my, k } = C;
  const who = C.who;
  const timeout = how === "timeout" ? ` (no word came: ${C.fw} did what seemed best)` : "";
  let text = "", level = "info", pop = "!";
  const hurtText = (w) => (w.dead ? "" : w.dmg > 0 ? ` (−${w.dmg + w.bled} health${w.aid ? `, stopped the bleeding with a ${w.aid}` : w.bled ? ", bleeding" : ""})` : "");
  const died = (w, c = crew[0]) => { if (w.dead) { st.killed++; T.killed++; alertPop(state, base, c.s, t, "", "✝"); delete c.s.trip; } return w.dead; };
  const kitOf = (c) => C.kits[crew.indexOf(c)] || k;
  const xpFight = (c, amt) => { const kc = kitOf(c); gainXp(state, c.s, kc.melee || !kc.weapon ? "melee" : "shooting", amt); };
  // The shots: the one whose gun or bow fires (alone: theirs, as always).
  const shoot = (shots) => (many ? (C.shooter >= 0 ? spendShots(state, base, crew[C.shooter].s, C.kits[C.shooter], shots, now, tile) : 0) : spendShots(state, base, s, k, shots, now, tile));
  // The hits shared out among the crew by the dice: [{ c, w }].
  const woundAll = (hits, cause) => {
    if (!many) return [{ c: crew[0], w: wound(state, s, hits, rng, tile, cause) }];
    const per = crew.map(() => []);
    for (const h of hits) per[rng.int(0, crew.length - 1)].push(h);
    return crew.map((c, i) => ({ c, w: per[i].length ? wound(state, c.s, per[i], rng, tile, cause) : { dmg: 0, bled: 0, dead: false, aid: "" } }));
  };
  // The dead among them counted; the living, their wounds in a few words. { all (none left), live [c], who, hurt, harm }.
  const deaths = (rows) => {
    for (const r of rows) died(r.w, r.c);
    const live = rows.filter((r) => !r.w.dead);
    if (!many) return { all: rows[0].w.dead, live: live.map((r) => r.c), who: s.name, hurt: hurtText(rows[0].w), harm: rows[0].w.dmg > 0 };
    const dead = rows.filter((r) => r.w.dead).map((r) => r.c.s);
    const hurt = live.filter((r) => r.w.dmg > 0).map((r) => `${first(r.c.s)} −${r.w.dmg + r.w.bled} health${r.w.aid ? `, the bleeding stopped with a ${r.w.aid}` : r.w.bled ? ", bleeding" : ""}`);
    return { all: !live.length, live: live.map((r) => r.c), who: namesText(live.map((r) => r.c.s), true), hurt: `${hurt.length ? ` (${hurt.join("; ")})` : ""}${dead.length ? `; ${namesText(dead, true)} ${dead.length > 1 ? "were" : "was"} killed` : ""}`, harm: hurt.length > 0 || dead.length > 0 };
  };
  const dropAll = (list) => list.map((c) => dropLoad(c.t)).filter(Boolean).join(" and ");
  const homeAll = (list, at, why) => { for (const c of list) goHome(c.t, at, why); };
  const were = many ? "were" : "was";
  // Running: caught, the first foe lands a blow (a bear's maul: two), each other one TRIP_EV.caught of the time. A crew
  // runs each for themselves (the crew's best Scouting and Stealth showing the way), the foes spread over them.
  const fleeOne = (c, extra, hit, n, cause, maul = 1) => {
    const ok = rng.next() < fleeChance(state, c.s, c.t, phase, extra, C.sk);
    const dropped = phase === "back" || phase === "work" ? dropLoad(c.t) : "";
    st.fled++; T.fled++;
    if (dropped) st.dropped++;
    goHome(c.t, when, "fled");
    gainXp(state, c.s, "scouting", 2);
    if (ok) return { c, ok, dropped, w: { dmg: 0, bled: 0, dead: false, aid: "" } };
    const hits = [];
    for (let i = 0; i < maul; i++) hits.push(rng.int(hit[0], hit[1]));
    for (let i = 1; i < n; i++) if (rng.next() < TRIP_EV.caught) hits.push(rng.int(hit[0], hit[1]));
    if (ev.kind === "dead" && n >= 2 && !kitOf(c).weapon && rng.next() < TRIP_EV.dragged * (n - 1)) { // no weapon to fight free
      hurt(state, c.s, (c.s.health || 0) + 1, tile, cause, { raw: true });
      return { c, ok, dropped, w: { dmg: 0, bled: 0, dead: true, aid: "" } };
    }
    return { c, ok, dropped, w: wound(state, c.s, hits, rng, tile, cause) };
  };
  const fleeAll = (extra, hit, n, cause, maul = 1) => crew.map((c) => fleeOne(c, extra, hit, many ? Math.max(1, Math.round(n / crew.length)) : n, cause, maul));
  const fled = (rows) => ({ ok: rows.every((r) => r.ok), dropped: rows.map((r) => r.dropped).filter(Boolean).join(" and ") });
  switch (ev.kind) {
    case "dead": case "deadbeast": {
      const n = ev.n, foes = foeWords(ev);
      if (pick === "fight") {
        const f = fight(rng, my, foeWorth(ev), n, k);
        shoot(f.shots);
        const rows = woundAll(f.hits, `fighting the dead out ${job} near ${where}`);
        for (const r of rows) xpFight(r.c, 3 * n);
        const D = deaths(rows);
        if (D.all) return `${who} ${were} killed by ${foes}.`;
        if (f.win) { st.won++; text = `${D.who} put down ${foes} near ${where}${many ? " together" : k.weapon ? ` with the ${k.weapon.name.toLowerCase()}` : " with bare hands"}${f.shots ? " (shots fired)" : ""}${D.hurt}.`; level = D.harm ? "danger" : "good"; }
        else { const dropped = phase !== "out" ? dropAll(D.live) : ""; homeAll(D.live, when, "fled"); st.fled++; T.fled++; text = `${D.who} could not hold off ${foes} near ${where} and ran${dropped ? `, leaving ${dropped}` : ""}${D.hurt}.`; level = "danger"; }
      } else {
        const rows = fleeAll(0, TRIP_EV.hit, n, `caught by the dead out ${job} near ${where}`);
        const D = deaths(rows), r = fled(rows);
        if (D.all) return `${who} ${were} dragged down by ${foes}.`;
        text = `${D.who} met ${foes} near ${where} and ${r.ok ? "slipped away" : many ? "got away, not all of them unhurt" : "got away hurt"}${r.dropped ? `, leaving ${r.dropped}` : ""}${D.hurt}.`;
        level = r.ok ? "info" : "danger";
      }
      break;
    }
    case "animal": {
      const A = TRIP_ANIMALS[ev.animal];
      const name = A.name, Name = `${name[0].toUpperCase()}${name.slice(1)}`;
      if (!A.big && rng.next() < A.leave * (k.weapon ? 1.5 : 1) * (many ? 1 + TEAM.beastLeave * (crew.length - 1) : 1)) { text = `${who} met ${name} near ${where}; it sized them up and went.`; pop = "?"; break; }
      if (pick === "hide") {
        const ok = rng.next() < clamp(0.6 + 0.02 * C.sk("stealth"), 0.5, 0.9);
        const L = r1(1 + rng.next());
        for (const c of crew) delay(c.t, when, L, phase);
        st.lostHours += L;
        for (const c of crew) gainXp(state, c.s, "stealth", 2);
        if (ok) { text = `${who} kept still while ${name} passed near ${where}, ${L} hours lost${timeout}.`; break; }
        const f = fight(rng, my, A.power, ev.n, k, A.hit);
        shoot(f.shots);
        const D = deaths(woundAll(f.hits, `after an attack by ${name} near ${where}`));
        if (D.all) return `${who} ${were} killed by ${name}.`;
        homeAll(D.live, when + L, "hurt");
        text = `${Name} found ${D.who} hiding near ${where}${f.win ? "; they drove it off" : ""}${D.hurt}${timeout}.`;
        level = "danger";
        break;
      }
      if (pick === "fight") {
        const f = fight(rng, my, A.power, ev.n, k, A.hit);
        shoot(f.shots);
        const rows = woundAll(f.hits, `after an attack by ${name} near ${where}`);
        for (const r of rows) xpFight(r.c, A.big ? 8 : 4);
        const D = deaths(rows);
        if (D.all) return `${who} ${were} killed by ${name}.`;
        if (f.win) {
          st.won++;
          if (A.meat) { t.bonus = t.bonus || {}; t.bonus.meat = (t.bonus.meat || 0) + A.meat; st.meat += A.meat; }
          text = `${D.who} killed ${name} near ${where}${A.meat ? ` (+${A.meat} kg meat to carry home)` : ""}${f.shots ? ", shots fired" : ""}${D.hurt}${timeout}.`;
          level = D.harm ? "danger" : "good";
          for (const r of rows) if (!r.w.dead && r.w.dmg >= 20) goHome(r.c.t, when, "hurt");
        } else {
          const dropped = phase !== "out" ? dropAll(D.live) : "";
          homeAll(D.live, when, "hurt");
          text = `${Name} got the better of ${D.who} near ${where}${dropped ? `; ${dropped} left behind` : ""}${D.hurt}${timeout}.`;
          level = "danger";
        }
        break;
      }
      const rows = fleeAll(pick === "back" ? 0.1 : 0, A.hit, ev.n, `after an attack by ${name} out ${job} near ${where}`, A.maul || 1);
      const D = deaths(rows), r = fled(rows);
      if (D.all) return `${who} ${were} killed by ${name}.`;
      text = `${D.who} ${pick === "back" ? "backed away from" : "ran from"} ${name} near ${where}${r.ok ? "" : `, but it caught ${many ? rows.filter((x) => !x.ok).map((x) => first(x.c.s)).join(" and ") : "them"}`}${r.dropped ? `, leaving ${r.dropped}` : ""}${D.hurt}${timeout}.`;
      level = r.ok ? "info" : "danger";
      break;
    }
    case "injury": {
      const I = TRIP_INJURY[ev.pool][ev.inj];
      const V = many ? crew[rng.int(0, crew.length - 1)] : crew[0]; // a crew: the accident is one of theirs
      const vs = V.s, vt = V.t;
      const others = many ? namesText(crew.filter((c) => c !== V).map((c) => c.s)) : "";
      if (I.cold) {
        const temp = Weather.weatherAt(state, tile, when).temp;
        const dropped = I.drop ? dropLoad(vt) : "";
        if (temp < 8) {
          addCondition(state, vs, "chestcold", "from a fall into cold water", { quiet: true, cause: "trip", sev: Math.round(clamp(20 + (8 - temp) * 2, 20, 55)) });
          if (temp < -5) hurt(state, vs, 5, tile, `of the cold after a fall into the water near ${where}`, { raw: true });
          goHome(vt, when, "soaked");
          text = `${vs.name} ${I.text} near ${where} (${Math.round(temp)} °C) and came home soaked and shivering: a chest cold${dropped ? `; the buckets went in` : ""}${others ? `; ${others} pulled them out` : ""}.`;
          level = "danger";
        } else {
          vs.mood = Math.max(0, (vs.mood ?? 50) - 3);
          if (temp < 15) goHome(vt, when, "soaked");
          text = `${vs.name} ${I.text} near ${where}: soaked${temp < 15 ? ", home to dry off" : ", no harm done"}${dropped ? ` (the buckets went in)` : ""}.`;
        }
        st.hurt++;
        break;
      }
      const dmg = I.dmg ? Math.round(rng.int(I.dmg[0], I.dmg[1]) * woundMult(vs)) : 0;
      if (dmg > 0) hurt(state, vs, dmg, tile, `after an accident out ${job} near ${where}`, { raw: true });
      if (!vs.alive) { st.killed++; T.killed++; delete vs.trip; if (many) releaseCrew(C); return `${vs.name} died of an accident.`; }
      let what = "";
      if (I.cond && (I.p == null || rng.next() < I.p)) {
        const D = CONDITIONS[I.cond];
        let sev = rng.int(D.sev[0], D.sev[1]);
        let aid = I.cond === "cut" ? useAid(vs) : "", by = "";
        if (I.cond === "cut" && !aid && many) for (const c of crew) { if (c === V) continue; aid = useAid(c.s); if (aid) { by = first(c.s); break; } } // a mate's kit
        if (aid) sev = Math.round(sev * 0.6);
        addCondition(state, vs, I.cond, `out ${job}`, { quiet: true, cause: "trip", sev });
        what = I.cond === "cut" ? `a deep cut${aid ? `, dressed on the spot with ${by ? `${by}'s` : "a"} ${aid}` : ""}` : "a sprain";
        if (I.cond === "sprain" || sev >= 35) { goHome(vt, when, "hurt"); if (I.cond === "sprain") vt.home = r2(vt.home + 0.5); }
      }
      st.hurt++;
      text = `${vs.name} ${I.text} ${phase === "work" ? `at ${where}` : `near ${where}`}${what ? `: ${what}` : ""}${dmg ? ` (−${dmg} health)` : ""}${vt.cut === "hurt" ? `; limping home${others ? `, ${others} work${others.includes(" and ") ? "" : "s"} on` : ""}` : ""}.`;
      level = "danger";
      break;
    }
    case "lost": {
      const L = ev.hours * (k.light || hod(when) < 18 ? 1 : 1.25);
      for (const c of crew) delay(c.t, when, r1(L), phase);
      st.lostHours += r1(L);
      for (const c of crew) gainXp(state, c.s, "scouting", 2);
      text = `${who} lost the way ${phase === "out" ? "out to" : "back from"} ${where}: ${r1(L)} hours gone.`;
      pop = "?";
      break;
    }
    case "stranger": {
      if (ev.threat) {
        const gunHit = ev.gun ? [12, 28] : [8, 20];
        if (pick === "give") {
          const dropped = phase === "back" ? dropAll(crew) : "";
          let lost = dropped;
          if (!dropped && k.weapon) { for (const c of crew) { const sp = carriedSpots(c.s).find((x) => x.item === k.weapon); if (sp) { sp.take(); lost = `the ${k.weapon.name.toLowerCase()}`; break; } } }
          if (!dropped && phase === "work") for (const c of crew) c.t.noLoad = true;
          homeAll(crew, when, "robbed");
          text = `A stranger held up ${who} near ${where}; ${C.fw} handed over ${lost || "what little they had"}${timeout}.`;
          level = "danger";
          break;
        }
        if (pick === "refuse" && rng.next() < backOff(state, s, my, ev, k, C.sk)) { text = `A stranger tried to rob ${who} near ${where}; ${C.fw} stood firm and they backed off.`; gainXp(state, C.best("speech"), "speech", 2); break; }
        if (pick === "run") {
          const rows = fleeAll(0, gunHit, 1, `running from a robber near ${where}`);
          const D = deaths(rows), r = fled(rows);
          if (D.all) return `${who} ${were} shot running from a robber.`;
          text = `${D.who} ran from a robber near ${where}${r.ok ? "" : ` and ${many ? "not all got away unhurt" : "was hurt getting away"}`}${r.dropped ? `, leaving ${r.dropped}` : ""}${D.hurt}.`;
          level = r.ok ? "info" : "danger";
          break;
        }
        const f = fight(rng, my, ev.power + (ev.gun ? 2 : 0), 1, k, gunHit);
        shoot(f.shots);
        const D = deaths(woundAll(f.hits, `after a fight with a robber near ${where}`));
        if (D.all) return `${who} ${were} killed by a robber.`;
        if (f.win) { st.won++; text = `A stranger tried to rob ${who} near ${where}; it came to a fight and ${many ? D.who : first(s)} drove them off${D.hurt}.`; }
        else { const dropped = phase === "back" ? dropAll(D.live) : ""; homeAll(D.live, when, "robbed"); text = `A stranger robbed ${D.who} near ${where} after a fight${dropped ? ` and took ${dropped}` : ""}${D.hurt}.`; }
        level = "danger";
        break;
      }
      const o = TRIP_OFFERS[ev.offer];
      if (pick === "trade" && sumStock(base.stock, o.want)) {
        for (const [k2, q] of Object.entries(o.want)) { if (k2 === "food") payFood(base, q, state); else base.stock[k2] -= q; } // foods.js: days of food, the soonest to spoil first
        if (o.give) gainGoods(state, base, o.give, "keeps"); // foods.js: tins of food as cans
        if (o.item) base.armory.push(lootItem(o.item, "traveller", rng)); // a traveller's pack (itemcond.js)
        for (const c of crew) delay(c.t, when, 0.5, phase);
        gainXp(state, C.best("speech"), "speech", 2);
        text = `${who} met a traveller near ${where} and traded ${Object.entries(o.want).map(([k2, q]) => `${q} ${k2}`).join(", ")} for ${o.text}.`;
        level = "good";
      } else text = `${who} met a traveller near ${where}; no trade${timeout}.`;
      pop = "?";
      break;
    }
    case "find": {
      const F = TRIP_FINDS[ev.find] || TRIP_FINDS[0];
      t.bonus = t.bonus || {};
      let what = "", carrier = null;
      if (F.item) {
        const it = lootItem(F.item, "site", rng);
        carrier = many ? shareLoot(state, crew.map((c) => c.s), it, ev.seed) : null; // teamwork.js: one of them by the dice, room permitting
        if (!carrier) (t.bonus.items = t.bonus.items || []).push(it);
        what = `a ${GEAR[F.item].name.toLowerCase()}`;
      } else for (const [k2, [a, b]] of Object.entries(F.give)) { const q = rng.int(a, b) + (t.job === "scavenge" && rng.next() < C.sk("scavenging") / 20 ? 1 : 0); t.bonus[k2] = (t.bonus[k2] || 0) + q; what = F.text(q); }
      st.found++;
      text = `${who} found ${what} near ${where}${carrier ? `; ${first(carrier)} carries it` : ""}.`;
      level = "good";
      pop = "+";
      break;
    }
  }
  const alive = crew.filter((c) => c.s.alive);
  if (!alive.length) return text;
  log(state, text, level);
  alertPop(state, base, alive[0].s, t, text, pop);
  ev.text = text;
  releaseCrew(C);
  return text;
}
// The map's "!" over the walker (ui/workermap.js): base.tripAlerts [{ t, sid, tile, mark, text }].
function alertPop(state, base, s, t, text, mark = "!") {
  const list = base.tripAlerts || (base.tripAlerts = []);
  list.push({ t: r2(Math.max(t.ev.at, state.hour)), sid: s.id, tile: placeOf(t), mark, text });
  while (list.length > 8) list.shift();
}

// What a trip found or killed comes home with the load (jobtrips.js credit): meat into the store (fresh game), supplies
// into the deposit's stock, items into the base's armory. Returns "+16 meat, +2 scrap" for the map's pop, or "".
export function creditBonus(state, base, t, st) {
  const b = t.bonus;
  if (!b) return "";
  const out = [];
  if (b.meat > 0) {
    depositGame(state, st === base.stock ? base : st, { rations: b.meat }, "hog"); // hunting.js: the boar's raw meat, by item
    out.push(`+${b.meat} meat`);
  }
  for (const k of ["scrap", "preserved", "meds"]) if (b[k] > 0) { if (k === "preserved") giveFood(state, st === base.stock ? base : st, b[k], "keeps"); else st[k] = (st[k] || 0) + b[k]; out.push(`+${b[k]} ${k === "preserved" ? "tins" : k}`); } // foods.js: tins of food as cans and jars
  for (const it of b.items || []) { base.armory.push(it); out.push(`+${it.name.toLowerCase()}`); }
  delete t.bonus;
  return out.join(" ");
}
// A crew's finds carried home by the one the dice gave them to (teamwork.js shareLoot: item.tripFind) go into the
// armory as they get home (jobtrips.js credit), as a lone worker's find does. Returns "+knife" for the map's pop, or "".
export function bankFinds(state, base, s) {
  const out = [];
  for (const x of carriedSpots(s)) {
    if (!x.item || !x.item.tripFind) continue;
    const it = x.item;
    x.take();
    delete it.tripFind;
    base.armory.push(it);
    out.push(`+${it.name.toLowerCase()}`);
  }
  return out.join(" ");
}

// Midnight (economy.js baseDaily): the day's gunshots on the land: the base's Heat (base.tripNoise, hordes.js baseHeat),
// and each roaming horde within HUNT.drawRange of a tile with shots may turn toward it (HUNT.drawChance × the quiet of
// the loudest gun there), on the day's own dice.
export function tripEventsDaily(state, base) {
  const T = base.tripTally && base.tripTally.day === tallyDay(state.hour) ? base.tripTally.ev : null;
  base.tripNoise = T ? r1(T.noise) : 0;
  if (!T) return 0;
  let drawn = 0;
  for (const [tile, quiet] of Object.entries(T.gunfire || {})) {
    for (const h of state.hordes || []) {
      if (!["roam", "border", undefined, null].includes(h.role)) continue;
      if (state.grid.distance(h.tile, Number(tile)) > HUNT.drawRange || h.tile === Number(tile)) continue;
      if (hash01("tripdraw", state.seed, base.tripTally.day, tile, h.id != null ? localId(state, h.id) : h.tile) < HUNT.drawChance * quiet) { h.target = Number(tile); h.path = null; drawn++; }
    }
  }
  return drawn;
}
// The activity line while a card holds them: "Facing a bear", else "".
// A crew's mate held with them (teamwork.js t.follow): the same words.
export const holdText = (t) => (t && t.ev && t.ev.pending ? t.ev.what || "Holding still" : t && t.follow && t.follow.what ? t.follow.what : "");
