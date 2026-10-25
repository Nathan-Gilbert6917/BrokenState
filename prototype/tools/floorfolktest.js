// Who is inside a multi-storey city building, by floor (docs/multi-storey-crawl.md phase 3, src/sim/floorfolk.js):
//   - the roll (rollFolk): survivors only in apartments / offices / hospitals / schools / motels of 2+ storeys, raiders
//     upstairs only where the place has raiders (offices, apartments, police), a nest only from block 4 in 4+ storeys;
//   - placed in a crawl's building: survivors in an upper-floor room behind a barricaded door (their room's containers
//     left to them by the bot), the raiders upstairs with a watcher by the stairwell below and a stash in their room, better
//     armed deeper in; a nest of the special dead around hive flesh on the top floor, the top floor's containers richer;
//   - the card when one of yours reaches the door (through the turn hook too): talk (what they know of the floor, a gift,
//     a follow-up card), ask them to join (they leave the map; the recruit card once the team is out), leave them be, force
//     the door (the barricade down, the group hostile, they fire first);
//   - the nest keeps still until the Heat or noise through the floors wakes it;
//   - the block card's hint only after a Look around (or having been inside), with the Look around button and action;
//   - a building left and gone back into keeps its folk; save and load mid-raid with a nest and a barricaded group, then
//     play on with the bot (which answers the card);
//   - hospitals: a pharmacy on the ground floor and a dispensary on floor 1 (0-based); police: the armory and the evidence
//     room on the ground floor.
// Usage: node tools/floorfolktest.js
import { totalRounds } from "../src/sim/ammo.js"; // the stash's rounds by calibre
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { combatAct, setFloor, activeAny, active, CELL, endPlayerTurn, runEnemyPhase, autoPlayerTurn, finishCombat, alertNear, canSee, unitAt } from "../src/sim/combat.js";
import { BUILDINGS, assemble, BMAP, runLandings } from "../src/sim/buildingmaps.js";
import { Rng } from "../src/sim/rng.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import * as CC from "../src/sim/citycrawl.js";
import { FURNITURE } from "../src/sim/barricade.js"; // a piece shoved onto a top landing (floorfolk.js landingPiece)
import { FOLK, rollFolk, folkHint, folkTick, resolveBattleCards } from "../src/sim/floorfolk.js";
import { crawlModal, CRAWL_ACTIONS } from "../src/ui/citycrawl.js";
import { siteWanderers, interiorOccupants } from "../src/sim/wanderers.js";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  ok: ${msg}`); } else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const t0 = performance.now();

// ---------- helpers ----------
// A team crawling a city at block n, its people's skills set (speech / leadership / scouting) for the dice.
function crawlIn(seed, n, skills = {}) {
  const state = createWorld({ seed, factionCount: 7 });
  state.cards.length = 0;
  const h = hub(state);
  const city = state.tiles.find((t) => t.loc && t.loc.type === "city");
  for (const k of ["food", "water", "ammo", "meds"]) h.stock[k] = 200;
  const crew = atBase(state, h.id).slice(0, 3);
  for (const s of crew) for (const [k, v] of Object.entries(skills)) s.skills[k] = v;
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest: city.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 60, meds: 3 } });
  const p = res.party;
  p.path = [city.id]; p.idx = 0; p.dest = city.id; p.phase = "engaged";
  CC.startCrawl(state, p);
  const c = p.crawl;
  if (!CC.jumpToLevel(state, c, n)) throw new Error(`test setup: no block at depth ${n} in this city`); // a block at depth n on the round grid
  return { state, p, c, city };
}
// A place of this type on the team's block with these folk forced, tall enough (minStoreys) by its slot's dice.
function placeOf(state, c, key, folk, minStoreys = 2, raiders = false) {
  for (let slot = 10; slot < 80; slot++) {
    const pl = { id: `t-${key}-${slot}`, slot, key, name: `${BUILDINGS[key].name} on Test Street`, kind: BUILDINGS[key].name, dead: 1, rich: 1, raiders, looted: 0, blocked: null, quick: false, known: false, folk: { survivors: false, raidersUp: false, nest: false, ...folk } };
    if (CC.placeStoreys(state, c, pl) >= minStoreys) return pl;
  }
  return null;
}
function enter(state, p, c, pl) {
  CC.blockOf(c).places = [pl];
  const err = CC.enterPlace(state, p, pl.id, { map: true });
  if (err) throw new Error(err);
  return state.combat;
}
// Puts a unit on floor f at (x, y), moving whoever stood there off it (tests only).
function place(b, u, f, x, y) {
  for (const o of b.units) if (o !== u && (o.f || 0) === f && o.x === x && o.y === y && !o.dead) o.x = Math.max(1, o.x - 2);
  u.x = x; u.y = y; u.f = f; u.away = f !== (b.floor || 0);
}
const turn = (st) => { const b = st.combat; for (const u of b.units) if (u.side === "player") u.ap = 0; endPlayerTurn(st); runEnemyPhase(st); };
const sure = (st, v, fn) => { const was = st.rng.chance; st.rng.chance = () => v; try { return fn(); } finally { delete st.rng.chance; void was; } };
const inRoom = (r, u) => u.x > r.x0 && u.x < r.x0 + r.w - 1 && u.y > r.y0 && u.y < r.y0 + r.h - 1;
const survivors = (b) => b.units.filter((u) => u.folk === "survivors");
// The place's own raiders: not another group's party passing through (parley.js u.party, which floorfolk.js leaves where
// they are; with the hub on open land since 2026-10-22 one of this seed's groups is passing through this block).
const raidersOf = (b) => b.units.filter((u) => u.side === "enemy" && u.kind === "human" && u.kit === "raiders" && !u.occupant && !u.party);
const nesters = (b) => b.units.filter((u) => u.nesting);
const battleCard = (st) => st.cards.find((x) => x && x.battle);
const pct = (v) => `${Math.round(v * 100)}%`;
const extractAll = (st) => {
  const b = st.combat;
  setFloor(b, 0);
  const z = b.raid.zones[0];
  b.phase = "player"; b.queue = [];
  for (const o of b.units.filter((x) => x.side === "player" && activeAny(x))) { place(b, o, 0, z.x0 + 1, z.y0 + 1); o.ap = 2; combatAct(st, { type: "extract", unit: o.id }); }
  if (!b.over) { b.over = true; }
  finishCombat(st, b.setup, b.result || { outcome: "extracted", loot: { supplies: {}, gear: [] }, raid: { hours: 1, searched: 0, total: 0, heat: 0 } });
};
// A free open cell next to one of the doors (8 ways) on the room's floor, outside the room.
function outsideDoor(b, S) {
  const r = b.raid.areas.find((a) => a.id === S.room);
  const cells = b.floors[S.f].cells;
  for (const [dx, dy] of S.doors) for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = dx + ox, y = dy + oy;
    const c = cells[y * b.w + x];
    if (c && CELL[c.k].walk && c.k !== "stairs" && !(r && inRoom(r, { x, y }))) return [x, y];
  }
  return null;
}

// ======================================================================================
console.log("The roll: who a place can hold (floorfolk.js rollFolk)");
{
  const draws = (o, n = 600) => { const rng = new Rng(11); let s = 0, r = 0, z = 0; for (let i = 0; i < n; i++) { const f = rollFolk(rng, o); s += f.survivors; r += f.raidersUp; z += f.nest; } return { s, r, z }; };
  const flats = draws({ key: "apartments", n: 5, storeys: 5, danger: 2, raiders: true });
  check(flats.s > 0 && flats.r === 600 && flats.z > 0, `apartments at block 5, 5 storeys, raiders: survivors ${flats.s}/600, raiders upstairs always, a nest ${flats.z}/600`);
  const shallow = draws({ key: "apartments", n: 3, storeys: 6, danger: 1, raiders: true });
  check(shallow.z === 0 && shallow.s > 0, `block 3: never a nest however tall (${shallow.z}); survivors still (${shallow.s})`);
  const low = draws({ key: "offices", n: 6, storeys: 3, danger: 1, raiders: true });
  check(low.z === 0 && low.r === 600, `3 storeys: never a nest (${low.z}); the raiders still hole up above`);
  const one = draws({ key: "apartments", n: 6, storeys: 1, danger: 1, raiders: true });
  check(one.s === 0 && one.r === 0 && one.z === 0, "one storey: nothing upstairs");
  const shop = draws({ key: "grocery", n: 6, storeys: 2, danger: 1, raiders: true });
  check(shop.s === 0 && shop.r === 0, "a grocery with a flat above: no barricaded survivors, no raiders' nest upstairs (not their kind of place)");
  const noRaid = draws({ key: "offices", n: 6, storeys: 5, danger: 1, raiders: false });
  check(noRaid.r === 0, "no raiders at the place: nobody holed up above");
  const safe = draws({ key: "hospital", n: 2, storeys: 4, danger: 1, raiders: false }), deadly = draws({ key: "hospital", n: 2, storeys: 4, danger: 5, raiders: false });
  check(safe.s > deadly.s, `survivors likelier in a quiet place than a death trap (${safe.s} vs ${deadly.s} of 600)`);
  const d4 = draws({ key: "offices", n: 4, storeys: 5, danger: 1 }), d8 = draws({ key: "offices", n: 8, storeys: 5, danger: 1 });
  check(d8.z > d4.z && d8.s > d4.s, `deeper: more nests (${d4.z} → ${d8.z}) and more survivors holed up (${d4.s} → ${d8.s})`);
}

// ======================================================================================
console.log("Placed in a crawl's building: survivors behind a barred door, raiders upstairs with a watcher and a stash, a nest on top");
let W1 = null;
{
  const { state, p, c } = crawlIn(41, 5, { speech: 20, leadership: 20, scouting: 20 });
  const pl = placeOf(state, c, "offices", { survivors: true, raidersUp: true, nest: true }, 4, true);
  check(!!pl, "test setup: an office tower of 4+ storeys at block 5");
  const b = enter(state, p, c, pl);
  const R = b.raid, F = R.folk;
  W1 = { state, p, c, pl, b };
  check(!!F && F.survivors && F.raiders && F.nest, `the raid records who is upstairs (${JSON.stringify(Object.keys(F))})`);
  // Survivors.
  const S = F.survivors;
  const sv = survivors(b);
  const room = R.areas.find((a) => a.id === S.room);
  check(sv.length >= 1 && sv.length === S.count && sv.every((u) => u.side === "third" && u.team === "neutral" && !u.aware && (u.f || 0) === S.f && S.f >= 1 && inRoom(room, u)), `${sv.length} survivors (${S.names.join(", ")}) as a neutral group in the ${room.name} on floor ${S.f + 1}, unaware`);
  check(S.f !== F.nest.f, "not on the nest's floor");
  const doorCells = S.doors.map(([x, y]) => b.floors[S.f].cells[y * b.w + x]);
  check(doorCells.length === 1 && doorCells.every((d) => d.k === "door" && d.barred && d.hp === BMAP.DOOR.locked && d.mhp === d.hp), `the room's one door is barricaded from inside (a door cell, ${BMAP.DOOR.locked} hp)`);
  check(R.containers.filter((x) => x.area === S.room).every((x) => x.barred && x.botSkip), "their room's containers are theirs: the bot leaves them");
  check(state.wanderers && state.wanderers.groups.some((g) => g.wid === S.wid && g.people.length === sv.length), "they are a wanderers.js group (remembered, simulated when left)");
  check(!battleCard(state) && !S.met, "no card yet: nobody has reached their door");
  // Raiders.
  const K = F.raiders;
  const rd = raidersOf(b);
  const watcher = rd.find((u) => u.watcher);
  const up = rd.filter((u) => !u.watcher);
  const rroom = R.areas.find((a) => a.id === K.room);
  check(K.up && rd.length >= 2 && up.length && up.every((u) => (u.f || 0) === K.f && K.f >= 1 && inRoom(rroom, u)), `${up.length} raiders hold the ${rroom.name} on floor ${K.f + 1}`);
  // By the stairwell: on a stair run's landing (buildingmaps.js stairWaits; issue #9), else next to a landing or (an
  // older save's one-cell stairwell) next to the stairwell cell.
  const byStairs = (u) => R.runs && R.runs.length ? R.runs.some((r) => runLandings(r).some(([lx, ly]) => Math.max(Math.abs(u.x - lx), Math.abs(u.y - ly)) <= 1)) : R.stairs.some(([sx, sy]) => Math.max(Math.abs(u.x - sx), Math.abs(u.y - sy)) === 1);
  check(!!watcher && K.watcher === true && (watcher.f || 0) === K.f - 1 && byStairs(watcher), `a watcher stands by the stairwell on floor ${K.f} (${watcher ? `${watcher.x},${watcher.y}` : "none"})`);
  const stash = R.containers.find((x) => x.id === K.stash);
  check(!!stash && stash.stash && stash.f === K.f && stash.area === K.room && b.floors[K.f].cells[stash.y * b.w + stash.x].k === "crate" && stash.contents && totalRounds(stash.contents.sup) > 0 && stash.contents.gear.length >= 1, `their stash in the room: a crate with ${stash ? `${stash.contents.sup.ammo} ammo, ${stash.contents.sup.food} food and ${stash.contents.gear.map((g) => g.name).join(", ")}` : "nothing"}`);
  check(K.f !== F.nest.f && K.room !== S.room, "not in the survivors' room, not on the nest's floor");
  // Nest.
  const N = F.nest;
  const top = b.floors.length - 1;
  const knot = b.floors[top].cells[N.y * b.w + N.x];
  const nz = nesters(b);
  check(N.f === top && knot.k === "hivewall" && knot.nest, `a knot of hive flesh on the top floor (floor ${top + 1}) at ${N.x},${N.y}`);
  check(nz.length === N.count && nz.length >= FOLK.NEST.count[0] && nz.length <= FOLK.NEST.cap && nz.every((u) => u.kind === "zombie" && u.ztype && !u.aware && (u.f || 0) === top && Math.hypot(u.x - N.x, u.y - N.y) <= 4), `${nz.length} of the special dead (${[...new Set(nz.map((u) => u.ztype))].join(", ")}) around it, unaware`);
  check(R.containers.filter((x) => (x.f || 0) === top && x.kind !== "body").every((x) => x.rich === FOLK.NEST.rich) && R.containers.some((x) => (x.f || 0) === top), `the top floor's containers are richer (×${FOLK.NEST.rich})`);
  check(!N.awake, "the nest sleeps");
  // Every floor still hangs together: nothing new blocks a stairwell, nobody stands in a wall.
  check(b.units.every((u) => CELL[b.floors[u.f || 0].cells[u.y * b.w + u.x].k].walk), "everyone stands on floor they can stand on");
  check(R.stairs.every(([sx, sy]) => b.floors.every((Fl) => Fl.cells[sy * b.w + sx].k === "stairs")), "the stairwells are untouched");
  // AI parity (issue #9): the people holding an upper floor shove a piece onto its top landing, the floor still whole.
  for (const [who, G] of [["survivors", S], ["raiders", K]]) {
    if (!G.landing) continue;
    const [lx, ly] = G.landing, c = b.floors[G.f].cells[ly * b.w + lx];
    check(FURNITURE[c.k] && c.hp === FURNITURE[c.k].hp && c.shoved === who && R.runs.some((r) => runLandings(r)[1][0] === lx && runLandings(r)[1][1] === ly), `the ${who} shoved a ${c.k} (${c.hp} hp) onto the top landing of floor ${G.f + 1}`);
  }
  check(!!(S.landing || K.landing), "a piece stands on a top landing upstairs");
}

