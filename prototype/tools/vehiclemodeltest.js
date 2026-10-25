// The vehicles as low-poly models on the battle map (src/ui/vehiclemodel.js, drawn by ui/isoview.js) and the State
// Map's vehicle pieces by type (ui/mapfigures.js, ui/mapsprites.js, ui/render.js vehicleKind); the user's ask 2026-10-25:
// "Improve the look of the vehicles in raid/crawls, make them look similar to the current world map vehicle sprite and
// change the world map vehicle sprites to change based on the type of vehicle".
// - modelOf: the team's vehicle by its type (a pickup, a sedan, an SUV, a Hummer, a van, the Army truck, a bicycle),
//   the Army trucks by their body, the map's box trucks, a parked car a sedan at 2 × 3 and a van or a pickup by its dice;
//   lookOf: the team's own in blue, a blown-up one burnt out, the enemy's Humvee armed, a parked car in its dice's colour;
// - every model builds limbs with finite points, at every heading step, with and without upgrades;
// - a car's cells each get a share of one painting (no cell empty, the shares' pixels together the whole car's, every
//   share placed from the cell's own corner), one painting a look (the cache), another heading another picture;
// - on a raid's map the team's vehicle carries its type (sim/combat.js fitMapVehicle) and the fleet's others theirs
//   (placeRaidConvoy); the view draws them as models (vehicleArtStats) in the diagonal views and the straight one (its own
//   projection: a share placed from the cell's top-left corner); a car on one cell (no c.car) as the model shrunk onto it;
// - the windows' pictures: vehicleImg gives every type its own <img> from a vehicle record (its upgrades, a wreck, a bike
//   stack, another group's colour), kept by look; the trip planner's vehicle buttons carry them;
// - the State Map: pieces for an SUV, a van and a Hummer that differ from each other and from the sedan's; the flat
//   sprites and the parked markers for them paint; render.js vehicleKind maps a vehicle's type to its piece.
// Usage: node tools/vehiclemodeltest.js [seed]   (a few seconds)
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { createVehicle, fitMilitary } from "../src/sim/vehicles.js";
import { createBattle, registerCombatHandler } from "../src/sim/combat.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { launchExpedition } from "../src/sim/parties.js";

const SEED = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); };
const section = (s) => console.log(`\n${s}`);
registerCombatHandler("vmt", () => {});
const inBrowser = (fn) => { const had = "window" in globalThis; if (!had) globalThis.window = {}; try { return fn(); } finally { if (!had) delete globalThis.window; } };

// A stub canvas whose context keeps the ImageData put on it (the models' cells, the view's sprites) and counts NaNs.
let nan = 0;
function stubCanvas(w = 0, h = 0) {
  const cv = { width: w, height: h, img: null, toDataURL: () => "data:," };
  const ctx = new Proxy({ createImageData: (cw, ch) => ({ width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) }), putImageData(img) { cv.img = img; }, measureText: (t) => ({ width: String(t).length * 6 }), getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) }, {
    get: (o, k) => (k in o ? o[k] : (...a) => { if (a.some((x) => typeof x === "number" && !Number.isFinite(x))) nan++; }),
    set: (o, k, x) => { if (typeof x === "number" && !Number.isFinite(x)) nan++; o[k] = x; return true; },
  });
  cv.getContext = () => ctx;
  return cv;
}
globalThis.document = { createElement: () => stubCanvas(), getElementById: () => null, body: { appendChild() {} } };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
const VM = await import("../src/ui/vehiclemodel.js");
const ISO = await import("../src/ui/isoview.js");
const UI = await import("../src/ui/combat.js");
const MF = await import("../src/ui/mapfigures.js");
const MS = await import("../src/ui/mapsprites.js");
const R = await import("../src/ui/render.js");
ISO.setIsoCanvas(stubCanvas);
VM.setVehicleCanvas(stubCanvas);
const solid = (cv) => { let n = 0; if (!cv || !cv.img) return 0; for (let i = 3; i < cv.img.data.length; i += 4) if (cv.img.data[i] === 255) n++; return n; };

