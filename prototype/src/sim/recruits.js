// Newcomers ask first: everyone who would join (a stranger at the gate, refugees, a loner on the road, survivors
// saved or freed after a road fight, a lost teenager, a deserter coming back) is a choice card showing who they
// are (skills, traits, health, gear) and what the base can take (free beds, days of food and water, now and with
// them). Options:
//   at a base:  take them in (5 food each on arrival), take only one of them, send them on to an outpost (they walk:
//               the chance to arrive and the days are on the card), give them supplies and part ways (3 food and
//               3 water each: +2 mood for everyone there, +2 goodwill with known groups nearby), or turn them away;
//   on the road: take them along (only if the team's food and water cover everyone on the way home), send them to
//               the nearest base or the hub on foot, give them supplies and part ways (2 food and 2 water each from
//               the team: +2 mood for the team, +2 goodwill with known groups nearby), or turn them away.
// People walking to a base arrive after their days on the road (or never). Deserters (morale.js) sometimes come back.
import { SKILL_NAMES, TRAITS } from "./data.js";
import { log, addCard, day, hub, baseById, residents, survivorById, makeSurvivor, skill } from "./world.js";
import { baseBeds } from "./buildings.js";
import { foodOutlook, waterOutlook, drinkRate } from "./economy.js";
import { partyMembers, partyTile, carried, takeSupply, planPath, partySpeed, hoursLeft, tileLabel } from "./parties.js";
import { newItem, stow, allItems } from "./inventory.js";
import { attitude, changeGoodwill } from "./factions.js";
import { foodNeedFactor, thirstAhead } from "./weather.js";

export const JOIN_FOOD = 5;                         // food a newcomer eats on arrival at a base (less if there is less)
export const PART_BASE = { food: 3, water: 3 };     // per person, from the base, to part ways
export const PART_TEAM = { food: 2, water: 2 };     // per person, from the team
export const PART_MOOD = 2, PART_GOODWILL = 2, PART_RADIUS = 12;
export const RETURN = { after: 8, until: 90, chance: 0.006 }; // a deserter may come back: days after, a chance a day

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const firstName = (s) => s.name.split(" ")[0];
const listNames = (list) => (list.length <= 1 ? list.map(firstName).join("") : `${list.slice(0, -1).map(firstName).join(", ")} and ${firstName(list[list.length - 1])}`);
const r1 = (v) => Math.round(v * 10) / 10;

// A walk on foot to a base: the farther, the less likely they make it.
export const walkChance = (dist) => clamp(0.97 - 0.012 * dist, 0.6, 0.97);
export const walkDays = (dist) => Math.max(1, Math.ceil(dist / 8));

// A newcomer: a survivor not yet in the group (pending), with their own health and maybe a bit of gear.
export function makeCandidate(state, { quality = 0.85, minHealth = 60, gearChance = 0.4 } = {}) {
  const s = makeSurvivor(state, quality);
  const rng = state.rng;
  s.pending = true;
  s.health = rng.int(minHealth, 100);
  s.mood = rng.int(45, 65);
  if (rng.chance(gearChance)) {
    const w = rng.weighted(Object.keys(RECRUIT_WEAPONS), (k) => RECRUIT_WEAPONS[k]);
    s.gear.weapon = newItem(w, Math.round(rng.range(0.5, 0.9) * 100) / 100);
  }
  if (rng.chance(gearChance * 0.35)) stow(s, newItem(rng.pick(RECRUIT_ARMOR), Math.round(rng.range(0.5, 0.9) * 100) / 100));
  if (rng.chance(gearChance * 0.3)) stow(s, newItem(rng.pick(RECRUIT_KIT), Math.round(rng.range(0.5, 0.9) * 100) / 100));
  // Something of their own from before: a keepsake, a comfort, a last pack of smokes.
  if (rng.chance(gearChance * 0.6)) stow(s, newItem(rng.pick(RECRUIT_PERSONAL), 1));
  return s;
}
// What a newcomer may bring (weights for the weapon).
export const RECRUIT_WEAPONS = { knife: 3, spikedbat: 2, pipespear: 2, machete: 1, pistol: 1.5, huntrifle: 0.5, bat: 1.5, prybar: 1, revolver: 0.5 };
export const RECRUIT_ARMOR = ["tirevest", "padding", "shinguards", "bikehelmet"];
export const RECRUIT_KIT = ["bandagekit", "backpack", "crowbar", "slingbag", "hikingpack", "flashlight"];
export const RECRUIT_PERSONAL = ["photos", "photos", "cards", "harmonica", "smokes", "chocolate", "goldring", "watch", "novel"];

