// Field Heat: a team that stays put draws attention (review T-25). Every hour a team spends on one tile (waiting,
// holding, camping, gathering, building a boat, looking around, crafting, treating, repairing) builds up local
// Heat from noise, smoke and smell; Heat falls again once the team moves on. Each hour on the spot the chance of
// trouble (the dead wander in, a horde close by is drawn in, scavengers or raiders find the camp) rises with the
// Heat and with how dangerous the tile is. Trouble uses the road's conflict cards (conflicts.js).
//
// Numbers (all per hour on the spot):
//   gain  = activity × place × hive land × team size × night × stance
//     activity: fishing 0.7, setting or checking snares 0.8, waiting / holding / look around / treating 1.0,
//               hunting 1.2 (and +6 a gunshot, hunting.js), cutting wood 1.3 (axes carry: woodcutting.js),
//               gathering / crafting / repairs 1.5,
//               building a boat 1.8 (hammering); resting in the field: the camp danger model below instead
//     place:    countryside 1.0, suburbs 1.4, city 1.8, then × (1 + 0.6 × infection)
//     hive land ×1.4, the red ring around a hive ×2
//     team size 0.7 + 0.1 a person (3 people 1.0, 6 people 1.3)
//     night:    a camp fire carries further (×1.3); otherwise darkness hides the team (×0.8)
//     stance:   stealthy ×0.8
//     camp kit the team carries (GEAR heat, each kind once, together at least ×0.35): camo netting ×0.75, a ghillie
//               wrap ×0.85, rag-wrapped boots ×0.95, a smokeless stove ×0.6 while camping, a gore scent mask ×0.6
//               (worn for 24 hours: one is used up when the team starts to gain Heat or starts a search)
//   searching (scavenge.js searchHeatMult): ghillie ×0.9, boots ×0.85, a scent mask ×0.75, a hiking pack ×1.05
//   decay = 8 an hour on the move (and gone at your own bases); Heat is capped at 100.
//   trouble = 12% × (Heat / 100)^1.5 × danger, danger = 0.15 + 3 × the road's conflict chance here
//             (groups near, AI parties, infected ground, hordes, traffic) + 0.3 city / 0.15 suburbs
//             + 0.3 hive land / 0.8 hive ring + 0.2 a horde within 3 tiles (capped at 2); × 0.8 with a tripwire
//             alarm carried (they hear it coming).
//   After trouble the Heat halves (they found you; the rest lost interest), and nothing more for 6 hours (20 after a
//   conflict card, the road's rule).
// A quiet countryside camp for a night (10 hours) reaches Heat ~25 and has about a 1–2% chance of trouble;
// three days camped in a city near a group or a hive reaches 100 within a day and sees trouble every day or so.
//
// Camps are different (camp danger, CAMP_HEAT below): a team resting in the field (the rest task "camp") gains Heat from what the camp does instead of the activity table:
// its fire (lit or out: a toggle), the people there, the vehicles parked there, shooting at or next to it lately
// (state.gunfire, fading over a day or two) and building work. A camp's Heat settles (CAMP_HEAT.settle an hour) rather
// than climbing to 100, so a small dark camp stays quiet and a big one with a bonfire, trucks and gunfights does not.
// A shelter (buildings.js, tier 0) is a base: its Heat is the base's (hordes.js baseHeat) with the same fire, vehicle
// and shooting terms (shelterHeat) in place of the hub's flat 3.
import { partyMembers, partyTile, tileLabel } from "./parties.js";
import { conflictChance, stationaryEncounter, COOLDOWN_HOURS } from "./conflicts.js";
import { zombieToughness } from "./hives.js";
import { heatMult } from "./skills.js";
import { GEAR } from "./data.js";
import { carriedAll } from "./comforts.js";
import { log } from "./world.js";
import { partyVehicles, isCar } from "./vehicles.js";
import * as Weather from "./weather.js";