// ---------------------------------------------------------------------------------------------------------------
section("Which model, in what look");
{
  const own = (type, body = "car", L = 3) => ({ kind: "vehicle", body, type, L, ax: "x", v: 0 });
  const by = Object.fromEntries([["truck", "truck"], ["sedan", "car"], ["suv", "car"], ["hummer", "car"], ["van", "car"], ["miltruck", "m35"], ["bike", "bike"]].map(([t, b]) => [t, VM.modelOf(own(t, b))]));
  check(by.truck === "pickup" && by.sedan === "sedan" && by.suv === "suv" && by.hummer === "humvee" && by.van === "van" && by.miltruck === "m35" && by.bike === "bicycle", `the team's vehicle by its type: ${JSON.stringify(by)}`);
  check(VM.modelOf({ kind: "vehicle", body: "truck", L: 4, ax: "x" }) === "pickup" && VM.modelOf({ kind: "vehicle", body: "car", L: 3, ax: "x" }) === "sedan", "without a type (an older battle): a pickup or a sedan by the body");
  check(VM.modelOf({ kind: "truck", body: "humvee", L: 4 }) === "humvee" && VM.modelOf({ kind: "truck", body: "mrap", L: 4 }) === "mrap" && VM.modelOf({ kind: "truck", body: "m35", L: 5 }) === "m35" && VM.modelOf({ kind: "truck", body: "truck", L: 4 }) === "boxtruck", "the Army trucks by their body, the map's trucks box trucks");
  check(VM.modelOf({ kind: "car", body: "car", L: 3, v: 2 }) === "sedan" && VM.modelOf({ kind: "car", body: "car", L: 4, v: 3 }) === "van" && VM.modelOf({ kind: "car", body: "car", L: 4, v: 4 }) === "pickup", "a parked car: a sedan at 2 × 3, a van or a pickup at 2 × 4 by its dice");
  const mine = VM.lookOf(own("suv")), burnt = VM.lookOf({ ...own("sedan"), wrecked: true }), foe = VM.lookOf({ kind: "truck", body: "humvee", L: 4, v: 0, mil: { kind: "humvee", cond: "intact", enemy: true }, up: { p: 1, s: 0, g: 1, m: 0, t: "m2hb" } });
  const parked = VM.lookOf({ kind: "car", body: "car", L: 3, v: 2 }), army = VM.lookOf(own("miltruck", "m35", 5));
  check(mine.color === VM.TEAM_BLUE && !mine.rust && !mine.gun, "the team's SUV in the team's blue, no rust");
  check(burnt.burnt && burnt.cond === "burnt", "a blown-up vehicle burnt out");
  check(foe.gun && foe.turret === "m2hb" && foe.glass === 1 && foe.plating === 1 && foe.color !== VM.TEAM_BLUE, "the raid's Humvee: olive, armed, plated and glassed as its cells say");
  check(parked.color === VM.CAR_COLORS[2] && parked.rust, "a parked car in its dice's colour, rusting");
  check(army.tint === VM.TEAM_BLUE && army.color !== VM.TEAM_BLUE, "the team's Army truck olive, its canvas tinted the team's blue");
}

