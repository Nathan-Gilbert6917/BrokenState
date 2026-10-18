// The State Map with its moving pieces (ui/mapfigures.js) in the real game, saved as PNGs for the brief
// (docs/design-doc/sprites/map-figures-3d.md). Usage: NODE_PATH=$(npm root -g) node tools/mapshot.cjs [outdir]
// Starts the prototype's server on a free port, begins a run in headless Chromium, sends three teams out from the hub
// (walkers, a truck, one on foot), puts a horde, a herd and two bands of outsiders beside it, reveals the map and saves
// the hub's neighbourhood at the map's 1×, 2× and 3× zoom.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "docs", "design-doc", "sprites", "map-3d"));
const port = 5300 + Math.floor(Math.random() * 600);

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.cjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 700));
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await page.goto(`http://localhost:${port}/?notitle`);
    await page.waitForFunction(() => window.game && document.querySelector('[data-action="begin"]'), null, { timeout: 30000 });
    await page.click('[data-action="begin"]');
    await page.waitForFunction(() => window.game.state.started, null, { timeout: 30000 });
    const info = await page.evaluate(async () => {
      const P = await import("/src/sim/parties.js"), H = await import("/src/sim/hordes.js"), V = await import("/src/sim/visitors.js"), R = await import("/src/ui/render.js"), W = await import("/src/sim/world.js");
      const st = game.state, g = st.grid, hub = W.hub(st);
      const people = W.atBase(st, hub.id).filter((s) => s.alive);
      const ring = (r) => st.tiles.filter((t) => g.distance(t.id, hub.tile) === r && t.terrain !== "water" && !t.loc && !st.bases.some((b) => b.tile === t.id)).map((t) => t.id);
      const far = ring(4), near = ring(2);
      const go = (ids, dest, vehicle) => P.launchExpedition(st, { memberIds: ids, dest, mission: "scavenge", stance: "normal", vehicle, supplies: { food: 2, water: 2, ammo: 0 } });
      const r1 = go([people[0].id, people[1].id, people[2].id], far[0], false);
      const r2 = go([people[3].id], far[Math.floor(far.length / 2)], false);
      const car = st.vehicles && st.vehicles.find((v) => v.baseId === hub.id);
      const r3 = people[4] && people[5] ? go([people[4].id, people[5].id], far[far.length - 1], !!car) : { error: "no one" };
      for (let i = 0; i < 2; i++) game.tickHour();
      H.makeHorde(st, { tile: near[0], size: 32, target: hub.tile, role: "attack" });
      (st.herds || (st.herds = [])).push({ tile: near[Math.floor(near.length / 2)], kind: "deer", size: 4, until: 9999 });
      V.spawnVisitor(st, "merchants", { tile: near[near.length - 1] });
      V.spawnVisitor(st, "raiders", { tile: near[Math.floor(near.length / 3)] });
      R.view.devReveal = true;
      game.ui.speed = 0;
      R.centerOn(st, hub.tile);
      return { teams: [r1.error, r2.error, r3.error], parties: st.parties.filter((p) => p.owner === "player").map((p) => [p.phase, p.idx, p.path && p.path.length, p.vehicle]), hordes: st.hordes.length, visitors: (st.visitors || []).length };
    });
    console.log(JSON.stringify(info));
    const cv = await page.$("#map");
    for (const [name, zoom] of [["hub-1x", 1], ["hub-2x", 2], ["hub-3x", 3]]) {
      await page.evaluate(async (z) => { const R = await import("/src/ui/render.js"); R.camera.zoom = z; R.centerOn(game.state, (await import("/src/sim/world.js")).hub(game.state).tile); game.refresh(); }, zoom);
      await page.waitForTimeout(400);
      const box = await cv.boundingBox();
      const w = Math.min(box.width, 420 * zoom), h = Math.min(box.height, 300 * zoom);
      const out = path.join(outDir, `${name}.png`);
      await page.screenshot({ path: out, clip: { x: box.x + box.width / 2 - w / 2, y: box.y + box.height / 2 - h / 2, width: w, height: h } });
      console.log(out);
    }
    await browser.close();
    if (errs.length) console.log(`Page errors:\n${errs.join("\n")}`);
  } finally { srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
