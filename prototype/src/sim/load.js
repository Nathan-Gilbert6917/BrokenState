// Carrying weight (kg) and load bands: what each survivor carries, and what a team's load does to its pace,
// its rations and a car's fuel.
//
// Weights: every item has a weight (data.js GEAR weight; a pack also weighs what is in it, inventory.js itemLoad) and
// every supply has a weight per unit (data.js SUPPLIES weight). There is one system: weight. Pockets and pack
// slots are only where things are kept (and what is ready to use); what limits carrying is kilograms.
//
// A survivor's load = what they wear, hold and keep in pockets and pack + their share of the team's supplies and
// cargo. The team shares that pool out so everyone ends up equally burdened (the same felt load, each up to
// their own max), so whoever carries best (a good pack, no bad back, a higher max) takes more.
// Max load: 40 kg (Bad Back 28), + the pack's `carry` (improvised backpack +6, assault pack +10), + 8 with Packrat.
// A team can never carry more than its people's max loads together (plus its vehicle).
//
// Load bands, the same for everyone, by felt load (the load × 0.88 with an assault pack (its `ease`), × 1.2 with a
// Bad Back):
//   Light ≤ 18 kg: full pace, normal rations · Medium ≤ 28: -10% pace, +15% food and water
//   Heavy ≤ 38: -25% pace, +35% · Overloaded (above 38, up to the max): -45% pace, +60%.
// Scouting (fieldcraft: pacing, packing, resting right) takes 2.5% a point off both the slow-down and the extra
// rations, up to half at Scouting 20. The team moves at its slowest member's pace.
// Vehicles: a car takes the whole load off its riders (no slow-down, normal rations). On bikes each bike's rack
// takes up to 15 kg of the pool first and riding takes 55% of what is left of the slow-down and extra rations away.
// The extra rations count only while the team is on the move (parties.js consume), never while it rests.
//
// The team is weighed when it sets off and when it stops (parties.js weighTeam): eating on the way does not
// lighten its band until it stops, but anything picked up on the move counts at once. That keeps the trip planner's
// ETA, rations and fuel the same as the trip's.
import { GEAR } from "./data.js";
import { skill } from "./world.js";
import { hasPerk } from "./skills.js";
import { allItems, itemLoad, carryBonus } from "./inventory.js";
import { VEHICLE_TYPES, RIDER_KG, OVERLOAD_MAX, OVERLOAD_SPEED, fuelMultFor, isBike, isCar, typeSpeed, typeFuel, typeOffroad, payloadOf, roadPace } from "./vehicles.js";

export const LOAD_BANDS = [
  { key: "light",  name: "Light",      upTo: 18,       slow: 0,    eat: 0 },
  { key: "medium", name: "Medium",     upTo: 28,       slow: 0.1,  eat: 0.15 },
  { key: "heavy",  name: "Heavy",      upTo: 38,       slow: 0.25, eat: 0.35 },
  { key: "over",   name: "Overloaded", upTo: Infinity, slow: 0.45, eat: 0.6 },
];
export const MAX_LOAD = 40;          // kg anyone can carry at most (packs and Packrat add to it)
export const BADBACK_MAX = 28;
export const BADBACK_FEEL = 1.2;     // a bad back makes every load feel 20% heavier
export const PACKRAT_KG = 8;         // Packrat perk (skills.js)
export const EASE_SKILL = "scouting";
export const EASE_PER_POINT = 0.025; // per skill point off the slow-down and the extra rations
export const EASE_MAX = 0.5;
export const BIKE_EASE = 0.55;       // riding a bike takes this share of the load's effects away

const r4 = (x) => Math.round(x * 1e4) / 1e4;

// ---------- one person ----------
export const kgOf = (key) => GEAR[key]?.weight ?? 1;
export const wornLoad = (s) => (s ? allItems(s).reduce((a, it) => a + itemLoad(it), 0) : 0);
export const maxLoad = (s) => (s.traits.includes("badback") ? BADBACK_MAX : MAX_LOAD) + carryBonus(s) + (hasPerk(s, "packrat") ? PACKRAT_KG : 0);
export const packEase = (s) => {
  const pk = s && s.gear && s.gear.backpack;
  return (pk && GEAR[pk.key] && GEAR[pk.key].ease) || 0;
};
export const feelFactor = (s) => (1 - packEase(s)) * (s.traits.includes("badback") ? BADBACK_FEEL : 1);
export const loadEase = (s) => Math.min(EASE_MAX, Math.max(0, skill(s, EASE_SKILL)) * EASE_PER_POINT);
export const bandIndex = (felt) => {
  const i = LOAD_BANDS.findIndex((b) => felt <= b.upTo + 1e-9);
  return i < 0 ? LOAD_BANDS.length - 1 : i;
};