// ======================================================================================
console.log("The nest keeps still until the Heat wakes it; the watcher stands his post");
{
  const { state, b } = W1;
  const N = b.raid.folk.nest, K = b.raid.folk.raiders;
  const before = nesters(b).map((u) => [u.x, u.y]);
  const watcher = b.units.find((u) => u.watcher);
  const w0 = [watcher.x, watcher.y];
  b.raid.spawnCap = 0;
  turn(state); turn(state);
  check(nesters(b).every((u, i) => u.x === before[i][0] && u.y === before[i][1] && !u.aware), "two turns on: the nest's dead have not moved and are not aware");
  check(watcher.x === w0[0] && watcher.y === w0[1] && !watcher.aware, "the watcher has not left the stairwell");
  check(!N.awake && !state.cards.length, "no card, nothing stirring");
  b.raid.heat = FOLK.NEST.heat;
  folkTick(state, b);
  check(N.awake && nesters(b).every((u) => u.aware) && b.log.some((l) => /something stirs up there/.test(l.text)), `Heat ${FOLK.NEST.heat}: the nest wakes ("${b.log.find((l) => /stirs/.test(l.text))?.text}")`);
  turn(state);
  check(nesters(b).some((u) => u.drift || u.x !== before[nesters(b).indexOf(u)][0] || u.y !== before[nesters(b).indexOf(u)][1] || u.ap === 0), "awake, they move (or are sent down the stairs toward you)");
}

