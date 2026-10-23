// Scouting a tile before a camp, and the dead out on a blind camp's grounds (sim/campscout.js; the user's request
// 2026-10-23: "The team must scout out the tile prior to having the set up camp with all the information. Or you can
// still set up camp but it will be a random spot on the base build map ... it will generate events for the
// campsite/base being attacked taking you into a base raid until your base map is cleared of zombies. You can raid
// your base via the POI map to clear out the zombies yourself ...").
//   1. scouted versus blind: the orders say so (Scout first beside each); scouted, the spot is asked for; blind, the
//      game's dice and no fight first; Scout first surveys, then asks;
//   2. the blind spot: valid, and the same for the same world and tile;
//   3. the blind camp: the dead on its grounds (siteThreat's rules × GROUNDS.MAP), the map fogged past the fire;
//   4. the attacks: a card when their hour comes, the battle takes the kills off the pool, none once it is 0;
//   5. the POI map's raid on the grounds: a share of the pool, the kills off it;
//   6. a survey shows it all: the fog lifts, the count shows;
//   7. save and load keep the stamp and the pool; the governor's outpost scouts first; hardcore's first home is exempt.
// Usage: node tools/campscouttest.js [seed]
import { createWorld, tickHour, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, giveOrder, planPath, orderOptions, partyTile, partyMembers } from "../src/sim/parties.js";
import { pendingSite } from "../src/sim/staging.js";
import { siteThreat } from "../src/sim/siteclear.js";
import * as BM from "../src/sim/basemap.js";
import { playerVision } from "../src/sim/combat.js";
import { crawlTile } from "../src/sim/citycrawl.js";
import { isSettlementTile } from "../src/sim/startpick.js";
import { formTeam } from "../src/sim/teamform.js";
import { poiPickCard } from "../src/sim/poiraid.js";
import { fullSurveyDone, LOOK } from "../src/sim/survey.js";
import { poiKnowledge } from "../src/sim/pois.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { layoutHover } from "../src/ui/basemap.js";
import { teamTileMenu } from "../src/ui/teamctx.js";
import { GROUNDS, tileScouted, blindSite, mapDead, groundsHour, groundsBase, BLIND_NOTE, SCOUT_LABEL, GROUNDS_LABEL } from "../src/sim/campscout.js";