section("Every model builds, at every heading");
{
  const finite = (F) => F.every((q) => [...q.A, ...q.B, q.ra, q.rb].every(Number.isFinite));
  for (const m of VM.MODEL_NAMES) {
    const plain = VM.vehicleLimbs(m, { color: "#3b5a7a", seed: 2 }, m === "bicycle" ? 2 : m === "m35" ? 5 : 4);
    const armed = VM.vehicleLimbs(m, { color: "#3b5a7a", seed: 2, plating: 2, glass: 1, turret: "m2hb", manned: true, scrap: 0 }, m === "bicycle" ? 2 : 4);
    const burnt = VM.vehicleLimbs(m, { color: "#2b2723", burnt: true, cond: "burnt", seed: 2 }, 4);
    check(plain.length >= 7 && finite(plain) && finite(armed) && finite(burnt) && (m === "bicycle" || m === "boxtruck" || armed.length > plain.length), `${m}: ${plain.length} limbs plain, ${armed.length} armed, ${burnt.length} burnt out`);
  }
  let ok = true, cells = 0;
  const car = { kind: "vehicle", body: "truck", type: "truck", L: 4, ax: "x", v: 0, up: { p: 1, s: 0, g: 0, m: 1, t: "lmg", manned: false } };
  for (let yaw = 0; yaw < 360; yaw += 15) for (let i = 0; i < 4 && ok; i++) for (let j = 0; j < 2 && ok; j++) { const s = VM.vehicleCellSprite({ ...car, i, j }, yaw); if (!s || !(s.w > 0 && s.h > 0) || !solid(s.cv)) ok = false; else cells++; }
  check(ok && cells === 24 * 8 && !nan, `a plated pickup: every cell a picture with pixels at all 24 headings (${cells} cells, ${nan} NaN)`);
}

section("A car's cells share one painting");
{
  const car = { kind: "car", body: "car", L: 4, ax: "y", v: 4 };
  const whole = VM.vehiclePainting(car, 90), wholePx = whole.px.filter(Boolean).length; // (its own painting, before the count)
  const n0 = VM.vehicleArtStats.painted;
  const shares = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) shares.push(VM.vehicleCellSprite({ ...car, i, j }, 90));
  check(VM.vehicleArtStats.painted === n0 + 1, `one painting for the eight cells (${VM.vehicleArtStats.painted - n0} painted)`);
  const px = shares.map((s) => solid(s.cv));
  const sum = px.reduce((a, b) => a + b, 0), k = Math.max(1, Math.round(Math.sqrt(sum / wholePx))); // a painted px is k × k canvas px (the picture pre-scaled)
  check(px.every((n) => n > 0) && sum >= wholePx * k * k && sum <= wholePx * k * k * 1.6, `every cell has pixels (${px.join(", ")}): together the whole car's ${wholePx} (× ${k * k} canvas px each) and its outline (${sum})`);
  const corners = new Set(shares.map((s) => `${s.ox},${s.oy}`));
  check(corners.size === shares.length, "each share placed from its own cell's corner");
  const again = VM.vehicleCellSprite({ ...car, i: 1, j: 0 }, 90);
  check(VM.vehicleArtStats.painted === n0 + 1 && again.w === shares[2].w && again.h === shares[2].h, "asked again: from the painting kept, nothing painted anew");
  const turned = VM.vehicleCellSprite({ ...car, i: 1, j: 0 }, 0);
  check(VM.vehicleArtStats.painted === n0 + 2 && (turned.w !== again.w || turned.h !== again.h || solid(turned.cv) !== solid(again.cv)), "another heading: another painting, another picture");
  const fogged = VM.vehicleCellSprite({ ...car, i: 1, j: 0 }, 90, { fog: true }), snowy = VM.vehicleCellSprite({ ...car, i: 1, j: 0 }, 90, { sn: 0.75 });
  const dark = (cv) => { let l = 0, n = 0; for (let i = 0; i < cv.img.data.length; i += 4) if (cv.img.data[i + 3] === 255) { l += cv.img.data[i] + cv.img.data[i + 1] + cv.img.data[i + 2]; n++; } return l / Math.max(1, n); };
  check(dark(fogged.cv) < dark(again.cv) * 0.8, `under the fog of war the share is darker (${Math.round(dark(fogged.cv))} vs ${Math.round(dark(again.cv))})`);
  check(dark(snowy.cv) > dark(again.cv) * 1.05, `with snow lying its tops are whiter (${Math.round(dark(snowy.cv))})`);
  check(!nan, `no NaN drawn (${nan})`);
}

