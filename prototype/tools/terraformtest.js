// Terraforming the base map (the user's request 2026-10-23: "Add the ability to terraform the base build to add hills
// and create hollows it takes time requires a shovel and the more shovels and people the faster it is one shovel per
// person. If you have one shovel and 3 people building only one can work on the hollow until you have two more shovels
// ... Digging a hollow only works on dirt tiles and provides dirt when finished. This dirt can be used to create hills.
// When making a hill if it is adjacent to a hill meld them together to look smooth like they were created by the seed.
// Creating hills requires shovels too"; the playtest after it: hollows a level down at most).
//   1. the shovels: one a person (1 shovel and 3 builders: 1 digs; 3 shovels: 3), the pace by the crew, none: it waits;
//   2. dirt only: not the road, paving, a tree, rock, the river, a building; the hollow a level down at most;
//   3. the dirt: a hollow dug gives it, a hill raised takes it (short of it: refused); building on the dug ground waits
//      for it to be filled in, and nothing is placed on ground being worked;
//   4. a hill raised beside one of the tile's melds into it: one hill, no step over a level, 2 × 2 at every level; a
//      narrow hollow dug on purpose stays (dropNarrowHollows is the seed's);
//   5. on the battle map, through a save and a load, the same for the same orders whatever order the cells were dug in;
//   6. the Build list, the ghost, the panel and the activity line.
// Usage: node tools/terraformtest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { constructionHour, buildRate, BUILDINGS } from "../src/sim/buildings.js";
import { newItem, allCarried } from "../src/sim/inventory.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { Rng } from "../src/sim/rng.js";
import * as BM from "../src/sim/basemap.js";
import * as T from "../src/sim/terraform.js";
import { describeActivity } from "../src/sim/activity.js";
import { layoutPanel, layoutHover } from "../src/ui/basemap.js";

