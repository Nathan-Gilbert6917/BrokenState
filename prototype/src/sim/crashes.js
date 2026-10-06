// Crash sites and supply drops (suggestions-2 #9, contested events): every 10–20 days (the first between days 8
// and 14) something comes down somewhere in the state: an Army helicopter, a supply plane, a medevac, a news
// chopper, or a parachute supply drop. Someone sees or hears it (a base, a team in the field, or the radio): a card
// and a search circle on the map (radius 4; 3 seen from a base with a watchtower, 5 heard on the radio) that holds
// the wreck somewhere inside, not at its centre.
//
//   Finding it: a team that passes within 1 tile of the wreck sees the smoke; a look around (or a recon's survey)
//   finds it within 2 tiles (3 with Scouting 8+). A look inside the circle that finds nothing clears the tiles it
//   covered and narrows the circle by one (it always still holds the wreck). The plan step "Search the area"
//   (plans.js, orders.js "searcharea") walks the circle looking around at the spots that clear the most unsearched
//   ground (up to 8 looks), then searches the wreck when it is found.
//   The site: a temporary site on its tile (data.js LOCATIONS crash_mil / crash_cargo / crash_med / crash_news /
//   airdrop, raid areas in combat.js) with rich loot (military gear, meds, blueprints in locked cargo cases). It
//   burns out and is picked clean 7–10 days after it came down.
//   The race: groups with a base within 22 tiles saw it too; most send a salvage party (12–36 hours after the crash,
//   walking there like any group party). One that reaches the wreck strips it to 30% of what is left; if your team is
//   there it challenges you (a conflict card). The noise draws up to two hordes within 8 tiles toward it for 3 days.
// Scheduling and placement use hash01 (skills.js), never the world's random numbers.
import { LOCATIONS } from "./data.js";
import { log, addCard, day, hub, atBase, factionById, skill, combatPower, snapshot } from "./world.js";
import {
  partyTile, partyMembers, tileLabel, teamName, planPath, launchExpedition, carryCapacity, supplyLoad, spawnAiParty, awaitOrders,
  bestSkill, startReturn,
} from "./parties.js";
import { startOrder } from "./orders.js";
import { estimatePlan } from "./plans.js";
import { hash01 } from "./skills.js";
import { workFactor } from "./health.js";
import { triggerConflict } from "./conflicts.js";
import { stockHas } from "./water.js"; // water counts both kinds

export const CRASH = {
  firstMin: 8, firstMax: 14, gapMin: 10, gapMax: 20, radius: 4, radiusTower: 3, radiusRadio: 5, lifeMin: 7, lifeMax: 10,
  findLook: 2, findPass: 1, maxLooks: 8, raceRange: 22, raceMin: 12, raceMax: 36, stripKeep: 0.3, hordeRange: 8, lureHours: 72,
  minDist: 5, maxDist: 13, radioDist: 20,
};
// site: the LOCATIONS type of the wreck; seen: how the card puts it; w: how often.
export const CRASH_KINDS = {
  heli:    { name: "Army helicopter", site: "crash_mil", w: 0.33, seen: "a military helicopter trailing smoke, then a dull boom", icon: "🚁" },
  cargo:   { name: "Supply plane", site: "crash_cargo", w: 0.22, seen: "a cargo plane low over the trees, one engine on fire", icon: "✈" },
  medevac: { name: "Medevac helicopter", site: "crash_med", w: 0.2, seen: "a medevac helicopter with a red cross spinning down", icon: "🚁" },
  news:    { name: "News helicopter", site: "crash_news", w: 0.13, seen: "a news chopper wobbling, then falling behind a ridge", icon: "🚁" },
  drop:    { name: "Supply drop", site: "airdrop", w: 0.12, seen: "parachutes under a plane nobody answers on the radio: a supply drop", icon: "📦" },
};
// How eager each group type is to race you for it.
const RACE = { raider: 0.75, military: 0.85, expansionist: 0.65, zealot: 0.5, fortress: 0.4, traders: 0.3, commune: 0.2 };