// ======================================================================================
console.log("The survivors' card: raised at their door through the turn hook, with four answers");
let CARD = null;
{
  const { state, p, b } = W1;
  const S = b.raid.folk.survivors;
  const u = b.units.find((x) => x.side === "player");
  for (const o of b.units.filter((x) => x.side === "player" && x !== u)) o.left = true;
  // Only the survivors' card is looked at here: armed squatters elsewhere in the building (wanderers.js occupants)
  // who spot the one at the door would call out with a card of their own (parley.js) as the dice fall (the scenes
  // of interiorscenes.js move where they stand).
  for (const o of b.units.filter((x) => x.occupant === "hostile" && !x.folk)) o.left = true;
  const spot = outsideDoor(b, S);
  check(!!spot, `a cell outside their door to stand on (${spot})`);
  place(b, u, S.f, spot[0], spot[1]);
  setFloor(b, S.f);
  b.phase = "player"; u.ap = 2;
  turn(state); // the start of the next player turn runs folkTick
  const card = battleCard(state);
  CARD = card;
  check(!!card && S.met && card.title === "Survivors barricaded upstairs" && card.partyId === p.id, `at the door the card is raised (${card ? card.title : "none"}) and the group is met`);
  check(!!card && /barricaded from inside/.test(card.text) && S.names.every((n) => card.text.includes(n)), `it names them and the barricade: "${card && card.text.slice(0, 120)}..."`);
  check(!!card && card.choices.map((x) => x.label).join("|") === "Talk to them|Ask them to join|Leave them be|Force the door", `four answers: ${card && card.choices.map((x) => x.label).join(", ")}`);
  check(!!card && card.choices.every((x) => typeof x.ai === "function" && typeof x.resolve === "function" && x.hint), "each with a hint, a weight for the bots and a resolution");
  check(state.cards.filter((x) => x.battle).length === 1, "only one card for them");
}