const SEED = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  ok   ${msg}`); } else { fails++; console.log(`  FAIL ${msg}`); } return !!ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
const DIGS = new Set(["shovel", "etool", "pickaxe", "scrapshovel"]);

// A hub on a hills tile, three builders with no shovel of their own, none in the armory; the rest on other work.
function world(seed = SEED) {
  const st = createWorld({ seed, factionCount: 6 });
  st.started = true;
  st.hour = 24 * 3 + 8;
  const h = hub(st), tile = st.tiles[h.tile];
  tile.terrain = "hills"; tile.loc = null;
  h.armory = h.armory.filter((it) => !DIGS.has(it.key));
  const people = atBase(st, h.id).filter((s) => !allCarried(s).some((it) => DIGS.has(it.key)));
  for (const s of atBase(st, h.id)) { s.role = "guard"; s.upkeep = false; }
  for (const s of people.slice(0, 3)) s.role = "build";
  h.construction = [];
  return { st, h };
}
const shovels = (h, n) => { for (let i = 0; i < n; i++) h.armory.push(newItem("shovel")); };
const heightAt = (st, h, x, y) => BM.landFor(st, h).heights.get(`${x},${y}`) || 0;
const run = (st, h, hours) => { for (let i = 0; i < hours && h.construction.length; i++) { constructionHour(st); st.hour++; } };
// A free rectangle of plain dirt (every cell dirt, level ground), w × h, searched outward from (sx, sy).
function flatDirt(st, h, w, hh, sx = 0, sy = 0) {
  const land = BM.landFor(st, h), occ = BM.occupancy(st, h, null, BM.autoLayout(st, h));
  occ.land = null;
  const ok = (x, y) => !T.dirtProblem(h, land, occ, x, y) && !land.heights.get(`${x},${y}`);
  for (let d = 0; d < 90; d++) for (let y = sy - d; y <= sy + d; y++) for (let x = sx - d; x <= sx + d; x++) {
    if (Math.max(Math.abs(x - sx), Math.abs(y - sy)) !== d) continue;
    let all = true;
    for (let yy = y - 1; yy <= y + hh && all; yy++) for (let xx = x - 1; xx <= x + w && all; xx++) if (!ok(xx, yy)) all = false; // and a ring of level dirt round it
    if (all) return [x, y];
  }
  return null;
}

// ---------- 1. the shovels ----------
section("The shovels: one a person; the more shovels and builders, the faster");
{
  const { st, h } = world();
  let c = T.shovelCrew(st, h);
  check(c.builders.length === 3 && c.shovels === 0 && c.workers.length === 0, `3 builders, no shovel: nobody digs (${T.crewWords(c)})`);
  const at = flatDirt(st, h, 4, 4, 14, 14);
  check(!!at, `level dirt to dig at ${at}`);
  const plan = T.terraPlan(st, h, "dig", at, [at[0] + 3, at[1] + 3], 1);
  check(plan.ok && plan.cells.length === 16 && plan.steps === 16 && plan.hours === 16 * T.TERRA.HOURS.dig && plan.dirt === 16 * T.TERRA.DIRT && plan.eta === null, `a 4 × 4 hollow: ${plan.cells.length} cells, ${plan.steps} cell-levels, ${plan.hours} work-hours, +${plan.dirt} dirt (${plan.why || "ok"})`);
  const job = T.queueTerra(st, h, plan);
  check(T.terraWaits(st, h, job) === "Needs a shovel", `no shovel: it waits ("${T.terraWaits(st, h, job)}")`);
  run(st, h, 3);
  check(job.progress === 0 && h.construction.includes(job), "and nothing is dug");
  shovels(h, 1);
  c = T.shovelCrew(st, h);
  const r1 = T.terraRate(st, h), full = buildRate(st, h);
  check(c.shovels === 1 && c.workers.length === 1 && Math.abs(r1 - full / 3) < 1e-9, `1 shovel, 3 builders: 1 digs (${T.crewWords(c)}), a third of the builders' pace (${r1.toFixed(2)} of ${full.toFixed(2)})`);
  const act = c.builders.map((s) => describeActivity(st, s, 10).text);
  check(act.filter((t) => /^Digging a hollow \(1 of 3 with shovels/.test(t)).length === 1 && act.filter((t) => /^Waiting for a shovel/.test(t)).length === 2, `the activity lines: ${act.join(" | ")}`);
  const p0 = job.progress;
  run(st, h, 1);
  check(Math.abs(job.progress - p0 - r1) < 1e-9, `an hour with one shovel: ${(job.progress - p0).toFixed(2)} work-hours`);
  shovels(h, 2);
  c = T.shovelCrew(st, h);
  const r3 = T.terraRate(st, h);
  check(c.workers.length === 3 && Math.abs(r3 - full) < 1e-9 && r3 > r1 * 2.9, `3 shovels: 3 dig (${T.crewWords(c)}), the whole pace (${r3.toFixed(2)})`);
  // A builder's own shovel counts, and a fourth shovel adds nobody.
  shovels(h, 1);
  check(T.shovelCrew(st, h).workers.length === 3 && T.shovelCrew(st, h).shovels === 4, "a 4th shovel and 3 builders: still 3 dig");
  const b0 = T.shovelCrew(st, h).builders[2];
  h.armory = h.armory.filter((it) => !DIGS.has(it.key));
  const own = newItem("etool");
  b0.gear.weapon = own; // an entrenching tool in hand
  const ownCrew = T.shovelCrew(st, h);
  check(allCarried(b0).includes(own) && ownCrew.shovels === 1 && ownCrew.workers.length === 1 && ownCrew.workers[0] === b0, `a builder's own shovel counts, and that builder digs: ${T.crewWords(ownCrew)}`);
}