const roll = (state, ...k) => hash01(state.seed, "crash", ...k);
export const crashes = (state) => state.crashes || (state.crashes = []);
export const crashById = (state, id) => crashes(state).find((c) => c.id === id) || null;
export const activeCrashes = (state) => crashes(state).filter((c) => !c.gone);
export const crashAt = (state, tile) => activeCrashes(state).find((c) => c.tile === tile) || null;
export const daysLeft = (state, c) => Math.max(0, (c.expires - state.hour) / 24);
export const inCircle = (state, c, tile) => state.grid.distance(c.center, tile) <= c.radius;

// When the next one comes down (hours).
function schedule(state, first = false) {
  const n = state.crashSeq || 0;
  const d = first ? CRASH.firstMin + Math.floor(roll(state, "first") * (CRASH.firstMax - CRASH.firstMin + 1))
    : day(state) + CRASH.gapMin + Math.floor(roll(state, "gap", n) * (CRASH.gapMax - CRASH.gapMin + 1));
  state.crashNext = (d - 1) * 24 + 9 + Math.floor(roll(state, "hr", n) * 9);
}

const isLand = (t) => t && t.terrain !== "water" && !t.bridge;
// A tile for a wreck: open land with no site, base or hive on it, reachable on foot from the hub.
function goodTile(state, id) {
  const t = state.tiles[id];
  if (!isLand(t) || t.loc || t.hive || t.terrain === "mountain") return false;
  if (state.bases.some((b) => b.tile === id) || state.factions.some((f) => f.alive && f.bases.includes(id))) return false;
  if (state.hiveSites && state.hiveSites.some((s) => s.tile === id)) return false;
  return true;
}
const DIRS = ["east", "southeast", "south", "southwest", "west", "northwest", "north", "northeast"];
function direction(state, from, to) {
  const [ax, ay] = state.grid.toPixel(from, 1), [bx, by] = state.grid.toPixel(to, 1);
  const a = Math.atan2(by - ay, bx - ax);
  return DIRS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}
function nearestTown(state, tile) {
  let best = null, bd = Infinity;
  for (const id of state.grid.within(tile, 12)) {
    const t = state.tiles[id];
    if (!t.loc || !["town", "city"].includes(t.loc.type)) continue;
    const d = state.grid.distance(id, tile);
    if (d < bd) { bd = d; best = t.loc.name.replace(/ (Town|City center|Downtown)$/i, ""); }
  }
  return best;
}

// Who saw it: a base, a team in the field, or the radio. Returns { tile, label, radius, from } or null.
function witness(state, n) {
  const opts = [];
  for (const b of state.bases) opts.push({ tile: b.tile, label: b.name, radius: b.watchtower ? CRASH.radiusTower : CRASH.radius, w: b.type === "hub" ? 3 : 1, from: "base" });
  for (const p of state.parties) {
    if (p.owner !== "player" || p.kind === "convoy" || !partyMembers(state, p).length) continue;
    opts.push({ tile: partyTile(p), label: teamName(state, p), radius: CRASH.radius, w: 1.5, from: "team", partyId: p.id });
  }
  const h = hub(state);
  if (h && h.radio) opts.push({ tile: h.tile, label: "The radio", radius: CRASH.radiusRadio, w: 1.5, from: "radio" });
  if (!opts.length) return null;
  const total = opts.reduce((a, o) => a + o.w, 0);
  let r = roll(state, "who", n) * total;
  for (const o of opts) { r -= o.w; if (r <= 0) return o; }
  return opts[opts.length - 1];
}

