// Base stewards (suggestions-2 #7) and base leaders: hand one base, or parts of it, to the governor's logic
// (autopilot.js) while you keep everything else (teams, trips, cards, the other bases). Normal play, not a dev tool.
//
// Each base runs under a leader: one of the people who live there (base.steward.leaderId), picked by you or, when you
// hand the base over without picking, the best there by Leadership (Speech counts half). The leader keeps their own
// work and is never sent out by the base; while they are away (on a team, held, on an errand) the next best there stands
// in as deputy (one line each way; with nobody to stand in the base waits). If they die, leave the group or settle at
// another base, the next best there takes over (one line). A person leads one base at a time.
// The leader's Leadership matters: while they are at the base everyone living there gains its mood lift a day
// (morale.js crowdInfo, as the group's leader gives the base where they live), and someone under LEADER.sharp
// Leadership is slow to act: in some hours (LEADER.base + LEADER.per x Leadership of them run, by a fixed hash of the
// base and the hour, not the game's dice) nothing is done.
//
// base.steward = { on, style, leaderId, away, areas: { roles, building, production, medical, food, defence, supplies }, day: { ... } }
// Every area is on by default; each can be switched off on its own:
//   roles       sets everyone's role every hour (autopilot planRoles), but only within the areas it has: a role in
//               an area that is off (farm = Farming & food, medic = Medical, guard = Defence, operate and craft =
//               Crafting & production, build = Building) is left as it is, and so are pinned people;
//   building    queues buildings (planBuilds), each kind only if its own area is on too (walls and barricades need
//               Defence, the hospital Medical, plots and stores Farming & food, stations Crafting & production);
//   production  hands out armory gear (equipFromArmory), queues crafts (planCrafts) and sets the stations' standing
//               orders (govOrders: the player's own orders stand);
//   medical     treats the hurt and sick with base meds and sets the meds reserve (planTreatment); a Medic trainee
//               while the base has too few skilled medics (training.js planTrainees, from planRoles);
//   food        farmers and the food side of building (farm plots, stores, water);
//   defence     guards and the defence buildings, the night watch roster (unless you set your own) and, each morning,
//               a defence plan by role where you have saved none (stewardSafety);
//   supplies    an emergency haul when the water would run out within a day or the food within two (stewardSupplies):
//               the governor's water or food trip, from this base and back. Nothing drastic: no scavenging trips,
//               trades, outposts, people moved, wars or fights picked by this area;
//   trade       a caravan at the gates traded with (never attacked) and a small radio deal for water, food or meds
//               when short (autopilot.js stewardTrade);
//   outposts    from a hub: water to an outpost running dry, scrap or parts for its next building (stewardOutposts);
//   land        hunting, fishing or firewood trips, one team at a time (stewardLand).
// Raid and horde warnings about the base are answered under Defence (stewardWarnings: never by leaving the base).
// Pinned survivors (s.pinned) are never moved, re-equipped or given a station by a steward (or the autopilot).
// Taking over = switching it off: nothing is undone, everything stays as the steward left it. While the dev
// autopilot is on it runs the whole holdout and stewards do nothing.
// Once a day (STEWARD_LOG_HOUR) each steward writes one log line with what it did since the last one.
import { log, hourOfDay, atBase, survivorById, skill, localId } from "./world.js";
import { hash01 } from "./skills.js";
import { BUILDINGS } from "./buildings.js";
import { CRAFTS, craftName } from "./crafting.js";
import { PERSONALITIES, stewardRun, stewardSafety, stewardSupplies, stewardTrade, stewardOutposts, stewardLand, stewardWarnings, autopilotStats } from "./autopilot.js";