// One line about a candidate (for the card text, the log and headless tools).
export function candidateLine(s) {
  const top = Object.entries(s.skills).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => `${SKILL_NAMES[k]} ${skill(s, k)}`).join(", ");
  const items = allItems(s).map((g) => g.name);
  return `${s.name} (health ${Math.round(s.health)}; ${top}; ${s.traits.map((t) => TRAITS[t].name).join(", ")}${items.length ? `; carries ${items.join(", ")}` : ""})`;
}

// ---------- what a base or a team can take ----------
export function baseOutlook(state, base, k = 0) {
  const people = residents(state, base.id).length;
  const beds = baseBeds(base);
  const fo = foodOutlook(state, base) || {};
  const perHead = fo.perHead != null ? fo.perHead : foodNeedFactor(state); // a resident's share (upkeep.js); fo.eat counts prisoners and guests too
  const burn = Math.max(0, (fo.eat || 0) + (fo.spoil || 0) + (fo.used || 0) - (fo.scav || 0));
  const stock = Math.max(0, fo.stock != null ? fo.stock : base.stock.food || 0); // fresh and preserved food
  const burnK = burn + k * perHead;
  const wo = waterOutlook(state, base);
  const waterNet = wo.net, waterNetWith = r1(wo.net - k * drinkRate(state)); // today's rate: more in summer
  return {
    people, beds, free: beds - people, freeWith: beds - people - k,
    food: stock, foodDays: burn > 0 ? stock / burn : null, foodDaysWith: burnK > 0 ? Math.max(0, stock - JOIN_FOOD * k) / burnK : null,
    water: Math.max(0, wo.stock || 0), waterNet, waterNetWith,
    waterDays: waterNet < 0 ? wo.stock / -waterNet : null, waterDaysWith: waterNetWith < 0 ? wo.stock / -waterNetWith : null,
  };
}
export const daysText = (d) => (d == null ? "no shortage" : `${Math.floor(d)} day${Math.floor(d) === 1 ? "" : "s"}`);
export function outlookText(o, k) {
  const water = o.waterDays == null ? `water steady (${o.waterNet >= 0 ? "+" : ""}${o.waterNet} a day${k ? `, ${o.waterNetWith >= 0 ? "+" : ""}${o.waterNetWith} with them` : ""})` : `water for ${daysText(o.waterDays)}${k ? ` (${daysText(o.waterDaysWith)} with them)` : ""}`;
  return `${o.free >= 0 ? o.free : 0} of ${o.beds} beds free${o.free < 0 ? ` (${-o.free} already without one)` : ""}${k ? `, ${o.freeWith >= 0 ? `${o.freeWith} after` : `${-o.freeWith} without a bed after`}` : ""}; food for ${daysText(o.foodDays)}${k ? ` (${daysText(o.foodDaysWith)} with them)` : ""}; ${water}`;
}

// The team's food and water against the way home, now and with k more mouths (1 food and 1 water a day each, the
// water times the thirst of the days ahead: more in summer and a heat wave).
export function teamOutlook(state, p, k = 0) {
  const members = partyMembers(state, p).length;
  const food = carried(p, "food"), water = carried(p, "water");
  // No base left (conquest.js exiles): the team itself is home for now.
  const home = baseById(state, p.homeBaseId) || hub(state) || { name: "the road (no base)", tile: partyTile(p) };
  const speed = partySpeed(p) || 1;
  const homeFrom = (tile) => { const r = planPath(state, tile, home.tile, p.vehicle || false) || planPath(state, tile, home.tile, false); return r ? r.cost / speed : 48; };
  const left = p.path && p.idx < p.path.length - 1 ? hoursLeft(state, p) : 0;
  const hours = p.phase === "back" ? left : left + (p.dest != null && left > 0 ? 6 + homeFrom(p.dest) : homeFrom(partyTile(p)));
  const days = Math.max(0.5, hours / 24);
  const need = (n) => Math.ceil(n * days);
  const thirst = thirstAhead(state, days);
  const needWater = (n) => Math.ceil(n * days * thirst);
  const have = Math.min(food, water / thirst);
  return {
    members, food, water, hours: Math.round(hours), home,
    days: members ? have / members : 0, daysWith: have / Math.max(1, members + k),
    need: need(members + k), needWater: needWater(members + k), ok: food >= need(members + k) && water >= needWater(members + k),
  };
}

