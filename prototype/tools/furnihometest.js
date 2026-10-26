// Extracting with a piece of furniture in the arms (issue #18, the user's request 2026-10-25; src/sim/furnihome.js): with
// a vehicle the piece goes into its cargo by itself (a line names it); the vehicle full, it is set down at the exit and
// kept in the POI's ledger; on foot it is dropped from exhaustion (the message in the raid's summary, the log, the alert
// and the team report) and kept at the door in the ledger; bikes take a piece their racks hold; a pair with one left
// behind sets it down where they parted; the next raid on the POI finds it by the door (and the cell it was lifted off
// empty) and lifts it again; a street fight with no ledger loses it; the raid bot never extracts with a piece and no
// vehicle; the city crawl (the walk's pace, the vehicle or exhaustion at the rim); a vehicle's own cargo carries a piece
// as any gear; other groups' raids flag a piece only when they came by vehicle; the save round trip of the ledger.
// Usage: node tools/furnihometest.js [seed]   ("ok" / "FAIL" lines; exits 1 on a failure)
import { createWorld, hub, atBase, survivorById } from "../src/sim/world.js";
import { launchExpedition, partyMembers, cargoRoom } from "../src/sim/parties.js";
import { createBattle, combatAct, finishCombat, endPlayerTurn, runEnemyPhase, autoPlayerTurn, CELL, unitAt } from "../src/sim/combat.js";
import { newItem, ensureInv, itemLoad } from "../src/sim/inventory.js";
import { createVehicle, carryCargo, cargoIn } from "../src/sim/vehicles.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { poisOf, poiAt, poiPool, isSitePoi } from "../src/sim/pois.js";
import { poiRaidSetup } from "../src/sim/poiraid.js";
import { raidPoiAsGroup } from "../src/sim/grouppois.js";
import { supWeight } from "../src/sim/data.js";
import * as F from "../src/sim/furnicarry.js";
import * as H from "../src/sim/furnihome.js";
import { computeAlerts } from "../src/ui/alerts.js";

