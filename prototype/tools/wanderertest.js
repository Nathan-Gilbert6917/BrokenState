// People on the move (sim/wanderers.js) and the third side in battle (sim/thirdside.js), plus hardcore's loot
// (sim/hardcore-loot.js): the density by ground and mode, the cards (talk, gifts, recruits, hold-ups, a robbery, a
// squad), battles with neutrals and soldiers on the field and raid maps, the people you left (the daily simulation),
// building interiors, saves, and autopilot games in both modes with the numbers met per 10 trips and raids.
// Usage: node tools/wanderertest.js [games per mode] [days]   (default 4 games of 90 days; 0 skips the games)
import { createWorld, tickHour, day, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, partyMembers, planPath, partyTile } from "../src/sim/parties.js";
import { createBattle, autoPlayerTurn, runEnemyPhase, finishCombat, registerCombatHandler, damage, active } from "../src/sim/combat.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { HC_LOOT, hardcoreLootDaily } from "../src/sim/hardcore-loot.js";
import { hcEraOffset } from "../src/sim/hardcore-groups.js";
import { LOCATIONS } from "../src/sim/data.js";
import {
  WANDER, wanderers, roadChance, siteChance, modeFactor, wanderDensity, rollWanderer, siteRoll, siteWanderers, interiorOccupants,
  neutralCard, hostileCard, squadCard, wanderersDaily, wanderersAfterRaid, groupById, talkChance,
} from "../src/sim/wanderers.js";
import { thirdSideHit } from "../src/sim/thirdside.js";

const GAMES = Number(process.argv[2] ?? 4);
const DAYS = Number(process.argv[3] ?? 90);
let passes = 0, fails = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (ok) passes++; else fails++; };
const section = (t) => console.log(`\n== ${t}`);
const t0 = Date.now();
registerCombatHandler("wtest", () => {});
const r2 = (v) => Math.round(v * 100) / 100;
const pc = (v) => `${Math.round(v * 100)}%`;

// A team of three out of the hub (normal) on a tile.
function team(state, tile) {
  const h = hub(state);
  const crew = atBase(state, h.id).slice(0, 3).map((x) => x.id);
  const res = launchExpedition(state, { memberIds: crew, dest: tile, mission: "move", stance: "normal", supplies: { food: 12, water: 12, ammo: 40, meds: 2 } });
  const p = res.party;
  p.path = [h.tile, tile]; p.idx = 1; p.phase = "out";
  return p;
}
const cat = (state, t) => (t.loc ? (t.loc.type === "city" || LOCATIONS[t.loc.type]?.cat === "urban" ? "city" : LOCATIONS[t.loc.type]?.cat === "town" ? "town" : LOCATIONS[t.loc.type]?.cat === "rural" ? "rural" : "special") : "open");
// Plays a battle to its end with the AI on both sides.
function play(state, b, max = 120) {
  state.combat = b;
  for (let i = 0; i < max && !b.over; i++) { autoPlayerTurn(state); if (!b.over) runEnemyPhase(state); }
  return b;
}

