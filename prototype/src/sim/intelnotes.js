import { foodIn } from "./foods.js"; // days of food
// What your people have learned about other groups' bases, written down when they learn it (sim/intelest.js turns it
// into the estimates the State Map shows when you select a group's base). No imports: the world (world.js), the
// teams (parties.js), the survey (survey.js), trade visits and radio listening (radiolisten.js) all note here.
//
// state.intelLedger = {
//   bases:  { [tile]: { sight?: Look, survey?: Look, visit?: Look } }, the latest look of each kind at that base
//   groups: { [factionId]: { stores?: { hour, wants, spare }, force?: { hour, strength } } }, heard on their channel
// }
// Look = { hour, fid, err, pop, gpop, works, built, cars, main, stock? }: what was there when they looked (true values
// then; intelest.js widens them by err and by age, so the map never shows the exact count). err: how rough the look
// was (LOOK_ERR, less with optics, more at night). A look out of radio range rides home on the team's report (the
// snapshot's gb field, world.js mergeKnowledge), like everything else a team sees.
// Kinds: sight (a base or a team saw it from outside), survey (a Survey team close by, with its optics), visit (a
// trade team at their gates: the stores too).

export const LOOK_ERR = { sight: 0.3, survey: 0.2, visit: 0.12, night: 1.5 };
const HOME_WEIGHT = 2; // conquest.js CONQUEST.HOME_WEIGHT: the main base holds twice a share of the people

export const ledger = (state) => {
  const L = state.intelLedger || (state.intelLedger = { bases: {}, groups: {} });
  L.bases = L.bases || {};
  L.groups = L.groups || {};
  return L;
};
const night = (state) => { const h = ((state.hour % 24) + 24) % 24; return h < 6 || h >= 20; };

// People at one of a group's bases (conquest.js peopleAt).
export function peopleAtBase(f, tile) {
  const i = f.bases.indexOf(tile);
  if (i < 0) return 0;
  if (Array.isArray(f.people)) return f.people.filter((s) => s.alive && s.location && s.location.kind === "member" && s.location.partyId == null && s.location.tile === tile).length; // members.js peopleHere: the people who live there
  const w = f.bases.length - 1 + HOME_WEIGHT;
  return Math.max(1, Math.round((f.pop * (i === 0 ? HOME_WEIGHT : 1)) / w));
}
// Their working vehicles (vehicles.js factionVehicles: a military group's motor pool before it is first read).
const carsOf = (f) => (f.vehicles ? f.vehicles.filter((v) => v && v.condition > 0).length : f.type === "military" ? 2 : 0);

// What a look at the base on this tile takes in (null: no group's base there).
export function baseLook(state, tile, src = "sight", err = null) {
  const f = (state.factions || []).find((x) => x.alive && x.bases.includes(tile));
  if (!f) return null;
  const main = f.bases[0] === tile;
  const look = {
    hour: state.hour, fid: f.id, src, err: err != null ? err : LOOK_ERR[src] * (night(state) ? LOOK_ERR.night : 1),
    pop: peopleAtBase(f, tile), gpop: f.pop, main,
    works: { ...((f.works && f.works[tile]) || {}) }, jail: (f.jails && f.jails[tile]) || 0,
    built: !!state.groupWorks && !f.hcMilitary, // groupworks.js groupsBuild: built up from bare (else the old fixed walls)
    cars: main ? carsOf(f) : 0,
  };
  if (src === "visit") { const s = f.stock || {}; look.stock = { food: Math.round(foodIn(s)), ammo: s.ammo || 0, meds: s.meds || 0, fuel: s.fuel || 0, scrap: s.scrap || 0 }; }
  return look;
}
// How rough a close look is (a survey, a Look around): optics.js opticsFor's look (binoculars ×1.25, a spotting scope
// ×1.6) sharpens it; at night it is rougher unless the optics see in the dark (a thermal, night vision).
export const surveyErr = (state, opt = null) => (LOOK_ERR.survey / Math.max(1, (opt && opt.look) || 1)) * (night(state) && !(opt && opt.night != null) ? LOOK_ERR.night : 1);
// Keep a look: the newest of its kind, unless an older one of that kind was a closer look and is still fresh.
export function keepLook(state, tile, look) {
  if (!look || look.fid == null) return;
  const rec = ledger(state).bases[tile] || (ledger(state).bases[tile] = {});
  const cur = rec[look.src];
  if (cur && cur.hour > look.hour) return;
  if (cur && cur.fid === look.fid && cur.err < look.err && look.hour - cur.hour < 24) return; // a worse look the same day
  rec[look.src] = look;
}
// Look at a base now (it is in view, a Survey team is beside it, a trade team stands at its gates).
export function noteLook(state, tile, src = "sight", err = null) {
  const look = baseLook(state, tile, src, err);
  if (look) keepLook(state, tile, look);
  return look;
}
// A team's snapshot of a tile, with what it saw of a group's base there (it reaches the ledger with the report).
export function withLook(state, snap, tile, src = "sight", err = null) {
  if (!snap || snap.factionBase == null) return snap;
  const look = baseLook(state, tile, src, err);
  if (look) snap.gb = look;
  return snap;
}
// Heard on a group's channel (radiolisten.js): what its stores are short of or full of, a war party's strength.
export function noteHeard(state, fid, kind, data) {
  const g = ledger(state).groups[fid] || (ledger(state).groups[fid] = {});
  g[kind] = { hour: state.hour, ...data };
}