export const HEAT_MAX = 100;
export const KIT = { floor: 0.35, tripwire: 0.8, maskHours: 24 };
export const HEAT_DECAY = 8;          // per hour on the move
export const HEAT_TROUBLE = 0.12;     // hourly chance at Heat 100 and danger 1
export const HEAT_COOLDOWN = 6;       // hours after trouble before the next roll
// stage and camp: only where campSite does not apply (it always does for them: the camp danger model, CAMP_HEAT).
const ACTIVITY = { sweep: 0.5, fish: 0.7, snare: 0.8, hunt: 1.2, wood: 1.3, waiting: 1, holding: 1, survey: 1, treat: 1, wait: 1, gather: 1.5, craft: 1.5, repair: 1.5, fixcar: 1.6, stage: 1.6, cross: 1.8, camp: 2 };
const ACT_NAME = { sweep: "surveying (on the move about the area)", fish: "fishing", snare: "snares", hunt: "hunting (gunshots add more)", wood: "cutting wood (the axes carry)", waiting: "waiting", holding: "holding", survey: "looking around", treat: "treating someone", wait: "waiting", gather: "gathering on the shore", craft: "crafting", repair: "repairing the vehicle", fixcar: "getting a found vehicle running (engine noise, tools)", stage: "building the camp", cross: "building a boat", camp: "camp fire and cooking" };

// What the team is doing on the spot (null: moving, in a fight or search, on the water, or not a field team).
export function stationaryActivity(p) {
  if (!p || p.owner !== "player" || p.kind === "convoy") return null;
  if (p.phase === "waiting" || p.phase === "holding") return p.phase;
  if (p.phase === "task" && p.task) {
    if (p.task.type === "cross" && p.task.afloat) return null;
    return ACTIVITY[p.task.type] ? p.task.type : "waiting";
  }
  return null;
}

// Within a tile of one of your bases the team is home: no Heat there (the base has its own, hordes.js baseHeat).
const atHome = (state, tile) => state.bases.some((b) => state.grid.distance(b.tile, tile) <= 1);

// Heat gained this hour on the spot, with the reasons (team panel tooltip).
export function heatGain(state, p, activity = stationaryActivity(p), hour = state.hour) {
  if (!activity) return { gain: 0, parts: [] };
  const site = campSite(state, p, activity, hour);
  if (site) return campGain(state, p, site, hour);
  const tile = partyTile(p);
  const t = state.tiles[tile];
  const parts = [];
  let g = ACTIVITY[activity] || 1;
  parts.push(`${ACT_NAME[activity] || activity} ×${g}`);
  g *= placeMult(state, tile, parts);
  const n = partyMembers(state, p).length;
  const size = Math.round((0.7 + 0.1 * n) * 10) / 10;
  g *= size;
  if (size !== 1) parts.push(`${n} people ×${size}`);
  if (isNightHour(hour)) { // night, as world.js isNight
    const nf = activity === "camp" ? 1.3 : 0.8;
    g *= nf;
    parts.push(activity === "camp" ? "fire at night ×1.3" : "dark ×0.8");
  }
  g *= teamMult(state, p, parts);
  const kit = kitMult(state, p, activity === "camp" ? ["stay", "camp"] : ["stay"], hour);
  if (kit.mult !== 1) { g *= kit.mult; parts.push(...kit.parts); }
  return { gain: g, parts };
}
const isNightHour = (hour) => hour % 24 < 6 || hour % 24 >= 20;
// The place: city, suburbs, infection, hive land (multipliers, their reasons pushed onto parts).
function placeMult(state, tile, parts) {
  const t = state.tiles[tile];
  let g = 1;
  const place = t.terrain === "city" ? 1.8 : t.terrain === "suburb" ? 1.4 : 1;
  if (place > 1) parts.push(`${t.terrain === "city" ? "city" : "suburbs"} ×${place}`);
  g *= place;
  if (t.infection > 0.05) { const inf = 1 + 0.6 * t.infection; g *= inf; parts.push(`infection ×${inf.toFixed(1)}`); }
  const tough = zombieToughness(state, tile);
  if (tough) { const h = tough >= 3 ? 2 : 1.4; g *= h; parts.push(`${tough >= 3 ? "next to a hive" : "hive land"} ×${h}`); }
  return g;
}
// The team: stealthy, the Ranger perk.
function teamMult(state, p, parts) {
  let g = 1;
  if (p.stance === "stealthy") { g *= 0.8; parts.push("stealthy ×0.8"); }
  if (heatMult(state, p) !== 1) { g *= heatMult(state, p); parts.push(`Ranger ×${heatMult(state, p)}`); } // skills.js perk
  return g;
}