console.log("Talk: what they know of the floor, a gift, a follow-up card; or a refusal");
{
  const { state, b } = W1;
  const S = b.raid.folk.survivors;
  const u = b.units.find((x) => x.side === "player" && activeAny(x));
  const deadUp = b.units.filter((x) => x.side === "enemy" && (x.f || 0) === S.f && activeAny(x));
  const text = sure(state, true, () => CARD.choices[0].resolve(state));
  state.cards.splice(state.cards.indexOf(CARD), 1);
  check(S.state === "talked" && /They talk/.test(text) && /place/.test(text), `a good talk: "${text.slice(0, 140)}..."`);
  check(deadUp.every((e) => b.ghosts && b.ghosts[e.id] && b.ghosts[e.id][3] === S.f), `the dead on their floor are marked on the map (${deadUp.length} ghosts)`);
  check(b.raid.containers.filter((x) => (x.f || 0) === S.f && !x.barred && !x.searched).every((x) => x.known), "the floor's places to search are known");
  const gifted = (u.haul && (u.haul.sup.food || 0) > 0) || S.mood === "desperate";
  check(gifted, `${S.mood === "desperate" ? "the desperate have nothing to spare" : `they pass food and water out (${u.haul.sup.food} food, ${u.haul.sup.water} water on ${u.name})`}`);
  const follow = battleCard(state);
  check(!!follow && follow.title === "The survivors upstairs" && follow.choices.map((x) => x.label).join("|") === "Ask them to join|Leave them be|Force the door", `a follow-up card without the talk: ${follow && follow.choices.map((x) => x.label).join(", ")}`);
  const g = state.wanderers.groups.find((x) => x.wid === S.wid);
  check(g && g.talked && g.met === 1, "the group remembers the talk");
  // Leave them be from the follow-up.
  const left = follow.choices[1].resolve(state);
  state.cards.splice(state.cards.indexOf(follow), 1);
  check(S.state === "left" && /leave/.test(left) && survivors(b).every((x) => x.side === "third" && activeAny(x)), `leave them be: "${left}" — they keep their room`);
  check(!battleCard(state), "no card left open");
  // A refusal on a fresh building.
  const w = crawlIn(42, 5, { speech: 0, leadership: 0 });
  const pl = placeOf(w.state, w.c, "apartments", { survivors: true }, 2);
  const b2 = enter(w.state, w.p, w.c, pl);
  const S2 = b2.raid.folk.survivors;
  check(!!S2, "test setup: an apartment block with survivors upstairs");
  if (S2) {
    const u2 = b2.units.find((x) => x.side === "player");
    const spot = outsideDoor(b2, S2);
    place(b2, u2, S2.f, spot[0], spot[1]); setFloor(b2, S2.f);
    folkTick(w.state, b2);
    const card = battleCard(w.state);
    const text = sure(w.state, false, () => card.choices[0].resolve(w.state));
    w.state.cards.splice(w.state.cards.indexOf(card), 1);
    check(S2.state === "refused" && /nothing to do with you/.test(text), `a refusal: "${text}"`);
    const follow = battleCard(w.state);
    check(!!follow && follow.choices.length === 3 && /nothing to do with you/.test(follow.text), "the follow-up card still offers to ask, leave or force");
    w.state.cards.length = 0;
    w.state.combat = null; w.c.inside = null;
  }
}

