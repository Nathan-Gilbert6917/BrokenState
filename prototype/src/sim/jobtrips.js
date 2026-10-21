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
// Lunch (meals.js, the lunch hour): out at work they stop where they are and eat from their pack (eating.js: they set out
// with at least PACK.trip, a day of food, topped up from the stores as they leave); the hour inside the work does not
// count toward the load, nor does the lunch hour of a walk out or home (tripHours: lunchOverlap), and nobody sets out
// in it (activity.js: they are eating).
//
// The day's totals: base.tripTally = { day, [job]: { …sums, who: [ids] } } (the daily systems read it at midnight for
// the noise, the log and the summaries); base.tripPops: the last deposits (the map's "+12 food" pops, ui/render.js).
import { atBase, survivorById } from "./world.js";
import { TRIP, TRIP_JOBS, tripWindow, walkHours, tripScale, depositPoint, drawSource, walkMult } from "./tripland.js";
import { describeActivity } from "./activity.js";
import { woodTripTile, woodTrip, isChopTool, chopMult } from "./woodcutting.js";
import { forageTripTile, forageTrip, FORAGE, addForage } from "./foraging.js";
import { huntTripTile, huntTrip, fishWater, fishTrip, meatAt, depositGame, isFishTool, isSpear, fishToolPower, frozenAt } from "./hunting.js";
import { allCarried, stow, packOf } from "./inventory.js"; // a job's tool goes out with the one who uses it
import { scavTripTile, scavTrip, scavCredit, fetchWaterTile, rawRoom } from "./economy.js";
import { econStats } from "./farming.js";
import { addFood, qtyOf } from "./foods.js"; // food by type: the loads come home as items
import { noteOutput } from "./output.js";
import { tileLabel } from "./parties.js";
import { RAW } from "./water.js";
import { armTripEvent, fireTripEvent, holdTrip, creditBonus, holdText, followHold, bankFinds } from "./tripevents.js"; // trouble on the way (trips-plus #2); a crew's (teamwork)
import { noteMates, teamMult, matesText } from "./teamwork.js"; // teamwork: the same job on the same tile at the same time, a crew
import { bondCrewMult } from "./bonds.js"; // bonds: a friend in the crew, a rival (call-time only)
import { lunchOverlap, isLunchHour } from "./meals.js"; // the lunch break out at work
import { PACK, packFood, topUpPack } from "./eating.js"; // the food they take out for lunch
import { chopHour, hasChopWork } from "./woodwork.js"; // woodwork: the woodcutters fell the trees marked on the base map before going out
import { haulStep, haulDropped, haulTripState } from "./hauling.js"; // hauling: a haul trip is s.trip with job "haul" (call-time only)

const r2 = (v) => Math.round((v || 0) * 100) / 100;
const POPS = 12; // deposits kept for the map
const dayOf = (t) => Math.floor(t / 24);
// The day a credit at tick `now` counts for (output.js workDay − 1: 0-based; the midnight tick is the day before).
const tallyDay = (now) => Math.floor((now - 1) / 24);

