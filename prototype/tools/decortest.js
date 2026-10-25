// Interior decor (sim/decor.js; sim/buildingmaps.js assemble; ui/isoview.js floorColor, decoTexel, the wall case of
// primsOf), issue #13 of the interiors epic (the user's request 2026-10-25: "filled with appliances, furniture and decor
// that makes it feel lived in"):
//   1. decor never changes a cell's kind (walk, cover, sight: combat.js CELL), nor the containers or any other roll of
//      the map: the same building assembled bare (opts.noDecor) is the same map without it, but for the catalogue's
//      lootable plants and floor lamps (data-furniture.js) stood on open floor; the paintings and wall clocks hang on
//      the walls marked piece;
//   2. rugs lie wholly inside their room, as one rectangle of 2 × 3 to 3 × 4 cells with its border on its outer sides;
//   3. wall art only on wall cells next to a floor cell of its room (on the side it faces); wall colours on room cells;
//   4. broken glass only under a broken window (and under every one with floor inside); leaves only by an open door;
//   5. the same building rolls the same decor twice; a south-row house of a street keeps its art facing its room;
//   6. the new floors on the rooms (lino, checker, hardwood, plank, rubber, steel); the survivors' room swept (tidyDecor);
//   7. restoreBuilding keeps it (a building left and come back to);
//   8. the view on stub canvases: drawn without error, the decor painted into the ground once (not every frame), the
//      walls' inside faces and art in their sprites' keys; tools/isobattles.js's decor layouts (a house, a hospital)
//      drawn at every turn of the view.
// Usage: node tools/decortest.js [seeds]
import { createWorld } from "../src/sim/world.js";
import { CELL } from "../src/sim/combat.js";
import { BUILDINGS, ROLES, assemble, streetMap } from "../src/sim/buildingmaps.js";
import { DECOR, WALL_ART, WALLC, tidyDecor } from "../src/sim/decor.js";
import { pieceDef } from "../src/sim/data-furniture.js";
import { snapshotBuilding, restoreBuilding } from "../src/sim/citycrawl.js";
import { Rng } from "../src/sim/rng.js";
import { battles } from "./isobattles.js";

const SEEDS = Number(process.argv[2] || (process.env.BS_QUICK ? 4 : 10));
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return !!ok; };
const t0 = performance.now();
const KEYS = ["house", "cabin", "apartments", "hospital", "clinic", "school", "offices", "police", "barn", "church", "garage", "autoshop", "motel", "library", "store", "warehouse", "barracks", "messhall"].filter((k) => BUILDINGS[k]);
const build = (key, seed, o = {}) => { const spec = BUILDINGS[key].make(new Rng(seed)); return assemble(new Rng(seed), spec, { key, name: BUILDINGS[key].name, ...o }); };
const floorsOf = (m) => (m.floors || [{ cells: m.cells }]).map((F, f) => ({ f, cells: F.cells }));
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const PIECES = new Set(["plant", "floorlamp"]); // the lootable decor that stands on a cell (data-furniture.js)
const decorOf = (m) => JSON.stringify(floorsOf(m).map(({ cells }) => cells.map((c) => [c.deco || 0, c.wart || 0, c.wc || 0])));
const roomAt = (m, f, x, y) => m.rooms.find((r) => !r.outdoor && (r.f || 0) === f && x > r.x0 && x < r.x0 + r.w - 1 && y > r.y0 && y < r.y0 + r.h - 1);

// ---------- 1. decor changes nothing but the look ----------
console.log("Decor changes nothing but the look");
{
  let maps = 0, sameK = true, sameBoxes = true, decoCells = 0, artCells = 0, onlyLook = true, pieces = 0;
  for (const key of KEYS) for (let s = 1; s <= SEEDS; s++) {
    const m = build(key, s * 7919), bare = build(key, s * 7919, { noDecor: true });
    maps++;
    floorsOf(m).forEach(({ f, cells }) => {
      const bc = floorsOf(bare)[f].cells;
      cells.forEach((c, i) => {
        if (PIECES.has(c.k) && bc[i].k === "open") { pieces++; return; } // the catalogue's plant or floor lamp stood there
        if (c.k !== bc[i].k || CELL[c.k].walk !== CELL[bc[i].k].walk || CELL[c.k].cover !== CELL[bc[i].k].cover || CELL[c.k].los !== CELL[bc[i].k].los) sameK = false;
        const extra = Object.keys(c).filter((k) => !(k in bc[i]));
        if (extra.some((k) => k !== "deco" && k !== "wart" && k !== "wc")) onlyLook = false;
        if (c.deco) decoCells++;
        if (c.wart) artCells++;
      });
    });
    if (JSON.stringify(m.containers) !== JSON.stringify(bare.containers) || JSON.stringify(m.exits) !== JSON.stringify(bare.exits)) sameBoxes = false;
  }
  check(sameK, `${maps} buildings: every cell's kind (walk, cover, sight) the same as the bare map's, but for the catalogue's plants and floor lamps on open floor (${pieces})`);
  check(pieces > 0, "plants and floor lamps stood in rooms");
  check(sameBoxes, "the containers and the exits the same: decor rolls none of the map's dice");
  check(onlyLook, "decor adds only deco, wart and wc to a cell");
  check(decoCells > maps * 5 && artCells > maps, `decor laid: ${decoCells} floor cells, ${artCells} pieces of wall art`);
}

