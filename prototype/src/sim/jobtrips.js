// Job trips: the outdoor jobs worked as trips out to the base's land and back (user request 2026-10-10).
//
// The people on Cut wood, Forage, Hunt, Fish, Scavenge and Fetch water at one of your bases leave the walls in their
// job's hours (tripland.js TRIP_JOBS: daylight for wood, forage, scavenging and water; dawn and dusk for hunting and
// fishing), walk to the job's tile on the base's land (the best for the job by what it holds and how far it is:
// woodTripTile, forageTripTile, huntTripTile, fishWater, scavTripTile, fetchWaterTile), work there, walk home with the
// load and put it in the store ON ARRIVAL (the stock, the Work now panel's output, the stats), then go out again while
// the hours last. The walk costs hours on the tile (tripland.js: 0.5 h a tile each way), so a far tile gives less.
//
// s.trip = { job, base, tile (where they go), at (where they stand: the shore for water jobs), d (tiles out), leave,
//            arrive, workEnd, home (hours, absolute), next? (Fetch water: the next trip's earliest start),
//            reach? (0..1: how far out they got when turned back), carry? (the load, rolled when the work ends),
//            cut? (why it was cut short) }
// Run every hour (world.js tickHour, after the work priorities, the stewards and the watch): at the tick for hour H
// everything due before H + 1 happens (the load is rolled when the work ends, credited when they are home), and
// whoever may work out now and has no trip sets off at H. A trip is cut short (home with what they have) when they
// may no longer be out: hurt, the role changed, on the watch, the base under attack (buildings.js underAttack: on
// alert or under siege: "On hold"), and dropped when they leave the base (a team, an errand).
// While out (world.js outOnTrip, from leaving the gate to coming back in) they are not at hand for a fight at the base.
//
// The day's totals: base.tripTally = { day, [job]: { …sums, who: [ids] } } (the daily systems read it at midnight for
// the noise, the log and the summaries); base.tripPops: the last deposits (the map's "+12 food" pops, ui/render.js).
import { atBase, survivorById } from "./world.js";
import { TRIP, TRIP_JOBS, tripWindow, walkHours, tripScale, depositPoint, drawSource } from "./tripland.js";
import { describeActivity } from "./activity.js";
import { woodTripTile, woodTrip } from "./woodcutting.js";
import { forageTripTile, forageTrip, FORAGE } from "./foraging.js";
import { huntTripTile, huntTrip, fishWater, fishTrip, meatAt } from "./hunting.js";
import { scavTripTile, scavTrip, scavCredit, fetchWaterTile, rawRoom } from "./economy.js";
import { econStats } from "./farming.js";
import { addWormCrop, wormMeatAt } from "./worm.js";
import { noteOutput } from "./output.js";
import { tileLabel } from "./parties.js";
import { RAW } from "./water.js";

const r2 = (v) => Math.round((v || 0) * 100) / 100;
const POPS = 12; // deposits kept for the map
const dayOf = (t) => Math.floor(t / 24);
// The day a credit at tick `now` counts for (output.js workDay − 1: 0-based; the midnight tick is the day before).
const tallyDay = (now) => Math.floor((now - 1) / 24);

// ---------- where they go ----------
// The job's tile at this base: { tile (the target on the map), at (where they work), d } or null.
export function tripTarget(state, base, job) {
  switch (job) {
    case "wood": { const t = woodTripTile(state, base); return t ? { tile: t.id, at: t.id, d: t.d } : null; }
    case "forage": { const t = forageTripTile(state, base); return t ? { tile: t.id, at: t.id, d: t.d } : null; }
    case "hunt": { const t = huntTripTile(state, base); return t ? { tile: t.id, at: t.id, d: t.d } : null; }
    case "fish": { const w = fishWater(state, base); return w ? { tile: w.id, at: w.shore, d: w.d } : null; }
    case "scavenge": { const t = scavTripTile(state, base); return t ? { tile: t.id, at: t.id, d: t.d } : null; }
    case "water": { const w = fetchWaterTile(state, base); return w ? { tile: w.id, at: w.id, d: w.d, ...(w.well ? { well: true } : {}) } : null; } // well: a field well (sim/fieldworks.js)
    default: return null;
  }
}