// ---------- the job's tools (INV-03) ----------
// The tools a job trip uses are carried, not left in the armory: a fisher takes a rod, a net or a spear (Fish needs
// one: no tool, no trip), a woodcutter without an axe of their own takes the armory's best (Cut wood goes on by hand
// without one). The tool leaves the armory for their pack (or the hand it goes in; a rod or a net in the off hand when
// the pack has no room), marked item.jobTool, and goes back into the armory as soon as they are home with no trip
// planned (jobTripsHour; a team member's at the Home from a trip window, sim/teaminv.js). One item, one person: a tool
// out on a trip cannot be loaded onto a team, nor taken by a second fisher.
const JOB_TOOLS = {
  fish: { is: (state, it) => isFishTool(it) && !(frozenAt(state) && isSpear(it)), rank: (it) => fishToolPower(it), need: true, offHand: (it) => !isSpear(it) },
  wood: { is: (state, it) => isChopTool(it), rank: (it) => chopMult(it), need: false, offHand: () => false },
};
// Could s go out on `job` for want of a tool? (checkOutTool without taking anything: the activity line.)
export function hasJobTool(state, base, s, job) {
  const J = JOB_TOOLS[job];
  if (!J || !J.need) return true;
  return allCarried(s).some((it) => J.is(state, it)) || (base.armory || []).some((it) => it && J.is(state, it));
}
// Does s carry a tool for `job` now? Else one is checked out of the base's armory. Returns false only when the job
// needs a tool and there is none to take.
export function checkOutTool(state, base, s, job) {
  const J = JOB_TOOLS[job];
  if (!J) return true;
  if (allCarried(s).some((it) => J.is(state, it))) return true;
  const list = (base.armory || []).filter((it) => it && J.is(state, it)).sort((a, b) => J.rank(b) - J.rank(a));
  for (const it of list) {
    const i = base.armory.indexOf(it);
    base.armory.splice(i, 1);
    let at = stow(s, it);
    if (!at && J.offHand(it) && s.gear && !s.gear.tool) { s.gear.tool = it; at = `s:${s.id}:tool`; }
    if (at) { it.jobTool = job; return true; }
    base.armory.splice(i, 0, it); // no room on them for it: back on the shelf
  }
  return !J.need;
}
// A job's tools a person at a base carries back into its armory. Returns how many went back.
export function returnTools(state, base, s) {
  let n = 0;
  if (!s || !s.gear || !base) return 0;
  const take = (arr, k) => { const it = arr[k]; if (it && it.jobTool) { delete it.jobTool; arr[k] = null; base.armory.push(it); n++; } };
  for (const k of Object.keys(s.gear)) if (k !== "backpack" && k !== "rig" && k !== "armor" && k !== "carry") take(s.gear, k);
  if (s.gear.carry && s.gear.carry.haulCart) { delete s.gear.carry.haulCart; base.armory.push(s.gear.carry); s.gear.carry = null; n++; } // hauling.js: the armory's cart back
  (s.pockets || []).forEach((_, i) => take(s.pockets, i));
  const pk = packOf(s);
  if (pk) pk.forEach((_, i) => take(pk, i));
  return n;
}

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
// from: where they set out from when it is not the base (a stockpile they left the last load at: a shorter walk out).
// Drop points (trips-plus #3): a trip that is not the last of its window leaves its load at a stockpile of the base
// (tripland.js depositPoint: sim/fieldworks' hook, the nearest with room) when walking there from the work is shorter
// than walking home: t.drop = its tile, the walk back that much shorter (more hours at the work), and the next trip
// sets out from it (t.from). The window's last trip brings its load home (they sleep at the base), and a trip cut
// short walks home (cutShort). A team (fieldworks' Send a haul team) brings a stockpile's goods in.
export function planTrip(state, base, s, job, start, from = null) {
  const c = TRIP_JOBS[job];
  const win = tripWindow(job, start);
  if (!c || !win) return null;
  const tg = tripTarget(state, base, job);
  if (!tg) return null;
  const d0 = Math.floor(start / 24) * 24, wa = d0 + win[0], wb = d0 + win[1];
  const m = walkMult(state); // the game's pace (tripland.js PACES)
  const walk = walkHours(job, tg.d, m);
  const leg = (a, b) => walkHours("wood", state.grid.distance(a, b), m); // a walk between two land tiles
  const out = from != null && from !== base.tile && !c.fixed ? Math.min(walk, leg(from, tg.at)) : walk;
  let home, next = null, back = walk, drop = null;
  if (c.fixed) {
    home = start + 2 * walk + c.fixed.fill;
    if (home > wb + 1e-9) return null;
    next = home + c.fixed.rest;
  } else {
    const L = (wb - wa) / c.trips;
    let k = Math.min(c.trips - 1, Math.floor((start - wa) / L + 1e-9));
    home = wa + (k + 1) * L;
    if (home - start - out - walk < TRIP.minWork) {
      if (k + 1 >= c.trips) return null;
      home = wa + (k + 2) * L; // too late in this slot: one longer trip into the next
      k++;
    }
    if (k + 1 < c.trips) { // not the window's last: a stockpile nearer the work takes the load
      const dp = depositPoint(state, base, { ...s, trip: { at: tg.at, job } }, job);
      if (dp && dp.tile != null && dp.tile !== base.tile) { const b2 = leg(tg.at, dp.tile); if (b2 < back - 1e-9) { back = b2; drop = dp.tile; } }
    }
  }
  return { job, base: base.id, tile: tg.tile, at: tg.at, d: tg.d, leave: start, arrive: start + out, workEnd: home - back, home, ...(next != null ? { next } : {}), ...(drop != null ? { drop, wh: walk } : {}), ...(from != null && from !== base.tile && !c.fixed ? { from } : {}), ...(tg.well ? { well: true } : {}) };
}