// ---------- 2–4. where it lies ----------
console.log("Where it lies");
{
  const pieceArt = [], plainArt = [];
  let rugs = 0, rugBad = [], artBad = [], glassBad = 0, glassMissing = 0, glass = 0, leavesBad = 0, wcBad = 0, artKinds = new Set(), decoKinds = new Set(), lights = 0;
  for (const key of KEYS) for (let s = 1; s <= SEEDS; s++) {
    const m = build(key, s * 104729);
    for (const { f, cells } of floorsOf(m)) {
      const W = m.w, at = (x, y) => (x >= 0 && y >= 0 && x < W && y < m.h ? cells[y * W + x] : null);
      const seen = new Uint8Array(cells.length);
      cells.forEach((c, i) => {
        const x = i % W, y = (i / W) | 0;
        if (c.deco) { decoKinds.add(c.deco.k); if (c.deco.lt) lights++; }
        if (c.wc && !roomAt(m, f, x, y) && c.k !== "stairs") wcBad++;
        // A rug: its rectangle (from its top-left corner, edge bits 1 and 4), wholly inside one room.
        if (c.deco && c.deco.k === "rug" && !seen[i] && (c.deco.e & 1) && (c.deco.e & 4)) {
          let w = 1, h = 1;
          while (at(x + w, y) && at(x + w, y).deco && at(x + w, y).deco.k === "rug" && !(at(x + w - 1, y).deco.e & 8)) w++;
          while (at(x, y + h) && at(x, y + h).deco && at(x, y + h).deco.k === "rug" && !(at(x, y + h - 1).deco.e & 2)) h++;
          const room = roomAt(m, f, x, y);
          let whole = !!room && Math.min(w, h) >= 2 && Math.min(w, h) <= 3 && Math.max(w, h) >= 3 && Math.max(w, h) <= 4;
          for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
            const q = at(xx, yy);
            seen[yy * W + xx] = 1;
            if (!q || !q.deco || q.deco.k !== "rug" || roomAt(m, f, xx, yy) !== room) whole = false;
          }
          rugs++;
          if (!whole) rugBad.push(`${key}#${s} f${f} (${x},${y}) ${w}×${h}`);
        }
        if (c.wart) {
          artKinds.add(c.wart.k);
          (c.wart.k === "painting" || c.wart.k === "wallclock" ? pieceArt : plainArt).push(c.wart);
          const [dx, dy] = D4[c.wart.d] || [0, 0], fl = at(x + dx, y + dy);
          if (c.k !== "wall" || !WALL_ART[c.wart.k] || !fl || fl.f !== "floor" || !roomAt(m, f, x + dx, y + dy)) artBad.push(`${key}#${s} f${f} (${x},${y}) ${c.wart.k}`);
        }
        if (c.deco && c.deco.k === "glass") { glass++; if (!D4.some(([dx, dy]) => at(x + dx, y + dy) && at(x + dx, y + dy).k === "smashed")) glassBad++; }
        if (c.deco && c.deco.k === "leaves" && !D4.some(([dx, dy]) => [[dx, dy], [2 * dx, 2 * dy]].some(([ax, ay]) => at(x + ax, y + ay) && (at(x + ax, y + ay).k === "odoor" || at(x + ax, y + ay).k === "doorway")))) leavesBad++;
        // Every broken window with open floor inside it (a room's side opposite the outside) has glass there.
        if (c.k === "smashed") for (const [dx, dy] of D4) {
          const ic = at(x + dx, y + dy), oc = at(x - dx, y - dy);
          if (ic && oc && ic.k === "open" && roomAt(m, f, x + dx, y + dy) && oc.f !== "floor" && !(ic.deco && ic.deco.k === "glass")) glassMissing++;
        }
      });
    }
  }
  check(rugs > 0 && !rugBad.length, `${rugs} rugs, each one rectangle of 2 × 3 to 3 × 4 wholly inside its room${rugBad.length ? `: ${rugBad.slice(0, 4).join("; ")}` : ""}`);
  check(!artBad.length, `wall art only on wall cells, facing a floor cell of a room (${[...artKinds].join(", ")})${artBad.length ? `: ${artBad.slice(0, 4).join("; ")}` : ""}`);
  check(artKinds.size >= 6, `${artKinds.size} kinds of wall art seen`);
  check(artKinds.has("painting") && artKinds.has("wallclock") && pieceArt.every((w) => w.piece && pieceDef(w.k) && pieceDef(w.k).carry === "one") && !plainArt.some((w) => w.piece), `the catalogue's paintings and wall clocks hang among the wall art, marked piece (${pieceArt.length})`);
  check(glass > 0 && glassBad === 0, `broken glass only under a broken window (${glass} cells)`);
  check(glassMissing === 0, `glass under every broken window with open floor inside (${glassMissing} missing)`);
  check(leavesBad === 0, "leaves only in from an open outer door or a doorway");
  check(wcBad === 0, "wall colours only on a room's cells");
  check(lights > 0, `light fixtures overhead (${lights} cells)`);
  const want = ["rug", "papers", "books", "trash", "tins", "clothes", "crack", "stain", "oil", "straw", "light"];
  check(want.every((k) => decoKinds.has(k)), `the floor's decor kinds seen: ${[...decoKinds].join(", ")}`);
  check(Object.keys(DECOR).every((r) => ROLES[r]) && Object.keys(WALLC).every((r) => ROLES[r]), "DECOR and WALLC name real room roles");
}