export const STEWARD_AREAS = {
  roles:      { name: "Roles", desc: "Sets everyone's role every hour by what the base needs (pinned people and roles in areas switched off are left alone)." },
  building:   { name: "Building", desc: "Queues buildings: beds, water, storage and the rest. Defence, medical, food and workshop buildings also need their own area on." },
  production: { name: "Crafting & production orders", desc: "Hands out armory gear, queues crafts and sets the stations' standing orders (your own orders stand)." },
  medical:    { name: "Medical", desc: "Treats the hurt and sick with this base's meds, staffs the hospital, puts a Medic trainee on the ward while the base has too few skilled medics (training.js), sets the meds reserve." },
  food:       { name: "Farming & food", desc: "Farmers for the plots, and the food and water buildings (plots, stores, wells, preserving)." },
  defence:    { name: "Defence", desc: "Guards when raiders or hordes are near, a lookout at the hub, walls, barricades and other defences, a night watch roster (unless you set your own), a defence plan by role (unless you saved one), and the raid and horde warnings about this base answered (prepare, a tribute cheaper than the fight, a decoy fire; never by leaving the base)." },
  supplies:   { name: "Emergency supplies", desc: "When the water would run out within a day or the food within two, a team from this base goes for it (the leader stays home)." },
  trade:      { name: "Trading", desc: "Trades with a caravan at the gates for what the base is short of, paid from its surplus (never attacks one), and with a radio network makes one small deal for water, food or meds every 6 days at most when short." },
  outposts:   { name: "Supply runs to outposts", desc: "From a hub: water to an outpost running dry, and the scrap or parts its next building waits on. Nobody is moved to live there." },
  land:       { name: "Hunting, fishing & firewood", desc: "A hunting or fishing trip when food runs short (or to stock up in autumn), a wood-cutting trip when firewood is short. One team at a time, not in storms or with raiders or a horde coming." },
};
// Leadership: under `sharp` a leader is slow to act, running base + per x Leadership of the hours (0: half of them).
export const LEADER = { sharp: 5, base: 0.5, per: 0.1 };
const AREA_KEYS = Object.keys(STEWARD_AREAS);
export const STEWARD_LOG_HOUR = 20;
const emptyDay = () => ({ roles: 0, builds: [], crafts: [], treated: 0, equipped: 0, orders: 0, hours: 0, trips: 0, slow: 0, did: [] });

export function stewardOf(base) {
  if (!base.steward) base.steward = { on: false, style: "balanced", areas: Object.fromEntries(AREA_KEYS.map((k) => [k, true])), day: emptyDay() };
  const s = base.steward;
  for (const k of AREA_KEYS) if (s.areas[k] === undefined) s.areas[k] = true;
  if (!s.day) s.day = emptyDay();
  if (s.leaderId === undefined) s.leaderId = null;
  return s;
}
export const stewardOn = (base) => !!(base && base.steward && base.steward.on);

// ---------- the leader ----------
export const leaderScore = (s) => skill(s, "leadership") + skill(s, "speech") * 0.5;
const fit = (s) => !!(s && s.alive && !s.left);
const livesAt = (s, base) => !!(s.location && s.location.kind === "base" && s.location.baseId === base.id);
// The people who could lead this base: alive and living there now, best first.
export function leaderChoices(state, base) {
  return atBase(state, base.id).filter(fit).sort((a, b) => leaderScore(b) - leaderScore(a) || a.id - b.id);
}
// The leader as named (null: none, or dead or gone).
export function leaderOf(state, base) {
  const s = base.steward && base.steward.leaderId != null ? survivorById(state, base.steward.leaderId) : null;
  return fit(s) ? s : null;
}
// Where the leader is: "here", "away" (on a team, held, on an errand or a route: the base waits), "gone" (dead, left
// the group, or living at another base now), or "none" (nobody named).
export function leaderStatus(state, base) {
  const id = base.steward ? base.steward.leaderId : null;
  if (id == null) return "none";
  const s = survivorById(state, id);
  if (!fit(s)) return "gone";
  if (livesAt(s, base)) return "here";
  return s.location && s.location.kind === "base" ? "gone" : "away";
}
// Who runs the base this hour: the leader while here, their deputy while they are away (null: nobody).
export function actingLeader(state, base) {
  const st = leaderStatus(state, base);
  if (st === "here") return leaderOf(state, base);
  if (st !== "away" || !base.steward || base.steward.deputyId == null) return null;
  const d = survivorById(state, base.steward.deputyId);
  return fit(d) && livesAt(d, base) ? d : null;
}
// Share of the hours this person gets anything done as leader (1: every hour).
export const actsShare = (s) => (skill(s, "leadership") >= LEADER.sharp ? 1 : Math.min(1, LEADER.base + LEADER.per * skill(s, "leadership")));
// The base a person leads (null: none).
export const ledBy = (state, s) => (s ? state.bases.find((b) => b.steward && b.steward.leaderId === s.id) || null : null);
// Name someone at this base its leader (id null or "": nobody, only while you run it). A person leads one base:
// another base they led gets its next best.
export function setLeader(state, base, id) {
  const s = stewardOf(base);
  if (id == null || id === "") {
    if (s.on) return `${base.name} needs a leader while it runs itself: take it over first.`;
    s.leaderId = null;
    return `${base.name} has no leader now.`;
  }
  const p = survivorById(state, Number(id));
  if (!fit(p) || !livesAt(p, base)) return `${p ? p.name : "They"} must live at ${base.name} to lead it.`;
  if (s.leaderId === p.id) return "";
  const other = ledBy(state, p);
  if (other && other !== base) dropLeader(state, other, `${p.name} now leads ${base.name}`, p);
  s.leaderId = p.id;
  s.away = false; s.deputyId = null;
  const msg = `${p.name} now leads ${base.name}${s.on ? "" : " (they run it once you hand it over)"}.`;
  if (s.on) log(state, `🧭 ${msg}`, "info");
  return msg;
}
// A base that lost its leader: the next best there takes over (not `not`, who leads elsewhere now), or you do.
function dropLeader(state, base, why, not = null) {
  const s = stewardOf(base);
  s.leaderId = null;
  s.away = false; s.deputyId = null;
  if (!s.on) return;
  const next = leaderChoices(state, base).find((x) => x !== not && !ledBy(state, x));
  if (next) { s.leaderId = next.id; log(state, `🧭 ${why}: ${next.name} leads ${base.name} in their place.`, "danger"); }
  else { s.on = false; log(state, `🧭 ${why}: nobody is left at ${base.name} to lead it. You run it now.`, "danger"); }
}