// A new crash (also used by tools: opts.kind, opts.tile, opts.witness force them). Returns the crash or null.
export function spawnCrash(state, opts = {}) {
  const list = crashes(state);
  const n = state.crashSeq || 0; // crashes so far (old ones are forgotten, the count is not)
  const w = opts.witness || witness(state, n);
  if (!w) return null;
  const kinds = Object.keys(CRASH_KINDS);
  let kind = opts.kind;
  if (!kind) {
    let r = roll(state, "kind", n) * kinds.reduce((a, k) => a + CRASH_KINDS[k].w, 0);
    kind = kinds.find((k) => (r -= CRASH_KINDS[k].w) <= 0) || "heli";
  }
  const g = state.grid;
  const h = hub(state);
  let tile = opts.tile;
  if (tile == null) {
    const far = w.from === "radio" ? CRASH.radioDist : CRASH.maxDist;
    const cands = g.within(w.tile, far).filter((id) => g.distance(id, w.tile) >= CRASH.minDist && goodTile(state, id));
    for (let i = 0; i < 12 && cands.length && tile == null; i++) {
      const id = cands[Math.floor(roll(state, "tile", n, i) * cands.length) % cands.length];
      if (planPath(state, h ? h.tile : w.tile, id, false)) tile = id;
    }
  }
  if (tile == null) return null;
  const radius = opts.radius || w.radius;
  // The circle's centre: somewhere within radius − 1 of the wreck, so the wreck is always inside.
  const near = g.within(tile, Math.max(0, radius - 1)).filter((id) => isLand(state.tiles[id]));
  const center = near.length ? near[Math.floor(roll(state, "center", n) * near.length) % near.length] : tile;
  const def = CRASH_KINDS[kind];
  const t = state.tiles[tile];
  const town = nearestTown(state, tile);
  const life = CRASH.lifeMin + Math.floor(roll(state, "life", n) * (CRASH.lifeMax - CRASH.lifeMin + 1));
  state.crashSeq = n + 1;
  const c = {
    id: n + 1, kind, tile, center, radius, radius0: radius, seenHour: state.hour, expires: state.hour + life * 24, found: false,
    witness: w.label, from: w.from, cleared: [], looks: 0, race: [], stripped: 0, gone: false, prevLoot: t.loot ?? 0,
  };
  c.name = `${def.name} wreck${town ? ` near ${town}` : ""}`.replace("Supply drop wreck", "Supply drop");
  list.push(c);
  // The site itself appears on its tile once someone finds it (foundCrash): until then nothing on the map gives it away.
  // Groups nearby saw it too.
  state.factions.forEach((f, i) => {
    if (!f.alive || !f.bases.length) return;
    const d = Math.min(...f.bases.map((b) => g.distance(b, tile)));
    if (d > CRASH.raceRange || roll(state, "race", n, i) >= (RACE[f.type] ?? 0.4)) return;
    c.race.push({ fid: f.id, at: state.hour + CRASH.raceMin + Math.floor(roll(state, "rat", n, i) * (CRASH.raceMax - CRASH.raceMin + 1)), sent: false });
  });
  // The noise draws the dead.
  const hordes = state.hordes.filter((x) => g.distance(x.tile, tile) <= CRASH.hordeRange).sort((a, b) => g.distance(a.tile, tile) - g.distance(b.tile, tile)).slice(0, 2);
  for (const x of hordes) { x.target = tile; x.lureUntil = state.hour + CRASH.lureHours; }
  c.lured = hordes.length;
  const dir = direction(state, w.tile, center);
  const dist = g.distance(w.tile, center);
  log(state, `${def.icon} ${w.label} ${w.from === "radio" ? "heard on the radio of" : "saw"} ${def.seen.replace(/^a /, "a ")}: down somewhere around ${tileLabel(state, center)} (${dist} tiles ${dir}). A search circle of ${radius} tiles is on the map.`, "danger");
  if (!opts.noCard) addCard(state, crashCard(state, c, w, dir, dist));
  state.stats.crashes = (state.stats.crashes || 0) + 1;
  return c;
}