// ---------- joining ----------
function joinBase(state, s, base, foodEach = 0) {
  const cost = Math.max(0, Math.min(foodEach, base.stock.food || 0));
  base.stock.food = Math.max(0, (base.stock.food || 0) - cost);
  const back = s.left;
  delete s.pending;
  delete s.left;
  s.alive = true;
  s.location = { kind: "base", baseId: base.id };
  s.role = "farm";
  s.station = null;
  s.moodWarn = 0;
  if (!state.survivors.includes(s)) state.survivors.push(s);
  if (!back) state.stats.peopleSaved += 1;
  return cost;
}
function joinTeam(state, s, p) {
  delete s.pending;
  s.alive = true;
  s.location = { kind: "party", partyId: p.id };
  s.role = "farm";
  if (!state.survivors.includes(s)) state.survivors.push(s);
  if (!p.members.includes(s.id)) p.members.push(s.id);
  state.stats.peopleSaved += 1;
  if (state.stats.conflicts) state.stats.conflicts.joined += 1;
}
// Sets off on foot for a base: arrives (or not) after the days on the road.
function walkTo(state, s, base, fromTile) {
  const dist = state.grid.distance(fromTile, base.tile);
  delete s.pending;
  s.walking = true;
  (state.walkers || (state.walkers = [])).push({ s, baseId: base.id, arrive: day(state) + walkDays(dist), chance: walkChance(dist) });
}
// Word gets around: known groups (not hostile) with a base near the tile.
function goodwillNear(state, tile) {
  const out = [];
  for (const f of state.factions) {
    if (!f.alive || !f.known || attitude(f) === "Hostile" || !f.bases.length) continue;
    if (Math.min(...f.bases.map((b) => state.grid.distance(b, tile))) > PART_RADIUS) continue;
    changeGoodwill(state, f, PART_GOODWILL, "you helped people on the road");
    out.push(f.name);
  }
  return out;
}
const costText = (c, n) => Object.entries(c).map(([k, q]) => `${q * n} ${k}`).join(" and ");

// The bases a walker could be sent to: the nearest base and the hub (from a team), or outposts (from a base).
function walkTargets(state, fromTile, exceptId = null) {
  const list = state.bases.filter((b) => b.id !== exceptId);
  const h = hub(state);
  if (exceptId == null) {
    const nearest = [...list].sort((a, b) => state.grid.distance(fromTile, a.tile) - state.grid.distance(fromTile, b.tile))[0];
    return [...new Set([nearest, h].filter(Boolean))];
  }
  // From a base: the outposts with the most free beds first, at most two.
  return list.filter((b) => b.type === "outpost").sort((a, b) => (baseBeds(b) - residents(state, b.id).length) - (baseBeds(a) - residents(state, a.id).length)).slice(0, 2);
}