console.log("Ask them to join: they come down and wait on the street (the recruit card when the team is out); or they stay");
{
  const w = crawlIn(43, 5, { speech: 20, leadership: 20 });
  const pl = placeOf(w.state, w.c, "offices", { survivors: true }, 3);
  const b = enter(w.state, w.p, w.c, pl);
  const S = b.raid.folk.survivors;
  check(!!S, "test setup: survivors upstairs");
  if (S) {
    const u = b.units.find((x) => x.side === "player");
    const spot = outsideDoor(b, S);
    place(b, u, S.f, spot[0], spot[1]); setFloor(b, S.f);
    folkTick(w.state, b);
    const card = battleCard(w.state);
    const n = survivors(b).length;
    const text = sure(w.state, true, () => card.choices[1].resolve(w.state));
    w.state.cards.splice(w.state.cards.indexOf(card), 1);
    check(S.state === "joining" && /wait for you on the street/.test(text) && survivors(b).every((x) => x.left), `they agree and leave the map: "${text}"`);
    check(!battleCard(w.state), "no card left open");
    extractAll(w.state);
    const rc = w.state.cards.find((x) => x.recruit);
    check(!!rc && rc.recruit.candidates.length === n && rc.recruit.candidates.every((s) => S.names.includes(s.name) && s.pending), `out on the street: the recruit card for ${n} (${rc ? rc.title : "none"})`);
    check(S.state === "offered" && w.c.log.some((l) => /wait for you on the street/.test(l.text)), "the crawl's log says so, and they are not offered twice");
    check(CC.blockOf(w.c).places[0].known && CC.blockOf(w.c).places[0].folk.survivors === false, "the block card knows the building and that nobody is barricaded in now");
    w.state.cards.length = 0;
  }
  const w2 = crawlIn(44, 5, { speech: 0, leadership: 0 });
  const pl2 = placeOf(w2.state, w2.c, "hospital", { survivors: true }, 3);
  const b2 = enter(w2.state, w2.p, w2.c, pl2);
  const S2 = b2.raid.folk.survivors;
  if (check(!!S2, "test setup: a hospital with survivors upstairs")) {
    const u = b2.units.find((x) => x.side === "player");
    const spot = outsideDoor(b2, S2);
    place(b2, u, S2.f, spot[0], spot[1]); setFloor(b2, S2.f);
    folkTick(w2.state, b2);
    const card = battleCard(w2.state);
    const text = sure(w2.state, false, () => card.choices[1].resolve(w2.state));
    w2.state.cards.splice(w2.state.cards.indexOf(card), 1);
    check(S2.state === "stay" && /rather hold out/.test(text) && survivors(b2).every((x) => !x.left && x.side === "third"), `or they stay: "${text}"`);
  }
}

