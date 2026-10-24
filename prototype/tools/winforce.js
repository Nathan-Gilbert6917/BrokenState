// The forced endings (not natural play: the setup is rigged, the rules are the game's), shared by tools/wintest.js
// (which checks them) and tools/wincensus.js --force (which prints one). Each starts on seed 1 with the Balanced
// autopilot 30 days in and the eras' clocks off (forcedStart), then forcedPlay rigs and plays one ending:
// hive: every hive but the one nearest the hub is removed and no site is under way; six well-armed fighters join the
//   hub and are sent on a real Destroy hive mission to the last one (guard cut to 40). The governor answers the hive
//   card and the battle is played out.
// alliance: every living group put in the coalition (pact, goodwill 80, a year in), outposts placed until the
//   coalition holds over the land it needs, then every hive destroyed in the same breath.
// conquest: every group but two broken by taking its bases (conquest.js captureBase), then as alliance: the
//   coalition's victory after a conquest.
// keep: the hive victory first, "Keep playing" (as main.js), then the coalition set up as above: the coalition
//   victory after a hive victory.
// loss: everyone dies.
import { food, setFood } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, tickHour, day, alive, hub, killSurvivor, makeSurvivor, newId, snapshot } from "../src/sim/world.js";
import { launchExpedition, outpostName } from "../src/sim/parties.js";
import { finishChronicle } from "../src/sim/chronicle.js";
import { GEAR } from "../src/sim/data.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { destroyHive, ensureHives } from "../src/sim/hives.js";
import { goalsProgress, ensureAlliance, ALLIANCE, controlledLand, landCentres } from "../src/sim/alliance.js";
import { captureBase } from "../src/sim/conquest.js";

export const FACTIONS = 8;
export const FORCED = ["hive", "alliance", "conquest", "keep", "loss"];

