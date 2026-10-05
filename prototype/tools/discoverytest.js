// Hidden sites (sim/discovery.js): sites a normal person did not know before the fall stay off the map until your
// people find them or hear of them.
// Usage: node tools/discoverytest.js [seed] [autopilot days] [runs per style]
// - classification: every LOCATIONS type has a rule (public / road / secret), the road rule, towns and landmarks public
// - before discovery: not drawn by the real map renderer (no name), bare ground in the tooltip and the tile panel,
//   no "Scavenge" in the right-click actions, not in the planner's nearby sites, tileLabel names the ground,
//   the autopilot's and crews' site score refuses it, hive names never name one
// - each discovery route puts it on the map with one log line: seen from a base, a team's sight (radioed in, or
//   brought home), radio news, an explorer's map, intel bought, a prisoner questioned, the coalition's reports,
//   a retrieve job's pick-up place; it stays known, it is saved and loaded, and nothing is announced twice
// - determinism: the same seed plays the same with the same discoveries
// - autopilot campaigns ([days] in each style, [runs] seeds): no team is ever sent to scavenge a site the player has
//   not found; how fast the hidden sites near the hub are found
import { createWorld, tickHour, hub, day, atBase, snapshot, updateVision, mergeKnowledge } from "../src/sim/world.js";
import { recomputeOwnership } from "../src/sim/factions.js";
import { LOCATIONS } from "../src/sim/data.js";
import { isPublicSite, hiddenSites, siteKnown, siteKnownTo, nearRoad, knownLoc, discoveryHour } from "../src/sim/discovery.js";
import { tileLabel, launchExpedition, partyTile, removeParty, planPath } from "../src/sim/parties.js";
import { nearbySites } from "../src/sim/plans.js";
import { setAutopilot, crewAI } from "../src/sim/autopilot.js";
import { addBuilding } from "../src/sim/buildings.js";
import { radioNews, canRadioGroup } from "../src/sim/radio.js";
import { giveIntel } from "../src/sim/visitors.js";
import { gatherIntel } from "../src/sim/prisoners.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { hiveName } from "../src/sim/hives.js";
import * as J from "../src/sim/jobs.js";
import * as A from "../src/sim/alliance.js";
import * as D from "../src/sim/diplomacy.js";

const seed = Number(process.argv[2] || 42);
const days = Number(process.argv[3] || 120);
const runs = Number(process.argv[4] || 3);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; return st; };
const unknownHidden = (st) => hiddenSites(st).filter((id) => !siteKnown(st, id));
const land = (st, t) => st.tiles[t].terrain !== "water" && st.tiles[t].terrain !== "mountain";
const free = (st, t) => land(st, t) && !st.tiles[t].loc && !st.factions.some((f) => f.bases.includes(t)) && !st.bases.some((b) => b.tile === t);