// ---------- the density ----------
section("Density: the chance per tile entered on the road and per site visit");
{
  const n = createWorld({ seed: 4242, factionCount: 7 });
  const hc = createWorld({ seed: 4242, factionCount: 7, mode: "hardcore" });
  const byGround = (s) => {
    const out = {};
    for (const t of s.tiles) {
      const k = t.terrain === "water" ? null : `${t.terrain}${t.loc ? "+site" : ""}`;
      if (!k) continue;
      (out[k] = out[k] || []).push(roadChance(s, t.id, false));
    }
    return Object.fromEntries(Object.entries(out).map(([k, l]) => [k, l.reduce((a, v) => a + v, 0) / l.length]));
  };
  const g = byGround(n);
  console.log(`  normal, road, per tile (day, x100): ${Object.entries(g).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${r2(v * 100)}`).join(", ")}`);
  check(g.city > g.suburb && g.suburb > g.plains && g.plains > 0, "cities > suburbs > open country");
  const siteBy = (s) => {
    const out = {};
    for (const t of s.tiles) if (t.loc) (out[cat(s, t)] = out[cat(s, t)] || []).push(siteChance(s, t.id));
    return Object.fromEntries(Object.entries(out).map(([k, l]) => [k, l.reduce((a, v) => a + v, 0) / l.length]));
  };
  const sn = siteBy(n);
  console.log(`  normal, per site visit: ${Object.entries(sn).map(([k, v]) => `${k} ${pc(v)}`).join(", ")}`);
  check(sn.city > sn.town && sn.town > sn.rural, "city sites > town sites > rural sites");
  const days = [1, 14, 30, 60, 112, 200];
  console.log(`  hardcore factor by day: ${days.map((d) => `day ${d} ×${r2(modeFactor(hc, d))}`).join(", ")} (normal ×${modeFactor(n)})`);
  check(modeFactor(hc, 1) > 3 && modeFactor(hc, 30) > 1.7 && modeFactor(hc, 112) < 1.15 && modeFactor(n) === 1, "hardcore: about ×3 at first, near ×1 by a normal start; normal ×1");
}

// Expected encounters per 10 trips: out from the hub to a site of each kind and back (3–12 tiles), on foot, by day.
section("Expected meetings per 10 trips (there and back on foot, plus the site) and per 10 searches, by site kind");
{
  const rows = [];
  for (const mode of ["normal", "hardcore"]) for (const seed of [4242, 7, 99]) {
    const s = createWorld({ seed, factionCount: 7, mode });
    const from = mode === "normal" ? hub(s).tile : partyTile(roadTeam(s));
    const by = {};
    for (const t of s.tiles) {
      if (!t.loc) continue;
      const d = s.grid.distance(from, t.id);
      if (d < 3 || d > 12) continue;
      const r = planPath(s, from, t.id, false);
      if (!r) continue;
      const k = cat(s, t);
      (by[k] = by[k] || []).push({ path: r.path, site: t.id });
    }
    for (const dd of mode === "normal" ? [1] : [1, 14, 30, 60, 112]) {
      s.hour = (dd - 1) * 24 + 12;
      for (const [k, list] of Object.entries(by)) {
        let road = 0, site = 0;
        for (const { path, site: id } of list) {
          let none = 1;
          for (const id2 of [...path.slice(1), ...path.slice(0, -1)]) none *= 1 - roadChance(s, id2, false);
          road += 1 - none;
          site += siteChance(s, id);
        }
        rows.push({ mode, day: dd, k, road: road / list.length, site: site / list.length, n: list.length });
      }
    }
  }
  const agg = {};
  for (const r of rows) { const key = `${r.mode}|${r.day}|${r.k}`; const a = (agg[key] = agg[key] || { road: 0, site: 0, c: 0 }); a.road += r.road; a.site += r.site; a.c++; }
  for (const mode of ["normal", "hardcore"]) for (const dd of mode === "normal" ? [1] : [1, 14, 30, 60, 112]) {
    const line = ["city", "town", "rural", "special"].map((k) => { const a = agg[`${mode}|${dd}|${k}`]; return a ? `${k} ${r2((a.road / a.c) * 10)} road + ${r2((a.site / a.c) * 10)} at the site` : null; }).filter(Boolean).join("; ");
    console.log(`  ${mode}${mode === "hardcore" ? ` day ${dd}` : ""}: ${line}`);
  }
  const a = (m, d, k) => agg[`${m}|${d}|${k}`];
  check(a("normal", 1, "city").site > a("normal", 1, "rural").site, "normal: more at city sites than rural ones");
  check(a("hardcore", 1, "city").road > a("hardcore", 112, "city").road * 1.8, "hardcore: many more on the road in the first days than by a normal start");
}

// ---------- the dice ----------
section("Own dice: rolls never touch the world's random numbers");
{
  const s = createWorld({ seed: 77, factionCount: 7 });
  const p = team(s, hub(s).tile);
  const before = s.rng.state;
  let met = 0;
  for (let i = 0; i < 300; i++) {
    const t = s.tiles[(i * 37) % s.tiles.length];
    s.hour += 1;
    p.lastWander = null;
    const c = rollWanderer(s, p, t.id);
    if (c) { met++; break; }
  }
  // Up to the first meeting nothing drew from state.rng (the card itself is made from its own generator).
  check(s.rng.state === before, `${met ? "until a meeting" : "300 tiles, nobody met"}: state.rng untouched`);
  const s2 = createWorld({ seed: 77, factionCount: 7 });
  check(!s2.wanderers, "a fresh normal world has no wanderers state");
  s2.hour += 10;
  for (let i = 0; i < 40; i++) siteRoll(s2, s2.tiles.find((t) => t.loc && t.loc.type === "town").id);
  const r1 = JSON.stringify(siteRoll(s2, s2.tiles.find((t) => t.loc && t.loc.type === "town").id));
  check(r1 === JSON.stringify(siteRoll(s2, s2.tiles.find((t) => t.loc && t.loc.type === "town").id)), "a site's roll is the same for the same hour (raid map, interior and search agree)");
}

// ---------- the cards ----------
section("Cards: neutral survivors (talk, gift, recruit, leave)");
{
  const s = createWorld({ seed: 31, factionCount: 7 });
  const tile = s.tiles.find((t) => t.terrain === "suburb" && !s.bases.some((b) => b.tile === t.id)).id;
  const p = team(s, tile);
  // Force a neutral meeting on the road.
  const saved = { ...WANDER.KIND };
  Object.assign(WANDER.KIND, { neutral: 1, hostile: 0, military: 0 });
  const R = WANDER.ROAD, RM = WANDER.ROAD_MAX;
  WANDER.ROAD = 100; WANDER.ROAD_MAX = 1;
  let card = null;
  for (let i = 0; i < 5 && !card; i++) { s.hour++; p.lastWander = null; card = rollWanderer(s, p, tile); }
  check(!!card && /urvivor/.test(card.title) && card.choices.length === 3, `a neutral card: "${card && card.title}" (${card && card.choices.map((c) => c.label).join(" / ")})`);
  check(p.phase === "engaged", "the team stops for it");
  console.log(`  ${card && card.text}`);
  const g = s.wanderers.groups[0];
  check(!!g && g.people.length >= 1 && g.people.every((x) => !s.survivors.includes(x)), `the group is remembered (${g && g.people.length} people, ${g && g.mood}), not in your roster`);
  // Talk until they ask (fresh cards; the chance is on the card).
  let asked = null;
  for (let i = 0; i < 30 && !asked; i++) {
    const c2 = neutralCard(s, p, g, {});
    s.cards.length = 0;
    c2.choices[0].resolve(s);
    asked = s.cards.find((c) => c.recruit);
  }
  check(!!asked && asked.recruit.partyId === p.id, `talking: a recruit card for the team (chance ${pc(talkChance(s, p, g))}, ${pc(talkChance(s, p, g, true))} with a gift)`);
  const take = asked && asked.choices.find((c) => c.kind === "take");
  const before = partyMembers(s, p).length;
  if (take && !(take.disabled && take.disabled(s))) take.resolve(s);
  else { p.supplies.food = 60; p.supplies.water = 60; asked.choices.find((c) => c.kind === "take").resolve(s); }
  check(partyMembers(s, p).length > before, `they join the team (${before} → ${partyMembers(s, p).length})`);
  wanderersDaily(s);
  check(!groupById(s, g.wid), "a group that joined you is no longer out there");
  // Leave a second group: it stays in the simulation and can be met again.
  s.hour += 30;
  p.lastWander = null;
  const c3 = rollWanderer(s, p, tile);
  const g2 = s.wanderers.groups[s.wanderers.groups.length - 1];
  c3.choices.find((c) => /^Leave/.test(c.label)).resolve(s);
  check(g2.met === 1 && p.phase !== "engaged", "left: remembered as met, the team goes on");
  s.hour += 30;
  WANDER.SIM.AGAIN_CHANCE = 1;
  p.lastWander = null;
  const c4 = rollWanderer(s, p, tile);
  check(!!c4 && /again/.test(c4.text), `met again near where they were: "${c4 && c4.text.split(".")[0]}"`);
  WANDER.SIM.AGAIN_CHANCE = 0.6;
  // A gift: costs the team food and water.
  const food = p.supplies.food;
  const c5 = neutralCard(s, p, g2, {});
  c5.choices[1].resolve(s);
  check(p.supplies.food < food, "a gift of food and water is paid from what the team carries");
  Object.assign(WANDER.KIND, saved);
  WANDER.ROAD = R; WANDER.ROAD_MAX = RM;
}

section("Cards: armed strangers (hand over, talk, run, fight), a robbery, a military squad");
{
  const s = createWorld({ seed: 55, factionCount: 7 });
  const tile = s.tiles.find((t) => t.terrain === "city").id;
  const p = team(s, tile);
  const c = hostileCard(s, p, 3, {});
  check(c.choices.map((x) => x.label).join("/") === "Hand over some of what you carry/Talk them down/Run for it/Fight", `hold-up choices: ${c.choices.map((x) => x.label).join(" / ")}`);
  const food = p.supplies.food;
  c.choices[0].resolve(s);
  check(p.supplies.food < food && p.phase !== "engaged", `handing over takes about ${pc(WANDER.ROB_SHARE)} (food ${food} → ${p.supplies.food}) and the team goes on`);
  const c2 = hostileCard(s, p, 3, {});
  s.cards.length = 0;
  c2.choices.find((x) => x.label === "Fight").resolve(s);
  check(s.cards.some((x) => x.title === "After the fight") || !s.parties.includes(p), "a fight by the numbers ends in the usual After the fight card");
  check((s.wanderers.stats["fight-victory"] || 0) + (s.wanderers.stats["fight-defeat"] || 0) + (s.wanderers.stats["fight-retreat"] || 0) === 1, "the fight is counted");
  // A hostile military stops you like a checkpoint (conflicts.js).
  const mil = s.factions.find((f) => f.type === "military") || s.factions[0];
  const was = { type: mil.type, gw: mil.goodwill };
  mil.type = "military"; mil.goodwill = -90;
  const near = s.grid.within(mil.bases[0], 3).find((id) => s.tiles[id].terrain !== "water" && !s.bases.some((b) => b.tile === id) && id !== mil.bases[0]);
  const q = team(s, near);
  const kind = { ...WANDER.KIND }, R = WANDER.ROAD, RM = WANDER.ROAD_MAX;
  Object.assign(WANDER.KIND, { neutral: 0, hostile: 0, military: 1 });
  WANDER.ROAD = 100; WANDER.ROAD_MAX = 1;
  s.cards.length = 0;
  s.hour += 1;
  const none = rollWanderer(s, q, near);
  check(none === null && s.cards.some((x) => x.title === "Checkpoint"), "a hostile military's squad: a checkpoint card (conflicts.js)");
  mil.goodwill = 20;
  s.cards.length = 0;
  let sq = null;
  for (let i = 0; i < 10 && !sq; i++) { s.hour += 11; q.lastWander = null; const cc = rollWanderer(s, q, near); if (cc && /squad|Soldiers/.test(cc.title)) sq = cc; }
  check(!!sq, `a friendly squad: "${sq && sq.title}" (${sq && sq.choices.map((x) => x.label).join(" / ")})`);
  const gw = mil.goodwill;
  const news = squadCard(s, q, mil, 4, {});
  news.choices[0].resolve(s);
  check(mil.goodwill > gw, `sharing news: goodwill ${gw} → ${mil.goodwill}`);
  const atk = squadCard(s, q, mil, 4, {});
  const gw2 = mil.goodwill;
  atk.choices.find((x) => /Open fire/.test(x.label)).resolve(s);
  check(mil.goodwill <= gw2 + WANDER.GW_ATTACK, `opening fire on them: goodwill ${gw2} → ${mil.goodwill}`);
  Object.assign(WANDER.KIND, kind);
  WANDER.ROAD = R; WANDER.ROAD_MAX = RM;
  mil.type = was.type; mil.goodwill = was.gw;
}

// ---------- the battle map ----------
section("The third side on a field map: soldiers fighting the dead beside you");
{
  let shotYou = 0, shotDead = 0, turned = 0, fought = 0;
  for (let i = 0; i < 6; i++) {
    const s = createWorld({ seed: 600 + i, factionCount: 7 });
    const tile = s.tiles.find((t) => t.terrain === "suburb" && !s.bases.some((b) => b.tile === t.id)).id;
    const p = team(s, tile);
    const setup = { tile, partyId: p.id, enemy: { kind: "zombies", count: 10, power: 2, name: "the dead" }, ambush: "player", canRetreat: true, handler: "wtest",
      third: [{ side: "military", kind: "soldiers", count: 4, power: 5, name: "the squad", factionId: null }], context: {} };
    const b = play(s, createBattle(s, setup));
    const soldiers = b.units.filter((u) => u.team === "military");
    const mine = b.units.filter((u) => u.side === "player").map((u) => u.name);
    for (const l of b.log) {
      if (soldiers.some((u) => l.text.startsWith(`${u.name} shoots `) && mine.some((m) => l.text.includes(` shoots ${m}`)))) shotYou++;
      if (soldiers.some((u) => l.text.startsWith(`${u.name} shoots Zombie`) || l.text.startsWith(`${u.name} strikes Zombie`))) shotDead++;
    }
    if (b.result && b.result.third && b.result.third[0].hostile) turned++;
    if (b.over) fought++;
    finishCombat(s, setup, b.result);
  }
  check(fought === 6, `6 battles played to the end`);
  check(shotDead > 0, `the soldiers fire on the dead (${shotDead} shots and blows)`);
  check(shotYou === 0 && turned === 0, "the soldiers never fire on your people, and your AI never fires on them");
  // Fire on one: every soldier turns.
  const s = createWorld({ seed: 611, factionCount: 7 });
  const tile = s.tiles.find((t) => t.terrain === "plains" && !s.bases.some((b) => b.tile === t.id)).id;
  const p = team(s, tile);
  const setup = { tile, partyId: p.id, enemy: { kind: "zombies", count: 4, power: 2 }, ambush: null, canRetreat: true, handler: "wtest", third: [{ side: "military", kind: "soldiers", count: 3, power: 5, name: "the squad" }], context: {} };
  const b = createBattle(s, setup);
  s.combat = b;
  const me = b.units.find((u) => u.side === "player");
  const sol = b.units.find((u) => u.team === "military");
  damage(b, sol, 5, me);
  check(b.units.filter((u) => u.team === "military").every((u) => u.side === "enemy"), "firing on one soldier turns the whole squad on you");
  play(s, b);
  check(b.over && b.result.third && b.result.third[0].hostile, `the result says so (${b.result.outcome}, ${b.result.enemiesKilled} of them down)`);
}

section("The third side on a field map: a robbery, the travellers defend themselves");
{
  let ok = 0, alive = 0, start = 0, turned = 0;
  for (let i = 0; i < 6; i++) {
    const s = createWorld({ seed: 700 + i, factionCount: 7 });
    const tile = s.tiles.find((t) => t.terrain === "plains" && !s.bases.some((b) => b.tile === t.id)).id;
    const p = team(s, tile);
    const setup = { tile, partyId: p.id, enemy: { kind: "survivors", count: 3, power: 2.8, name: "the armed strangers" }, ambush: "player", canRetreat: true, handler: "wtest",
      third: [{ side: "neutral", kind: "survivors", count: 2, power: 2.2, name: "the travellers", people: [{ name: "Ann Reyes", weapon: "knife" }, { name: "Bo Reyes", weapon: "fists" }] }], context: {} };
    const b = play(s, createBattle(s, setup));
    if (b.over) ok++;
    const r = b.result.third[0];
    alive += r.alive; start += r.start;
    if (r.hostile) turned++;
    finishCombat(s, setup, b.result);
  }
  check(ok === 6 && turned === 0, `6 robberies fought; your AI never turned on the travellers`);
  console.log(`  travellers alive after the fight: ${alive} of ${start}`);
}

section("The third side on the raid map: survivors hiding, a squad clearing the place");
{
  let met = 0, cards = 0, hostile = 0, raids = 0, squadMet = 0;
  for (let i = 0; i < 8; i++) {
    const s = createWorld({ seed: 800 + i, factionCount: 7 });
    wanderers(s);
    const tile = s.tiles.find((t) => t.loc && t.loc.type === "town").id;
    const p = team(s, tile);
    p.phase = "engaged";
    // Force someone here: a neutral group (and a squad on even seeds).
    const kind = { ...WANDER.KIND }, S = WANDER.SITE, SM = WANDER.SITE_MAX;
    Object.assign(WANDER.KIND, i % 2 ? { neutral: 1, hostile: 0, military: 0 } : { neutral: 0, hostile: 0, military: 1 });
    WANDER.SITE = 100; WANDER.SITE_MAX = 1;
    const mil = s.factions.find((f) => f.type === "military");
    if (mil) { mil.bases = [s.grid.within(tile, 4).find((id) => id !== tile && s.tiles[id].terrain !== "water") ?? tile]; mil.goodwill = 20; }
    const groups = raidEnemies(s, tile);
    Object.assign(WANDER.KIND, kind);
    WANDER.SITE = S; WANDER.SITE_MAX = SM;
    const third = groups.filter((g) => g.side);
    if (!third.length) continue;
    const setup = { mode: "raid", tile, partyId: p.id, canRetreat: true, ambush: null, handler: "wtest", enemy: { kind: "mixed", count: 1, power: 3, groups }, raid: { heat0: 5 }, context: {} };
    const b = play(s, createBattle(s, setup), 200);
    raids++;
    const r = b.result.third || [];
    if (r.some((x) => x.hostile)) hostile++;
    if (r.some((x) => x.team === "neutral" && x.met)) met++;
    if (r.some((x) => x.team === "military" && x.met)) squadMet++;
    s.cards.length = 0;
    finishCombat(s, setup, b.result);
    wanderersAfterRaid(s, p, b.result);
    if (s.cards.some((c) => /Survivors in/.test(c.title))) cards++;
  }
  check(raids >= 6, `${raids} raids with a third side on the map`);
  check(hostile === 0, "your raid AI never fires on them");
  console.log(`  neutrals found in ${met} raids (a card to talk to them after ${cards}); squads met in ${squadMet}`);
  check(cards === met, "every neutral group found (and alive) can be talked to after the raid");
}

section("Building interiors: a raid inside with survivors, a squad or squatters (buildingmaps.js → thirdside.js)");
{
  const TYPES = ["pharmacy", "police", "clinic", "gunstore", "grocery", "diner", "motel", "school", "hardware", "church", "autoshop", "apartments"];
  const seen = { neutral: 0, military: 0, hostile: 0 };
  let inside = 0, raids = 0, attackedYou = 0, turned = 0, soldierShots = 0, cards = 0, met = 0;
  for (let i = 0; i < 18; i++) {
    const s = createWorld({ seed: 900 + i, factionCount: 7 });
    wanderers(s);
    const h = hub(s);
    const tile = s.tiles.find((t) => t.loc && t.loc.type === TYPES[i % TYPES.length] && t.id !== h.tile && !s.factions.some((f) => f.bases.includes(t.id)));
    if (!tile) continue;
    const mil = s.factions.find((f) => f.type === "military");
    const side = ["neutral", mil ? "military" : "neutral", "hostile"][i % 3]; // no military group in this world: survivors
    const kind = { ...WANDER.KIND }, S = WANDER.SITE, SM = WANDER.SITE_MAX;
    Object.assign(WANDER.KIND, { neutral: side === "neutral" ? 1 : 0, hostile: side === "hostile" ? 1 : 0, military: side === "military" ? 1 : 0 });
    WANDER.SITE = 100; WANDER.SITE_MAX = 1;
    if (mil) { mil.bases = [s.grid.within(tile.id, 5).find((id) => id !== tile.id && s.tiles[id].terrain !== "water") ?? tile.id]; mil.goodwill = 20; }
    const crew = atBase(s, h.id).slice(0, 3).map((x) => x.id);
    const res = launchExpedition(s, { memberIds: crew, dest: tile.id, mission: "scavenge", stance: "normal", supplies: { food: 4, water: 4, ammo: 40, meds: 2 } });
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    const groups = raidEnemies(s, tile.id);
    const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "wtest", enemy: { kind: "mixed", count: 1, power: 3, groups }, raid: { heat0: 5 }, context: {} };
    const b = createBattle(s, setup);
    Object.assign(WANDER.KIND, kind);
    WANDER.SITE = S; WANDER.SITE_MAX = SM;
    if (!b.raid.plan) continue;
    raids++;
    const B = b.raid.plan.building;
    const inB = (u) => u.x >= B.x0 && u.x < B.x0 + B.w && u.y >= B.y0 && u.y < B.y0 + B.h;
    const third = b.units.filter((u) => u.side === "third");
    const squat = b.units.filter((u) => u.occupant === "hostile");
    if (side !== "hostile" && third.length && third.every(inB) && third.every((u) => u.team === side)) { inside++; seen[side]++; }
    if (side === "hostile" && squat.length && !third.length) { inside++; seen.hostile++; }
    const names3 = third.map((u) => u.name), mine = b.units.filter((u) => u.side === "player").map((u) => u.name);
    play(s, b, 200);
    for (const l of b.log) {
      if (names3.some((n) => l.text.startsWith(`${n} shoots `) || l.text.startsWith(`${n} strikes `)) && mine.some((m) => l.text.includes(` ${m}`))) attackedYou++;
      if (third.some((u) => u.team === "military" && (l.text.startsWith(`${u.name} shoots Zombie`) || l.text.startsWith(`${u.name} shoots Survivor`)))) soldierShots++;
    }
    const r = b.result.third || [];
    if (r.some((x) => x.hostile)) turned++;
    if (r.some((x) => x.team === "neutral" && x.met && x.alive)) met++;
    s.cards.length = 0;
    finishCombat(s, setup, b.result);
    wanderersAfterRaid(s, p, b.result);
    if (s.cards.some((c) => /Survivors in/.test(c.title))) cards++;
  }
  check(raids >= 12 && inside === raids, `${raids} raids inside a building: the people are there (${seen.neutral} with survivors in their room, ${seen.military} with a squad, ${seen.hostile} with squatters as guards)`);
  check(attackedYou === 0 && turned === 0, "the survivors and soldiers never attack your people, and your AI never attacks them");
  console.log(`  the soldiers shot at the dead or the squatters ${soldierShots} times; survivors found alive in ${met} raids, ${cards} talk cards after`);
  check(cards === met, "survivors found alive inside can be talked to after the raid");
}

section("Building interiors: interiorOccupants");
{
  const s = createWorld({ seed: 91, factionCount: 7 });
  const tile = s.tiles.find((t) => t.loc && t.loc.type === "city");
  const S = WANDER.SITE, SM = WANDER.SITE_MAX;
  WANDER.SITE = 100; WANDER.SITE_MAX = 1;
  const occ = interiorOccupants(s, tile, { type: "office", rooms: [{}, {}, {}] });
  WANDER.SITE = S; WANDER.SITE_MAX = SM;
  const g = occ[0];
  check(occ.length === 1 && ["neutral", "hostile", "military"].includes(g.side) && Array.isArray(g.people) && g.people.length === g.count && g.people.every((x) => x.kit && x.weapon), `one group: ${g.side}, ${g.count} people (${g.people.map((x) => x.weapon).join(", ")}), room ${g.room}`);
  check(JSON.stringify(interiorOccupants(s, tile.id, { rooms: [{}, {}, {}] })) === JSON.stringify(occ), "asked again (by id): the same people");
  check(interiorOccupants(s, s.tiles.find((t) => t.terrain === "water").id, {}).length === 0, "nobody on the water");
}

// ---------- the people you left ----------
section("The people you left: a light simulation, with no dice of the world's");
{
  const s = createWorld({ seed: 4040, factionCount: 7 });
  const S = WANDER.SITE, SM = WANDER.SITE_MAX, K = { ...WANDER.KIND };
  WANDER.SITE = 100; WANDER.SITE_MAX = 1;
  Object.assign(WANDER.KIND, { neutral: 1, hostile: 0, military: 0 });
  const sites = s.tiles.filter((t) => t.loc && !s.bases.some((b) => b.tile === t.id) && !s.factions.some((f) => f.bases.includes(t.id))).slice(0, 30);
  for (const t of sites) { s.hour += 1; siteRoll(s, t.id); }
  WANDER.SITE = S; WANDER.SITE_MAX = SM;
  Object.assign(WANDER.KIND, K);
  for (const g of s.wanderers.groups) g.met = 1;
  const n0 = s.wanderers.groups.length, people0 = s.wanderers.groups.reduce((a, g) => a + g.people.length, 0);
  const tiles0 = s.wanderers.groups.map((g) => g.tile).join();
  const rng0 = s.rng.state;
  for (let d = 0; d < 90; d++) { s.hour += 24; wanderersDaily(s); }
  const st = s.wanderers.stats;
  const n1 = s.wanderers.groups.length;
  console.log(`  ${n0} groups (${people0} people) after 90 days: ${n1} groups left; died ${st.died || 0}, joined a group ${st["joined-group"] || 0}, settled ${st.settled || 0}`);
  check(s.rng.state === rng0, "state.rng untouched");
  check(n1 < n0 && (st.died || 0) > 0, "some die, some move on");
  check(s.wanderers.groups.map((g) => g.tile).join() !== tiles0, "they wander");
  // A save keeps them.
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(s))));
  check(back.wanderers && back.wanderers.groups.length === n1 && back.wanderers.groups.every((g, i) => g.people.length === s.wanderers.groups[i].people.length), "save and load keep them");
}

// ---------- hardcore loot ----------
section("Hardcore: the buildings are only half picked over");
{
  const n = createWorld({ seed: 4242, factionCount: 7 });
  const h = createWorld({ seed: 4242, factionCount: 7, mode: "hardcore" });
  const sites = h.tiles.filter((t) => t.loc && t.lootNormal != null);
  const ratio = sites.reduce((a, t) => a + t.loot / t.lootNormal, 0) / sites.length;
  const nSum = n.tiles.filter((t) => t.loc).reduce((a, t) => a + t.loot, 0), hSum = h.tiles.filter((t) => t.loc).reduce((a, t) => a + t.loot, 0);
  check(Math.abs(ratio - HC_LOOT.START) < 0.01, `every site starts at ×${r2(ratio)} its normal-start loot (sites total ${r2(hSum)} vs ${r2(nSum)} in the normal world on the seed)`);
  check(n.tiles.every((t) => t.lootNormal == null), "a normal world has no surplus");
  const off = hcEraOffset(h);
  const pick = sites.filter((t) => t.loot - t.lootNormal > 0.2)[0];
  const extra0 = pick.loot - pick.lootNormal;
  // Day by day (the daily step alone: a whole world's days would only add time).
  const at = (d) => { while (day(h) < d) { h.hour += 24; hardcoreLootDaily(h); } return pick.lootNormal != null ? (pick.loot - pick.lootNormal) / extra0 : 0; };
  const mid = at(Math.round(off / 2));
  const end = at(off);
  console.log(`  a site's surplus left (untouched): ${pc(mid)} at day ${Math.round(off / 2)}, ${pc(end)} at day ${off} (the normal start)`);
  check(mid > 0.2 && mid < 0.45 && end < 0.15, "the surplus wears off to about a tenth by the day a normal game starts");
}