export function setSteward(state, base, on) {
  const s = stewardOf(base);
  if (!!on === s.on) return "";
  const st = leaderStatus(state, base);
  if (on && st !== "here" && st !== "away") {
    const pick = leaderChoices(state, base).find((x) => !ledBy(state, x));
    if (!pick) return `Nobody at ${base.name} can lead it.`;
    s.leaderId = pick.id;
  }
  s.on = !!on;
  s.away = false; s.deputyId = null;
  s.day = emptyDay();
  // Taken over: the leader's watchers (planRoles puts them on guard, s.govWatch) get their own job back; the roster
  // stays and is stood as yours is (watch.js watchHour).
  if (!on) for (const p of atBase(state, base.id)) if (p.govWatch) { if (p.role === "guard") { p.role = p.govWatch.role; p.station = p.govWatch.station ?? null; } delete p.govWatch; }
  const L = leaderOf(state, base);
  const msg = on
    ? `${L.name} now runs ${base.name} (${areaList(s)}). Pinned people are left alone; take over any time.`
    : `You take over ${base.name}${L ? ` from ${L.name}` : ""}. Everything stays as it is.`;
  log(state, `🧭 ${msg}`, "info");
  return msg;
}
export function setStewardArea(state, base, key, on) {
  if (!STEWARD_AREAS[key]) return "";
  const s = stewardOf(base);
  s.areas[key] = !!on;
  return `${base.name} steward: ${STEWARD_AREAS[key].name} ${on ? "handed over" : "back to you"}.`;
}
export function setStewardStyle(state, base, style) {
  if (!PERSONALITIES[style]) return "";
  stewardOf(base).style = style;
  return `${base.name} steward: ${PERSONALITIES[style].name} style.`;
}
export function setPinned(state, s, on) {
  if (!s) return "";
  s.pinned = !!on;
  if (on) s.parked = null; // production.js: a pinned operator is not moved to a fallback either
  return `${s.name} is ${on ? "pinned: stewards will not change their role, station or gear" : "no longer pinned"}.`;
}
const areaList = (s) => {
  const on = AREA_KEYS.filter((k) => s.areas[k]);
  return on.length === AREA_KEYS.length ? "all areas" : on.length ? on.map((k) => STEWARD_AREAS[k].name).join(", ") : "no areas";
};

// Hourly, from world.js tickHour (after the autopilot would run): every base with a steward on.
export function stewardHour(state) {
  if (state.autopilot || state.gameOver) return;
  for (const base of [...state.bases]) {
    if (!stewardOn(base)) continue;
    const s = stewardOf(base);
    const L = leaderPresent(state, base, s);
    if (!L) continue;
    try {
      runOne(state, base, s, L);
    } catch (e) {
      if (typeof window === "undefined") throw e; // headless tools should see the crash
      console.error("Steward error:", e);
      s.on = false;
      log(state, `🧭 ${base.name}'s leader stopped after an error (${e.message}). You have control there.`, "danger");
    }
    if (hourOfDay(state) === STEWARD_LOG_HOUR && state.bases.includes(base)) dailyLine(state, base, s);
  }
}

// The leader's hour: here, the base runs; away, the base waits (a line each way); gone, the next best takes over.
function leaderPresent(state, base, s) {
  let st = leaderStatus(state, base);
  if (st === "gone" || st === "none") {
    const was = st === "gone" ? survivorById(state, s.leaderId) : null;
    const why = !was ? `${base.name} has no leader` : !was.alive ? `${was.name}, ${base.name}'s leader, is dead` : was.left ? `${was.name}, ${base.name}'s leader, has left` : `${was.name} lives at another base now`;
    dropLeader(state, base, why);
    if (!s.on) return null;
    st = "here";
  }
  const L = leaderOf(state, base);
  if (st === "away") {
    // A deputy stands in: the best there now (not someone leading another base).
    const cur = actingLeader(state, base);
    const dep = cur || leaderChoices(state, base).find((x) => !ledBy(state, x)) || null;
    const was = s.away;
    s.away = true;
    if (!dep) {
      if (!was || s.deputyId != null) log(state, `🧭 ${L.name} is away from ${base.name} and nobody there can stand in: the base waits for its leader (it is yours until they are back).`, "info");
      s.deputyId = null;
      return null;
    }
    if (s.deputyId !== dep.id) log(state, `🧭 ${L.name} is away from ${base.name}: ${dep.name} stands in until they are back.`, "info");
    s.deputyId = dep.id;
    return dep;
  }
  if (s.away) log(state, `🧭 ${L.name} is back and runs ${base.name} again.`, "info");
  s.away = false;
  s.deputyId = null;
  return L;
}