const seed = Number(process.argv[2] || 42);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return ok; };
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; return st; };
// A team of `n` from the hub: on foot, in the hub's car ("car") or on bikes ("bike", one each).
function team(st, how = null, n = 3) {
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, n);
  for (const s of crew) { s.traits = []; s.traitTier = {}; s.perks = []; ensureInv(s); s.gear.carry = null; }
  const v = how === "car" ? st.vehicles.find((x) => x.type !== "bike" && x.loc && x.loc.kind === "base") : how === "bike" ? createVehicle(st, "bike", { kind: "base", baseId: h.id }, { count: n }) : null;
  if (how && !v) throw new Error(`no ${how} at the hub`);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: h.tile, mission: "scavenge", stance: "normal", vehicleId: v ? v.id : null, supplies: { food: 1, water: 1, ammo: 0 } });
  if (res.error) throw new Error(`launch: ${res.error}`);
  st.cards.length = 0;
  return res.party;
}
// A raid on POI i of tile t (null: a raid on the tile with no POI, a street fight), no enemies.
function raid(st, p, t, i) {
  p.path = [t.id]; p.idx = 0; p.dest = t.id; p.phase = "engaged";
  const rs = i == null ? null : poiRaidSetup(st, t, i);
  const setup = {
    mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "zombies", count: 0, power: 3, name: "nobody", groups: [] },
    raid: rs ? { heat0: 5, choose: rs.choose, poi: i, kind: rs.kind || null, place: rs.place || null } : { heat0: 5 }, context: {},
  };
  st.combat = createBattle(st, setup);
  const b = st.combat;
  if (b.raid.choose) b.raid.choose = null;
  b.units = b.units.filter((u) => u.side === "player");
  for (const u of b.units) u.ap = 2;
  return b;
}
const mine = (b) => b.units.filter((u) => u.side === "player");
const findPoi = (st, kinds) => {
  for (const t of st.tiles) {
    if (t.id === hub(st).tile || st.bases.some((x) => x.tile === t.id)) continue;
    const L = poisOf(t);
    for (let i = 0; i < L.length; i++) if (kinds.includes(L[i].kind) && !isSitePoi(t, i) && poiPool(t, i) > 0.1) return [t, i];
  }
  return null;
};
// Free ground-floor walkable cells of a zone (the vehicle's when vehicle is true and the raid has one).
function zoneCells(b, vehicle = false) {
  const R = b.raid;
  const free = (x, y) => { const c = x >= 0 && y >= 0 && x < b.w && y < b.h ? b.cells[y * b.w + x] : null; return !!c && c.k !== "vehicle" && CELL[c.k] && CELL[c.k].walk && !unitAt(b, x, y); };
  if (vehicle && b.vehicle) { // any cell round the vehicle is a way out in it (combat.js vehicleExit)
    const v = b.vehicle, out = [];
    for (let y = v.y - 2; y <= v.y + v.h + 1; y++) for (let x = v.x - 2; x <= v.x + v.w + 1; x++) if (free(x, y) && x >= v.x - 1 && x <= v.x + v.w && y >= v.y - 1 && y <= v.y + v.h) out.push({ x, y });
    return out;
  }
  const z = R.zones[vehicle && R.vehicleZone >= 0 ? R.vehicleZone : R.zones.findIndex((q, k) => k !== R.vehicleZone) >= 0 ? R.zones.findIndex((q, k) => k !== R.vehicleZone) : 0];
  const out = [];
  for (let y = z.y0; y < z.y0 + z.h; y++) for (let x = z.x0; x < z.x0 + z.w; x++) { const c = b.cells[y * b.w + x]; if (c && CELL[c.k] && CELL[c.k].walk && !unitAt(b, x, y)) out.push({ x, y }); }
  return out;
}
// The piece put in u's arms as a lift leaves it (helper: the other end of a pair).
function arms(st, b, u, kind, helper = null) {
  const d = F.liftDef(kind), it = newItem(d.item), s = survivorById(st, u.sid);
  ensureInv(s);
  s.gear.carry = it; u.bag = it; u.piece = kind; u.tether = null; u.shareKg = null;
  if (helper) { helper.piece = kind; helper.tether = u.id; u.tether = helper.id; helper.shareKg = u.shareKg = d.kg / 2; }
  F.reweigh(st, b, u);
  return it;
}
// Everyone into the zone and out (the pair next to each other first); the raid ends and its handler runs.
function extractAll(st, b, vehicle = false, opts = {}) {
  const cells = zoneCells(b, vehicle);
  const us = mine(b).filter((u) => !u.left && !u.dead);
  const pair = us.find((u) => u.tether != null);
  const order = pair ? [pair, ...us.filter((u) => u !== pair)] : us;
  for (const u of order) {
    if (u.left || u.down || u.dead) continue;
    const o = u.tether != null ? b.units.find((x) => x.id === u.tether) : null;
    const spot = cells.find((c) => !unitAt(b, c.x, c.y) && (!o || cells.some((d) => cheb(c, d) === 1 && !unitAt(b, d.x, d.y))));
    if (!spot) throw new Error("no room in the zone");
    u.x = spot.x; u.y = spot.y; u.f = 0; u.ap = 2;
    if (o) { const d = cells.find((q) => cheb(q, spot) === 1 && !unitAt(b, q.x, q.y)); o.x = d.x; o.y = d.y; o.f = 0; o.ap = 2; }
    if (opts.before) opts.before(u, o);
    const err = combatAct(st, { type: "extract", unit: u.id });
    if (err) throw new Error(`extract: ${err}`);
  }
  if (!b.over) { endPlayerTurn(st); runEnemyPhase(st); }
  if (!b.over) throw new Error("the raid did not end");
  finishCombat(st, b.setup, b.result);
}
const logHas = (st, rx) => st.log.some((l) => rx.test(l.text));
const ledgerPieces = (t, i, kind) => { const c = poiAt(t, i).cont; return c && c.pieces ? Object.values(c.pieces).flat().filter((o) => o.cell.k === kind && o.cell.moved) : []; };