// May this person be out on `job` at hour h (absolute)? The activity line's own checks (hurt, the watch, asleep, the
// job workable here, the base on alert …): it says "work" for the job in its hours.
function mayGo(state, base, s, h) {
  const a = describeActivity(state, s, ((h % 24) + 24) % 24, { trips: false });
  return a.kind === "work" && TRIP_JOBS[a.job] ? a.job : "";
}

// A trip for s on `job` from time `start` (in one of the job's windows), or null (no tile, or no time left).
export function planTrip(state, base, s, job, start) {
  const c = TRIP_JOBS[job];
  const win = tripWindow(job, start);
  if (!c || !win) return null;
  const tg = tripTarget(state, base, job);
  if (!tg) return null;
  const d0 = Math.floor(start / 24) * 24, wa = d0 + win[0], wb = d0 + win[1];
  const walk = walkHours(job, tg.d);
  let home, next = null;
  if (c.fixed) {
    home = start + 2 * walk + c.fixed.fill;
    if (home > wb + 1e-9) return null;
    next = home + c.fixed.rest;
  } else {
    const L = (wb - wa) / c.trips;
    const k = Math.min(c.trips - 1, Math.floor((start - wa) / L + 1e-9));
    home = wa + (k + 1) * L;
    if (home - start - 2 * walk < TRIP.minWork) {
      if (k + 1 >= c.trips) return null;
      home = wa + (k + 2) * L; // too late in this slot: one longer trip into the next
    }
  }
  return { job, base: base.id, tile: tg.tile, at: tg.at, d: tg.d, leave: start, arrive: start + walk, workEnd: home - walk, home, ...(next != null ? { next } : {}), ...(tg.well ? { well: true } : {}) };
}

// The old job's hours a trip's work counts as (Fetch water: its share of a full fill).
const tripHours = (t) => {
  const w = Math.max(0, t.workEnd - t.arrive);
  return TRIP_JOBS[t.job].fixed ? Math.min(1, w / TRIP_JOBS[t.job].fixed.fill) : w * tripScale(t.job);
};
// The hour the job's odds are read at: dawn or dusk for hunting and fishing, else the middle of the work.
function sampleHour(t) {
  const c = TRIP_JOBS[t.job];
  const mid = (t.arrive + t.workEnd) / 2, d0 = Math.floor(mid / 24) * 24;
  if (c.prime) { const h = mid - d0; return d0 + c.prime.reduce((b, p) => (Math.abs(p - h) < Math.abs(b - h) ? p : b), c.prime[0]); }
  return Math.floor(mid);
}

// The load, rolled when the work ends: { job-specific fields } (the dice of the old daily jobs, for these hours).
function rollLoad(state, base, s, t) {
  const hrs = tripHours(t);
  if (!(hrs > 1e-6)) return { empty: true };
  const h = sampleHour(t);
  switch (t.job) {
    case "wood": return woodTrip(state, base, s, t.at, hrs, h);
    case "forage": return forageTrip(state, base, s, t.at, hrs, h);
    case "hunt": return huntTrip(state, base, s, t.at, hrs, h);
    case "fish": return fishTrip(state, base, s, t.at, hrs, h);
    case "scavenge": return scavTrip(state, base, s, t.at, hrs, t.n || 0);
    case "water": { const q = r2(TRIP_JOBS.water.perTrip * hrs); return t.well ? { water: r2(drawSource(state, base, { id: t.tile, well: true }, q)), well: true } : { water: q }; } // a field well: its day's yield left, drawn down
    default: return { empty: true };
  }
}