section("On the raid's map: the team's fleet by type, drawn as models");
{
  let st = null, tile = null;
  for (let i = 0; i < 6 && tile == null; i++) { st = createWorld({ seed: SEED * 100 + i, factionCount: 6 }); const h = hub(st); tile = (st.tiles.find((t) => t.id !== h.tile && t.loc && !st.bases.some((b) => b.tile === t.id)) || {}).id; }
  const h = hub(st);
  h.stock.fuel = (h.stock.fuel || 0) + 100;
  const suv = createVehicle(st, "suv", { kind: "base", baseId: h.id }, { fuel: 24, condition: 90 });
  const van = createVehicle(st, "van", { kind: "base", baseId: h.id }, { fuel: 20, condition: 90 });
  fitMilitary(suv, "m2hb");
  const res = launchExpedition(st, { memberIds: atBase(st, h.id).slice(0, 3).map((s) => s.id), dest: tile, mission: "move", stance: "normal", vehicleId: suv.id, vehicleIds: [suv.id, van.id], supplies: { food: 6, water: 6, fuel: 4 } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.phase = "waiting"; p.dest = tile;
  st.combat = inBrowser(() => createBattle(st, { mode: "raid", tile, partyId: p.id, canRetreat: true, ambush: null, handler: "vmt", enemy: { kind: "mixed", count: 1, power: 3, groups: raidEnemies(st, tile) }, raid: { heat0: 5 }, context: {} }));
  const b = st.combat;
  check(b.vehicle && b.vehicle.type === "suv" && b.cells.some((c) => c.k === "vehicle" && c.car && c.car.type === "suv" && c.car.up && c.car.up.t === "m2hb"), `the team's SUV on the map carries its type and its turret (${b.vehicle && b.vehicle.type})`);
  check((b.convoy || []).some((c) => c.type === "van") && b.cells.some((c) => c.k === "vehicle" && c.car && c.car.type === "van"), `the fleet's van beside it carries its type (${(b.convoy || []).map((c) => c.type).join(", ") || "no convoy"})`);
  UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => stubCanvas().getContext() });
  const n0 = VM.vehicleArtStats.painted, c0 = VM.vehicleArtStats.cells;
  let err = "";
  try { ISO.isoCenterOn(b, b.vehicle.x, b.vehicle.y, false); UI.drawCombat(st, 1e9); } catch (e) { err = e.stack.split("\n").slice(0, 3).join(" "); }
  check(!err && !nan && VM.vehicleArtStats.painted >= n0 + 2 && VM.vehicleArtStats.cells >= c0 + 6, `the view draws the SUV and the van as models (${VM.vehicleArtStats.painted - n0} painted, ${VM.vehicleArtStats.cells - c0} cells)${err ? `: ${err}` : ""}`);
  // The straight view: the models in its own projection.
  for (let g = 0; g < 8 && !ISO.iso.straight; g++) ISO.isoRotate(b, 1);
  const n1 = VM.vehicleArtStats.painted, c1 = VM.vehicleArtStats.cells;
  try { b.rev = (b.rev || 0) + 1; UI.drawCombat(st, 2e9); } catch (e) { err = e.stack.split("\n").slice(0, 3).join(" "); }
  check(ISO.iso.straight && !err && !nan && VM.vehicleArtStats.painted >= n1 + 2 && VM.vehicleArtStats.cells >= c1 + 6, `the straight view draws them as models too (${VM.vehicleArtStats.painted - n1} painted, ${VM.vehicleArtStats.cells - c1} cells)${err ? `: ${err}` : ""}`);
  st.combat = null;
}