const SEED = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  ok   ${msg}`); } else { fails++; console.log(`  FAIL ${msg}`); } return !!ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
const world = (opts = {}) => { const st = createWorld({ seed: SEED, factionCount: 6, ...opts }); st.started = true; st.noNewGangs = true; st.erasOff = true; st.noWanderers = true; return st; };
const free = (st, t) => { const x = st.tiles[t]; return x.terrain !== "water" && x.terrain !== "mountain" && !x.hive && !crawlTile(x) && x.owner == null && !st.factions.some((f) => f.bases.includes(t)) && !st.bases.some((b) => b.tile === t) && !st.hordes.some((h) => h.tile === t) && !(st.abandoned || []).some((a) => a.tile === t); };
// A tile near the hub with the dead about (a town's, a city's or an infected one: siteThreat), reached on foot.
function deadTile(st) {
  const h = hub(st);
  for (let r = 2; r <= 14; r++) {
    const t = st.grid.within(h.tile, r).find((id) => st.grid.distance(id, h.tile) >= 2 && free(st, id) && siteThreat(st, id).count >= 3 && planPath(st, h.tile, id, false));
    if (t != null) return t;
  }
  // None: make one infected enough (siteclear.js SITE_CLEAR.INF).
  const t = st.grid.within(h.tile, 6).find((id) => st.grid.distance(id, h.tile) >= 2 && free(st, id) && !isSettlementTile(st.tiles[id]) && planPath(st, h.tile, id, false));
  st.tiles[t].infection = 0.8;
  return t;
}
// A team from the hub standing on the tile, its order not yet given.
function teamOn(st, tile, n = 4) {
  const h = hub(st);
  Object.assign(h.stock, { food: 300, water: 300, ammo: 400 });
  const res = launchExpedition(st, { memberIds: atBase(st, h.id).slice(0, n).map((s) => s.id), dest: tile, mission: "move", stance: "normal", supplies: { food: 6, water: 6, ammo: 60 } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.dest = tile; p.progress = 0; p.phase = "waiting"; p.mission = "move";
  for (const s of partyMembers(st, p)) s.health = 100;
  return p;
}
const pitch = (st, p, tile) => { for (let i = 0; i < 200 && !st.bases.some((b) => b.tile === tile); i++) { tickHour(st); st.cards.length = 0; } return st.bases.find((b) => b.tile === tile) || null; };

// ---------- 1. scouted versus blind ----------
section("Scouted versus blind: the orders, the spot, the fight first");
const st = world();
const tile = deadTile(st);
const p = teamOn(st, tile);
let base = null;
{
  check(!tileScouted(st, tile, p), "a tile never surveyed is not scouted");
  const opts = orderOptions(st, p);
  const camp = opts.find((o) => o.mission === "camp"), scout = opts.find((o) => o.mission === "scoutcamp");
  check(!!camp && camp.label.endsWith(BLIND_NOTE) && /Unscouted/.test(camp.desc) && !/about \d+ of the dead here/.test(camp.desc), `the order says so: "${camp && camp.label}", and no count of the dead`);
  check(!!scout && scout.label.startsWith(SCOUT_LABEL) && opts.indexOf(scout) === opts.indexOf(camp) + 1, `Scout first beside it: "${scout && scout.label}"`);
  const out = opts.find((o) => o.mission === "outpost"), sout = opts.find((o) => o.mission === "scoutoutpost");
  check(!!out && out.label.endsWith(BLIND_NOTE) && !!sout, "Build outpost too, with its Scout first");
  const menu = teamTileMenu(st, { ctxAll: false }, p, tile);
  check(menu.items.some((it) => it.key === "setcamp" && it.label.endsWith(BLIND_NOTE)) && menu.items.some((it) => it.key === "mission:scoutcamp"), "the right-click menu: Set up camp here (unscouted: blind spot) and Scout first");
  // Blind: the game's dice, nobody asked, no fight.
  const n0 = siteThreat(st, tile).count;
  giveOrder(st, p, "camp");
  check(!pendingSite(st) && !st.combat && p.phase === "task" && p.task && p.task.type === "pitch" && p.siteClear == null, `blind: no spot asked for, no fight first (${n0} of the dead at a spot here) — the setup goes on`);
  check(Array.isArray(p.campAt) && String(p.campAt) === String(blindSite(st, tile)) && p.campBlind === tile, `the camp's spot is the game's dice (${p.campAt})`);
  base = pitch(st, p, tile);
  check(!!base && String(base.plan.origin) === String(blindSite(st, tile)), `the camp stands there (${base && base.plan.origin})`);
}

// ---------- 2. the blind spot ----------
section("The blind spot: valid, the same every time");
{
  const a = blindSite(st, tile), b2 = blindSite(world(), tile);
  check(BM.siteProblem(st, tile, a) === "" && String(a) === String(b2), `valid and the same for the same world and tile (${a})`);
  const others = st.grid.within(tile, 3).filter((id) => free(st, id)).slice(0, 6);
  check(others.every((id) => BM.siteProblem(st, id, blindSite(st, id)) === ""), `valid on ${others.length} other tiles too`);
  const spots = new Set(others.map((id) => String(blindSite(st, id))));
  check(spots.size > 1, `not one fixed spot: ${[...spots].slice(0, 4).join(" · ")}`);
}

// ---------- 3. the blind camp ----------
section("The blind camp: the dead on its grounds, the map fogged past the fire");
{
  const g = base && base.grounds;
  check(!!g && g.blind && !g.known && g.dead === mapDead(st, tile) && g.dead === Math.min(GROUNDS.MAX, Math.round(siteThreat(st, tile).count * GROUNDS.MAP)) && g.dead > 0, `the pool: ${g && g.dead} (${GROUNDS.MAP} × the ${siteThreat(st, tile).count} at a spot), unknown`);
  BM.openBaseMap(st, base.id);
  const b = st.combat, F = b && b.deployPlan && b.deployPlan.fort;
  const vis = b ? playerVision(b) : null;
  const seen = vis ? vis.reduce((a, v) => a + v, 0) : 0;
  check(!!b && !!b.knownMask && seen > 0 && seen < vis.length && vis[F.oy * b.w + F.ox] === 1 && vis[0] === 0, `the base map: ${seen} of ${vis ? vis.length : 0} cells seen, round the fire`);
  const hov = b ? layoutHover(st, b, { x: 0, y: 0 }, null) : "";
  check(/Unknown ground/.test(hov), "the hover past the fire: unknown ground");
  st.combat = null;
  const quiet = Object.values(st.tiles).filter((x) => free(st, x.id) && !siteThreat(st, x.id).count).slice(0, 20);
  const city = Object.values(st.tiles).filter((x) => x.terrain === "city" && free(st, x.id)).slice(0, 5);
  check(quiet.length && quiet.every((x) => mapDead(st, x.id) === 0) && city.every((x) => mapDead(st, x.id) > mapDead(st, tile) || mapDead(st, x.id) === GROUNDS.MAX || siteThreat(st, x.id).count <= siteThreat(st, tile).count), `quiet land: none on its grounds (${quiet.length} tiles); a city's more (${city.map((x) => mapDead(st, x.id)).join(", ") || "no city near"})`);
}