// ---------- camp danger ----------
// Heat an hour at a camp, added up (then × the place, stealthy and Ranger, and the camp kit carried):
//   presence  0.3 (people living on one spot: tracks, rubbish, noise)
//   people    0.12 a person there
//   fire      lit: 0.5 by day (smoke), 1.4 at night (the light carries); out: nothing. A smokeless stove carried (GEAR
//             heat "camp") ×0.6 on the fire.
//   vehicles  0.5 a car parked there, 0.7 the pickup (engines, fuel smell, tracks), and raiders want them: +0.12 to the
//             tile's danger each (tileDanger)
//   shots     0.1 a gunshot fired at or next to the camp (a neighbour tile counts half), halving every 18 hours
//             (state.gunfire, noteGunfire: every fight's shots), at most +3
//   work      0.3 while building work goes on (daylight)
// The Heat settles 3% an hour on the spot (it levels off near 33 × the hourly gain): three people working with the fire
// lit day and night level off near 60; the fire out at night, near 35; one quiet team camping a night stays under 20.
export const CAMP_HEAT = {
  presence: 0.3, person: 0.12, fireDay: 0.5, fireNight: 1.4, stove: 0.6, car: 0.5, truck: 0.7, miltruck: 1.1, carDanger: 0.12, carDangerMax: 0.36,
  shot: 0.1, shotCap: 3, shotHalf: 18, shotKeep: 120, shotAdj: 0.5, work: 0.3, settle: 0.03,
};
// A shelter's Heat (base Heat, hordes.js baseHeat) in place of the hub's flat 3: the fire 1 by day / 3 at night, a car
// parked there 1.5 (the pickup 2), 0.25 a weighted gunshot nearby (at most 6). Its people count as at any base.
export const SHELTER_HEAT = { fireDay: 1, fireNight: 3, car: 1.5, truck: 2, miltruck: 3, shot: 0.25, shotCap: 6 };
// The fire's comforts, at a camp or a shelter: warmth (cold exposure × warm while it burns), cooked food and boiled
// water (without it: a raw chance a person a day of a stomach bug, at a camp; a shelter's dirty-water risk doubles) and
// spirits (mood an hour in camp, lit / out; a shelter's people +moodLit a day with it, coldMood a day without it in the
// cold).
export const FIRE = { warm: 0.35, raw: 0.015, campMood: 0.3, campMoodOut: 0.1, shelterMood: 0.5, coldMood: -1, coldAt: 4 };

export const fireLit = (x) => !!x && (x.campFire ?? x.fire) !== false;
// Where a team's Heat is a camp's: resting in the field (the internal rest task "camp": the governor's night stops,
// plans' rest steps). null: not camping. A camp you set up is a base (staging.js): its Heat is base Heat
// (shelterHeat), and a team on its tile is at home (no Heat of its own).
// { kind, tile, teams, people, vehicles, fire, working, where }
export function campSite(state, p, activity = stationaryActivity(p), hour = state.hour) {
  if (!p || !activity) return null;
  const tile = partyTile(p);
  if (activity !== "camp") return null;
  return { kind: "team", tile, teams: [p], people: partyMembers(state, p).length, vehicles: partyVehicles(state, p).filter(isCar), fire: fireLit(p), working: false, where: p }; // every car of the team's
}
const r1 = (v) => Math.round(v * 10) / 10;
const vehicleHeat = (v, C) => (v.type === "miltruck" ? C.miltruck : v.type === "truck" ? C.truck : C.car); // the Army truck (miltrucks.js): bigger, louder, smells of diesel
// The rows of a camp's hourly gain before the multipliers: [{ key, label, v }].
export function campRows(state, site, hour = state.hour, kitP = null) {
  const C = CAMP_HEAT, rows = [];
  rows.push({ key: "presence", label: "camped here", v: C.presence });
  if (site.people) rows.push({ key: "people", label: `${site.people} ${site.people === 1 ? "person" : "people"}`, v: C.person * site.people });
  if (site.fire) {
    const night = isNightHour(hour);
    let v = night ? C.fireNight : C.fireDay;
    const stove = kitP && teamKit(state, kitP).some((it) => it && it.key === "stove");
    if (stove) v *= C.stove;
    rows.push({ key: "fire", label: `fire${night ? " at night" : ""}${stove ? " (smokeless stove)" : ""}`, v });
  }
  for (const v of site.vehicles) rows.push({ key: "vehicle", label: (VEHICLE_WORD[v.type] || "vehicle"), v: vehicleHeat(v, C) });
  const sh = shotsNear(state, site.tile, hour);
  if (sh.w >= 0.5) rows.push({ key: "shots", label: shotsLabel(sh.age), v: Math.min(C.shotCap, C.shot * sh.w) });
  if (site.working) rows.push({ key: "work", label: "building work", v: C.work });
  return rows;
}
const VEHICLE_WORD = { truck: "truck", sedan: "car", suv: "SUV", hummer: "Hummer", van: "van", miltruck: "Army truck" };
export const rowsText = (rows) => rows.map((r) => `${r.label[0].toUpperCase()}${r.label.slice(1)}: +${r.v >= 1 ? r1(r.v) : Math.round(r.v * 100) / 100}`).join(", ");
// A camp's Heat this hour for team p there: { gain, parts, rows, mult }.
export function campGain(state, p, site, hour = state.hour) {
  const rows = campRows(state, site, hour, p);
  const base = rows.reduce((a, r) => a + r.v, 0);
  const multParts = [];
  let mult = placeMult(state, site.tile, multParts) * teamMult(state, p, multParts);
  const kit = kitMult(state, p, ["stay"], hour);
  if (kit.mult !== 1) { mult *= kit.mult; multParts.push(...kit.parts); }
  const parts = [rowsText(rows), ...multParts];
  return { gain: base * mult, parts, rows, mult, base };
}
// The camp danger view for a panel: a team resting in the field: the gain an hour now, the rows, the level it
// settles at, the Heat now (the highest of the teams there).
export function campDanger(state, at, hour = state.hour) {
  const p = at.teams ? at.teams[0] : null;
  if (!p) return null;
  const g = campGain(state, p, at, hour);
  const heat = Math.max(0, ...at.teams.map((q) => q.heat || 0));
  return { ...g, heat, settles: Math.min(HEAT_MAX, g.gain / CAMP_HEAT.settle), text: `${rowsText(g.rows)}${g.parts.length > 1 ? ` (${g.parts.slice(1).join(", ")})` : ""}` };
}