// What `load` kg does to this person: their band, pace and rations (negate: share of the effect a bike takes away).
export function personLoad(s, load, negate = 0) {
  const felt = load * feelFactor(s);
  const band = bandIndex(felt);
  const b = LOAD_BANDS[band];
  const ease = loadEase(s);
  const keep = (1 - ease) * (1 - negate);
  return { sid: s.id, name: s.name, load: r4(load), felt: r4(felt), max: maxLoad(s), band, bandName: b.name, ease, speed: r4(1 - b.slow * keep), eat: r4(1 + b.eat * keep) };
}

// Shares of a pool (kg) for each of `people` ([{ worn, max, f }]): everyone filled to the same felt load, each up to
// their max. overflow: what does not fit is split by max load (the team is over its limit); else it is left out.
export function shareLoad(people, pool, overflow = true) {
  const room = people.map((q) => Math.max(0, q.max - q.worn));
  const cap = room.reduce((a, b) => a + b, 0);
  const put = Math.max(0, Math.min(pool, cap));
  let shares;
  if (put <= 1e-12) shares = people.map(() => 0);
  else if (put >= cap - 1e-9) shares = room.slice();
  else {
    let lo = 0, hi = Math.max(...people.map((q) => q.max * q.f));
    const fill = (lvl) => people.reduce((a, q, j) => a + Math.min(room[j], Math.max(0, lvl / q.f - q.worn)), 0);
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (fill(mid) < put) lo = mid; else hi = mid;
    }
    shares = people.map((q, j) => Math.min(room[j], Math.max(0, hi / q.f - q.worn)));
  }
  const over = pool - put;
  if (overflow && over > 1e-9 && people.length) {
    const tm = people.reduce((a, q) => a + q.max, 0) || people.length;
    shares = shares.map((x, j) => x + (over * (people[j].max || 1)) / tm);
  }
  return shares;
}

// ---------- a team ----------
// The load of a team with this pool (kg of supplies and cargo) and vehicle (null, a car or a stack of bikes):
//   people: each person on foot ({ load, felt, band, bandName, speed, eat, max }), foot: { speed, eat: { sid: × } },
//   ride: the same riding (null on foot), fill / fuelMult (a car), capacity: most pool the team can carry.
// footCap: when the team has a vehicle, `foot` is what it would be on foot with the pool cut to what people can carry
// (parties.js trimCargo does that when the vehicle is left behind).
export function teamLoad(members, pool, v = null) {
  const base = members.map((s) => ({ s, worn: wornLoad(s), max: maxLoad(s), f: feelFactor(s) }));
  const worn = base.reduce((a, q) => a + q.worn, 0);
  const footCap = Math.max(0, base.reduce((a, q) => a + q.max - q.worn, 0));
  const side = (shares, negate) => {
    const people = base.map((q, j) => personLoad(q.s, q.worn + shares[j], negate));
    const eat = {};
    for (const x of people) eat[x.sid] = x.eat;
    return { speed: people.length ? Math.min(...people.map((x) => x.speed)) : 1, eat, people };
  };
  const foot = side(shareLoad(base, pool, !v), 0);
  const out = { pool: r4(pool), worn: r4(worn), total: r4(pool + worn), foot, ride: null, people: foot.people, fill: 0, fuelMult: 1, capacity: footCap, footCap, mode: false };
  if (isBike(v)) {
    const rack = (v.count || 1) * VEHICLE_TYPES.bike.rack;
    out.ride = side(shareLoad(base, Math.max(0, pool - rack), true), BIKE_EASE);
    out.rack = rack;
    out.onRack = Math.min(pool, rack);
    out.capacity = footCap + rack;
    out.people = out.ride.people;
    out.mode = "bike";
  } else if (v) {
    // Several vehicles (vehicles.js fleetOf): the cars' payloads together; bikes among them carry their racks first and
    // their riders (one each) are not in the cars.
    const bikes = v.fleet && v.count ? v.count : 0;
    const rack = bikes * VEHICLE_TYPES.bike.rack;
    const riders = Math.max(0, members.length - bikes);
    const carShare = members.length ? riders / members.length : 0;
    const payload = payloadOf(v); // vehicles.js: the type's payload less the weight of its upgrades (glass, plating)
    const load = bikes ? Math.max(0, pool - rack) + worn * carShare + riders * RIDER_KG : pool + worn + members.length * RIDER_KG;
    if (bikes) {
      out.fill = r4(load / payload);
      out.fuelMult = Math.round(fuelMultFor(out.fill) * typeFuel(v) * 100) / 100;
      const eat = {};
      for (const s of members) eat[s.id] = 1;
      out.ride = { speed: (out.fill > 1 + 1e-9 ? OVERLOAD_SPEED : 1) * typeSpeed(v), eat, people: [] };
      out.payload = payload;
      out.vehicleLoad = r4(load);
      out.rack = rack;
      out.capacity = Math.max(footCap, OVERLOAD_MAX * payload - riders * RIDER_KG - worn * carShare + rack);
      out.mode = true;
      return out;
    }
    out.fill = r4(load / payload);
    out.fuelMult = Math.round(fuelMultFor(out.fill) * typeFuel(v) * 100) / 100; // a thirsty type (vehicles.js: the Army truck ×2)
    const eat = {};
    for (const s of members) eat[s.id] = 1;
    out.ride = { speed: (out.fill > 1 + 1e-9 ? OVERLOAD_SPEED : 1) * typeSpeed(v), eat, people: [] }; // a slow type (the Army truck ×0.67)
    out.payload = payload;
    out.vehicleLoad = r4(load);
    out.capacity = Math.max(footCap, OVERLOAD_MAX * payload - members.length * RIDER_KG - worn);
    out.mode = true;
  }
  return out;
}