// ---------- 5. the same building twice; a street's flipped houses ----------
console.log("The same building twice");
{
  let same = true;
  for (const key of KEYS) for (let s = 1; s <= Math.min(SEEDS, 4); s++) if (decorOf(build(key, s * 31)) !== decorOf(build(key, s * 31))) same = false;
  check(same, "the same building rolls the same decor twice");
  const st = createWorld({ seed: 11, factionCount: 6 });
  const tile = st.tiles.find((t) => t.terrain !== "water").id;
  const sm = streetMap(st, tile, { id: "poi0:neighbourhood", key: "street", name: "Street" });
  let art = 0, bad = 0, rugs = 0;
  for (const F of sm.floors || [{ cells: sm.cells }]) F.cells.forEach((c, i) => {
    const x = i % sm.w, y = (i / sm.w) | 0;
    if (c.deco && c.deco.k === "rug") rugs++;
    if (!c.wart) return;
    art++;
    const [dx, dy] = D4[c.wart.d], q = F.cells[(y + dy) * sm.w + x + dx];
    if (c.k !== "wall" || !q || q.f !== "floor" || !q.wc && !q.fl) bad++;
  });
  check(art > 0 && bad === 0 && rugs > 0, `a street of houses: ${art} pieces of wall art all facing a room (south-row houses flipped with them), ${rugs} rug cells`);
}

// ---------- 6. the floors; the survivors' room swept ----------
console.log("The floors");
{
  const fls = new Set();
  for (const key of KEYS) for (let s = 1; s <= 3; s++) for (const { cells } of floorsOf(build(key, s * 13))) for (const c of cells) if (c.fl) fls.add(c.fl);
  check(["lino", "checker", "hardwood", "plank", "rubber", "steel"].every((k) => fls.has(k)), `the new floors laid: ${[...fls].join(", ")}`);
  check(ROLES.kitchen.fl === "lino" && ROLES.bath.fl === "checker" && ROLES.gym.fl === "rubber" && ROLES.bays.fl === "steel" && ROLES.living.fl === "hardwood" && ROLES.barnfloor.fl === "dirt", "kitchens lino, baths checker, gyms rubber, bays steel, homes hardwood");
  const m = build("apartments", 5);
  const room = m.rooms.find((r) => !r.outdoor && r.role === "apt");
  const cells = (m.floors ? m.floors[room.f || 0].cells : m.cells).map((c) => ({ ...c, deco: c.deco ? { ...c.deco } : undefined }));
  for (let y = room.y0 + 1; y < room.y0 + room.h - 1; y++) for (let x = room.x0 + 1; x < room.x0 + room.w - 1; x++) { const c = cells[y * m.w + x]; if (c.k === "open" && !c.deco) c.deco = { k: "trash", v: 0 }; }
  const rugBefore = cells.filter((c) => c.deco && c.deco.k === "rug").length;
  tidyDecor(cells, m.w, room);
  let left = 0;
  for (let y = room.y0 + 1; y < room.y0 + room.h - 1; y++) for (let x = room.x0 + 1; x < room.x0 + room.w - 1; x++) { const c = cells[y * m.w + x]; if (c.deco && (c.deco.k === "trash" || c.deco.k === "clothes" || c.deco.k === "papers")) left++; }
  check(left === 0 && cells.filter((c) => c.deco && c.deco.k === "rug").length === rugBefore, "tidyDecor: the survivors' room swept of trash, clothes and papers, its rug kept");
}