// What a load is, in a few words: "18 food (2 small game)", "140 firewood (14 kg)", "2 water" …
export function loadText(t) {
  const c = t.carry;
  if (!c || c.empty) return "";
  switch (t.job) {
    case "wood": return c.wood > 0 ? `${Math.round(c.wood)} firewood (${Math.round(c.wood * 0.1)} kg)` : "";
    case "forage": return c.food > 0.05 || c.herbs || c.honey ? [c.food > 0.05 ? `${r1(c.food)} food` : "", c.herbs ? `${c.herbs} meds (herbs)` : "", c.honey ? "honey" : ""].filter(Boolean).join(", ") : "";
    case "hunt": case "fish": {
      const n = [c.deer ? `${c.deer} deer` : "", c.hog ? `${c.hog} hog${c.hog > 1 ? "s" : ""}` : "", c.small ? `${c.small} small game` : "", c.fish ? `${c.fish} fish` : ""].filter(Boolean).join(", ");
      return c.rations > 0.05 ? `${Math.round(c.rations)} kg ${t.job === "fish" ? "fish" : "meat"}${n ? ` (${n})` : ""}` : "";
    }
    case "scavenge": return c.finds ? Object.entries({ ...c.got, ...(c.ammo ? { ammo: c.ammo.q } : {}) }).map(([k, n]) => `${n} ${k === "buildmat" ? "building materials" : k}`).join(", ") : "";
    case "water": return c.water > 0 ? `${r1(c.water)} water (un-purified)` : "";
    default: return "";
  }
}
const r1 = (v) => Math.round((v || 0) * 10) / 10;
// The pop over the base when a load comes in: "+18 food", "+140 firewood" …
function popText(t) {
  const c = t.carry;
  if (!c || c.empty) return "";
  switch (t.job) {
    case "wood": return c.wood > 0.5 ? `+${Math.round(c.wood)} firewood` : "";
    case "forage": return c.food > 0.05 ? `+${r1(c.food)} food${c.herbs ? ` +${c.herbs} meds` : ""}` : c.herbs ? `+${c.herbs} meds` : "";
    case "hunt": case "fish": return c.rations > 0.05 ? `+${Math.round(c.rations)} ${t.job === "fish" ? "fish" : "meat"}` : "";
    case "scavenge": return c.finds ? `+${loadText(t)}` : "";
    case "water": return c.water > 0 ? `+${r1(c.water)} water` : "";
    default: return "";
  }
}

// The day's totals by job.
function tally(state, base, job, sid, add, now) {
  const d = tallyDay(now);
  if (!base.tripTally || base.tripTally.day !== d) base.tripTally = { day: d };
  const T = base.tripTally[job] || (base.tripTally[job] = { who: [] });
  if (!T.who.includes(sid)) T.who.push(sid);
  for (const [k, v] of Object.entries(add)) {
    if (k === "tool") { if (v != null) { T.toolWho = T.toolWho || []; if (!T.toolWho.includes(v)) T.toolWho.push(v); T.tools = T.toolWho.length; } }
    else if (typeof v === "number") T[k] = r2((T[k] || 0) + v);
    else if (k === "hrs" && v) { T.hrs = T.hrs || {}; for (const [m, x] of Object.entries(v)) T.hrs[m] = r2((T.hrs[m] || 0) + x); }
    else if (k === "gunfire" && v) { T.gunfire = T.gunfire || {}; for (const [tile, q] of Object.entries(v)) T.gunfire[tile] = Math.max(T.gunfire[tile] || 0, q); }
    else if (k === "sick" && v === true) { T.sick = T.sick || []; T.sick.push(sid); }
  }
}