// ---------- 1. classification ----------
console.log("Classification");
{
  for (const [type, def] of Object.entries(LOCATIONS)) check(["public", "road", "secret"].includes(def.known), `${type} has a known rule`);
  const pub = Object.keys(LOCATIONS).filter((k) => LOCATIONS[k].known === "public");
  for (const k of ["town", "city", "mall", "hospital", "police", "gas", "truckstop", "school", "military", "dam", "airport", "prison"]) check(pub.includes(k), `${k} is public (known before the fall)`);
  for (const k of ["farm", "cabin", "lodge", "campground", "quarry", "barn", "ranch"]) check(LOCATIONS[k].known === "road", `${k} is public only by a road`);
  for (const k of ["crashsite", "crash_mil", "airdrop"]) check(LOCATIONS[k].known === "secret", `${k} is secret`);
  const st = W();
  const sites = st.tiles.filter((t) => t.loc);
  const hidden = hiddenSites(st);
  check(hidden.length > 10, `a Normal map has hidden sites (${hidden.length} of ${sites.length})`);
  const roadside = sites.filter((t) => LOCATIONS[t.loc.type].known === "road" && nearRoad(st, t.id));
  check(roadside.length > 0 && roadside.every((t) => isPublicSite(st, t.id)), `${roadside.length} countryside sites by a road are public`);
  check(hidden.every((id) => { const t = st.tiles[id]; return LOCATIONS[t.loc.type].known === "secret" || (!t.road && !st.grid.neighbors(id).some((n) => st.tiles[n].road)); }), "every hidden road-rule site is more than a tile from any road");
  const types = {};
  for (const id of hidden) types[st.tiles[id].loc.type] = (types[st.tiles[id].loc.type] || 0) + 1;
  console.log(`  seed ${seed}: ${hidden.length} of ${sites.length} sites hidden (${Object.entries(types).map(([k, n]) => `${k} ${n}`).join(", ")}); ${hidden.filter((id) => siteKnown(st, id)).length} in the hub's view on day 1`);
  // Hive names never give a hidden site away.
  for (const hv of st.hives) check(!hidden.some((id) => hv.name.includes(st.tiles[id].loc.name)), `${hv.name} names no hidden site`);
  for (const id of hidden) check(!hiveName(st, id).includes(st.tiles[id].loc.name), `a hive on ${st.tiles[id].loc.name} would not be named after it`);
}

// ---------- 2. before discovery: not drawn, not listed, not targetable ----------
console.log("Before discovery");
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
const drawn = [];
const noop = () => {};
const ctx = new Proxy({ measureText: (t) => ({ width: String(t).length * 5 }), getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) },
  { get: (o, k) => (k in o ? o[k] : k === "fillText" || k === "strokeText" ? (s) => drawn.push(String(s)) : noop), set: (o, k, v) => ((o[k] = v), true) });