export function crashCard(state, c, w = { label: c.witness, from: c.from }, dir = "", dist = 0) {
  const def = CRASH_KINDS[c.kind];
  const crew = searchCrew(state);
  const est = crew.length >= 2 ? searchSupplies(state, c, crew) : null;
  const wording = w.from === "radio" ? `A garbled call on the radio: ${def.seen}.` : `${w.label} saw ${def.seen}.`;
  return {
    title: c.kind === "drop" ? "A supply drop comes down" : `${def.name} down`, crashId: c.id, where: tileLabel(state, c.center),
    text: `${wording} It came down somewhere within ${c.radius} tiles of ${tileLabel(state, c.center)}${dist ? `, ${dist} tiles ${dir}` : ""} (the circle on the map). ` +
      `A wreck like this holds military gear, meds and sometimes a manual or blueprint in locked cases. It burns out and is picked clean in about ${Math.round(daysLeft(state, c))} days; other groups will have seen it, and the noise draws the dead.`,
    choices: [
      { label: "Mark it on the map", hint: "The circle stays on the map until it burns out. Plan a trip there yourself (the planner has a “Search the area” step).", ai: () => 1, resolve: () => "The search circle is on the map." },
      {
        label: crew.length >= 2 ? `Send a search team (${crew.map((s) => s.name.split(" ")[0]).join(", ")})` : "Send a search team",
        hint: est && est.ok ? `On foot from the hub with ${est.text}: recon the circle, look around until the wreck is found (up to ${CRASH.maxLooks} looks), search it, come home. About ${Math.ceil(est.days)} days.` : (est ? est.why : "Not enough people free at the hub (2 or more, leaving 3 at home)."),
        disabled: () => !(est && est.ok) || c.gone || !searchCrew(state).length,
        ai: (st) => (est && est.ok && hub(st) && atBase(st, hub(st).id).length >= 6 ? 6 : 0),
        resolve: (st) => sendSearchTeam(st, c),
      },
    ],
  };
}

// ---------- the one-click search team ----------
// Up to 3 of the fittest free people at the hub, leaving 3 at home.
export function searchCrew(state) {
  const h = hub(state);
  if (!h) return [];
  const people = atBase(state, h.id);
  const free = people.filter((s) => !s.inBed && s.health >= 50 && workFactor(s) >= 0.5 && !s.pinned && !s.leader)
    .sort((a, b) => (skill(b, "scouting") + combatPower(b) * 0.5 + skill(b, "stealth") * 0.2) - (skill(a, "scouting") + combatPower(a) * 0.5 + skill(a, "stealth") * 0.2) || a.id - b.id);
  const n = Math.min(3, free.length, people.length - 3);
  return n >= 2 ? free.slice(0, n) : [];
}
const SEARCH_STEPS = (c) => [{ kind: "searcharea", crash: c.id }, { kind: "home" }];
function searchSupplies(state, c, crew) {
  const h = hub(state);
  const n = crew.length;
  const est = estimatePlan(state, { memberIds: crew.map((s) => s.id), dest: c.center, vehicle: false, stance: "normal", mission: "recon", steps: SEARCH_STEPS(c), homeBaseId: h.id });
  if (!est) return { ok: false, why: "No way there on foot." };
  const stock = (k) => Math.floor(stockHas(h.stock, k)); // water: both kinds (water.js)
  const sup = { food: Math.ceil(est.food * 1.3) + n, water: Math.ceil(est.water * 1.3) + n, ammo: Math.max(0, Math.min(stock("ammo") - 10, 8 * n)), meds: stock("meds") >= 4 ? 1 : 0 };
  const cap = carryCapacity(state, crew, null);
  while (supplyLoad(sup) > cap && sup.ammo > 0) sup.ammo = Math.max(0, sup.ammo - 4);
  if (supplyLoad(sup) > cap) return { ok: false, why: "They cannot carry the food and water for it." };
  if (sup.food > stock("food") || sup.water > stock("water")) return { ok: false, why: `The hub cannot spare ${sup.food} food and ${sup.water} water.` };
  return { ok: true, sup, days: est.total / 24, text: `${sup.food} food, ${sup.water} water${sup.ammo ? `, ${sup.ammo} ammo` : ""}${sup.meds ? ", 1 meds" : ""}` };
}
export function sendSearchTeam(state, c) {
  if (!c || c.gone) return "The wreck has burned out.";
  const crew = searchCrew(state);
  if (crew.length < 2) return "Not enough people free at the hub.";
  const s = searchSupplies(state, c, crew);
  if (!s.ok) return s.why;
  const res = launchExpedition(state, {
    memberIds: crew.map((x) => x.id), dest: c.center, mission: "recon", stance: "normal", supplies: s.sup,
    plan: { preset: "custom", steps: SEARCH_STEPS(c), conditions: { hurt: 35 } },
  });
  if (res.error) return res.error;
  res.party.crashSearch = c.id;
  return `${crew.map((x) => x.name.split(" ")[0]).join(", ")} set out to find the ${CRASH_KINDS[c.kind].name.toLowerCase()}.`;
}