console.log("a pickup: the fridge (two carrying it) goes into its cargo by itself");
{
  const st = W();
  const p = team(st, "car");
  const [t, i] = findPoi(st, ["house"]);
  const b = raid(st, p, t, i);
  check(b.raid.vehicleZone >= 0, `the raid has the vehicle at a zone (${b.raid.vehicleZone})`);
  const [u, o] = mine(b);
  const it = arms(st, b, u, "fridge", o);
  check(itemLoad(it) === 60 && /goes into/.test(H.extractNote(st, b, u)), `the Extract warning: "${H.extractNote(st, b, u)}"`);
  extractAll(st, b, true);
  const s = survivorById(st, u.sid), s2 = survivorById(st, o.sid);
  check(p.cargo.gear.includes(it), "the fridge is in the team's cargo (p.cargo)");
  check(!s.gear.carry && !s2.gear.carry && !u.bag && !u.piece && !o.piece, "the arms are empty, the tether gone");
  check(logHas(st, /heaved the refrigerator into the /) || b.summary.some((l) => /heaved the refrigerator into the /.test(l)), `a line names it: "${b.summary.find((l) => /heaved/.test(l)) || "none"}"`);
  check(b.result.loot.gear.includes(it), "and it is in the raid's loot");
  check(!ledgerPieces(t, i, "fridge").length, "nothing left at the door");
}

console.log("the pickup full: the fridge stays by the door, in the ledger");
{
  const st = W();
  const p = team(st, "car");
  const [t, i] = findPoi(st, ["house"]);
  const b = raid(st, p, t, i);
  const [u, o] = mine(b);
  const room = cargoRoom(st, p);
  p.cargo.supplies.scrap = (p.cargo.supplies.scrap || 0) + Math.ceil((room - 20) / supWeight("scrap"));
  check(cargoRoom(st, p) < 60, `the pickup has ${Math.round(cargoRoom(st, p))} kg of room`);
  const it = arms(st, b, u, "fridge", o);
  check(/No room/.test(H.extractNote(st, b, u)), `the warning: "${H.extractNote(st, b, u)}"`);
  extractAll(st, b, true);
  check(!p.cargo.gear.includes(it), "not in the cargo");
  check(ledgerPieces(t, i, "fridge").length === 1, "the fridge is in the POI's ledger, standing as a piece");
  check(b.summary.some((l) => /is full: the refrigerator stays by the door/.test(l)), `the line says so: "${b.summary.find((l) => /full/.test(l)) || "none"}"`);
  check(logHas(st, /is full: the refrigerator stays by the door/), "and the log");
  check(!survivorById(st, u.sid).gear.carry, "the arms are empty");
}