// ---------- gunfire (every fight's shots, combat.js finishCombat) ----------
// state.gunfire: [{ tile, hour, n }], kept CAMP_HEAT.shotKeep hours.
export function noteGunfire(state, tile, n) {
  if (tile == null || !(n >= 1)) return;
  const list = state.gunfire || (state.gunfire = []);
  const last = list[list.length - 1];
  if (last && last.tile === tile && last.hour === state.hour) last.n += n;
  else list.push({ tile, hour: state.hour, n: Math.round(n) });
  while (list.length && state.hour - list[0].hour > CAMP_HEAT.shotKeep) list.shift();
}
// Weighted shots at or next to a tile (fading by half every shotHalf hours) and the hours since the latest.
export function shotsNear(state, tile, hour = state.hour) {
  let w = 0, age = Infinity;
  for (const s of state.gunfire || []) {
    const a = hour - s.hour;
    if (a < 0 || a > CAMP_HEAT.shotKeep) continue;
    const d = s.tile === tile ? 1 : state.grid.distance(s.tile, tile) <= 1 ? CAMP_HEAT.shotAdj : 0;
    if (!d) continue;
    w += s.n * d * Math.pow(0.5, a / CAMP_HEAT.shotHalf);
    age = Math.min(age, a);
  }
  return { w, age };
}
export const shotsLabel = (age) => (age < 6 ? "shots just now" : age < 24 ? "shots today" : age < 48 ? "shots yesterday" : `shots ${Math.floor(age / 24)} days ago`);

// ---------- the shelter (a tier-0 base): its share of base Heat ----------
export function shelterHeat(state, base, hour = state.hour) {
  const S = SHELTER_HEAT, rows = [];
  if (fireLit(base)) rows.push({ key: "fire", label: `fire${isNightHour(hour) ? " at night" : ""}`, v: isNightHour(hour) ? S.fireNight : S.fireDay });
  for (const v of state.vehicles.filter((x) => x.loc && x.loc.kind === "base" && x.loc.baseId === base.id && isCar(x))) rows.push({ key: "vehicle", label: VEHICLE_WORD[v.type] || "vehicle", v: vehicleHeat(v, S) });
  const sh = shotsNear(state, base.tile, hour);
  if (sh.w >= 0.5) rows.push({ key: "shots", label: shotsLabel(sh.age), v: Math.min(S.shotCap, S.shot * sh.w) });
  return { rows, total: rows.reduce((a, r) => a + r.v, 0), text: rowsText(rows) };
}