const R = await import("../src/ui/render.js");
const UI = await import("../src/ui/ui.js");
R.initRenderer({ getContext: () => ctx, getBoundingClientRect: () => ({ width: 1600, height: 900 }), width: 0, height: 0 });
R.zoomAt(800, 450, 2.5 / R.camera.zoom);
const namesDrawn = (st, id) => { drawn.length = 0; R.centerOn(st, id); R.redrawMap(true); R.render(st); return new Set(drawn); };
{
  const st = W();
  const hidden = unknownHidden(st);
  const id = hidden.sort((a, b) => st.grid.distance(a, hub(st).tile) - st.grid.distance(b, hub(st).tile))[0];
  const t = st.tiles[id], name = t.loc.name;
  check(!siteKnown(st, id) && !knownLoc(st, id), `${name} (${t.loc.type}) is unknown at the start`);
  check(tileLabel(st, id) !== name && /\(\d+,\d+\)/.test(tileLabel(st, id)), `tileLabel names the ground ("${tileLabel(st, id)}")`);
  check(!R.tileTooltip(st, id).includes(name) && !R.tileTooltip(st, id).includes(LOCATIONS[t.loc.type].name), "the tooltip shows bare ground");
  let panel = "";
  try { panel = UI.renderRight(st, { selected: id }); } catch (e) { panel = `error ${e.message}`; }
  check(!panel.includes(name) && !panel.startsWith("error"), "the tile panel shows bare ground");
  check(!UI.tileActions(st, id).some(([m]) => m === "scavenge"), "no Scavenge / raid among the right-click actions");
  check(R.mapLoc(st, id) === null, "the map's site lookup gives nothing");
  check(!nearbySites(st, { center: id, radius: 3 }).some((s) => s.tile === id), "not among the planner's nearby sites");
  const need = crewAI.needs(st, "balanced");
  check(crewAI.siteScore(st, id, need, "balanced") === null, "the autopilot's (and crews') site score refuses it");
  // The real renderer, centered on each unknown hidden site in turn: none of their names is drawn.
  let leaked = 0;
  const names = new Set(hidden.map((x) => st.tiles[x].loc.name));
  for (const x of hidden.slice(0, 40)) for (const s of namesDrawn(st, x)) if (names.has(s)) leaked++;
  check(leaked === 0, `the map draws none of the ${names.size} unknown hidden sites' names (${leaked} drawn)`);
  // A public site nearby (in the countryside, away from other names) is drawn (the check can see a name).
  const pubNear = st.tiles.filter((x) => x.loc && isPublicSite(st, x.id) && x.loc.zone === "rural" && !st.bases.some((b) => b.tile === x.id) && !st.factions.some((f) => f.bases.includes(x.id)))
    .sort((a, b) => st.grid.distance(a.id, id) - st.grid.distance(b.id, id))[0];
  const seenPub = namesDrawn(st, pubNear.id);
  check([...seenPub].some((s) => pubNear.loc.name.endsWith(s)), `a public site is drawn with its name (${pubNear.loc.name})`);
  // Dev Reveal shows it; turning it off hides it again.
  R.view.devReveal = true;
  check(R.mapLoc(st, id) === t.loc && namesDrawn(st, id).has(name), "Dev Reveal draws it");
  R.view.devReveal = false;
  check(!namesDrawn(st, id).has(name), "and hides it again when switched off");
  // Found: drawn, named, listed and scored.
  st.knowledge[id] = snapshot(st, id);
  check(siteKnown(st, id) && tileLabel(st, id) === name && R.tileTooltip(st, id).includes(name) && R.mapLoc(st, id) === t.loc, "once known it is named in labels and the tooltip");
  check(namesDrawn(st, id).has(name), "once known the map draws it with its name");
  check(nearbySites(st, { center: id, radius: 3 }).some((s) => s.tile === id) || (t.loot || 0) < 0.2, "once known the planner lists it");
  // A team in the field that has seen it knows it before the hub does.
  const st2 = W();
  const h2 = hub(st2);
  const res = launchExpedition(st2, { memberIds: atBase(st2, h2.id).slice(0, 2).map((s) => s.id), dest: id, mission: "move", stance: "normal", supplies: { food: 6, water: 6 } });
  if (check(!res.error, `a team can be sent to the tile (${res.error || "ok"})`)) {
    const p = res.party;
    p.seen.set(id, snapshot(st2, id));
    check(!siteKnown(st2, id) && siteKnownTo(st2, id, p) && tileLabel(st2, id) === name, "a team that saw it knows it (and names it) before it reports in");
    check(nearbySites(st2, { center: id, radius: 3, p }).some((s) => s.tile === id) || (t.loot || 0) < 0.2, "the team's own nearby-sites step may pick it");
  }
}