// ---------- the card ----------
// ctx: { source, title, intro, baseId (a base card) or partyId (a road card), takeMood, awayMood }
//   takeMood / awayMood: mood for everyone at the base when they are taken in / turned away (a lost teenager).
export function recruitCard(state, candidates, ctx) {
  const n = candidates.length;
  const p = ctx.partyId != null ? state.parties.find((x) => x.id === ctx.partyId) : null;
  const base = p ? null : baseById(state, ctx.baseId) || hub(state);
  const them = n === 1 ? firstName(candidates[0]) : "them all";
  const waiting = () => candidates.filter((s) => s.pending);
  const notWaiting = () => `${listNames(candidates)} ${n === 1 ? "is" : "are"} no longer waiting.`;
  const moodAll = (st, b, v) => { if (!v || !b) return; for (const o of residents(st, b.id)) o.mood = clamp(o.mood + v, 0, 100); };
  const tileOf = () => (p ? partyTile(p) : base.tile);
  const choices = [];
  if (p) {
    choices.push({
      label: `Take ${them} along`, kind: "take",
      hint: (() => { const t = teamOutlook(state, p, n); return `They join the team and carry their own share. Team food ${Math.floor(t.food)}, water ${Math.floor(t.water)}: ${r1(t.days)} days for ${t.members}, ${r1(t.daysWith)} with them; about ${t.hours} hours from ${t.home.name}${t.ok ? "" : ` (not enough: ${t.need} food and ${t.needWater} water needed)`}`; })(),
      disabled: (st) => !waiting().length || !state.parties.includes(p) || !teamOutlook(st, p, waiting().length).ok,
      resolve: (st) => {
        const list = waiting();
        if (!list.length) return notWaiting();
        if (!st.parties.includes(p)) return "Too late: the team is no longer there.";
        for (const s of list) joinTeam(st, s, p);
        return `${listNames(list)} ${list.length === 1 ? "joins" : "join"} the team.`;
      },
    });
  } else {
    choices.push({
      label: `Take ${them} in`, kind: "take",
      hint: `${n === 1 ? "Joins" : "They join"} ${base.name} now (${JOIN_FOOD * n} food on arrival)`,
      disabled: (st) => !waiting().length || !st.bases.includes(base),
      resolve: (st) => {
        const list = waiting();
        if (!list.length) return notWaiting();
        let paid = 0;
        for (const s of list) paid += joinBase(st, s, base, JOIN_FOOD);
        moodAll(st, base, ctx.takeMood);
        return `${listNames(list)} ${list.length === 1 ? "joined" : "joined the group"}${paid < JOIN_FOOD * list.length ? ` (there was only ${Math.floor(paid)} food to share)` : ""}.${ctx.takeMood ? ` Everyone at ${base.name} feels better for it (mood +${ctx.takeMood}).` : ""}`;
      },
    });
    if (n > 1) {
      for (const s of candidates) {
        choices.push({
          label: `Take only ${firstName(s)} in`, kind: "takeOne", who: s,
          hint: `${JOIN_FOOD} food on arrival; the others walk on`,
          disabled: () => !s.pending,
          resolve: (st) => {
            if (!s.pending) return notWaiting();
            const paid = joinBase(st, s, base, JOIN_FOOD);
            for (const o of candidates) if (o !== s && o.pending) { delete o.pending; o.gone = true; }
            return `${s.name} joined${paid < JOIN_FOOD ? ` (there was only ${Math.floor(paid)} food to share)` : ""}. The others walk on.`;
          },
        });
      }
    }
  }
  // Sent on foot to a base.
  for (const b of walkTargets(state, tileOf(), p ? null : base.id)) {
    const dist = state.grid.distance(tileOf(), b.tile);
    const room = baseBeds(b) - residents(state, b.id).length;
    choices.push({
      label: `Send ${them} to ${b.name}`, kind: "send", sendTo: b.id, room,
      hint: `They walk there on their own: about ${walkDays(dist)} day${walkDays(dist) === 1 ? "" : "s"}, ${Math.round(walkChance(dist) * 100)}% chance to make it. ${room >= 0 ? room : 0} free bed${room === 1 ? "" : "s"} there now`,
      disabled: (st) => !waiting().length || !st.bases.includes(b),
      resolve: (st) => {
        const list = waiting();
        if (!list.length) return notWaiting();
        if (!st.bases.includes(b)) return `${b.name} is gone.`;
        for (const s of list) walkTo(st, s, b, p && st.parties.includes(p) ? partyTile(p) : tileOf());
        return `${listNames(list)} set${list.length === 1 ? "s" : ""} off for ${b.name} (about ${walkDays(dist)} day${walkDays(dist) === 1 ? "" : "s"}).`;
      },
    });
  }
  // Supplies and a handshake.
  const cost = p ? PART_TEAM : PART_BASE;
  const afford = (st, k) => Object.entries(cost).every(([key, q]) => (p ? carried(p, key) : base.stock[key] || 0) >= q * k);
  choices.push({
    label: `Give ${them} supplies and part ways`, kind: "part",
    hint: `Costs ${costText(cost, n)} from the ${p ? "team" : "stores"}: ${p ? "the team" : `everyone at ${base.name}`} feels better for it (mood +${PART_MOOD}), and known groups within ${PART_RADIUS} tiles hear of it (goodwill +${PART_GOODWILL})`,
    disabled: (st) => !waiting().length || !afford(st, waiting().length),
    resolve: (st) => {
      const list = waiting();
      if (!list.length) return notWaiting();
      if (!afford(st, list.length) || (p && !st.parties.includes(p))) return "You no longer have that to give.";
      for (const [key, q] of Object.entries(cost)) {
        if (p) takeSupply(p, key, q * list.length);
        else base.stock[key] = Math.max(0, (base.stock[key] || 0) - q * list.length);
      }
      const people = p ? partyMembers(st, p) : residents(st, base.id);
      for (const o of people) o.mood = clamp(o.mood + PART_MOOD, 0, 100);
      const heard = goodwillNear(st, tileOf());
      for (const s of list) { delete s.pending; s.gone = true; }
      return `You share ${costText(cost, list.length)} and part as friends.${heard.length ? ` Word gets around (${heard.join(", ")}).` : ""}`;
    },
  });
  choices.push({
    label: `Turn ${them} away`, kind: "away",
    hint: ctx.awayMood ? `Everyone at ${base.name} takes it hard (mood ${ctx.awayMood})` : "No cost",
    resolve: (st) => {
      const list = waiting();
      if (!list.length) return notWaiting();
      for (const s of list) { delete s.pending; s.gone = true; }
      moodAll(st, base, ctx.awayMood);
      return `${listNames(list)} ${list.length === 1 ? "walks" : "walk"} on.`;
    },
  });
  const where = p ? `The team: ${(() => { const t = teamOutlook(state, p, n); return `${Math.floor(t.food)} food and ${Math.floor(t.water)} water, ${r1(t.days)} days for ${t.members} (${r1(t.daysWith)} with them), ${t.hours} hours from ${t.home.name}`; })()}. ` : "";
  const h = p ? hub(state) : base;
  return {
    title: ctx.title || (n === 1 ? "Someone asks to join" : "Survivors ask to join"),
    text: `${ctx.intro || ""} ${candidates.map(candidateLine).join(". ")}. ${where}${h ? `${h.name}: ${outlookText(baseOutlook(state, h, n), n)}` : "no base to take them to (you have none left)"}.`.trim(),
    partyId: p ? p.id : undefined,
    where: p ? tileLabel(state, partyTile(p)) : undefined,
    recruit: { candidates, source: ctx.source, intro: ctx.intro || "", baseId: base ? base.id : null, partyId: p ? p.id : null },
    choices,
  };
}