// ---------- the fire toggle ----------
// x: a camp or shelter (a base with tier 0) or a team (its camp). Returns the message.
export function setFire(state, x, lit) {
  if (!x) return "";
  if (x.members) x.campFire = !!lit; else x.fire = !!lit;
  return lit ? "The fire is lit: warmth, hot food and boiled water, better spirits; its light and smoke carry, most at night." : "The fire is out: darker and quieter, but cold food, unboiled water and cold nights.";
}
// The fire a team sits by, for its comforts: a camp's or shelter's where it waits on one (staging.js), its own while
// it rests in the field; null: no camp.
export function teamFire(state, p) {
  const camp = p.owner === "player" && (p.phase === "task" || p.phase === "waiting") ? state.bases.find((b) => b.tier === 0 && b.tile === partyTile(p)) : null;
  if (camp) return fireLit(camp);
  if (p.phase === "task" && p.task && p.task.type === "camp") return fireLit(p);
  return null;
}
// What a sensible camp does with its fire this hour (the autopilot): lit by day for cooking, at night only in the cold
// or with someone badly hurt; out otherwise (the light carries).
export function fireWanted(state, { hurt = false, hour = state.hour } = {}) {
  const w = Weather.weather ? Weather.weather(state) : null;
  const cold = !!w && w.lo <= FIRE.coldAt;
  return !isNightHour(hour) || cold || hurt;
}

// ---------- camp kit (data.js GEAR heat) ----------
// Everything the team has with it: carried by its people (pockets, hands, packs) and in its cargo.
export function teamKit(state, p) {
  if (!p) return [];
  return [...partyMembers(state, p).flatMap(carriedAll), ...((p.cargo && p.cargo.gear) || [])];
}
const masked = (p, hour) => p.maskUntil != null && hour < p.maskUntil;
// The kit's multiplier for some kinds of Heat (keys of GEAR heat: "stay", "camp", "search"): each item kind counts
// once, a scent mask only while one is on (or one is carried and would be put on). { mult, parts }.
export function kitMult(state, p, kinds, hour = state.hour) {
  const seen = new Set();
  let mult = 1;
  const parts = [];
  for (const it of teamKit(state, p)) {
    const h = GEAR[it.key] && GEAR[it.key].heat;
    if (!h || seen.has(it.key)) continue;
    let m = 1;
    for (const k of kinds) if (h[k]) m *= h[k];
    if (m === 1) continue;
    seen.add(it.key);
    mult *= m;
    parts.push(`${GEAR[it.key].name.toLowerCase()} ×${Math.round(m * 100) / 100}`);
  }
  // A scent mask still on with none left to carry.
  if (masked(p, hour) && !seen.has("scentmask")) {
    let m = 1;
    for (const k of kinds) if (GEAR.scentmask.heat[k]) m *= GEAR.scentmask.heat[k];
    if (m !== 1) { mult *= m; parts.push(`scent mask on ×${m}`); }
  }
  if (mult < KIT.floor) mult = KIT.floor;
  return { mult, parts };
}
// Puts a scent mask on when the team starts to gain Heat or starts a search and none is on: one is used up (from
// whoever carries it, else the cargo). Returns true when one was put on.
export function useScentMask(state, p) {
  if (!p || masked(p, state.hour)) return false;
  for (const s of partyMembers(state, p)) {
    for (const where of [s.pockets || [], (s.gear && s.gear.backpack && s.gear.backpack.contents) || []]) {
      const i = where.findIndex((it) => it && it.key === "scentmask");
      if (i >= 0) { where[i] = null; return putOn(state, p); }
    }
  }
  const list = (p.cargo && p.cargo.gear) || [];
  const i = list.findIndex((it) => it && it.key === "scentmask");
  if (i >= 0) { list.splice(i, 1); return putOn(state, p); }
  return false;
}
function putOn(state, p) {
  p.maskUntil = state.hour + KIT.maskHours;
  log(state, `${p.name || "The team"} smear on a gore scent mask: the dead will not smell them for a day.`, "info");
  return true;
}
// A search's Heat (scavenge.js searchHour): puts on a scent mask if the team has one, then the multiplier.
export function searchHeatMult(state, p) {
  useScentMask(state, p);
  const k = kitMult(state, p, ["search"]);
  for (const s of partyMembers(state, p)) {
    const pk = s.gear && s.gear.backpack;
    if (pk && GEAR[pk.key] && GEAR[pk.key].searchHeat) { k.mult *= GEAR[pk.key].searchHeat; k.parts.push(`${GEAR[pk.key].name.toLowerCase()} ×${GEAR[pk.key].searchHeat}`); break; }
  }
  return k;
}
const hasTripwire = (state, p) => teamKit(state, p).some((it) => it && it.key === "tripwire");