// ---------- 3. discovery routes ----------
console.log("Discovery routes");
// A world with a radio at the hub and every group known (diplotest's setup), groups' main bases moved into reach.
function radioWorld(s = seed) {
  const st = W(s);
  const h = hub(st);
  addBuilding(h, "radio");
  h.radio = true;
  Object.assign(h.stock, { food: 500, water: 200, meds: 80, ammo: 600, scrap: 200, fuel: 60, parts: 10 });
  for (const f of st.factions) { f.known = true; f.goodwill = 40; }
  D.ensureDiplo(st);
  st.cards.length = 0;
  return st;
}
// The unknown hidden site nearest to tile (optionally with a free tile next to it for a group's base).
const nearestHidden = (st, tile, max = 99) => unknownHidden(st).filter((id) => st.grid.distance(id, tile) <= max).sort((a, b) => st.grid.distance(a, tile) - st.grid.distance(b, tile))[0];
function route(name, fn) {
  try {
    const r = fn();
    if (!r) return check(false, `${name}: could not be set up`);
    const { st, id, m, word } = r;
    discoveryHour(st);
    const lines = st.log.filter((l) => !m.has(l)).filter((l) => /🧭/.test(l.text || ""));
    const got = siteKnown(st, id);
    check(got, `${name}: ${st.tiles[id].loc.name} is on the map`);
    check(lines.length === 1 && lines[0].text.includes(st.tiles[id].loc.name) && (!word || word.test(lines[0].text)), `${name}: one log line (${lines.map((l) => l.text).join(" | ") || "none"})`);
    console.log(`  ${name}: ${lines[0] ? lines[0].text : "(no line)"}`);
    // Stays known; announced once.
    for (let i = 0; i < 6; i++) tickHour(st);
    st.cards.length = 0;
    check(siteKnown(st, id) && st.log.filter((l) => !m.has(l)).filter((l) => (l.text || "").includes(`: ${st.tiles[id].loc.name}`) && /🧭/.test(l.text)).length <= 1, `${name}: stays on the map, announced once`);
    return true;
  } catch (e) {
    return check(false, `${name}: ${e.stack.split("\n").slice(0, 3).join(" | ")}`);
  }
}
route("seen from a base", () => {
  const st = W();
  const id = nearestHidden(st, hub(st).tile);
  const spot = st.grid.within(id, 2).find((t) => free(st, t));
  if (spot == null) return null;
  const m = new Set(st.log);
  st.bases.push({ id: 9999, tile: spot, type: "outpost", name: "Test Outpost", stock: {}, buildings: [], construction: [], armory: [], watchtower: false });
  updateVision(st);
  st.bases.pop();
  updateVision(st);
  return { st, id, m, word: /Lookouts at Test Outpost spotted/ };
});
route("a team's sight, radioed in", () => {
  const st = radioWorld();
  const h = hub(st);
  const id = nearestHidden(st, h.tile, 10);
  if (id == null) return null;
  const res = launchExpedition(st, { memberIds: atBase(st, h.id).slice(0, 2).map((s) => s.id), dest: id, mission: "move", stance: "normal", supplies: { food: 10, water: 10 } });
  if (res.error) return null;
  const m = new Set(st.log);
  for (let i = 0; i < 24 * 6 && !siteKnown(st, id); i++) { tickHour(st); st.cards.length = 0; }
  return { st, id, m, word: /team \(.*\) (found|brought word of)/ };
});
route("a team's sight, brought home", () => {
  const st = W();
  const h = hub(st);
  const id = nearestHidden(st, h.tile, 14);
  if (id == null) return null;
  const res = launchExpedition(st, { memberIds: atBase(st, h.id).slice(0, 2).map((s) => s.id), dest: id, mission: "move", stance: "normal", supplies: { food: 12, water: 12 } });
  if (res.error) return null;
  const p = res.party;
  for (let i = 0; i < 24 * 8 && !(p.seen.has(id)); i++) { tickHour(st); st.cards.length = 0; }
  if (!check(p.seen.has(id) && !siteKnown(st, id), "out of radio range the team has seen it but the hub's map does not show it yet")) return null;
  const m = new Set(st.log);
  p.path = [partyTile(p), h.tile]; p.idx = 1; // home now: the report comes with it
  mergeKnowledge(st, p.seen, p.spotted, p);
  return { st, id, m, word: /team \(.*\) brought word of/ };
});
route("radio news", () => {
  const st = radioWorld();
  const h = hub(st);
  const id = nearestHidden(st, h.tile, 11);
  const f = st.factions.find((x) => x.alive);
  const spot = id != null ? st.grid.within(id, 1).find((t) => free(st, t) && planPath(st, t, h.tile, false)) : null;
  if (spot == null) return null;
  f.bases.unshift(spot);
  recomputeOwnership(st);
  if (!canRadioGroup(st, f)) return null;
  const m = new Set(st.log);
  radioNews(st, f);
  return { st, id, m, word: /Word reached you|Reports mapped/ };
});
route("an explorer's map", () => {
  const st = W();
  const id = nearestHidden(st, hub(st).tile);
  const m = new Set(st.log);
  giveIntel(st, { trail: [id], trailHours: [st.hour] }, 1, null);
  return { st, id, m, word: /Word reached you/ };
});
route("intel bought (tiles paid for)", () => {
  // trade.js executeTrade writes the paid-for tiles as knowledge (tradetest checks the area); the same write here.
  const st = W();
  const id = nearestHidden(st, hub(st).tile);
  const m = new Set(st.log);
  for (const t of st.grid.within(id, 3)) st.knowledge[t] = snapshot(st, t);
  return { st, id, m, word: /Word reached you|Reports mapped/ };
});
route("a prisoner questioned", () => {
  const st = W();
  const f = st.factions.find((x) => x.alive);
  // Their camp stands on a hidden site (an off-road lodge, say): the prisoner gives it away.
  const id = nearestHidden(st, f.bases[0]);
  if (id == null) return null;
  f.bases.unshift(id);
  recomputeOwnership(st);
  const m = new Set(st.log);
  gatherIntel(st, { factionId: f.id, tile: id, name: "Prisoner", group: f.name }, true);
  return { st, id, m, word: /Word reached you|Reports mapped/ };
});
route("the coalition's reports", () => {
  const st = radioWorld();
  const f = st.factions.find((x) => x.alive);
  const id = nearestHidden(st, f.bases[0], 99);
  const spot = st.grid.within(id, 1).find((t) => free(st, t));
  if (spot == null) return null;
  f.bases.unshift(spot);
  recomputeOwnership(st);
  A.ensureAlliance(st);
  st.alliance.members = [f.id];
  f.pact = "trade";
  f.goodwill = 60;
  if (!A.isMember(st, f)) return null;
  const m = new Set(st.log);
  st.hour += 24;
  A.allianceDaily(st);
  st.cards.length = 0;
  return { st, id, m, word: /Word reached you|Reports mapped/ };
});
route("a retrieve job's pick-up place", () => {
  const st = radioWorld();
  for (const f of st.factions.filter((x) => x.alive)) {
    const job = J.makeJob(st, f, "radio", "retrieve");
    if (!job) continue;
    const site = job.data.site;
    if (siteKnown(st, site) || isPublicSite(st, site)) { job.status = "expired"; continue; }
    const m = new Set(st.log);
    const r = J.acceptJob(st, job.id);
    if (!/accepted/i.test(r)) return null;
    return { st, id: site, m, word: /Word reached you/ };
  }
  return null;
});