// ---------- 2. dirt only ----------
section("Dirt only: not the road, paving, a tree, rock, the river or a building; a hollow a level down at most");
{
  const { st, h } = world();
  const land = BM.landFor(st, h), occ = BM.occupancy(st, h, null, BM.autoLayout(st, h));
  occ.land = null;
  const find = (k) => land.list.find((p) => p.k === k && p.cells.every(([x, y]) => Math.abs(x) < 110 && Math.abs(y) < 110));
  const tree = find("tree"), rock = find("rock") || find("boulder");
  check(tree && /Clear the land first: a tree/.test(T.dirtProblem(h, land, occ, ...tree.cells[0])), `a tree: "${tree && T.dirtProblem(h, land, occ, ...tree.cells[0])}"`);
  check(rock && /^Rock: not dirt/.test(T.dirtProblem(h, land, occ, ...rock.cells[0])), `a rock: "${rock && T.dirtProblem(h, land, occ, ...rock.cells[0])}"`);
  check(/stands there|base itself|wall/i.test(T.dirtProblem(h, land, occ, 0, 0)), `the base itself: "${T.dirtProblem(h, land, occ, 0, 0)}"`);
  const fake = { pieces: new Map([["5,5", { k: "water", cells: [[5, 5]] }], ["6,5", { k: "crag", cells: [[6, 5]] }]]), floors: new Map([["7,5", "road"], ["8,5", "gravel"], ["9,5", "field"], ["10,5", "dirt"]]), list: [] };
  const say = (x) => T.dirtProblem(h, fake, { foot: new Map(), door: new Map(), floor: new Map(), names: new Map() }, x, 5);
  check(/river/.test(say(5)) && /mountainside/.test(say(6)) && /road/.test(say(7)) && /Paved/.test(say(8)) && !say(9) && !say(10) && !say(11), `the river "${say(5)}", the crag "${say(6)}", the road "${say(7)}", paving "${say(8)}"; a field, trodden dirt and grass are dirt`);
  // A rectangle over a tree: the tree left out, the rest dug.
  const tx = tree.cells[0][0], ty = tree.cells[0][1];
  const plan = T.terraPlan(st, h, "dig", [tx - 2, ty - 2], [tx + 2, ty + 2], 1);
  check(plan.out.some(([x, y]) => x === tx && y === ty) && !plan.cells.some(([x, y]) => x === tx && y === ty), `an area over a tree: the tree left out (${plan.cells.length} cells dug, ${plan.out.length} left out)`);
  // Never below a level down (the playtest 2026-10-23), whatever is asked.
  const at = flatDirt(st, h, 6, 6, -20, 20);
  const deep = T.terraPlan(st, h, "dig", at, [at[0] + 5, at[1] + 5], 3);
  check(deep.ok && deep.cells.every(([, , , to]) => to === -1), `three levels asked on flat ground: a level down (${[...new Set(deep.cells.map((c) => c[3]))].join(",")})`);
  check(T.terraPlan(st, h, "dig", at, [at[0] + T.TERRA.MAX, at[1]], 1).why === `At most ${T.TERRA.MAX} × ${T.TERRA.MAX} cells at a time`, "an area too big is refused");
  check(/2 × 2/.test(T.terraPlan(st, h, "dig", at, [at[0], at[1] + 4], 1).why), `a strip a cell wide: "${T.terraPlan(st, h, "dig", at, [at[0], at[1] + 4], 1).why}"`);
}