// ---------- games ----------
if (GAMES > 0) {
  section(`Autopilot games: ${GAMES} per mode, ${DAYS} days`);
  const sum = {};
  for (const mode of ["normal", "hardcore"]) {
    const agg = (sum[mode] = { tiles: 0, trips: 0, visits: 0, road: { neutral: 0, hostile: 0, military: 0 }, site: { neutral: 0, hostile: 0, military: 0 }, bucket: {}, asked: 0, joined: 0, fights: 0, crash: 0, robbery: 0, squadfight: 0 });
    for (let i = 0; i < GAMES; i++) {
      const s = createWorld({ seed: 5100 + i * 17, factionCount: 7, mode });
      s.started = true;
      wanderers(s); // count tiles and visits from the start
      setAutopilot(s, true, "balanced");
      let last = {};
      try {
        while (day(s) <= DAYS && !s.gameOver) {
          tickHour(s);
          if (s.hour % 24 === 0) {
            const st = s.wanderers.stats;
            const d = day(s) - 1;
            const bk = d <= 14 ? "1-14" : d <= 30 ? "15-30" : d <= 60 ? "31-60" : "61+";
            const b = (agg.bucket[bk] = agg.bucket[bk] || { tiles: 0, met: 0, visits: 0, site: 0 });
            const delta = (k) => (st[k] || 0) - (last[k] || 0);
            b.tiles += delta("road-tiles");
            b.met += delta("road-neutral") + delta("road-hostile") + delta("road-military");
            b.visits += delta("site-visits");
            b.site += delta("site-neutral") + delta("site-hostile") + delta("site-military");
            last = { ...st };
          }
        }
      } catch (e) { agg.crash++; console.log(`  ${mode} game ${i}: ${e.stack.split("\n").slice(0, 4).join(" | ")}`); }
      const st = s.wanderers.stats;
      agg.tiles += st["road-tiles"] || 0;
      agg.visits += st["site-visits"] || 0;
      agg.trips += s.governor ? s.governor.stats.launched : 0;
      for (const k of ["neutral", "hostile", "military"]) { agg.road[k] += st[`road-${k}`] || 0; agg.site[k] += st[`site-${k}`] || 0; }
      agg.asked += st.asked || 0;
      agg.robbery += st["road-robbery"] || 0;
      agg.squadfight += st["road-squadfight"] || 0;
      agg.fights += (st["fight-victory"] || 0) + (st["fight-defeat"] || 0) + (st["fight-retreat"] || 0);
      agg.joined += s.survivors.filter((x) => x.wanderer).length;
      (agg.ends = agg.ends || []).push(`day ${day(s)}${s.gameOver ? " (over)" : ""}, ${s.survivors.filter((x) => x.alive).length} alive, ${s.factions.filter((f) => f.alive && f.type === "military" && f.bases.length).length} military`);
    }
    const roadMet = agg.road.neutral + agg.road.hostile + agg.road.military;
    const siteMet = agg.site.neutral + agg.site.hostile + agg.site.military;
    console.log(`  ${mode} games: ${agg.ends.join("; ")}`);
    console.log(`  ${mode}: ${agg.trips} trips launched, ${agg.tiles} tiles walked, ${agg.visits} site visits`);
    console.log(`    road: ${roadMet} met (${agg.road.neutral} neutral, ${agg.road.hostile} aggressive [${agg.robbery} robbing others], ${agg.road.military} squads [${agg.squadfight} fighting the dead]) = ${r2((roadMet / Math.max(1, agg.tiles)) * 100)} per 100 tiles, ${r2((roadMet / Math.max(1, agg.trips)) * 10)} per 10 trips`);
    console.log(`    sites: ${siteMet} met (${agg.site.neutral} neutral, ${agg.site.hostile} aggressive, ${agg.site.military} squads) = ${r2((siteMet / Math.max(1, agg.visits)) * 10)} per 10 searches or raids`);
    console.log(`    by day: ${Object.entries(agg.bucket).map(([k, b]) => `days ${k}: ${r2((b.met / Math.max(1, b.tiles)) * 100)} per 100 tiles, ${r2((b.site / Math.max(1, b.visits)) * 10)} per 10 visits`).join("; ")}`);
    console.log(`    ${agg.asked} asked to join, ${agg.joined} of them in the group at the end; ${agg.fights} fights with them`);
    check(agg.crash === 0, `${mode}: ${GAMES} games ran without a crash`);
  }
  check(sum.hardcore.bucket["1-14"] && sum.hardcore.bucket["61+"] ? sum.hardcore.bucket["1-14"].met / Math.max(1, sum.hardcore.bucket["1-14"].tiles) > sum.hardcore.bucket["61+"].met / Math.max(1, sum.hardcore.bucket["61+"].tiles) : true, "hardcore: more people on the road in the first two weeks than after two months");
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fails ? 1 : 0);