console.log("Force the door: the barricade down, the group hostile, they fire first");
{
  const w = crawlIn(45, 5, { speech: 0, leadership: 0 });
  const pl = placeOf(w.state, w.c, "apartments", { survivors: true }, 3);
  const b = enter(w.state, w.p, w.c, pl);
  const S = b.raid.folk.survivors;
  if (check(!!S, "test setup: survivors upstairs")) {
    const u = b.units.find((x) => x.side === "player");
    u.hp = u.maxHp = 500;
    const spot = outsideDoor(b, S);
    place(b, u, S.f, spot[0], spot[1]); setFloor(b, S.f);
    folkTick(w.state, b);
    const card = battleCard(w.state);
    // One of them has a pistol whatever the dice gave, so the shots-first path is played.
    // Placed across the doorway from you, so the door coming down shows you to them (where the dice put them, a
    // corner of the room may hide the doorway).
    const [dx, dy] = S.doors[0];
    const gun = survivors(b)[0];
    const ix = 2 * dx - spot[0], iy = 2 * dy - spot[1];
    if (!survivors(b).some((x) => x !== gun && x.x === ix && x.y === iy)) { gun.x = ix; gun.y = iy; }
    gun.weapon = "pistol"; gun.weaponName = "Pistol";
    gun.magW = "pistol"; gun.magMax = 15; gun.mag = 15; gun.stack = [{ k: "a_9mm_fmj", n: 15 }]; gun.jam = null; // (loaded: a gun fires only the rounds in it, mags.js)
    const armed = survivors(b).filter((x) => x.weapon !== "fists" && !["knife", "bat", "prybar", "machete", "spikedbat", "pipespear"].includes(x.weapon)).length;
    const shotsBefore = b.log.length;
    const text = sure(w.state, true, () => card.choices[3].resolve(w.state));
    w.state.cards.splice(w.state.cards.indexOf(card), 1);
    const doors = S.doors.map(([x, y]) => b.floors[S.f].cells[y * b.w + x]);
    check(S.state === "forced" && doors.every((d) => d.k === "doorway" && !d.barred), `the barricade comes down: "${text}"`);
    check(survivors(b).every((x) => x.side === "enemy" && x.aware), "the group turns on you");
    check(b.raid.containers.filter((x) => x.area === S.room).every((x) => !x.barred && !x.botSkip), "their things are up for grabs");
    const shots = b.log.slice(shotsBefore).filter((l) => /shoots/.test(l.text)).length;
    check(armed ? shots > 0 : shots === 0, `${armed} with guns: ${shots} shot${shots === 1 ? "" : "s"} before anyone is in (${b.log.slice(shotsBefore).map((l) => l.text).join(" | ").slice(0, 160)})`);
    check(b.log.some((l) => /fight back/.test(l.text)), "the log: they fight back");
    check(!battleCard(w.state), "no card left open");
    let g = 0, crash = null;
    try { while (!b.over && g++ < 120) { autoPlayerTurn(w.state); runEnemyPhase(w.state); } } catch (e) { crash = e; console.log(e.stack); }
    check(!crash, `the raid plays on without error (${b.over ? b.result.outcome : "still going"} after ${g} turns)`);
  }
}