console.log("on foot: a real piece lifted, dropped from exhaustion at the door; the next raid finds it there and lifts it");
{
  const st = W();
  const p = team(st, null);
  const [t, i] = findPoi(st, ["house"]);
  const b = raid(st, p, t, i);
  const [u] = mine(b);
  // a one-person piece on the map with a free cell beside it
  let from = null;
  for (let y = 1; y < b.h - 1 && !from; y++) for (let x = 1; x < b.w - 1 && !from; x++) {
    const c = b.cells[y * b.w + x], d = CELL[c.k] && F.liftDef(c.k);
    if (!d || d.carry !== "one" || d.size[0] * d.size[1] > 1 || c.pc) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = b.cells[(y + dy) * b.w + x + dx]; if (n && CELL[n.k] && CELL[n.k].walk && !unitAt(b, x + dx, y + dy)) { from = { x, y, k: c.k, sx: x + dx, sy: y + dy }; break; } }
  }
  if (check(!!from, `a one-person piece on the map (${from ? from.k : "none"})`)) {
    u.x = from.sx; u.y = from.sy; u.f = 0; u.ap = 2;
    const err = combatAct(st, { type: "liftPiece", unit: u.id, x: from.x, y: from.y });
    check(err === "" && u.piece === from.k, `lifted (${err || "ok"})`);
    const name = F.liftDef(from.k).name.toLowerCase();
    check(/No vehicle: .* dropped at the door/.test(H.extractNote(st, b, u)), `the warning: "${H.extractNote(st, b, u)}"`);
    extractAll(st, b, false);
    check(!survivorById(st, u.sid).gear.carry, "the arms are empty");
    check(ledgerPieces(t, i, from.k).length === 1, `the ${name} is in the POI's ledger, standing at the door`);
    // a plural name ("crates"): "some crates. They stand" (issue #48)
    check(b.summary.some((l) => new RegExp(`Exhausted, the team dropped what it was carrying: ${F.pluralName(name) ? `some ${name}\\. They stand` : `an? ${name}\\. It stands`} by the door`).test(l)), `the message in the raid's summary: "${b.summary.find((l) => /Exhausted/.test(l)) || "none"}"`);
    check(b.result.raid.pieces && b.result.raid.pieces.dropped[0] === name, "and in the result (b.result.raid.pieces)");
    check(logHas(st, /: Exhausted, the team dropped what it was carrying/), "the log line");
    const al = computeAlerts(st).find((a) => a.kind === "exhausted");
    check(!!al && al.tone === "warn" && /dropped/.test(al.text), `the alert: "${al ? al.text : "none"}"`);
    check(JSON.stringify(st.cards).includes("Exhausted, the team dropped"), "the team's report (its orders card) says it");
    st.cards.length = 0;
    // the save round trip keeps the ledger
    const st2 = deserializeState(serializeState(st));
    check(ledgerPieces(st2.tiles[t.id], i, from.k).length === 1, "saved and loaded: still in the ledger");
    // the next raid
    st.hour += 30;
    const b2 = raid(st, p, t, i);
    const at = (x, y) => b2.cells[y * b2.w + x];
    check(at(from.x, from.y).k !== from.k, `the cell it was lifted off is empty (${at(from.x, from.y).k})`);
    let door = null;
    for (let y = 0; y < b2.h && !door; y++) for (let x = 0; x < b2.w && !door; x++) if (at(x, y).k === from.k && at(x, y).moved) door = { x, y };
    const z = b2.raid.zones.find((q) => door && door.x >= q.x0 - 7 && door.x < q.x0 + q.w + 7 && door.y >= q.y0 - 7 && door.y < q.y0 + q.h + 7);
    check(!!door && !!z, `the ${name} stands by the way out (${door ? `${door.x},${door.y}` : "nowhere"})`);
    if (door) {
      const v = mine(b2)[0];
      const spot = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([dx, dy]) => ({ x: door.x + dx, y: door.y + dy })).find((q) => { const c = at(q.x, q.y); return c && CELL[c.k] && CELL[c.k].walk && !unitAt(b2, q.x, q.y); });
      v.x = spot.x; v.y = spot.y; v.f = 0; v.ap = 2;
      const err2 = combatAct(st, { type: "liftPiece", unit: v.id, x: door.x, y: door.y });
      check(err2 === "" && v.piece === from.k, `lifted again (${err2 || "ok"})`);
    }
    st.combat = null;
  }
}