// Pool a team can carry (people, plus a car's payload up to 125% or the bikes' racks).
export const poolCapacity = (members, v) => teamLoad(members, 0, v).capacity;
// Most pool (kg) these people carry on foot and still nobody is past band `band` (0 Light … 2 Heavy).
export function poolAtBand(members, band) {
  const top = LOAD_BANDS[Math.max(0, Math.min(LOAD_BANDS.length - 1, band))].upTo;
  return members.reduce((a, s) => {
    const worn = wornLoad(s), max = maxLoad(s);
    return a + Math.max(0, Math.min(max - worn, top / feelFactor(s) - worn));
  }, 0);
}

// The compact record a team keeps (p.burden) once weighed: paces, rations by person, a car's fuel multiplier.
export function burdenRecord(t, members, v) {
  return {
    total: t.total, ids: members.map((s) => s.id).sort((a, b) => a - b).join(","), vid: v ? v.id : null,
    onroad: t.mode === true ? roadPace(v) : 1, // bikes among the cars: the convoy keeps to the bikes on roads (vehicles.js)
    foot: t.foot.speed, eatFoot: t.foot.eat,
    ride: t.ride ? t.ride.speed : null, eatRide: t.ride ? t.ride.eat : null,
    fuelMult: t.fuelMult, fill: t.fill, offroad: t.mode === true ? typeOffroad(v) : 1, // a slow type off-road (vehicles.js)
    band: Math.max(-1, ...(t.mode === true ? [] : t.people.map((x) => x.band))),
  };
}

// Rations a day one person eats and drinks on a team: their load band's multiplier while moving, 1 at rest (needs.js
// gauges fall by it).
export function personRation(burden, s, mode, moving) {
  if (!moving || !burden) return 1;
  const eat = mode ? burden.eatRide || burden.eatFoot : burden.eatFoot;
  return (eat && eat[s.id]) || 1;
}
// Food and water a team eats a day per supply (people × their ration multiplier while moving, 1 each at rest).
export function rationRate(burden, members, mode, moving) {
  return members.reduce((a, s) => a + personRation(burden, s, mode, moving), 0);
}

export const bandName = (i) => (i >= 0 && LOAD_BANDS[i] ? LOAD_BANDS[i].name : "–");
export const pctText = (x) => `${x >= 1 ? "+" : "−"}${Math.round(Math.abs(x - 1) * 100)}%`;