function forcedOutposts(state) {
  // Outposts (staffed by two new people each) on the land the coalition does not hold yet, the best gain first.
  const g = state.grid;
  let added = 0;
  while (controlledLand(state).pct <= ALLIANCE.LAND_NEEDED && added < 40) {
    const held = new Uint8Array(state.tiles.length);
    for (const c of landCentres(state)) for (const id of g.within(c.tile, c.r)) held[id] = 1;
    let best = null;
    for (const t of state.tiles) {
      if (t.terrain === "water" || t.hive || held[t.id] || state.factions.some((f) => f.bases.includes(t.id))) continue;
      const gain = g.within(t.id, ALLIANCE.CONTROL_RANGE).filter((id) => !held[id] && state.tiles[id].terrain !== "water").length;
      if (!best || gain > best.gain) best = { t, gain };
    }
    if (!best) break;
    const base = { id: newId(), tile: best.t.id, type: "outpost", name: outpostName(state, best.t.id),
      stock: { food: 60, water: 40, fuel: 0, meds: 2, ammo: 20, parts: 0, scrap: 10, preserved: 0, jars: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
    state.bases.push(base);
    for (let i = 0; i < 2; i++) { const p = makeSurvivor(state, 0.9); p.location = { kind: "base", baseId: base.id }; p.role = "farm"; state.survivors.push(p); }
    added++;
  }
  return added;
}
function forcedCoalition(state) {
  const A = ensureAlliance(state);
  // Members a year in the coalition (alliance.js memberLand: a member's land counts after LAND_AFTER days at peace).
  for (const f of state.factions) if (f.alive) { f.known = true; f.pact = "trade"; f.goodwill = 80; if (!A.members.includes(f.id)) A.members.push(f.id); A.joined[f.id] = Math.min(A.joined[f.id] ?? Infinity, day(state) - ALLIANCE.LAND_AFTER); }
  if (A.founded == null) A.founded = day(state);
  return forcedOutposts(state);
}
function forcedStorm(state) {
  ensureHives(state);
  const h = hub(state);
  state.hiveSites.length = 0; // no new hive under way
  const last = [...state.hives].sort((a, b) => state.grid.distance(a.tile, h.tile) - state.grid.distance(b.tile, h.tile))[0];
  for (const hv of [...state.hives]) if (hv !== last) destroyHive(state, hv, "(forced by the test)");
  for (const hd of state.hordes) if (hd.hive === last.id && hd.role === "guard") hd.size = Math.min(hd.size, 40);
  state.knowledge[last.tile] = snapshot(state, last.tile);
  const squad = [];
  for (let i = 0; i < 6; i++) {
    const p = makeSurvivor(state, 1);
    p.traits = []; p.skills.shooting = 10; p.health = 100;
    p.gear.weapon = { key: "shotgun", name: GEAR.shotgun.name, quality: 1 };
    p.gear.armor = { key: "vest", name: GEAR.vest.name, quality: 1 };
    p.location = { kind: "base", baseId: h.id };
    state.survivors.push(p);
    squad.push(p);
  }
  h.stock.ammo = Math.max(h.stock.ammo || 0, 200); setFood(h, Math.max(food(h) || 0, 100)); h.stock.water = Math.max(h.stock.water || 0, 80);
  const res = launchExpedition(state, { memberIds: squad.map((p) => p.id), dest: last.tile, mission: "hive", stance: "normal", supplies: { food: 30, water: 30, ammo: 150, meds: 4 } });
  if (res.error) throw new Error(`forced storm: ${res.error}`);
  // Into the hive at once (autopilot.js hiveChoice: a crawl trip), the core taken at the odds it wants: the planner's own
  // gate for a storm (stormRatio, with the core's bosses by the numbers fitted to the map since 2026-10-09) is stricter.
  res.party.apCrawlTrip = true;
  return last;
}

// Seed 1, Balanced autopilot, played to day 30 with the eras' clocks (eras.js: no victory before year 10, the Accord,
// the containment) skipped: the scenarios check the paths, not the pacing (tools/eratest.js checks those).
export function forcedStart(seed = 1) {
  const state = createWorld({ seed, factionCount: FACTIONS });
  state.started = true;
  state.erasOff = true;
  setAutopilot(state, true, "balanced");
  while (day(state) < 30 && !state.gameOver) tickHour(state);
  return state;
}

// Rig and play one ending on a started world (forcedStart's, or a load of it). What it ended as, for the caller to check.
export async function forcedPlay(state, kind) {
  if (!FORCED.includes(kind)) throw new Error(`unknown forced scenario "${kind}" (${FORCED.join(", ")})`);
  const notes = [];
  let keptAt = null, broken = 0;
  if (kind === "loss") {
    for (const p of alive(state)) killSurvivor(state, p, null, "in a forced test");
  } else {
    if (kind === "alliance" || kind === "conquest") {
      // The coalition is its own victory now: no hive needs to fall.
      if (kind === "conquest") {
        for (const f of state.factions.filter((x) => x.alive).slice(2)) { for (const t of [...f.bases]) if (f.alive) captureBase(state, f, t, null, {}); broken++; }
        notes.push(`${broken} groups broken by taking their bases (${state.bases.filter((b) => b.captured).length} captured bases)`);
      }
      // 2026-10-13: the coalition wins only with no hive standing and no group outside it: the coalition is set up
      // first, then the hives go in the same breath (a hive victory would otherwise come first, on the next hour).
      const placed = forcedCoalition(state);
      const hivesDown = (state.hives || []).length;
      for (const hv of [...state.hives]) destroyHive(state, hv, "(forced by the test)");
      state.hiveSites.length = 0;
      notes.push(`${placed} outposts placed, every group left in the coalition; then ${hivesDown} hives destroyed`);
      for (let i = 0; i < 48 && !state.gameOver; i++) tickHour(state);
    } else {
      const last = forcedStorm(state);
      notes.push(`last hive: ${last.name}, ${state.grid.distance(last.tile, hub(state).tile)} tiles from the hub`);
      while (!state.gameOver && day(state) < 150) tickHour(state); // a squad that turns back at the core goes again from the style's hiveFrom (balanced: day 90)
    }
    if (kind === "keep" && state.gameOver && state.victory) {
      keptAt = { day: day(state), reason: state.victoryReason };
      state.victoryKept = true; state.gameOver = false; // the victory screen's "Keep playing" (main.js)
      notes.push(`${forcedCoalition(state)} outposts placed after Keep playing, every group in the coalition`);
      for (let i = 0; i < 48 && !state.gameOver; i++) tickHour(state);
    }
  }
  for (let i = 0; i < 2 && !state.gameOver; i++) tickHour(state);
  const c = finishChronicle(state); // as the timelapse does when it opens
  const gp = goalsProgress(state);
  let screen = null, screenHtml = "";
  try {
    const ui = await import("../src/ui/ui.js");
    screenHtml = ui.renderModal(state, { started: true }) || "";
    screen = screenHtml ? (/<h1>([^<]*)<\/h1>/.exec(screenHtml) || [null, screenHtml.slice(0, 80)])[1] : "(no window)";
  } catch (e) { screen = `(not rendered headless: ${e.message.split("\n")[0]})`; }
  return {
    kind, day: day(state), gameOver: !!state.gameOver, victory: !!state.victory, reason: state.victoryReason || null, keptAt, notes,
    hivesWon: !!state.hivesWon, allianceWon: !!state.allianceWon, victoryKept: !!state.victoryKept, alive: alive(state).length,
    broken, captured: state.bases.filter((b) => b.captured).length, landPct: gp.alliance.land.pct, landNeeded: ALLIANCE.LAND_NEEDED,
    logLine: (state.log.find((l) => /^(Every hive is destroyed|The Calder Coalition holds|Every survivor is dead)/.test(l.text)) || {}).text || null,
    captions: c ? c.events.filter((e) => e.major && /won on day|has fallen on day|Calder Coalition holds|Every survivor is dead/.test(e.text)).map((e) => e.text) : [],
    caption: c ? (c.events.filter((e) => e.major && /won on day|has fallen on day|Calder Coalition holds|Every survivor is dead/.test(e.text)).slice(-1)[0] || {}).text || null : null,
    land: Math.round(gp.alliance.land.pct * 1000) / 10, members: gp.alliance.members, groups: gp.alliance.groups, hives: gp.hives.left, building: gp.hives.building, screen,
    screenBad: /NaN|undefined/.test(screenHtml), keepButton: /data-action="keepplaying"/.test(screenHtml),
    hiveLog: state.log.filter((l) => /hive|Destroy|crawl|brood|Hivemind|core/i.test(l.text) && !/^🤖 Campaign/.test(l.text)).slice(-16).map((l) => l.text),
  };
}

export async function forceScenario(kind) {
  return forcedPlay(forcedStart(), kind);
}