// ---------- 4. save / load and determinism ----------
console.log("Save, load, determinism");
{
  const a = W(seed + 1);
  setAutopilot(a, true, "balanced");
  for (let i = 0; i < 24 * 40; i++) { tickHour(a); }
  a.cards.length = 0;
  const known = hiddenSites(a).filter((id) => siteKnown(a, id));
  check(known.length > 0 && a.foundSites.length === known.length, `after 40 days ${known.length} hidden sites found, all announced (foundSites ${a.foundSites.length})`);
  const b = deserializeState(JSON.parse(JSON.stringify(serializeState(a))));
  check(hiddenSites(b).filter((id) => siteKnown(b, id)).join() === known.join() && b.foundSites.join() === a.foundSites.join(), "a loaded save knows the same sites and has announced the same");
  const n0 = new Set(b.log);
  tickHour(b);
  check(!b.log.filter((l) => !n0.has(l)).some((l) => /🧭/.test(l.text || "") && known.some((id) => (l.text || "").includes(b.tiles[id].loc.name))), "nothing is announced again after loading");
  // An old save without foundSites: worked out quietly from the knowledge.
  delete b.foundSites;
  const n1 = new Set(b.log);
  discoveryHour(b);
  check(b.foundSites && b.foundSites.length >= known.length && !b.log.filter((l) => !n1.has(l)).some((l) => /🧭/.test(l.text || "")), "a save from before hidden sites announces nothing on load");
  // The same seed plays the same.
  const c = W(seed + 1);
  setAutopilot(c, true, "balanced");
  for (let i = 0; i < 24 * 40; i++) tickHour(c);
  check(c.foundSites.join() === a.foundSites.join() && c.log.map((l) => l.text).join("\n") === a.log.map((l) => l.text).join("\n"), "the same seed finds the same sites in the same order with the same log");
}