// The load into the store (the deposit point: the base unless something else takes it, tripland.js depositPoint).
function credit(state, base, s, t, now) {
  const c = t.carry;
  const dp = depositPoint(state, base, s, t.job);
  // A drop point with a room limit (a stockpile: dp.put(key, q) → what it took) gets the load through a scratch store:
  // what fits is left there, the rest comes home with them (no overfill).
  const st = dp.put ? {} : dp.stock || base.stock;
  const es = econStats(state);
  if (c && !c.empty) {
    switch (t.job) {
      case "wood":
        st.wood = (st.wood || 0) + c.wood;
        es.woodCut = (es.woodCut || 0) + c.wood;
        noteOutput(state, base, "wood", c.wood, "wood");
        tally(state, base, "wood", s.id, { wood: c.wood, tool: c.tool ? s.id : null }, now);
        break;
      case "forage":
        st.food = (st.food || 0) + c.food;
        if (st === base.stock) addWormCrop(state, base, t.at, c.food, "forage"); // worm.js: gathered on infected land
        if (c.herbs) st.meds = (st.meds || 0) + c.herbs;
        if (c.honey) st.preserved = (st.preserved || 0) + c.honey * FORAGE.honeyFood;
        es.foraged = (es.foraged || 0) + c.food + c.honey * FORAGE.honeyFood;
        noteOutput(state, base, "forage", c.food + c.honey * FORAGE.honeyFood, "food");
        if (c.herbs) noteOutput(state, base, "forage", c.herbs, "meds");
        tally(state, base, "forage", s.id, { food: c.food, herbs: c.herbs, honey: c.honey, sick: c.sick }, now);
        break;
      case "hunt": case "fish":
        if (c.rations > 0) {
          if (st === base.stock) {
            if (c.worm > 0) base.wormMeat = wormMeatAt(base) + c.worm; // worm.js: before the meat (it is capped by it)
            base.stock.food = (base.stock.food || 0) + c.rations;
            base.meat = meatAt(base) + c.rations;
          } else st.food = (st.food || 0) + c.rations;
          es.hunted = (es.hunted || 0) + c.rations;
        }
        noteOutput(state, base, t.job, c.rations || 0, "food");
        tally(state, base, t.job, s.id, { ...c }, now);
        break;
      case "scavenge":
        scavCredit(state, base, s, c, st);
        tally(state, base, "scavenge", s.id, { finds: c.finds || 0 }, now);
        break;
      case "water": {
        const put = st === base.stock ? Math.min(c.water, Math.max(0, rawRoom(base))) : c.water;
        st[RAW] = (st[RAW] || 0) + put;
        noteOutput(state, base, "water", put, RAW);
        tally(state, base, "water", s.id, { water: put, ...(c.well ? { well: put } : {}) }, now); // well: deep ground water, half the eggs (worm.js rawWaterEggs)
        c.water = put;
        break;
      }
    }
  }
  let popTile = dp.tile;
  if (dp.put) {
    let left = 0, home = 0;
    for (const [k, q] of Object.entries(st)) {
      if (!(q > 0)) continue;
      const took = Math.max(0, Math.min(q, dp.put(k, q) || 0)), rest = Math.round((q - took) * 100) / 100;
      left += took;
      if (rest > 0) { base.stock[k] = (base.stock[k] || 0) + rest; home += rest; }
    }
    if (!(left > 0)) popTile = base.tile; // nothing fitted: all of it came home
    if (home > 0) t.overflow = Math.round(home * 100) / 100; // the rest walked home with them
  }
  const text = popText(t);
  if (text) {
    const pops = base.tripPops || (base.tripPops = []);
    pops.push({ t: r2(t.home), sid: s.id, job: t.job, text, tile: popTile });
    while (pops.length > POPS) pops.shift();
  }
}

// Ends the work now (time `now`): on the way out they turn back, at work they pack up and walk home.
function cutShort(t, now, why) {
  if (now >= t.workEnd) return;
  if (now < t.arrive) {
    t.reach = Math.max(0, Math.min(1, (now - t.leave) / Math.max(1e-6, t.arrive - t.leave)));
    t.home = now + (now - t.leave);
    t.arrive = t.workEnd = now;
  } else {
    t.home = now + (t.home - t.workEnd);
    t.workEnd = now;
  }
  delete t.next;
  t.cut = why;
}