section("The straight view's projection and a car on one cell");
{
  const car = { kind: "vehicle", body: "car", type: "sedan", L: 3, ax: "x", v: 0 };
  const iso = VM.vehicleCellSprite({ ...car, i: 1, j: 0 }, 0), st = VM.vehicleCellSprite({ ...car, i: 1, j: 0 }, 0, { straight: true });
  check(iso && st && solid(st.cv) > 0 && (st.w !== iso.w || st.h !== iso.h || solid(st.cv) !== solid(iso.cv)), `a straight-view share is its own picture (${st.w} × ${st.h} vs ${iso.w} × ${iso.h} art px)`);
  const shares = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) shares.push(VM.vehicleCellSprite({ ...car, i, j }, 0, { straight: true }));
  const whole = VM.vehiclePainting(car, 0, true).px.filter(Boolean).length, sum = shares.reduce((a, s) => a + solid(s.cv), 0), k = Math.max(1, Math.round(Math.sqrt(sum / whole)));
  check(shares.every((s) => s && solid(s.cv) > 0) && sum >= whole * k * k && sum <= whole * k * k * 1.6 && new Set(shares.map((s) => `${s.ox},${s.oy}`)).size === 6, `its six cells share one straight-view painting, each placed from its own corner (${whole} px)`);
  const flat = VM.vehiclePainting(car, 0, true), tall = VM.vehiclePainting(car, 0, false);
  const rows = (p) => { let y0 = p.h, y1 = -1; for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (p.px[y * p.w + x]) { if (y < y0) y0 = y; if (y > y1) y1 = y; } return y1 - y0 + 1; };
  check(rows(flat) < rows(tall), `in the straight view the car is drawn flatter (${rows(flat)} vs ${rows(tall)} grid rows: v foreshortened to ${11 / 16} of a tile)`);
  const one = ["car", "truck", "vehicle"].map((kind) => VM.vehicleOneSprite(kind, 9, "u"));
  check(one.every((s) => s && solid(s.cv) > 0 && s.w <= 34 && s.h <= 30), `a car on one cell: a small model within its cell's diamond (${one.map((s) => `${s.w} × ${s.h}`).join(", ")} art px)`);
  const turned = VM.vehicleOneSprite("car", 9, "v"), straight = VM.vehicleOneSprite("car", 9, "u", { straight: true });
  const pic = (s) => (s && s.cv.img ? s.cv.img.data.join("") : "");
  check(turned && straight && pic(turned) !== pic(one[0]) && pic(straight) !== pic(one[0]) && solid(straight.cv) > 0, "along the other axis, and in the straight view: their own pictures");
  check(!nan, `no NaN drawn (${nan})`);
}

section("The State Map: pieces and sprites by type");
{
  const kinds = ["sedan", "suv", "van", "hummer", "truck", "miltruck"];
  const pics = kinds.map((k) => MF.mapPartyCanvas(k, "#4f8fd6", 3, "", 330, 0));
  const keys = pics.map((cv) => (cv && cv.img ? cv.img.data.join("") : ""));
  check(pics.every((cv) => cv && cv.grid && solid(cv) > 0) && new Set(keys).size === kinds.length, `pieces for ${kinds.join(", ")}: each painted, all different`);
  const armed = MF.mapPartyCanvas("hummer", "#4f8fd6", 3, "p1s0g1m0tm2hb", 330, 0);
  check(armed && armed.img && armed.img.data.join("") !== keys[3], "the Hummer with plates, glass and an M2: another picture");
  let ok = true;
  try { for (const k of ["suv", "van", "hummer"]) { MS.partySpriteCanvas(k, "#4f8fd6", 3); MS.partySpriteCanvas(k, "#4f8fd6", 3, "p2s0g1m0tm2hb"); MS.markerSpriteCanvas("vehicle", "#4f8fd6", { vehicle: k, needsFuel: true, damaged: true, ups: "p1s0g0m1t" }); } } catch (e) { ok = false; console.log(e.stack.split("\n").slice(0, 3).join(" ")); }
  check(ok, "the flat sprites and the parked markers for an SUV, a van and a Hummer paint, with upgrades");
  const map = Object.fromEntries(["truck", "sedan", "suv", "hummer", "van", "miltruck", "bike"].map((t) => [t, R.vehicleKind({ type: t })]));
  check(map.truck === "truck" && map.sedan === "sedan" && map.suv === "suv" && map.hummer === "hummer" && map.van === "van" && map.miltruck === "miltruck" && map.bike === "truck" && R.vehicleKind(null) === "truck", `render.js vehicleKind: ${JSON.stringify(map)}`);
}