// ---------- 7. restoreBuilding ----------
console.log("Back in the building");
const [{ st: vst, b: vb }] = battles(42, ["raid-building"]);
{
  const fl = (b) => (b.floors ? b.floors.map((F) => F.cells) : [b.cells]);
  const look = (b) => JSON.stringify(fl(b).map((cs) => cs.map((c) => [c.deco || 0, c.wart || 0, c.wc || 0])));
  const before = look(vb), had = fl(vb).flat().filter((c) => c.deco).length;
  const snap = snapshotBuilding(vb);
  for (const cs of fl(vb)) for (const c of cs) { delete c.deco; delete c.wart; delete c.wc; }
  const ok = restoreBuilding(vst, vb, snap);
  check(ok && had > 0 && look(vb) === before, `restoreBuilding: the decor as it was (${had} floor cells)`);
}

// ---------- 8. the view ----------
console.log("The view");
{
  const ISO = await import("../src/ui/isoview.js");
  const UI = await import("../src/ui/combat.js");
  let imgs = null, nan = 0;
  const silent = () => new Proxy({ createImageData: (w, h2) => ({ width: w, height: h2, data: new Uint8ClampedArray(w * h2 * 4) }), putImageData: (img) => { if (imgs) imgs.push(img); }, measureText: (t) => ({ width: String(t).length * 6 }) }, {
    get: (o, k) => (k in o ? o[k] : (...a) => { if (a.some((v) => typeof v === "number" && !Number.isFinite(v))) nan++; }),
    set: (o, k, v) => { if (typeof v === "number" && !Number.isFinite(v)) nan++; o[k] = v; return true; },
  });
  const cvs = (w, h2) => { const cv = { width: w, height: h2, toDataURL: () => "data:," }; const g = silent(); cv.getContext = () => g; return cv; };
  globalThis.document = globalThis.document || { createElement: () => cvs(0, 0), getElementById: () => null };
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  ISO.setIsoCanvas(cvs);
  UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent() });
  let clock = 1e6;
  const frame = (b) => {
    vst.combat = b;
    imgs = [];
    const g0 = ISO.iso.builds.ground;
    let err = "";
    try { clock += 50; UI.drawCombat(vst, clock); } catch (e) { err = e.stack.split("\n").slice(0, 3).join(" "); }
    let sum = 0;
    for (const im of imgs) if (im.width % 16 === 0 && im.height % 16 === 0) for (let i = 0; i < im.data.length; i += 4) sum = (sum + im.data[i] * 3 + im.data[i + 1] * 5 + im.data[i + 2] * 7) % 1e9;
    imgs = null;
    return { err, ground: ISO.iso.builds.ground - g0, sum };
  };
  ISO.setRoofs(false); // every building cut away: the inside walls seen
  const a = frame(vb), a2 = frame(vb);
  check(!a.err && a.ground >= 1 && a2.ground === 0, `a building's raid drawn with its decor, the ground painted once (${a.ground}, then ${a2.ground})${a.err ? ` (${a.err})` : ""}`);
  const keys = ISO.isoSpriteKeys();
  check(keys.some((k) => k.includes("|w")), "walls with a room's paint or art cached as their own sprites");
  const saved = vb.cells.map((c) => c.deco);
  for (const c of vb.cells) delete c.deco;
  const bare = frame(vb);
  check(!bare.err && bare.ground >= 1 && bare.sum !== a.sum, "taking the decor off repaints the ground, and it looks different");
  vb.cells.forEach((c, i) => { if (saved[i]) c.deco = saved[i]; });
  // The decor layouts (tools/isobattles.js): a house and a hospital, at the four diagonal turns of the view.
  let errs = [], drawn = 0;
  for (const { name, st: s2, b: b2 } of battles(42, ["decor-house", "decor-hospital"])) {
    for (const rot of [0, 1, 2, 3]) {
      ISO.iso.battle = null; ISO.iso.rot = rot;
      s2.combat = b2;
      try { clock += 50; UI.drawCombat(s2, clock); drawn++; } catch (e) { errs.push(`${name} r${rot}: ${e.stack.split("\n").slice(0, 2).join(" ")}`); }
    }
    s2.combat = null;
  }
  ISO.iso.rot = 0;
  check(!errs.length && drawn === 8, `the decor layouts (a house, a hospital) drawn at four turns of the view${errs.length ? `: ${errs[0]}` : ""}`);
  check(nan === 0, "no NaN anywhere");
  vst.combat = null;
}

const ms = Math.round(performance.now() - t0);
console.log(`\n${passed} passed, ${failed} failed (${ms} ms)`);
process.exit(failed ? 1 : 0);