// How dangerous the tile is for a team that stays (0.15 quiet … 2 worst).
export function tileDanger(state, p, tile = partyTile(p)) {
  const t = state.tiles[tile];
  const parts = [];
  const road = conflictChance(state, p, tile).chance;
  let d = 0.15 + road * 3;
  if (road > 0.02) parts.push(`people and the dead about (${Math.round(road * 100)}% a tile on the road)`);
  if (t.terrain === "city") { d += 0.3; parts.push("city"); } else if (t.terrain === "suburb") { d += 0.15; parts.push("suburbs"); }
  const tough = zombieToughness(state, tile);
  if (tough) { d += tough >= 3 ? 0.8 : 0.3; parts.push(tough >= 3 ? "next to a hive" : "hive land"); }
  const horde = state.hordes.find((h) => state.grid.distance(h.tile, tile) <= 3);
  if (horde) { d += 0.2; parts.push("a horde within 3 tiles"); }
  // Vehicles parked at a camp: raiders want them (camp danger, CAMP_HEAT.carDanger each).
  const site = p && p.owner === "player" ? campSite(state, p) : null;
  if (site && site.vehicles.length) { d += Math.min(CAMP_HEAT.carDangerMax, CAMP_HEAT.carDanger * site.vehicles.length); parts.push(`${site.vehicles.length === 1 ? "a vehicle" : `${site.vehicles.length} vehicles`} parked (raiders want them)`); }
  d = Math.min(2, d);
  if (hasTripwire(state, p)) { d *= KIT.tripwire; parts.push(`a tripwire alarm ×${KIT.tripwire}`); }
  return { danger: d, parts, horde };
}

export const troubleChance = (heat, danger) => HEAT_TROUBLE * Math.pow(Math.max(0, Math.min(HEAT_MAX, heat)) / 100, 1.5) * danger;
export const dangerWord = (d) => (d < 0.35 ? "quiet" : d < 0.7 ? "some risk" : d < 1.2 ? "dangerous" : "very dangerous");

// Everything the panel and the map tooltip show.
export function heatInfo(state, p) {
  const heat = p.heat || 0;
  const activity = stationaryActivity(p);
  const home = atHome(state, partyTile(p));
  const g = home ? { gain: 0, parts: [] } : heatGain(state, p, activity);
  const dz = tileDanger(state, p);
  const chance = activity && !home ? troubleChance(heat, dz.danger) : 0;
  const moving = p.phase === "out" || p.phase === "back";
  const camp = !home && activity ? campSite(state, p, activity) : null;
  let text = `Heat ${Math.round(heat)}/100: ${camp ? "the camp's fire, people, vehicles and any shooting lately" : "noise, smoke and smell from staying in one place"}. `;
  if (home) text += "At one of your bases: no Heat here.";
  else if (camp) text += `The camp adds ${g.gain.toFixed(1)} an hour (${g.parts.join(", ")}) and loses ${Math.round(CAMP_HEAT.settle * 100)}% of its Heat an hour: it settles near ${Math.round(Math.min(HEAT_MAX, g.gain / CAMP_HEAT.settle))}. The fire is ${camp.fire ? "lit" : "out"}. Danger here: ${dangerWord(dz.danger)}${dz.parts.length ? ` (${dz.parts.join(", ")})` : ""}. Chance of trouble: ${(chance * 100).toFixed(1)}% this hour, growing with the Heat.`;
  else if (activity) text += `Rising ${g.gain.toFixed(1)} an hour here (${g.parts.join(", ")}). Danger here: ${dangerWord(dz.danger)}${dz.parts.length ? ` (${dz.parts.join(", ")})` : ""}. Chance of trouble (the dead, a horde, scavengers or raiders finding the team): ${(chance * 100).toFixed(1)}% this hour, growing with the Heat. Moving on lets it fall ${HEAT_DECAY} an hour.`;
  else if (moving) text += `Falling ${HEAT_DECAY} an hour while the team moves.`;
  else text += "Not rising now.";
  return { heat, gain: g.gain, danger: dz.danger, chance, text, activity, camp, rows: g.rows || null, level: heat < 25 ? "low" : heat < 50 ? "rising" : heat < 75 ? "high" : "extreme" };
}