// ---------- 4. the attacks ----------
section("The dead come out: a card, a battle, the kills off the pool, none once it is 0");
{
  const g = base.grounds;
  st.cards.length = 0;
  g.next = st.hour;
  for (const s of atBase(st, base.id)) { delete s.trip; s.role = "guard"; } // everyone home (no job trips out of the walls)
  groundsHour(st);
  const card = st.cards.find((c) => c.grounds === base.id);
  check(!!card && /^The dead come out of .+ at /.test(card.title) && /unknown \(\?\)/.test(card.text), `the card: "${card && card.title}" (how many more: ?)`);
  check(g.next > st.hour, `the next one in ${g.next - st.hour} hours`);
  groundsHour(st);
  check(st.cards.filter((c) => c.grounds === base.id).length === 1, "one card at a time");
  const d0 = g.dead;
  for (const s of atBase(st, base.id)) s.health = 100;
  const def = card.choices.find((c) => c.default);
  st.cards.splice(st.cards.indexOf(card), 1);
  def.resolve(st);
  check(!st.combat && g.dead < d0 && g.waves === 1, `defended: the pool ${d0} → ${g.dead}`);
  // On to the last of them: the line in the log, then no more cards.
  g.dead = 2;
  for (let i = 0; i < 6 && g.dead > 0; i++) {
    for (const s of atBase(st, base.id)) { s.health = 100; delete s.trip; }
    g.next = st.hour; groundsHour(st);
    const c = st.cards.find((x) => x.grounds === base.id);
    if (!c) break;
    st.cards.splice(st.cards.indexOf(c), 1);
    c.choices.find((x) => x.default).resolve(st);
  }
  check(g.dead === 0 && st.log.some((l) => /grounds of .+ are clear of the dead/.test(l.text)), "at 0: the log says the grounds are clear");
  g.next = st.hour; groundsHour(st); tickHour(st);
  check(!st.cards.some((c) => c.grounds === base.id), "and no more attacks");
}

// ---------- 5. the POI map's raid ----------
section("Clear the dead from the base grounds: the POI map, a share of the pool");
let w2, b2, q2;
{
  w2 = world();
  const t2 = deadTile(w2);
  const p2 = teamOn(w2, t2);
  giveOrder(w2, p2, "camp");
  b2 = pitch(w2, p2, t2);
  const g = b2.grounds;
  const left = atBase(w2, b2.id);
  const res = formTeam(w2, { baseId: b2.id, memberIds: left.map((s) => s.id), vehicleIds: [], supplies: {}, cargo: [] });
  q2 = res.party;
  for (const s of partyMembers(w2, q2)) s.health = 100;
  check(!!q2 && !!groundsBase(w2, t2), `a team formed at ${b2.name} (${partyMembers(w2, q2).length})`);
  const card = poiPickCard(w2, q2);
  const ch = card.choices.find((c) => c.grounds);
  check(!!ch && ch.label.startsWith(GROUNDS_LABEL) && /\?/.test(ch.label) && ch.poi == null && ch.order, `on the POI map: "${ch && ch.label}"`);
  const opt = orderOptions(w2, q2).find((o) => o.mission === "grounds");
  check(!!opt && !opt.disabled, `in the team's orders too: "${opt && opt.label}"`);
  const d0 = g.dead;
  ch.resolve(w2);
  check(!w2.combat && g.raids === 1 && g.dead < d0 && d0 - g.dead <= Math.max(GROUNDS.RAID_MIN, Math.ceil(d0 * GROUNDS.RAID_SHARE)), `raided: the pool ${d0} → ${g.dead} (a share of it)`);
}