// ======================================================================================
console.log("The block card: hints only after a Look around (or having been inside)");
{
  const w = crawlIn(46, 5, { scouting: 20 });
  const pl = placeOf(w.state, w.c, "offices", { survivors: true, raidersUp: true, nest: true }, 4, true);
  const plain = placeOf(w.state, w.c, "apartments", {}, 2);
  plain.id = "t-plain"; plain.slot = 99;
  const shop = { ...placeOf(w.state, w.c, "grocery", {}, 1), id: "t-shop", slot: 98 };
  const blk = CC.blockOf(w.c);
  blk.places = [pl, plain, shop];
  const ui = { crawlMsg: "", crawlMsgKey: "" };
  check(folkHint(pl) === null && folkHint(plain) === null, "nothing known before a look");
  let html = crawlModal(w.state, ui);
  check(/Upstairs: unknown/.test(html) && !/nests above/.test(html) && !/lights were seen/.test(html), "the card says the upper floors are unknown");
  check(/data-action="cc-look"/.test(html) && !/cc-look" data-id="\d+" disabled/.test(html) && typeof CRAWL_ACTIONS["cc-look"] === "function", "a Look around button, wired to an action");
  const h0 = w.state.hour;
  const text = sure(w.state, true, () => CC.lookAround(w.state, w.p));
  check(w.state.hour === h0 + FOLK.LOOK.hours && blk.looked, `an hour watching: "${text.slice(0, 160)}..."`);
  check(folkHint(pl) === "something nests above; voices and a watcher on the stairs; lights were seen upstairs", `the tower: "${folkHint(pl)}"`);
  check(folkHint(plain) === "nothing stirs upstairs", `the plain block of flats: "${folkHint(plain)}"`);
  check(!shop.known, "a one-storey shop is not looked at");
  html = crawlModal(w.state, ui);
  check(/something nests above/.test(html) && /lights were seen upstairs/.test(html) && /nothing stirs upstairs/.test(html), "the hints are on the card");
  check(/cc-look" data-id="\d+" disabled/.test(html), "one look a block");
  check(/already/.test(CC.lookAround(w.state, w.p)), "a second look is refused");
  // A missed look, and the lookout taken down blinds the raiders' hint.
  const w2 = crawlIn(47, 5, { scouting: 0 });
  const pl2 = placeOf(w2.state, w2.c, "offices", { survivors: true, raidersUp: true }, 3, true);
  CC.blockOf(w2.c).places = [pl2];
  const t2 = sure(w2.state, false, () => CC.lookAround(w2.state, w2.p));
  check(!pl2.known && /nothing you could make out/.test(t2), `a poor scout can miss (${pct(CC.lookChance(w2.state, w2.p))}): "${t2}"`);
  pl2.known = true; pl2.raiders = false;
  check(folkHint(pl2) === "lights were seen upstairs", "with the block's raiders gone (the lookout taken down) the hint drops the watcher");
}

// ======================================================================================
console.log("A building left and gone back into keeps its folk; save and load mid-raid with a nest and a barricaded group");
{
  const w = crawlIn(48, 5, {});
  const pl = placeOf(w.state, w.c, "offices", { survivors: true, raidersUp: true, nest: true }, 4, true);
  const b = enter(w.state, w.p, w.c, pl);
  const F = b.raid.folk;
  const S = F.survivors, N = F.nest;
  check(!!S && !!N && !!F.raiders, "test setup: a tower with everyone in it");
  const doorKey = S.doors.map(([x, y]) => `${x},${y}`).join(";");
  // Out and back in.
  extractAll(w.state);
  const snap = w.c.buildings[pl.id];
  check(!!snap && snap.folk && JSON.stringify(snap.folk) === JSON.stringify(F), "the snapshot keeps the folk record");
  check(CC.blockOf(w.c).places[0].known && folkHint(CC.blockOf(w.c).places[0]) === "something nests above; voices and a watcher on the stairs; lights were seen upstairs", `having been inside, the card knows: "${folkHint(CC.blockOf(w.c).places[0])}"`);
  CC.enterPlace(w.state, w.p, pl.id, { map: true });
  const b2 = w.state.combat;
  check(b2 && b2.raid.folk && JSON.stringify(b2.raid.folk) === JSON.stringify(F), "going back in restores it");
  check(b2.raid.folk.survivors.doors.map(([x, y]) => `${x},${y}`).join(";") === doorKey && S.doors.every(([x, y]) => b2.floors[S.f].cells[y * b2.w + x].k === "door" && b2.floors[S.f].cells[y * b2.w + x].barred), "the barricade is where it was");
  check(survivors(b2).length === S.count && survivors(b2).every((u) => u.side === "third") && nesters(b2).length === N.count && nesters(b2).every((u) => !u.aware) && b2.floors[N.f].cells[N.y * b2.w + N.x].k === "hivewall", "the survivors, the nest's dead and the knot are back as they were");
  check(b2.raid.containers.some((x) => x.id === F.raiders.stash && x.stash && x.contents && totalRounds(x.contents.sup) > 0), "the stash and its contents");
  // Save and load with a unit on the survivors' floor, a card not yet raised.
  const u = b2.units.find((x) => x.side === "player");
  const [sx, sy] = b2.raid.stairs[0];
  place(b2, u, S.f, sx, sy);
  setFloor(b2, S.f);
  const saved = serializeState(w.state);
  const st2 = deserializeState(JSON.parse(JSON.stringify(saved)));
  const b3 = st2.combat;
  check(!!b3 && JSON.stringify(b3.raid.folk) === JSON.stringify(b2.raid.folk), "loaded: the folk record round-trips");
  check(S.doors.every(([x, y]) => { const c = b3.floors[S.f].cells[y * b3.w + x]; return c.k === "door" && c.barred && c.hp === BMAP.DOOR.locked; }), "the barricade's cells");
  check(survivors(b3).length === S.count && survivors(b3).every((x) => x.side === "third" && x.folk === "survivors" && x.tgroup != null), "the survivors as a third side");
  check(nesters(b3).length === N.count && nesters(b3).every((x) => x.nesting && x.ztype && !x.aware) && b3.floors[N.f].cells[N.y * b3.w + N.x].nest, "the nest, asleep");
  const st3 = b3.raid.containers.find((x) => x.id === F.raiders.stash);
  check(st3 && st3.contents && JSON.stringify(st3.contents) === JSON.stringify(b2.raid.containers.find((x) => x.id === F.raiders.stash).contents), "the stash's contents");
  check(b3.raid.containers.filter((x) => (x.f || 0) === N.f && x.kind !== "body").every((x) => x.rich === FOLK.NEST.rich), "the nest floor's richness");
  check(F.raiders.watcher === true && b3.units.filter((x) => x.watcher).length === 1 && b3.units.find((x) => x.watcher).f === F.raiders.f - 1, "the watcher, on the floor below the raiders' room");
  // Noise through the floors wakes the nest after loading; the bot plays on and answers the card.
  setFloor(b3, N.f - 1);
  alertNear(b3, N.x, N.y, 40, "A test blast.");
  folkTick(st2, b3);
  check(b3.raid.folk.nest.awake && nesters(b3).every((x) => x.aware) && b3.log.some((l) => /nest on the top floor is stirring/.test(l.text)), "noise on the floor below wakes the nest (through the floors)");
  setFloor(b3, S.f);
  const u3 = b3.units.find((x) => x.side === "player" && x.f === S.f);
  const spot = outsideDoor(b3, S);
  place(b3, u3, S.f, spot[0], spot[1]);
  folkTick(st2, b3);
  check(!!battleCard(st2), "the card is raised at the door after loading");
  let g = 0, crash = null;
  try { while (!b3.over && g++ < 200) { autoPlayerTurn(st2); runEnemyPhase(st2); } } catch (e) { crash = e; console.log(e.stack); }
  check(!crash && b3.over && !st2.cards.some((x) => x.battle) && ["talked", "refused", "joining", "offered", "left", "stay", "forced"].includes(b3.raid.folk.survivors.state), `the bot plays on to the end (${b3.over ? b3.result.outcome : "still going"}, ${g} turns) and answered the card (${b3.raid.folk.survivors.state})`);
  check(!st2.cards.some((x) => x.battle), "no battle card outlives the fight");
}

// ======================================================================================
console.log("Squatters the wanderers bring in prefer an upper floor of an office tower, a block of flats or a police station");
{
  const state = createWorld({ seed: 77, factionCount: 7 });
  const cities = state.tiles.filter((t) => t.terrain === "city" || (t.loc && t.loc.type === "city"));
  let found = null;
  for (let h = 0; h < 2000 && found == null; h += 5) { state.hour = h; for (const t of cities) if (siteWanderers(state, t.id).some((g) => !g.side)) { found = t.id; break; } }
  if (check(found != null, `test setup: a city site with armed squatters inside (hour ${state.hour})`)) {
    const plan = { key: "offices", storeys: 3, rooms: [{ id: 0, f: 0, entry: true }, { id: 1, f: 0 }, { id: 2, f: 0 }, { id: 3, f: 1 }, { id: 4, f: 1 }, { id: 5, f: 2 }] };
    const roomF = (g) => (plan.rooms.find((r) => r.id === g.room) || {}).f;
    const occ = interiorOccupants(state, found, plan);
    const hostile = occ.filter((g) => g.side === "hostile");
    check(hostile.length > 0 && hostile.every((g) => roomF(g) > 0), `in a 3-storey office tower the squatters' room is upstairs (floor ${hostile.map((g) => roomF(g) + 1).join(", ")})`);
    let any0 = false;
    for (let h = 0; h < 2000 && !any0; h += 5) { state.hour = h; for (const t of cities) for (const g of interiorOccupants(state, t.id, { ...plan, key: "grocery" })) if (g.side === "hostile" && roomF(g) === 0) any0 = true; }
    check(any0, "in a shop with a flat above they take any room");
    const flat = interiorOccupants(state, found, { ...plan, storeys: 1, rooms: plan.rooms.filter((r) => r.f === 0) });
    check(flat.filter((g) => g.side === "hostile").every((g) => roomF(g) === 0), "on one storey, the ground floor");
  }
}

// ======================================================================================
console.log("Rooms by floor: the hospital's pharmacy low and dispensary on floor 2, the police armory and evidence room on the ground");
{
  let bad = 0, n = 0;
  for (let s = 0; s < 8; s++) {
    const rng = new Rng(900 + s);
    const spec = BUILDINGS.hospital.make(rng, {});
    const m = assemble(rng, spec, { key: "hospital", name: "Hospital" });
    n++;
    const ph0 = m.rooms.some((r) => r.role === "pharmroom" && (r.f || 0) === 0);
    const ph1 = m.rooms.some((r) => r.role === "pharmroom" && (r.f || 0) === 1 && /Dispensary/.test(r.name));
    const phHigh = m.rooms.some((r) => r.role === "pharmroom" && (r.f || 0) > 1);
    if (!ph0 || !ph1 || phHigh) { bad++; console.log(`  hospital seed ${s}: pharmacy floors ${m.rooms.filter((r) => r.role === "pharmroom").map((r) => `${r.name}@${r.f}`).join(", ")}`); }
    const r2 = new Rng(950 + s);
    const ps = BUILDINGS.police.make(r2, {});
    const pm = assemble(r2, ps, { key: "police", name: "Police station" });
    const arm = pm.rooms.filter((r) => r.role === "armory" || r.role === "evidence");
    if (!arm.length || arm.some((r) => (r.f || 0) !== 0)) { bad++; console.log(`  police seed ${s}: ${arm.map((r) => `${r.name}@${r.f}`).join(", ")}`); }
  }
  check(!bad, `${n} hospitals: a pharmacy on the ground floor, the dispensary on floor 2 and nothing higher; ${n} police stations: gun cage and evidence room on the ground (${bad} bad)`);
}

console.log(`\n${passes} passed, ${fails} failed. (${Math.round(performance.now() - t0)} ms)`);
void active; void canSee; void unitAt;
process.exit(fails ? 1 : 0);