export function offerRecruits(state, candidates, ctx) {
  if (!hub(state) && ctx.partyId == null) return null; // no base left (conquest.js exiles): nobody to take them in
  const card = recruitCard(state, candidates, ctx);
  addCard(state, card);
  return card;
}

// ---------- daily: walkers arriving, deserters coming back ----------
export function recruitsDaily(state) {
  const d = day(state);
  const rng = state.rng;
  for (const w of [...(state.walkers || [])]) {
    if (w.arrive > d) continue;
    state.walkers.splice(state.walkers.indexOf(w), 1);
    delete w.s.walking;
    const base = baseById(state, w.baseId) || hub(state);
    if (!base) continue;
    if (rng.chance(w.chance)) {
      joinBase(state, w.s, base, 0);
      log(state, `${w.s.name} made it to ${base.name} on foot and joins the group.`, "good");
    } else {
      w.s.gone = true;
      log(state, `${w.s.name} never arrived at ${base.name}.`, "danger");
    }
  }
  for (const e of [...(state.deserters || [])]) {
    const s = survivorById(state, e.id);
    const age = d - e.day;
    if (!s || s.alive || !s.left || age > RETURN.until) { state.deserters.splice(state.deserters.indexOf(e), 1); continue; }
    if (age < RETURN.after || !rng.chance(RETURN.chance)) continue;
    state.deserters.splice(state.deserters.indexOf(e), 1);
    const base = baseById(state, e.baseId) || hub(state);
    if (!base) continue;
    s.pending = true;
    s.health = rng.int(50, 90);
    s.mood = 45;
    offerRecruits(state, [s], {
      source: "returning", baseId: base.id, title: "A familiar face at the gate",
      intro: `${s.name}, who walked out of ${base.name} ${age} days ago, is back and asks to be let in again.`,
    });
  }
}

// ---------- autopilot (autopilot.js pickChoice) ----------
// roomFor(k): the governor's bed, food and water rule for k more people. Takes everyone if there is room, else the
// best one, else sends them to a base with free beds, else parts ways when the stores are full, else turns them away.
export function autoRecruitPick(state, card, opts, roomFor) {
  const r = card.recruit;
  const n = r.candidates.filter((s) => s.pending).length || r.candidates.length;
  const kind = (k) => opts.filter((c) => c.kind === k);
  if (roomFor(n) && kind("take")[0]) return kind("take")[0];
  const ones = kind("takeOne").sort((a, b) => Math.max(...Object.values(b.who.skills)) - Math.max(...Object.values(a.who.skills)));
  if (ones.length && roomFor(1)) return ones[0];
  const send = kind("send").filter((c) => c.room >= n).sort((a, b) => b.room - a.room)[0];
  if (send && roomFor(n)) return send;
  const h = hub(state);
  if (kind("part")[0] && h && (h.stock.food || 0) >= 120 && (h.stock.water || 0) >= 40) return kind("part")[0];
  return kind("away")[0] || null;
}

// Everything the card window shows, worked out now (src/ui/people.js).
export function recruitView(state, card) {
  const r = card.recruit;
  const list = r.candidates;
  const k = list.filter((s) => s.pending).length;
  const p = r.partyId != null ? state.parties.find((x) => x.id === r.partyId) : null;
  const base = p ? hub(state) : baseById(state, r.baseId) || hub(state);
  return {
    candidates: list.map((s) => ({ s, items: allItems(s) })),
    base: base || { name: "no base", id: null }, outlook: base ? baseOutlook(state, base, k) : null, k, // no base left (conquest.js exiles)
    team: p ? teamOutlook(state, p, k) : null,
  };
}