// ---------- 6. the survey ----------
section("A survey of the tile shows it all");
{
  const g = b2.grounds;
  q2.phase = "task"; q2.task = { type: "fullsurvey", hours: LOOK.hours, done: LOOK.hours };
  if (!w2.parties.includes(q2) || !partyMembers(w2, q2).length) check(false, "the team is gone");
  const text = fullSurveyDone(w2, q2);
  check(g.known && /grounds is known now/.test(text), `surveyed: "${text.match(/The whole of .*?\./) ? text.match(/The whole of [^.]*\./)[0] : text}"`);
  BM.openBaseMap(w2, b2.id);
  check(!!w2.combat && !w2.combat.knownMask && playerVision(w2.combat).every((v) => v === 1), "the fog over the base map lifts");
  w2.combat = null;
  check(tileScouted(w2, b2.tile, q2), "the tile counts as scouted now");
}

// ---------- 7. scouted, Scout first, save and load, the governor, hardcore ----------
section("Scouted: today's flow; Scout first; save and load; the governor; hardcore");
{
  const w = world();
  const t = deadTile(w);
  poiKnowledge(w, t, true).surveyed = 1;
  const p3 = teamOn(w, t);
  check(tileScouted(w, t, p3) && !orderOptions(w, p3).some((o) => o.mission === "scoutcamp") && orderOptions(w, p3).find((o) => o.mission === "camp").label === "Set up camp", "a surveyed tile: plain Set up camp, no Scout first");
  giveOrder(w, p3, "camp");
  check(pendingSite(w) === p3 && p3.campBlind == null, "scouted: the spot is asked for as before");
  // Scout first: the survey, then the camp's order asks for its spot.
  const w4 = world();
  const t4 = deadTile(w4);
  const p4 = teamOn(w4, t4);
  giveOrder(w4, p4, "scoutcamp");
  check(p4.task && p4.task.type === "fullsurvey" && (p4.orders || []).some((o) => o.type === "mission" && o.mission === "camp" && o.at === t4), "Scout first: the survey, the camp queued after it");
  for (let i = 0; i < LOOK.hours + 2 && !pendingSite(w4); i++) { tickHour(w4); w4.cards.length = 0; }
  check(tileScouted(w4, t4, p4) && pendingSite(w4) === p4 && p4.campBlind == null, "surveyed: the team asks where the camp goes, all known");
  // Save and load.
  const g = b2.grounds;
  const s2 = deserializeState(JSON.parse(JSON.stringify(serializeState(w2, { dropCards: true }))));
  const lb = s2.bases.find((b) => b.id === b2.id);
  check(!!lb && lb.grounds && lb.grounds.dead === g.dead && lb.grounds.known === g.known && lb.grounds.next === g.next, `saved and loaded: the pool (${lb && lb.grounds && lb.grounds.dead}) and what is known`);
  const s3 = deserializeState(JSON.parse(JSON.stringify(serializeState(w, { dropCards: true }))));
  check(tileScouted(s3, t), "and a tile's scouting");
  const wb = world();
  const tb = deadTile(wb), pb = teamOn(wb, tb);
  giveOrder(wb, pb, "camp");
  const blindAfter = deserializeState(JSON.parse(JSON.stringify(serializeState(wb, { dropCards: true }))));
  const pl = blindAfter.parties.find((x) => x.id === pb.id);
  check(!!pl && pl.campBlind === tb && String(pl.campAt) === String(pb.campAt), "a blind setup under way keeps its spot through a save");
  // The governor's outpost: Scout first on arrival.
  const wg = world();
  wg.autopilot = { on: true };
  const tg = deadTile(wg), pg = teamOn(wg, tg);
  pg.scoutFirst = true;
  giveOrder(wg, pg, "outpost");
  check(pg.task && pg.task.type === "fullsurvey" && pg.orders.some((o) => o.mission === "outpost"), "the governor's outpost team scouts first, the outpost queued");
  // Hardcore's first home counts as scouted.
  const hc = createWorld({ seed: SEED, factionCount: 6, mode: "hardcore" });
  const rt = roadTeam(hc);
  check(!!rt && tileScouted(hc, partyTile(rt), rt), "hardcore's first home: scouted (no home to scout from)");
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