console.log("bikes: an 8 kg nightstand on the racks; a 60 kg fridge dropped from exhaustion (a bike is no vehicle for it)");
{
  const st = W();
  const p = team(st, "bike", 2);
  const [t, i] = findPoi(st, ["house"]);
  const b = raid(st, p, t, i);
  check(b.raid.hasVehicle !== false, `the bikes are on the raid (vehicle zone ${b.raid.vehicleZone})`);
  const [u, o] = mine(b);
  const it = arms(st, b, u, "nightstand");
  check(itemLoad(it) <= 15, `the nightstand weighs ${itemLoad(it)} kg`);
  extractAll(st, b, true);
  check(p.cargo.gear.includes(it), `the nightstand is on the racks (${b.summary.find((l) => /heaved/.test(l)) || "no line"})`);
  const st2 = W();
  const p2 = team(st2, "bike", 2);
  const [t2, i2] = findPoi(st2, ["house"]);
  const b2 = raid(st2, p2, t2, i2);
  const [u2, o2] = mine(b2);
  const it2 = arms(st2, b2, u2, "fridge", o2);
  extractAll(st2, b2, true);
  check(!p2.cargo.gear.includes(it2) && ledgerPieces(t2, i2, "fridge").length === 1, "the fridge is not on the racks: by the door, in the ledger");
  check(b2.summary.some((l) => /Exhausted, the team dropped what it was carrying: a refrigerator/.test(l)), `the message: "${b2.summary.find((l) => /Exhausted/.test(l)) || "none"}"`);
}

console.log("a pair, one of them left behind: the piece set down where they parted, kept in the ledger");
{
  const st = W();
  const p = team(st, null);
  const [t, i] = findPoi(st, ["house"]);
  const b = raid(st, p, t, i);
  const [u, o] = mine(b);
  const it = arms(st, b, u, "fridge", o);
  let at = null;
  extractAll(st, b, false, { before: (x, y) => { if (y) { y.down = true; y.hp = 1; y.stab = true; at = { x: y.x, y: y.y }; } } });
  const L = ledgerPieces(t, i, "fridge");
  check(L.length === 1 && at && cheb(L[0], at) <= 2, `the fridge stands next to where they parted (${L[0] ? `${L[0].x},${L[0].y}` : "none"}, ${at ? `${at.x},${at.y}` : ""})`);
  check(!p.cargo.gear.includes(it) && !survivorById(st, u.sid).gear.carry, "not carried home");
}

console.log("a street fight (no POI ledger): lost, with the message");
{
  const st = W();
  const p = team(st, null);
  const t = st.tiles.find((x) => x.loc && x.id !== hub(st).tile && !st.bases.some((q) => q.tile === x.id) && ["store", "house", "warehouse", "gas"].includes(x.loc.type));
  const b = raid(st, p, t, null);
  check(!b.raid.poiMap, "no ledger on this map");
  const [u] = mine(b);
  const it = arms(st, b, u, "chair");
  extractAll(st, b, false);
  check(!p.cargo.gear.includes(it) && !survivorById(st, u.sid).gear.carry, "the chair is not carried home");
  check(b.summary.some((l) => /Exhausted, the team dropped what it was carrying: a chair\. Nobody can come back for it: it is lost\./.test(l)), `the message: "${b.summary.find((l) => /Exhausted/.test(l)) || "none"}"`);
  check(logHas(st, /Exhausted, the team dropped/), "the log line");
}

console.log("two pieces, on foot: one message lists them");
{
  const st = W();
  const p = team(st, null);
  const [t, i] = findPoi(st, ["house"]);
  const b = raid(st, p, t, i);
  const [u, o, w] = mine(b);
  arms(st, b, u, "chair"); arms(st, b, o, "chair"); arms(st, b, w, "fridge");
  w.shareKg = null;
  extractAll(st, b, false);
  check(b.summary.some((l) => /dropped what it was carrying: two chairs, a refrigerator\. They stand by the door: come back with a vehicle to take them\./.test(l)), `"${b.summary.find((l) => /Exhausted/.test(l)) || "none"}"`);
}