// ---------- 3. the dirt ----------
section("The dirt: a hollow gives it, a hill takes it; the ground worked and the ground uneven wait to be built on");
let saved = null;
{
  const { st, h } = world();
  shovels(h, 3);
  const at = flatDirt(st, h, 4, 4, 14, 14);
  const job = T.queueTerra(st, h, T.terraPlan(st, h, "dig", at, [at[0] + 3, at[1] + 3], 1));
  const hutish = { kind: "prop", k: "crate", w: 1, h: 1, key: "probe", label: "a crate" };
  const occ = BM.occupancy(st, h, null, null);
  check(/being dug/.test(BM.placeProblemAt(h, hutish, at[0] + 1, at[1] + 1, 0, occ)), `nothing placed on ground being dug: "${BM.placeProblemAt(h, hutish, at[0] + 1, at[1] + 1, 0, occ)}"`);
  check(/being dug/.test(T.terraPlan(st, h, "raise", at, [at[0] + 3, at[1] + 3], 1).out.map((o) => o[2]).join()), "nor ordered dug twice");
  const d0 = h.stock.dirt || 0;
  run(st, h, 4);
  check(job.done > 0 && job.done < 16 && (h.stock.dirt || 0) === d0 + job.done * T.TERRA.DIRT, `the dirt comes as each cell-level is done: ${job.done} of 16, +${(h.stock.dirt || 0) - d0} dirt`);
  run(st, h, 40);
  check(!h.construction.includes(job) && (h.stock.dirt || 0) === d0 + 16 * T.TERRA.DIRT, `the hollow dug: +${(h.stock.dirt || 0) - d0} dirt (${T.TERRA.DIRT} a cell-level)`);
  let all = true;
  for (let y = at[1]; y < at[1] + 4; y++) for (let x = at[0]; x < at[0] + 4; x++) if (heightAt(st, h, x, y) !== -1) all = false;
  check(all, "its 16 cells a level down");
  const why = BM.placeProblemAt(h, hutish, at[0] + 1, at[1] + 1, 0, BM.occupancy(st, h, null, null));
  check(/Clear the land first: a hollow/.test(why), `built on only once filled in: "${why}"`);
  // A narrow hollow dug on purpose stays (the seed's narrow ones are filled in: basescatter.js dropNarrowHollows).
  check(heightAt(st, h, at[0], at[1]) === -1, "a 4 × 4 hollow, narrower than the seed's least, stays");
  // A hill raised with the dirt: as much as the hollow gave raises an equal hill.
  const at2 = flatDirt(st, h, 4, 4, -14, -14);
  const short = T.terraPlan(st, h, "raise", at2, [at2[0] + 4, at2[1] + 4], 1);
  check(!short.ok && /Needs 250 dirt \(160 to hand/.test(short.why), `a 5 × 5 hill with 160 dirt: "${short.why}"`);
  const hill = T.terraPlan(st, h, "raise", at2, [at2[0] + 3, at2[1] + 3], 1);
  check(hill.ok && hill.dirt === -16 * T.TERRA.DIRT, `a 4 × 4 hill, as big as the hollow: −${-hill.dirt} dirt`);
  const job2 = T.queueTerra(st, h, hill);
  check(T.dirtOwed(h) === 160 && T.terraPlan(st, h, "raise", [at2[0] + 6, at2[1]], [at2[0] + 8, at2[1] + 2], 1).why.startsWith("Needs"), "the dirt queued for it is owed: no more hills on it");
  run(st, h, 60);
  check(!h.construction.includes(job2) && (h.stock.dirt || 0) === d0 && heightAt(st, h, at2[0] + 1, at2[1] + 1) === 1, `the hill raised: the heap back to ${h.stock.dirt || 0}, its cells a level up`);
  // Short of dirt on the way (spent elsewhere): it waits.
  const at3 = flatDirt(st, h, 4, 4, 30, -30);
  h.stock.dirt = 160;
  const job3 = T.queueTerra(st, h, T.terraPlan(st, h, "raise", at3, [at3[0] + 3, at3[1] + 3], 1));
  h.stock.dirt = 5;
  check(T.terraWaits(st, h, job3) === `Needs ${T.TERRA.DIRT} dirt`, `no dirt left: "${T.terraWaits(st, h, job3)}"`);
  check(/cancelled/.test(T.cancelTerra(h, job3.id)) && !h.construction.includes(job3), "cancelled");
  // Clearing a dug cell (Fill in): level again, its edit gone.
  const dip = BM.landFor(st, h).pieces.get(`${at[0]},${at[1]}`);
  BM.finishClear(st, h, { pieces: [{ k: dip.k, g: dip.g, cells: dip.cells }], get: {} });
  check(heightAt(st, h, at[0], at[1]) === 0 && !(`${at[0]},${at[1]}` in h.land.heightEdits), "a dug cell filled in: level, its edit gone");
  // On the battle map (a raid's, a horde's: the base's own map).
  const F = BM.buildBaseMap(st, h, new Rng(7), {});
  const c = F.cells[(at[1] + 1 + F.oy) * F.W + at[0] + 1 + F.ox], c2 = F.cells[(at2[1] + 1 + F.oy) * F.W + at2[0] + 1 + F.ox];
  check(c && c.h === -1 && c.ter === 1 && c2 && c2.h === 1 && c2.ter === 1, `on the battle map: the hollow ${c && c.h}, the hill ${c2 && c2.h} (c.h with c.ter, as the tile's own)`);
  saved = { st, h, at, at2 };
}

// ---------- 4. a hill melds into the hill beside it ----------
section("A hill raised beside one of the tile's: one hill, no step over a level, 2 × 2 at every level");
{
  const { st, h } = world();
  shovels(h, 3);
  h.stock.dirt = 4000;
  const land = BM.landFor(st, h);
  // A natural hill's edge with level dirt beside it to the west.
  const occ = BM.occupancy(st, h, null, BM.autoLayout(st, h));
  occ.land = null;
  let spot = null;
  for (const [k, v] of land.heights) {
    if (v !== 1) continue;
    const [x, y] = k.split(",").map(Number);
    if (Math.abs(x) > 100 || Math.abs(y) > 100) continue;
    let ok = true;
    for (let yy = y - 3; yy <= y + 3 && ok; yy++) for (let xx = x - 7; xx < x; xx++) if (land.heights.get(`${xx},${yy}`) || T.dirtProblem(h, land, occ, xx, yy)) { ok = false; break; }
    if (ok) { spot = [x, y]; break; }
  }
  check(!!spot, `a hill's edge with level dirt beside it at ${spot}`);
  const plan = T.terraPlan(st, h, "raise", [spot[0] - 6, spot[1] - 3], [spot[0] - 1, spot[1] + 3], 2);
  check(plan.ok && plan.cells.some(([, , , to]) => to === 2) && plan.cells.some(([, , , to]) => to === 1), `two levels asked: nested, ${plan.cells.filter((c) => c[3] === 2).length} cells at 2 and ${plan.cells.filter((c) => c[3] === 1).length} at 1`);
  T.queueTerra(st, h, plan);
  run(st, h, 200);
  const H = BM.landFor(st, h).heights;
  const lv = (x, y) => H.get(`${x},${y}`) || 0;
  let steps = 0, narrow = 0;
  for (let y = spot[1] - 12; y <= spot[1] + 12; y++) for (let x = spot[0] - 14; x <= spot[0] + 10; x++) {
    const v = lv(x, y);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (Math.abs(lv(x + dx, y + dy) - v) > 1) steps++;
    if (v && ![[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([ox, oy]) => [[0, 0], [1, 0], [0, 1], [1, 1]].every(([dx, dy]) => { const w = lv(x + ox + dx, y + oy + dy); return v > 0 ? w >= v : w <= v; }))) narrow++;
  }
  check(!steps && !narrow, `smooth: ${steps} steps over a level, ${narrow} cells a cell wide`);
  // One hill: the raised ground joined to the natural hill (four ways over raised cells).
  const seen = new Set([`${spot[0]},${spot[1]}`]), q = [spot];
  for (let i = 0; i < q.length && q.length < 5000; i++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = q[i][0] + dx, y = q[i][1] + dy, k = `${x},${y}`; if (!seen.has(k) && lv(x, y) > 0) { seen.add(k); q.push([x, y]); } }
  check(plan.cells.every(([x, y]) => seen.has(`${x},${y}`)), `the raised cells and the hill are one hill (${plan.cells.length} raised, ${seen.size} in it)`);
  check(lv(spot[0] - 3, spot[1]) === 2, "its top two levels up");
}

// ---------- 5. save, load, determinism ----------
section("A save and a load; the same orders, the same ground");
{
  const { st, h, at, at2 } = saved;
  const before = [...BM.landFor(st, h).heights].sort().join(";");
  const st2 = loadFromString(saveToString(st));
  const h2 = hub(st2);
  check(JSON.stringify(h2.land.heightEdits) === JSON.stringify(h.land.heightEdits) && Object.keys(h2.land.heightEdits).length === 31, `the edits saved: ${Object.keys(h2.land.heightEdits).length} cells`);
  check([...BM.landFor(st2, h2).heights].sort().join(";") === before && heightAt(st2, h2, at2[0], at2[1]) === 1 && heightAt(st2, h2, at[0] + 1, at[1] + 1) === -1, "the ground after a load is the ground before it");
  // The order the cells were dug in does not matter: the edits shuffled give the same land.
  const keys = Object.keys(h.land.heightEdits).reverse(), shuffled = {};
  for (const k of keys) shuffled[k] = h.land.heightEdits[k];
  const L1 = BM.landFor(st, h).heights;
  h.land = { ...h.land, heightEdits: shuffled, n: h.land.n + 1 };
  check([...BM.landFor(st, h).heights].sort().join(";") === [...L1].sort().join(";"), "the edits in another order: the same land");
  // Two worlds, the same orders: the same edits, the same dirt.
  const twice = () => {
    const { st, h } = world();
    shovels(h, 2);
    const a = flatDirt(st, h, 6, 5, 18, -18);
    T.queueTerra(st, h, T.terraPlan(st, h, "dig", a, [a[0] + 5, a[1] + 4], 1));
    run(st, h, 80);
    return JSON.stringify({ e: h.land.heightEdits, d: h.stock.dirt, H: [...BM.landFor(st, h).heights].sort() });
  };
  check(twice() === twice(), "the same orders twice: the same ground and dirt");
}

// ---------- 6. the interface ----------
section("The Build list's Terrain, the ghost, the panel");
{
  const { st, h } = world();
  shovels(h, 1);
  check(!BM.openBaseMap(st, h.id), "the base map opens");
  const menu = BM.buildMenu(st, h).filter((m) => m.group === "Terrain");
  check(menu.map((m) => m.type).join() === "terra:dig,terra:raise" && menu[0].ok && !menu[1].ok && /No dirt/.test(menu[1].why), `Terrain: ${menu.map((m) => `${m.name} (${m.ok ? "ok" : m.why})`).join(", ")}`);
  let html = layoutPanel(st, st.combat, { msg: "" });
  check(/data-bt="terra:dig"/.test(html) && /<b>Terrain<\/b>/.test(html) && /1 of 3 builders with shovels/.test(html), "the Build list shows Terrain with Dig and Raise, the shovels against the builders");
  const at = flatDirt(st, h, 4, 4, 14, 14);
  const F = () => st.combat.deployPlan.fort, mx = (x) => x + F().ox, my = (y) => y + F().oy;
  check(!BM.layoutAct(st, st.combat, { type: "pickType", bt: "terra:dig" }) && st.combat.layout.pickType === "terra:dig", "Dig a hollow picked");
  check(/Click one corner/.test(layoutPanel(st, st.combat, { msg: "" })), "its card says how");
  let g = BM.ghostAt(st, st.combat, mx(at[0]), my(at[1]));
  check(g && g.ok && g.terraPick === "dig" && !g.terra && /Click to set one corner/.test(layoutHover(st, st.combat, { x: mx(at[0]), y: my(at[1]) }, g)), "before a corner: the cell under the mouse, dirt");
  check(!BM.layoutAct(st, st.combat, { type: "build", x: mx(at[0]), y: my(at[1]) }) && String(st.combat.layout.anchor) === String(at), "the first click sets a corner");
  g = BM.ghostAt(st, st.combat, mx(at[0] + 3), my(at[1] + 3));
  const hov = layoutHover(st, st.combat, { x: mx(at[0] + 3), y: my(at[1] + 3) }, g);
  check(g.ok && g.cells.length === 16 && /16 cells, 16 cell-levels · 16 work-hours/.test(hov) && /\+160 dirt/.test(hov) && /1 of 3 with shovels/.test(hov), `the ghost: ${hov.replace(/<[^>]+>/g, "")}`);
  const bad = BM.ghostAt(st, st.combat, mx(at[0]), my(at[1] + 4));
  check(bad && !bad.ok && /2 × 2/.test(bad.why), `a strip: red, "${bad.why}"`);
  check(!BM.layoutAct(st, st.combat, { type: "build", x: mx(at[0] + 3), y: my(at[1] + 3) }) && T.terraJobs(h).length === 1 && !st.combat.layout.anchor, `the second click queues it: "${st.combat.layout.msg}"`);
  run(st, h, 3);
  BM.refreshBaseMap(st);
  const cl = F().clearing.find((c) => c.terra);
  check(cl && cl.verb === "Digging" && cl.pct > 0 && cl.cells.length > 0, `on the map: an amber wash, "${cl && `${cl.verb} ${cl.pct}%`}"`);
  html = layoutPanel(st, st.combat, { msg: "" });
  check(/Dig a hollow <span class="muted">\d+% of 16h/.test(html) && /data-v="unclear" data-id="\d+"/.test(html), "the panel lists the job with Cancel");
  const id = T.terraJobs(h)[0].id;
  check(!BM.layoutAct(st, st.combat, { type: "unclear", id }) && !T.terraJobs(h).length && /cancelled/.test(st.combat.layout.msg), `Cancel: "${st.combat.layout.msg}"`);
  check(BUILDINGS.terra && BUILDINGS.terra.hidden, "the job's type is hidden from the lists");
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fails ? 1 : 0);