section("The windows' pictures");
{
  const urlOf = (html) => (html.match(/src="([^"]*)"/) || [])[1] || "";
  const types = ["truck", "sedan", "suv", "hummer", "van", "miltruck", "bike"];
  const n0 = VM.vehicleArtStats.painted;
  const imgs = types.map((t, i) => VM.vehicleImg({ id: 10 + i, type: t, upgrades: {} }, 2));
  check(imgs.every((h) => /^<img class="sprite vehimg" src="data:/.test(h) && /height:2rem;width:[0-9.]+rem/.test(h)), "every type an <img> of its model, 2 rem tall, its width to match");
  const cars = types.map((t) => VM.carImgURL(VM.vehicleCar({ id: 1, type: t })));
  check(new Set(cars.map((c) => `${c.w}x${c.h}`)).size >= 5 && VM.vehicleArtStats.painted === n0 + types.length, `each type its own painting (${cars.map((c) => `${c.w}×${c.h}`).join(", ")} art px)`);
  VM.vehicleImg({ id: 12, type: "suv", upgrades: {} }, 3);
  check(VM.vehicleArtStats.painted === n0 + types.length, "asked again at another size: the picture kept, nothing painted anew");
  const armed = VM.carImgURL(VM.vehicleCar({ id: 1, type: "suv", upgrades: { plating: 1, glass: 1, turret: { gun: "m2hb" } } })), wreck = VM.carImgURL(VM.vehicleCar({ id: 1, type: "suv", destroyed: true })), theirs = VM.carImgURL(VM.vehicleCar({ id: 1, type: "suv" }, { color: "#7a1a1a" }));
  check(VM.vehicleArtStats.painted === n0 + types.length + 3 && armed.h > cars[2].h, `with upgrades (the gun on the roof: ${armed.h} vs ${cars[2].h} art px tall), blown up, and in another group's colour: their own paintings`);
  check(wreck.w === cars[2].w && theirs.w === cars[2].w, "the same car otherwise");
  const bike = VM.vehicleCar({ id: 2, type: "bike", count: 3 });
  check(bike.body === "bike" && VM.modelOf(bike) === "bicycle" && VM.vehicleCar({ id: 3, type: "miltruck" }).body === "m35" && VM.vehicleCar({ id: 4 }).type === "truck", "a bike stack a bicycle, the Army truck the M35, an unknown type a pickup");
  check(urlOf(imgs[0]) === urlOf(VM.vehicleImg({ id: 99, type: "truck", upgrades: {} }, 1)), "two pickups alike share one picture (kept by look, not by vehicle)");
  // The trip planner's vehicle buttons carry the pictures.
  const FP = await import("../src/ui/fleetpick.js");
  const st = createWorld({ seed: SEED, factionCount: 6 }), h = hub(st);
  const suv = createVehicle(st, "suv", { kind: "base", baseId: h.id }, { fuel: 20, condition: 80 });
  const html = FP.fleetPicker(st, { base: h, ids: [], crewN: 2, cans: 0, action: "tf-vehicle" });
  check((html.match(/<img class="sprite vehimg"/g) || []).length >= 1 && html.includes(suv.name), `the trip planner's vehicle buttons carry their pictures (${(html.match(/<img class="sprite vehimg"/g) || []).length} on the hub's)`);
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