// The old job's hours a trip's work counts as (Fetch water: its share of a full fill). The lunch hour inside the trip,
// at the work or on the walk, is an hour's stop: it comes off the work (a walk home over lunch gets home an hour later
// in the old reckoning, so the work before it ends an hour sooner).
const tripHours = (state, t) => {
  const w = Math.max(0, t.workEnd - t.arrive - lunchOverlap(t.leave, t.home, state));
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
// teamwork.js: a crew's member works as many more hours' worth as the crew's bonus (teamMult: the land thins by it too).
function rollLoad(state, base, s, t) {
  const n = noteMates(state, s, t);
  const tm = teamMult(t.job, n);
  if (n > 1) t.crewN = n;
  const bm = n > 1 ? bondCrewMult(state, s, t) : 1; // bonds.js: friends in the crew work better, a rival worse
  const hrs = tripHours(state, t) * (TRIP_JOBS[t.job].fixed ? 1 : tm * bm);
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

// What a load is, in a few words: "18 food (2 small game)", "140 wood (14 kg)", "2 water" …
export function loadText(t) {
  const c = t.carry;
  if (!c || c.empty) return "";
  switch (t.job) {
    case "wood": return c.wood > 0 ? `${Math.round(c.wood)} wood (${Math.round(c.wood * 0.1)} kg)` : "";
    case "forage": return c.food > 0.05 || c.herbs || c.honey ? [c.food > 0.05 ? `${r1(c.food)} food` : "", c.herbs ? `${c.herbs} meds (herbs)` : "", c.honey ? "honey" : ""].filter(Boolean).join(", ") : "";
    case "hunt": case "fish": {
      const n = [c.deer ? `${c.deer} deer` : "", c.hog ? `${c.hog} hog${c.hog > 1 ? "s" : ""}` : "", c.small ? `${c.small} small game` : "", c.fish ? `${c.fish} fish` : ""].filter(Boolean).join(", ");
      return c.rations > 0.05 ? `${Math.round(c.rations)} kg ${t.job === "fish" ? "fish" : "meat"}${n ? ` (${n})` : ""}` : "";
    }
    case "scavenge": return c.finds ? Object.entries({ ...c.got, ...(c.ammo ? { ammo: c.ammo.q } : {}) }).map(([k, n]) => `${n} ${k === "buildmat" ? "building materials" : k === "metalsheet" ? "metal sheets" : k}`).join(", ") : "";
    case "water": return c.water > 0 ? `${r1(c.water)} water (un-purified)` : "";
    default: return c.text || ""; // hauling.js: the load's own words
  }
}
const r1 = (v) => Math.round((v || 0) * 10) / 10;
// The pop over the base when a load comes in: "+18 food", "+140 wood" …
function popText(t) {
  const c = t.carry;
  if (!c || c.empty) return "";
  switch (t.job) {
    case "wood": return c.wood > 0.5 ? `+${Math.round(c.wood)} wood` : "";
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
  const dp = t.drop != null ? depositPoint(state, base, s, t.job) : { tile: base.tile, stock: base.stock }; // a drop trip (planTrip t.drop): the stockpile, else home
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
        // foods.js: the season's forage as its items (egg lots when gathered on infected land, worm.js cropEggs), with lots
        // at home; honey as jars of honey.
        if (c.food > 0) addForage(state, st === base.stock ? base : st, c.food, t.at);
        if (c.herbs) st.meds = (st.meds || 0) + c.herbs;
        if (c.honey) addFood(st === base.stock ? base : st, "f_honey", qtyOf("f_honey", c.honey * FORAGE.honeyFood), { state });
        es.foraged = (es.foraged || 0) + c.food + c.honey * FORAGE.honeyFood;
        noteOutput(state, base, "forage", c.food + c.honey * FORAGE.honeyFood, "food");
        if (c.herbs) noteOutput(state, base, "forage", c.herbs, "meds");
        tally(state, base, "forage", s.id, { food: c.food, herbs: c.herbs, honey: c.honey, sick: c.sick }, now);
        break;
      case "hunt": case "fish":
        if (c.rations > 0) {
          depositGame(state, st === base.stock ? base : st, c, t.job === "fish" ? "fish" : "small"); // hunting.js: the raw meat and fish by item, the worm's eggs on their own lots
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
  const bonus = [creditBonus(state, base, t, st), bankFinds(state, base, s)].filter(Boolean).join(" "); // tripevents.js: a find, a boar's meat (with the load: a stockpile's room too); what a crew's dice gave them to carry (teamwork)
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
  const text = [popText(t), bonus].filter(Boolean).join(" ");
  if (text) {
    const pops = base.tripPops || (base.tripPops = []);
    pops.push({ t: r2(t.home), sid: s.id, job: t.job, text, tile: popTile });
    while (pops.length > POPS) pops.shift();
  }
}

// Ends the work now (time `now`): on the way out they turn back, at work they pack up and walk home.
export function cutShort(t, now, why) {
  if (now >= t.workEnd) return;
  if (now < t.arrive) {
    t.reach = Math.max(0, Math.min(1, (now - t.leave) / Math.max(1e-6, t.arrive - t.leave)));
    t.home = now + (now - t.leave);
    t.arrive = t.workEnd = now;
  } else {
    t.home = now + (t.drop != null && t.wh != null ? t.wh : t.home - t.workEnd); // cut short: home, not to the stockpile
    t.workEnd = now;
  }
  delete t.next;
  delete t.drop;
  t.cut = why;
}

// Setting out from the base: at least a day of food in the pack for lunch out there (eating.js PACK.trip; from the
// stores, if they can spare it). A trip on from a stockpile (t.from) never came through the gate: nothing to top up from.
function packForTrip(state, base, s) {
  if (s.trip && s.trip.from == null && packFood(s) < PACK.trip) topUpPack(state, base, s);
}

// One person's trips up to the end of the hour starting at `now`.
function stepPerson(state, base, s, now) {
  if (s.trip ? s.trip.job === "haul" : s.role === "haul") return haulStep(state, base, s, now); // hauling.js
  const end = now + 1;
  for (let guard = 0; guard < 6; guard++) {
    const t = s.trip;
    if (t) {
      if (!t.evr) armTripEvent(state, base, s, t); // tripevents.js: the trip's trouble, if any (its own dice, once; a crew's one roll)
      if (t.follow && followHold(state, base, s, t, now)) return; // teamwork: a mate's card or battle holds the crew
      if (t.ev && t.ev.pending && holdTrip(state, base, s, t, now)) return; // a card waits: they hold where they are
      if (!s.alive || s.trip !== t) return;
      if (t.workEnd > now) {
        const job = mayGo(state, base, s, now);
        if (job !== t.job) cutShort(t, now, job ? "another job" : describeActivity(state, s, ((now % 24) + 24) % 24, { trips: false }).text);
      }
      if (t.ev && !t.ev.done && t.ev.at < end && t.ev.at < t.home) {
        if (!t.carry && t.workEnd <= t.ev.at) t.carry = t.noLoad ? { empty: true } : rollLoad(state, base, s, t); // on the way home: the load is on their back
        fireTripEvent(state, base, s, t, now);
        if (!s.alive || s.trip !== t || t.ev.pending) return;
      }
      if (!t.carry && t.workEnd < end) t.carry = t.noLoad ? { empty: true } : rollLoad(state, base, s, t);
      if (t.home >= end) return;
      credit(state, base, s, t, now);
      delete s.trip;
      const from = Math.max(t.home + TRIP.deposit, t.next || 0);
      const n = (t.n || 0) + 1;
      const at = t.drop != null ? t.drop : null; // left the load at a stockpile: the next trip sets out from there
      if (from < end && dayOf(from) === dayOf(t.leave)) {
        const job = mayGo(state, base, s, Math.floor(from));
        if (job === "wood" && hasChopWork(base)) return; // woodwork: home with the load, they go to the felling marked on the map (the next hour)
        const nt = job === t.job ? planTrip(state, base, s, job, from, at) : null;
        if (nt && checkOutTool(state, base, s, job)) { nt.n = n; s.trip = nt; packForTrip(state, base, s); continue; }
      } else if (t.next != null || dayOf(from) === dayOf(t.leave)) s.tripNext = { t: r2(from), n, day: dayOf(t.leave), ...(at != null ? { from: at } : {}) };
      return;
    }
    const job = mayGo(state, base, s, now);
    if (!job) return;
    // woodwork: a woodcutter at the base works the felling marked on the base map (woodwork.js chopJobs) before any
    // trip out to the land: the hour goes on it.
    if (job === "wood" && chopHour(state, base, s, now)) { delete s.tripNext; return; }
    const nx = s.tripNext && s.tripNext.day === dayOf(now) ? s.tripNext : null;
    const start = Math.max(now, nx ? nx.t : now);
    if (start >= end) return;
    const nt = planTrip(state, base, s, job, start, nx && nx.from != null ? nx.from : null);
    if (!nt || !checkOutTool(state, base, s, job)) return;
    nt.n = nx ? nx.n : 0;
    delete s.tripNext;
    s.trip = nt;
    packForTrip(state, base, s);
  }
}

// The hourly pass (world.js tickHour).
export function jobTripsHour(state, now = state.hour) {
  for (const s of state.survivors) {
    if (!s.trip && !s.tripNext) continue;
    const l = s.location;
    if (!s.alive || !l || l.kind !== "base" || (s.trip && l.baseId !== s.trip.base)) { if (s.trip && s.trip.job === "haul") haulDropped(state, s); delete s.trip; delete s.tripNext; }
  }
  for (const base of state.bases) for (const s of atBase(state, base.id)) { if (!s.trip) returnTools(state, base, s); stepPerson(state, base, s, now); }
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
    for (const s of atBase(state, base.id)) { if (!s.trip) returnTools(state, base, s); stepPerson(state, base, s, h); }
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
  if (tr.job === "haul") return haulTripState(state, s, t); // hauling.js
  const c = TRIP_JOBS[tr.job];
  const mates = matesText(state, s, t); // teamwork.js: out with others of the crew ("with Mara")
  const w = mates ? ` with ${mates}` : "";
  const held = holdText(tr); // tripevents.js: a card waits ("Facing a bear"); a crew's mates hold with them
  if (held) { const ev = tr.ev && tr.ev.pending ? tr.ev : tr.follow; return { phase: ev.phase || "work", f: ev.f ?? 0.5, progress: ev.f ?? 0.5, text: `${held}${w} near ${tileLabel(state, tr.tile)}`, stage: "", job: tr.job, held: true, ...(mates ? { mates } : {}) }; }
  const where = tileLabel(state, tr.tile);
  const wtext = tr.job === "fish" || tr.job === "water" ? (state.tiles[tr.tile] && state.tiles[tr.tile].river ? "the river" : "the water") : where;
  const span = Math.max(1e-6, tr.workEnd - tr.arrive);
  const progress = Math.max(0, Math.min(1, (t - tr.arrive) / span));
  // The lunch hour at the work: stopped there, eating from the pack (on a walk out or home it is eaten on the way: the
  // walk's line stays).
  if (t >= tr.arrive && t < tr.workEnd && isLunchHour(Math.floor(t), state)) return { phase: "work", f: progress, progress, text: `Lunch break${w} at ${wtext} (from their pack)`, stage: "Lunch", job: tr.job, lunch: true, ...(mates ? { mates } : {}) };
  if (t < tr.arrive) return { phase: "out", f: (t - tr.leave) / Math.max(1e-6, tr.arrive - tr.leave), progress: 0, text: `Heading to ${wtext}${w}`, stage: "", job: tr.job, ...(mates ? { mates } : {}) };
  if (t < tr.workEnd) {
    const stage = c.stage[Math.min(c.stage.length - 1, Math.floor(progress * c.stage.length))];
    return { phase: "work", f: progress, progress, text: `${stage}${w} at ${wtext} ${Math.floor(progress * 100)}%`, stage, job: tr.job, ...(mates ? { mates } : {}) };
  }
  const load = loadText(tr);
  const f = (t - tr.workEnd) / Math.max(1e-6, tr.home - tr.workEnd);
  if (tr.drop != null) { const T = state.tiles[tr.drop]; const at = `stockpile (${T ? `${T.x},${T.y}` : tr.drop})`; return { phase: "back", f, progress: 1, text: load ? `Dropping ${load} at ${at}${w}` : `Dropping at ${at}${w}`, stage: "", job: tr.job, load, drop: tr.drop, ...(mates ? { mates } : {}) }; }
  return { phase: "back", f, progress: 1, text: `${load ? `Bringing ${load} back` : tr.carry ? "Heading home empty-handed" : "Heading home"}${w}`, stage: "", job: tr.job, load, ...(mates ? { mates } : {}) };
}
// The people of a base out on trips at time t: [{ s, st (tripState), trip }].
export function outWorkers(state, base, t = state.hour) {
  const out = [];
  for (const s of atBase(state, base.id)) { if (s.trip && s.trip.job === "haul") continue; const st = tripState(state, s, t); if (st) out.push({ s, st, trip: s.trip }); } // haulers: ui/workermap.js draws them on their route
  return out;
}
export { survivorById };