function runOne(state, base, s, L) {
  // Slow to act: a leader under LEADER.sharp gets nothing done in some hours (a fixed hash, not the game's dice).
  if (actsShare(L) < 1 && hash01("lead", state.seed, localId(state, base.id) /* localId: ids are process-wide */, state.hour) >= actsShare(L)) { s.day.slow++; return; }
  const say = (line) => { if (line) { log(state, `🧭 ${L.name} (${base.name}): ${line}`, /^Emergency|heading for/.test(line) ? "danger" : "info"); s.day.did.push(line); } };
  const keep = new Set([L.id, s.leaderId, ...atBase(state, base.id).filter((x) => x.pinned).map((x) => x.id)]);
  if (s.areas.defence) { say(stewardWarnings(state, base, s.style)); say(stewardSafety(state, base, s.style)); }
  if (s.areas.supplies) { const line = stewardSupplies(state, base, s.style, keep); if (line) { s.day.trips++; say(line); } }
  if (s.areas.trade) say(stewardTrade(state, base, s.style, s));
  if (s.areas.outposts) say(stewardOutposts(state, base, s.style, keep));
  if (s.areas.land) say(stewardLand(state, base, s.style, keep));
  const before = autopilotStats(state);
  const builds = new Set(base.construction.map((j) => j.id));
  const crafts = new Set((base.crafting || []).map((j) => j.id));
  const changed = stewardRun(state, base, s.areas, s.style);
  const after = autopilotStats(state);
  const d = s.day;
  d.hours++;
  d.roles += changed || 0;
  d.treated += after.treated - before.treated;
  d.equipped += after.equipped - before.equipped;
  d.orders += (after.orders || 0) - (before.orders || 0);
  for (const j of base.construction) if (!builds.has(j.id)) d.builds.push(BUILDINGS[j.type].name);
  for (const j of base.crafting || []) if (!crafts.has(j.id) && j.orderId == null && CRAFTS[j.recipe]) d.crafts.push(craftName(j.recipe));
}

const listOf = (arr) => {
  const c = {};
  for (const x of arr) c[x] = (c[x] || 0) + 1;
  return Object.entries(c).map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(", ");
};
// The day's line: what it did, and the roles as they stand.
export function stewardSummary(state, base) {
  const s = stewardOf(base);
  const d = s.day;
  const bits = [];
  if (d.roles) bits.push(`${d.roles} role change${d.roles === 1 ? "" : "s"}`);
  if (d.builds.length) bits.push(`queued ${listOf(d.builds)}`);
  if (d.crafts.length) bits.push(`crafting ${listOf(d.crafts)}`);
  if (d.treated) bits.push(`${d.treated} treatment${d.treated === 1 ? "" : "s"}`);
  if (d.equipped) bits.push(`${d.equipped} item${d.equipped === 1 ? "" : "s"} handed out`);
  if (d.orders) bits.push(`${d.orders} station order${d.orders === 1 ? "" : "s"} set`);
  if (d.trips) bits.push(`${d.trips} emergency haul${d.trips === 1 ? "" : "s"}`);
  const others = (d.did || []).filter((l) => !/^Emergency/.test(l) && !/defence plan/.test(l)).length;
  if (others) bits.push(`${others} other action${others === 1 ? "" : "s"} (in the log)`);
  if (d.slow) bits.push(`slow to act ${d.slow} hour${d.slow === 1 ? "" : "s"}`);
  const counts = {};
  for (const p of atBase(state, base.id)) counts[p.role] = (counts[p.role] || 0) + 1;
  const roles = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${n} ${r}`).join(", ");
  const pinned = atBase(state, base.id).filter((p) => p.pinned).length;
  return `${bits.length ? bits.join("; ") : "no changes"}${roles ? ` · now ${roles}` : ""}${pinned ? ` · ${pinned} pinned` : ""}`;
}
function dailyLine(state, base, s) {
  const L = leaderOf(state, base), A = actingLeader(state, base);
  const who = A && L && A !== L ? `${A.name} (standing in for ${L.name}), leader of ${base.name},` : L ? `${L.name}, leader of ${base.name},` : `${base.name}'s leader`;
  log(state, `🧭 ${who} today: ${stewardSummary(state, base)}.`, "info");
  s.last = stewardSummary(state, base);
  s.day = emptyDay();
}