console.log("the raid bot never extracts with a piece and no vehicle");
{
  const st = W();
  const p = team(st, null, 2);
  const [t, i] = findPoi(st, ["house"]);
  const b = raid(st, p, t, i);
  const [u] = mine(b);
  arms(st, b, u, "chair");
  for (const c of b.raid.containers) c.searched = true; // nothing to search: it leaves
  let guard = 0;
  while (!b.over && guard++ < 200) { autoPlayerTurn(st); runEnemyPhase(st); }
  check(b.over, `the bot ends the raid (${b.result ? b.result.outcome : "not over"})`);
  check(!(b.result && b.result.raid.pieces && b.result.raid.pieces.dropped.length), "no piece carried out without a vehicle");
  check(b.log.some((l) => /No vehicle to take it home: .* sets it down/.test(l.text || l)), "it set the chair down first");
  st.combat = null;
}

console.log("the city crawl: the walk slowed; out of the city by vehicle or dropped from exhaustion");
{
  const st = W();
  const p = team(st, null, 2);
  const s = partyMembers(st, p)[0];
  const it = newItem("fridge"); it.crawl = true; s.gear.carry = it;
  check(H.crawlPieces(st, p).length === 1, "the crawl card lists the fridge");
  const h = H.crawlMoveHours(st, p, 1);
  check(h >= 2, `a 60 kg fridge in the arms: ${h} h a block`);
  const r = H.piecesOut(st, p);
  check(r.dropped[0] === "refrigerator" && !s.gear.carry && !p.cargo.gear.includes(it), "on foot out of the city: dropped");
  check(/Exhausted, the team dropped what it was carrying: a refrigerator\./.test(r.text) && logHas(st, /Exhausted/), `the message: "${r.text}"`);
  const st2 = W();
  const p2 = team(st2, "car", 2);
  const s2 = partyMembers(st2, p2)[0];
  const it2 = newItem("fridge"); it2.crawl = true; s2.gear.carry = it2;
  const r2 = H.piecesOut(st2, p2);
  check(r2.loaded[0] === "refrigerator" && p2.cargo.gear.includes(it2) && !s2.gear.carry && !it2.crawl, "with the car: into its cargo");
  const it3 = newItem("fridge"); s2.gear.carry = it3; // carried from the road (not out of the crawl): not this rule's
  check(!H.piecesOut(st2, p2).loaded.length && s2.gear.carry === it3, "a fridge carried from the road is left alone");
}

console.log("a crawl's building: the piece comes out in the arms (the walk to the rim is the way out)");
{
  const st = W();
  const p = team(st, null);
  const [t, i] = findPoi(st, ["house"]);
  const b = raid(st, p, t, i);
  b.setup.handler = "crawl";
  const [u, o] = mine(b);
  const it = arms(st, b, u, "fridge", o);
  check(/slows the walk/.test(H.extractNote(st, b, u)), `the warning: "${H.extractNote(st, b, u)}"`);
  extractAll(st, b, false);
  const s = survivorById(st, u.sid);
  check(s.gear.carry === it && it.crawl && !p.cargo.gear.includes(it), "the fridge is still in the arms, marked as out of the crawl");
  check(!(b.result.raid.pieces), "no message yet");
}

console.log("a vehicle's own cargo carries a piece as any gear");
{
  const a = { cargo: { supplies: {}, gear: [newItem("fridge"), newItem("f_chair")] } }, z = {};
  carryCargo(a, z);
  check(cargoIn(z) && z.cargo.gear.length === 2 && z.cargo.gear[0].key === "fridge" && !a.cargo, "carryCargo moves the fridge and the chair along");
}

console.log("other groups: a piece in the haul only when they came by vehicle");
{
  const st = W();
  const [t, i] = findPoi(st, ["house"]);
  const f = st.factions[0];
  const r1 = raidPoiAsGroup(st, f, t, i, 0.2, { news: false });
  const r2 = raidPoiAsGroup(st, f, t, i, 0.2, { news: false, vehicle: true });
  check(r1 && !r1.pieces, "on foot: no piece");
  check(r2 && (r2.took > 0 ? r2.pieces === true : !r2.pieces), `by vehicle: the flag (${r2 ? r2.pieces : "none"})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