// ---------- finding it ----------
const lookRadius = (state, p) => CRASH.findLook + (bestSkill(state, p, "scouting") >= 8 ? 1 : 0);
// A look around or a recon's survey (parties.js survey): finds a wreck in reach, or narrows the circle. Returns a note.
export function crashSurvey(state, p) {
  if (!p || p.owner !== "player") return "";
  const tile = partyTile(p);
  const r = lookRadius(state, p);
  const notes = [];
  for (const c of activeCrashes(state)) {
    if (c.found) continue;
    if (state.grid.distance(tile, c.tile) <= r) { notes.push(foundCrash(state, c, p, true)); continue; }
    if (state.grid.distance(tile, c.center) > c.radius + r) continue;
    c.looks += 1;
    for (const id of state.grid.within(tile, r)) if (!c.cleared.includes(id)) c.cleared.push(id);
    narrow(state, c, tile);
    notes.push(`No sign of the ${CRASH_KINDS[c.kind].name.toLowerCase()} here: the search circle is down to ${c.radius} tile${c.radius === 1 ? "" : "s"} around ${tileLabel(state, c.center)}.`);
  }
  return notes.join(" ");
}
// One tile tighter, moved away from where the team looked; it still holds the wreck.
function narrow(state, c, lookedAt) {
  const g = state.grid;
  const r = Math.max(1, c.radius - 1);
  const cands = g.within(c.center, c.radius).filter((id) => g.distance(id, c.tile) <= r && isLand(state.tiles[id]));
  if (!cands.length) return;
  let best = cands[0], bv = -Infinity;
  for (const id of cands) {
    const v = 0.6 * g.distance(id, lookedAt) - g.distance(id, c.center) + roll(state, "nar", c.id, c.looks, id) * 0.5;
    if (v > bv) { bv = v; best = id; }
  }
  c.center = best;
  c.radius = r;
}
// Found: the site is on the map (and the team's report), with a card unless a search step is handling it.
export function foundCrash(state, c, p, byLook = false) {
  if (c.found) return "";
  c.found = true;
  c.foundHour = state.hour;
  c.foundBy = p ? p.id : null;
  c.center = c.tile;
  c.radius = 0;
  placeSite(state, c);
  state.knowledge[c.tile] = snapshot(state, c.tile);
  if (p && p.seen) p.seen.set(c.tile, snapshot(state, c.tile));
  const name = c.name || "the wreck";
  const msg = `${p ? teamName(state, p) : "Your people"} found the ${name} at ${tileLabel(state, c.tile)}${byLook ? "" : " (the smoke gave it away)"}: about ${Math.round(daysLeft(state, c))} days before it burns out.`;
  log(state, `🔥 ${msg}`, "good");
  const searching = p && (p.crashSearch === c.id || (p.orders || []).some((o) => o.type === "searcharea"));
  if (p && !searching && !state.cards.some((x) => x.partyId === p.id && x.crashFound)) {
    addCard(state, {
      title: "Wreck found", partyId: p.id, planCard: true, crashFound: c.id, where: tileLabel(state, c.tile),
      text: `${msg} Search it before other groups strip it.`,
      choices: [
        { label: "Search it now", hint: "Goes there and raids the wreck next (before the rest of the queue).", order: true, ai: (st) => (partyMembers(st, p).every((m) => m.health >= 45) ? 6 : 1), resolve: (st) => searchWreckNext(st, p, c) },
        { label: "Carry on", hint: (p.orders || []).length ? `Next: ${(p.orders || []).length} step${(p.orders || []).length === 1 ? "" : "s"} left.` : "Carry on.", ai: () => 2, resolve: () => "" },
        { label: "Come home", hint: "Head back with everything carried.", order: true, ai: () => 0, resolve: (st) => startReturn(st, p) || "The team heads home." },
      ],
    });
  }
  return msg;
}
function searchWreckNext(state, p, c) {
  if (!state.parties.includes(p) || c.gone) return "Too late.";
  p.orders = p.orders || [];
  p.orders.unshift({ type: "mission", mission: "scavenge", at: c.tile });
  if (p.phase === "waiting" || p.phase === "task") {
    if (partyTile(p) === c.tile) return startOrder(state, p, p.orders.shift());
    return startOrder(state, p, { type: "move", tile: c.tile });
  }
  p.orders.unshift({ type: "move", tile: c.tile });
  return `Added: search the wreck at ${tileLabel(state, c.tile)} next.`;
}