// One person's trips up to the end of the hour starting at `now`.
function stepPerson(state, base, s, now) {
  const end = now + 1;
  for (let guard = 0; guard < 6; guard++) {
    const t = s.trip;
    if (t) {
      if (t.workEnd > now) {
        const job = mayGo(state, base, s, now);
        if (job !== t.job) cutShort(t, now, job ? "another job" : describeActivity(state, s, ((now % 24) + 24) % 24, { trips: false }).text);
      }
      if (!t.carry && t.workEnd < end) t.carry = rollLoad(state, base, s, t);
      if (t.home >= end) return;
      credit(state, base, s, t, now);
      delete s.trip;
      const from = Math.max(t.home + TRIP.deposit, t.next || 0);
      const n = (t.n || 0) + 1;
      if (from < end && dayOf(from) === dayOf(t.leave)) {
        const job = mayGo(state, base, s, Math.floor(from));
        const nt = job === t.job ? planTrip(state, base, s, job, from) : null;
        if (nt) { nt.n = n; s.trip = nt; continue; }
      } else if (t.next != null || dayOf(from) === dayOf(t.leave)) s.tripNext = { t: r2(from), n, day: dayOf(t.leave) };
      return;
    }
    const job = mayGo(state, base, s, now);
    if (!job) return;
    const nx = s.tripNext && s.tripNext.day === dayOf(now) ? s.tripNext : null;
    const start = Math.max(now, nx ? nx.t : now);
    if (start >= end) return;
    const nt = planTrip(state, base, s, job, start);
    if (!nt) return;
    nt.n = nx ? nx.n : 0;
    delete s.tripNext;
    s.trip = nt;
  }
}

// The hourly pass (world.js tickHour).
export function jobTripsHour(state, now = state.hour) {
  for (const s of state.survivors) {
    if (!s.trip && !s.tripNext) continue;
    const l = s.location;
    if (!s.alive || !l || l.kind !== "base" || (s.trip && l.baseId !== s.trip.base)) { delete s.trip; delete s.tripNext; }
  }
  for (const base of state.bases) for (const s of atBase(state, base.id)) stepPerson(state, base, s, now);
}

// For the tests (tools/*test.js) that drive one base's day without the rest of the world: the trips of the 24 hours
// before `state.hour` (the day the midnight tick closes), each hour as the hourly pass would run it. The world's clock is
// set to each hour in turn and put back.
export function tripDay(state, base, end = state.hour) {
  const was = state.hour;
  if (base.tripTally && base.tripTally.day === tallyDay(end)) delete base.tripTally; // the day run again: its tally afresh
  for (const s of atBase(state, base.id)) { delete s.trip; delete s.tripNext; }
  for (let h = end - 24; h < end; h++) {
    state.hour = h;
    for (const s of atBase(state, base.id)) stepPerson(state, base, s, h);
  }
  state.hour = was;
  return base.tripTally && base.tripTally.day === tallyDay(end) ? base.tripTally : null;
}

// ---------- where someone is, for the activity line and the map ----------
// A trip at time t (hours, fractional): { phase: "out" | "work" | "back" | "home", f (0..1 through that phase),
// progress (0..1 through the work), from, to (tiles), text, stage } or null when they are not out.
export function tripState(state, s, t = state.hour) {
  const tr = s && s.trip;
  if (!tr || t < tr.leave || t >= tr.home) return null;
  const c = TRIP_JOBS[tr.job];
  const where = tileLabel(state, tr.tile);
  const wtext = tr.job === "fish" || tr.job === "water" ? (state.tiles[tr.tile] && state.tiles[tr.tile].river ? "the river" : "the water") : where;
  const span = Math.max(1e-6, tr.workEnd - tr.arrive);
  const progress = Math.max(0, Math.min(1, (t - tr.arrive) / span));
  if (t < tr.arrive) return { phase: "out", f: (t - tr.leave) / Math.max(1e-6, tr.arrive - tr.leave), progress: 0, text: `Heading to ${wtext}`, stage: "", job: tr.job };
  if (t < tr.workEnd) {
    const stage = c.stage[Math.min(c.stage.length - 1, Math.floor(progress * c.stage.length))];
    return { phase: "work", f: progress, progress, text: `${stage} at ${wtext} ${Math.floor(progress * 100)}%`, stage, job: tr.job };
  }
  const load = loadText(tr);
  const f = (t - tr.workEnd) / Math.max(1e-6, tr.home - tr.workEnd);
  return { phase: "back", f, progress: 1, text: load ? `Bringing ${load} back` : tr.carry ? "Heading home empty-handed" : "Heading home", stage: "", job: tr.job, load };
}
// The people of a base out on trips at time t: [{ s, st (tripState), trip }].
export function outWorkers(state, base, t = state.hour) {
  const out = [];
  for (const s of atBase(state, base.id)) { const st = tripState(state, s, t); if (st) out.push({ s, st, trip: s.trip }); }
  return out;
}
export { survivorById };