// ---------- 5. autopilot: never targets an undiscovered site; how fast it finds them ----------
console.log(`Autopilot (${days} days, ${runs} seed${runs === 1 ? "" : "s"} per style)`);
const rows = [];
for (const style of ["cautious", "balanced", "aggressive"]) {
  for (let r = 0; r < runs; r++) {
    const s = seed + 10 + r;
    const st = W(s);
    setAutopilot(st, true, style);
    const h = hub(st);
    const hidden = hiddenSites(st);
    const near = hidden.filter((id) => st.grid.distance(id, h.tile) <= 12);
    const foundDay = new Map();
    const lastDest = new Map();
    let bad = 0, sent = 0, toFound = 0;
    try {
      while (day(st) <= days && !st.gameOver) {
        tickHour(st);
        for (const id of hidden) if (!foundDay.has(id) && siteKnown(st, id)) foundDay.set(id, day(st));
        for (const p of st.parties) {
          if (p.owner !== "player" || p.kind === "convoy") continue;
          const targets = [p.dest, ...(p.orders || []).filter((o) => o.type === "mission" && (o.mission === "scavenge")).map((o) => o.at ?? o.tile)];
          const key = targets.join(",") + p.mission;
          if (lastDest.get(p.id) === key) continue;
          lastDest.set(p.id, key);
          for (const tid of targets) {
            const t = tid != null ? st.tiles[tid] : null;
            if (!t || !t.loc || isPublicSite(st, tid)) continue;
            if (p.mission !== "scavenge" && tid === p.dest) continue; // a move or a job to that tile, not a raid on the site
            sent++;
            if (!siteKnownTo(st, tid, p)) { bad++; if (bad <= 3) console.log(`  FAIL: day ${day(st)} ${style} seed ${s}: team ${p.id} sent to scavenge ${t.loc.name}, not found yet`); }
            else if (foundDay.has(tid)) toFound++;
          }
        }
      }
    } catch (e) { check(false, `${style} seed ${s}: crash ${e.stack.split("\n").slice(0, 3).join(" | ")}`); }
    check(bad === 0, `${style} seed ${s}: no team sent to scavenge an undiscovered site (${sent} raids on hidden sites after they were found)`);
    const by = (d, list) => list.filter((id) => foundDay.has(id) && foundDay.get(id) <= d).length;
    rows.push({ style, s, hidden: hidden.length, near: near.length, n30: by(30, near), n90: by(90, near), nEnd: by(days, near), all30: by(30, hidden), all90: by(90, hidden), allEnd: by(days, hidden), raids: sent, day: Math.min(day(st), days) });
  }
}
console.log("  style       seed  hidden  near hub (≤12): found by day 30 / 90 / end   all: by day 30 / 90 / end   raids on found hidden sites");
for (const r of rows) console.log(`  ${r.style.padEnd(11)} ${String(r.s).padStart(4)}  ${String(r.hidden).padStart(6)}  ${String(r.near).padStart(4)}: ${r.n30} / ${r.n90} / ${r.nEnd}${" ".repeat(24)}${r.all30} / ${r.all90} / ${r.allEnd}${" ".repeat(18)}${r.raids}`);
const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
console.log(`  total: near the hub ${sum("n30")}/${sum("near")} by day 30, ${sum("n90")}/${sum("near")} by day 90, ${sum("nEnd")}/${sum("near")} by day ${days}; all ${sum("all30")}/${sum("hidden")}, ${sum("all90")}/${sum("hidden")}, ${sum("allEnd")}/${sum("hidden")}`);

console.log(`\n${passes} passed, ${fails} failed.`);
if (fails) process.exit(1);