// Hourly, from parties.js playerPartyHour (after food and water). Builds or sheds Heat and may bring trouble:
// returns the card it raised (already added by the caller's addCard) or null.
export function fieldHeatHour(state, p, addCard) {
  if (p.owner !== "player" || p.kind === "convoy") return null;
  const tile = partyTile(p);
  const activity = stationaryActivity(p);
  if (atHome(state, tile)) { p.heat = 0; return null; }
  if (!activity) {
    if (p.phase === "out" || p.phase === "back") p.heat = Math.max(0, (p.heat || 0) - HEAT_DECAY);
    return null;
  }
  useScentMask(state, p); // a gore scent mask goes on when the team starts to gain Heat
  p.heat = nextHeat(state, p, activity, p.heat || 0, state.hour);
  p.heatTile = tile;
  // One thing at a time: no trouble while the team has a card open, or right after the last trouble.
  if (state.cards.some((c) => c.partyId === p.id) || state.combat || (p.heatTrouble != null && state.hour - p.heatTrouble < HEAT_COOLDOWN)) return null;
  // The road's rule too: at most one conflict per team every 20 hours (conflicts.js COOLDOWN_HOURS).
  if (p.lastConflict != null && state.hour - p.lastConflict < COOLDOWN_HOURS) return null;
  if (p.eventHour === state.hour) return null;
  const dz = tileDanger(state, p, tile);
  if (!state.rng.chance(troubleChance(p.heat, dz.danger))) return null;
  const card = stationaryEncounter(state, p, { horde: dz.horde && dz.horde.size >= 10 ? dz.horde : null, heat: p.heat });
  p.heatTrouble = state.hour;
  p.heat *= 0.5;
  if (!card) return null;
  card.text = `${heatLead(state, p, activity)} ${card.text || ""}`.trim();
  p.eventHour = state.hour;
  p.heatEncounters = (p.heatEncounters || 0) + 1;
  addCard(state, card);
  return card;
}

// Heat after an hour on the spot: a camp settles (CAMP_HEAT.settle) as it gains; anything else only gains.
export function nextHeat(state, p, activity, heat, hour = state.hour) {
  const settle = campSite(state, p, activity, hour) ? 1 - CAMP_HEAT.settle : 1;
  return Math.min(HEAT_MAX, heat * settle + heatGain(state, p, activity, hour).gain);
}

function heatLead(state, p, activity) {
  const site = campSite(state, p, activity);
  if (site) return `${site.fire ? "The camp's fire" : "The camp"}${site.vehicles.length ? " and the vehicles parked there" : ""}${shotsNear(state, site.tile).w >= 3 ? " (and the gunfire lately)" : ""} drew attention at ${tileLabel(state, partyTile(p))}.`;
  const what = { wood: "The sound of the axes", camp: "The camp's fire and cooking smells", cross: "The hammering on the shore", gather: "The noise on the shore", craft: "The noise of the work", hunt: "The hunt (and its gunshots)" }[activity] || "Too long in one place";
  return `${what} drew attention at ${tileLabel(state, partyTile(p))}.`;
}

// For the autopilot and the planner: hours a team can stay on a tile before the hourly chance of trouble passes
// `limit` (null: never within `max` hours).
export function safeHours(state, p, activity = "camp", limit = 0.03, max = 96) {
  const dz = tileDanger(state, p);
  let heat = p.heat || 0;
  for (let h = 1; h <= max; h++) {
    heat = nextHeat(state, { ...p, phase: "task", task: { type: activity } }, activity, heat, state.hour + h - 1);
    if (troubleChance(heat, dz.danger) > limit) return h - 1;
  }
  return null;
}

// The planner's look ahead: Heat after staying `hours` on the team's tile doing `activity`, and the chance of at
// least one trouble in that time (without the halving and cooldowns after trouble, so a little pessimistic).
export function heatPreview(state, p, activity, hours, startHour = state.hour) {
  const dz = tileDanger(state, p);
  let heat = p.heat || 0, safe = 1;
  for (let h = 0; h < hours; h++) {
    heat = nextHeat(state, p, activity, heat, startHour + h);
    safe *= 1 - troubleChance(heat, dz.danger);
  }
  return { heat, risk: 1 - safe, danger: dz.danger, word: dangerWord(dz.danger) };
}