// ---------- the "Search the area" step (orders.js startOrder) ----------
function nearestCrash(state, tile) {
  const list = activeCrashes(state);
  return list.sort((a, b) => state.grid.distance(a.center, tile) - state.grid.distance(b.center, tile))[0] || null;
}
// The next spot to look around: the one that clears the most unsearched ground of the circle, not far off.
export function nextLook(state, c, from, vehicle = false) {
  const g = state.grid;
  const r = CRASH.findLook;
  const circle = g.within(c.center, c.radius).filter((id) => isLand(state.tiles[id]));
  const open = new Set(circle.filter((id) => !c.cleared.includes(id)));
  if (!open.size) return null;
  const scored = circle.map((id) => {
    let gain = 0;
    for (const x of g.within(id, r)) if (open.has(x)) gain++;
    return { id, v: gain - 0.8 * g.distance(from, id) };
  }).filter((x) => x.v > -50).sort((a, b) => b.v - a.v || a.id - b.id);
  for (const x of scored.slice(0, 6)) if (x.id === from || planPath(state, from, x.id, vehicle) || planPath(state, from, x.id, false)) return x.id;
  return null;
}
export function startSearchArea(state, p, o) {
  const here = partyTile(p);
  const c = (o.crash != null && crashById(state, o.crash)) || nearestCrash(state, here);
  const done = (msg) => {
    delete p.crashSearch;
    if (p.phase === "waiting" || p.phase === "task") awaitOrders(state, p, msg);
    return msg;
  };
  if (!c || c.gone) return done("No downed aircraft to search for any more: step skipped.");
  p.crashSearch = c.id;
  if (c.found) {
    delete p.crashSearch;
    if (o.explore === false) return done(`The wreck is at ${tileLabel(state, c.tile)}.`);
    p.orders = p.orders || [];
    p.orders.unshift({ type: "mission", mission: "scavenge", at: c.tile });
    if (here === c.tile) return startOrder(state, p, p.orders.shift());
    return startOrder(state, p, { type: "move", tile: c.tile });
  }
  const tries = o.tries || 0;
  if (tries >= CRASH.maxLooks) return done(`Looked around ${tries} times without finding the wreck: step ended.`);
  const next = nextLook(state, c, here, p.vehicle);
  if (next == null) return done("No ground left to search: step ended.");
  p.orders = p.orders || [];
  p.orders.unshift({ type: "mission", mission: "survey", at: next }, { ...o, crash: c.id, tries: tries + 1 });
  if (next === here) return startOrder(state, p, p.orders.shift());
  return startOrder(state, p, { type: "move", tile: next });
}

// ---------- hourly (parties.js movePartiesHour) ----------
export function crashesHour(state) {
  if (state.gameOver) return;
  if (state.crashNext == null) schedule(state, true);
  if (state.hour >= state.crashNext) {
    spawnCrash(state);
    schedule(state);
  }
  const g = state.grid;
  for (const c of activeCrashes(state)) {
    // Burned out and picked clean (not while your team is raiding it).
    if (state.hour >= c.expires) {
      const busy = (state.combat && state.combat.tileId === c.tile) || (state.engagement && !state.engagement.done && state.engagement.tile === c.tile);
      if (!busy) { expire(state, c); continue; }
    }
    // Seen in passing: a team within a tile (smoke), or a base that can see it.
    if (!c.found) {
      const p = state.parties.find((q) => q.owner === "player" && q.kind !== "convoy" && q.path && partyMembers(state, q).length && g.distance(partyTile(q), c.tile) <= CRASH.findPass);
      if (p) foundCrash(state, c, p);
      else if (state.bases.some((b) => g.distance(b.tile, c.tile) <= (b.type === "hub" ? 3 : 2) + (b.watchtower ? 2 : 0))) foundCrash(state, c, null);
    }
    // The race.
    for (const r of c.race) {
      if (r.sent || state.hour < r.at) continue;
      r.sent = true;
      const f = factionById(state, r.fid);
      if (!f || !f.alive || !f.bases.length) continue;
      const q = spawnAiParty(state, f, "salvage", f.bases[0], c.tile, { strength: Math.max(3, Math.round(f.pop * 0.25)) });
      if (q) { q.crash = c.id; r.partyId = q.id; }
    }
  }
  // Salvage parties that arrived.
  for (const q of state.parties) {
    if (q.kind !== "salvage" || q.returning || q.owner === "player" || !q.path || q.idx < q.path.length - 1) continue;
    const c = crashById(state, q.crash);
    q.returning = true;
    if (!c || c.gone || partyTile(q) !== c.tile) continue;
    const f = factionById(state, q.owner);
    // Your team is there: they want it too.
    const team = state.parties.find((p) => p.owner === "player" && p.kind !== "convoy" && partyMembers(state, p).length && partyTile(p) === c.tile && p.phase !== "engaged");
    if (team && f && !state.cards.some((x) => x.partyId === team.id)) {
      triggerConflict(state, team, "challenge", f.id);
      log(state, `${f.known ? f.name : "Another group"} reached the wreck at ${tileLabel(state, c.tile)} while your team was there.`, "danger");
    }
    stripCrash(state, c, f);
  }
  // Old crashes are forgotten after a month.
  if (state.crashes && state.crashes.length > 12) state.crashes = state.crashes.filter((c) => !c.gone || state.hour - c.expires < 30 * 24);
}
export function stripCrash(state, c, f) {
  const t = state.tiles[c.tile];
  if (t.loc && t.loc.crash === c.id) t.loot = Math.max(0.03, (t.loot || 0) * CRASH.stripKeep);
  c.stripped += 1;
  if (c.found || state.live.has(c.tile)) log(state, `${f && f.known ? f.name : "Another group"} reached the ${c.name || "wreck"} and stripped most of it.`, "danger");
}
// The temporary site on the wreck's tile (data.js LOCATIONS crash_*, raid areas in combat.js); what groups that got
// there first left of it.
export function placeSite(state, c) {
  const t = state.tiles[c.tile];
  if (t.loc && t.loc.crash === c.id) return;
  const type = CRASH_KINDS[c.kind].site;
  t.loc = { type, name: c.name || CRASH_KINDS[c.kind].name, zone: "special", crash: c.id };
  t.loot = Math.max(0.03, (LOCATIONS[type] ? LOCATIONS[type].richness : 1.1) * CRASH.stripKeep ** (c.stripped || 0));
}
export function expire(state, c) {
  const t = state.tiles[c.tile];
  c.gone = true;
  if (t.loc && t.loc.crash === c.id) {
    const name = t.loc.name;
    delete t.loc;
    t.loot = c.prevLoot ?? 0;
    if (c.found) log(state, `The ${name} has burned out and been picked clean.`, "info");
    else log(state, `The smoke from the ${CRASH_KINDS[c.kind].name.toLowerCase()} near ${tileLabel(state, c.center)} is gone: whatever was there is lost.`, "info");
  }
  if (state.knowledge[c.tile]) state.knowledge[c.tile] = snapshot(state, c.tile);
  for (const q of state.parties) if (q.kind === "salvage" && q.crash === c.id) q.returning = true;
  for (let i = state.cards.length - 1; i >= 0; i--) if (state.cards[i].crashId === c.id) state.cards.splice(i, 1);
}

// For the UI: lines about a tile (tooltip) and the list of what is going on.
export function crashTip(state, tile) {
  const out = [];
  for (const c of activeCrashes(state)) {
    const def = CRASH_KINDS[c.kind];
    if (c.found && c.tile === tile) out.push(`${def.icon} ${c.name || def.name}: burns out in about ${daysLeft(state, c).toFixed(1)} days${c.stripped ? " (another group has stripped it)" : ""}`);
    else if (!c.found && inCircle(state, c, tile)) out.push(`${def.icon} Search area for the downed ${def.name.toLowerCase()} (${c.radius} tiles around ${tileLabel(state, c.center)}): about ${daysLeft(state, c).toFixed(1)} days left`);
  }
  return out;
}
