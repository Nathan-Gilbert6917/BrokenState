// A battle map with several armed figures in place (issue #77): a town raid against raiders in the real game, the
// team and the raiders set in a row near each other with a spread of weapons (rifles, shotguns, pistols, blades,
// clubs, a bow, a launcher), the view zoomed in on them and turned, saved as PNGs; and the raid's frame time
// measured (requestAnimationFrame over a few seconds of redraws, the figures warm in the cache) for the performance
// check. Usage: NODE_PATH=$(npm root -g) node tools/weaponmapshot.cjs [outdir]
// Starts the prototype's server on a free port and drives headless Chromium; prints one JSON line a shot.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "docs", "shots", "weapons"));
const port = 5300 + Math.floor(Math.random() * 600);

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.cjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 700));
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await page.goto(`http://localhost:${port}/?notitle`);
    await page.waitForFunction(() => window.game && document.querySelector('[data-action="begin"]'), null, { timeout: 30000 });
    await page.click('[data-action="begin"]');
    await page.waitForFunction(() => window.game.state.started, null, { timeout: 30000 });
    const setup = await page.evaluate(async () => {
      const P = await import("/src/sim/parties.js"), W = await import("/src/sim/world.js"), C = await import("/src/sim/worldcfg.js");
      const st = game.state, hub = W.hub(st);
      st.worldCfg = C.cleanCfg({ raidMin: 80, raidMax: 80 });
      let t = st.tiles.find((x) => x.id !== hub.tile && x.loc && x.loc.type === "town" && !st.bases.some((b) => b.tile === x.id));
      if (!t) { t = st.tiles.find((x) => x.id !== hub.tile && x.terrain !== "water" && !x.loc && !st.bases.some((b) => b.tile === x.id)); st.tiles[t.id] = { ...t, loc: { type: "town", name: "town" }, road: false }; t = st.tiles[t.id]; }
      st.hour = Math.floor(st.hour / 24) * 24 + 12;
      hub.stock.ammo = 400; hub.stock.food = 100; hub.stock.water = 100;
      const crew = W.atBase(st, hub.id).filter((s) => s.alive).slice(0, 4);
      const r = P.launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: t.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 40, meds: 2 } });
      if (!r.party) throw new Error("launch: " + JSON.stringify(r).slice(0, 200));
      const p = r.party;
      p.path = [t.id]; p.idx = 0; p.phase = "engaged";
      game.ui.speed = 0;
      game.combat.start({ mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "raiders", count: 6, power: 3, name: "raiders" }, raid: { heat0: 5, choose: true, poi: null, kind: null, place: null, building: null }, plan: true, context: {} });
      const b = st.combat;
      return b ? { w: b.w, h: b.h, kinds: b.units.map((u) => `${u.side}:${u.kind}:${u.kit || ""}`).slice(0, 12) } : null;
    });
    console.log("raid:", JSON.stringify(setup));
    if (!setup) throw new Error("no raid started");
    await page.waitForTimeout(600);
    await page.evaluate(() => { const e = document.querySelector('[data-action="cb-plan"][data-v="enter"]:not([disabled])'); if (e) e.click(); });
    await page.waitForTimeout(1200);
    // The team and the raiders set in two rows on open ground near the team, armed with a spread of weapons, facing each other.
    const placed = await page.evaluate(async () => {
      const I = await import("/src/ui/isoview.js"), b = game.state.combat;
      const mine = b.units.filter((u) => u.side === "player" && !u.dead), foes = b.units.filter((u) => u.side === "enemy" && !u.dead);
      const open = (x, y) => x > 0 && y > 0 && x < b.w - 1 && y < b.h - 1 && b.cells[y * b.w + x].k === "open" && !b.units.some((q) => q.x === x && q.y === y);
      // a 12 × 6 patch of open ground
      let at = null;
      for (let y = 2; y < b.h - 8 && !at; y++) for (let x = 2; x < b.w - 14 && !at; x++) { let ok = true; for (let dy = 0; dy < 6 && ok; dy++) for (let dx = 0; dx < 12 && ok; dx++) if (!open(x + dx, y + dy)) ok = false; if (ok) at = [x, y]; }
      if (!at) at = [Math.floor(b.w / 2) - 6, Math.floor(b.h / 2) - 3];
      const W1 = ["ar", "shotgun", "huntrifle", "machete", "sledge", "compbow"], W2 = ["sawnoff", "revolver44", "nailbat", "sks", "uzi", "at4"];
      mine.forEach((u, i) => { u.x = at[0] + 1 + i * 2; u.y = at[1] + 1; u.weapon = W1[i % W1.length]; u.item = null; u.face = [0, 1]; });
      foes.forEach((u, i) => { u.x = at[0] + 1 + (i % 6) * 2; u.y = at[1] + 4 + Math.floor(i / 6); u.weapon = W2[i % W2.length]; u.item = null; u.arsItem = null; u.face = [0, -1]; u.seen = true; });
      for (const u of b.units) { if (u.side === "enemy" && u.kind === "human" && !foes.includes(u)) { u.x = -1; } }
      if (b.losCache) b.losCache.fill(0);
      I.setRoofs(false);
      I.clearIsoCache();
      b.rev = (b.rev || 0) + 1;
      while (I.iso.zoom < 6) I.isoZoom(b, 1);
      I.isoCenterOn(b, at[0] + 6, at[1] + 3, false);
      document.querySelectorAll(".gdtip, .gd-note, .tipbox, .coach").forEach((e) => e.remove && e.remove()); // the guide's notes (ui/guide.js)
      game.refresh();
      return { at, mine: mine.map((u) => u.weapon), foes: foes.map((u) => u.weapon), zoom: I.iso.zoom };
    });
    console.log("placed:", JSON.stringify(placed));
    for (const turn of [0, 1]) {
      await page.evaluate(async ({ turn, at }) => {
        const I = await import("/src/ui/isoview.js"), b = game.state.combat;
        for (let g = 0; g < 8 && (I.iso.rot !== turn || I.iso.straight); g++) I.isoRotate(b, 1);
        I.isoCenterOn(b, at[0] + 6, at[1] + 3, false);
        b.rev = (b.rev || 0) + 1;
        game.refresh();
      }, { turn, at: placed.at });
      await page.mouse.move(300, 470); // off the buttons, over open ground: no tip
      await page.evaluate(() => document.querySelectorAll(".gdtip, .gd-note").forEach((e) => e.remove()));
      await page.waitForTimeout(600);
      const f = path.join(outDir, `battle-view${turn}.png`);
      await page.screenshot({ path: f });
      console.log(f);
    }
    // The frame time: the battle redrawn for 3 s, every frame forced (the figures cached after the first).
    const perf = await page.evaluate(async () => {
      const b = game.state.combat;
      const times = [];
      await new Promise((done) => {
        let n = 0, last = performance.now();
        const step = () => { const t0 = performance.now(); b.rev = (b.rev || 0) + 1; game.refresh(); const t1 = performance.now(); times.push(t1 - t0); n++; if (t1 - last < 3000 && n < 200) requestAnimationFrame(step); else done(); };
        requestAnimationFrame(step);
      });
      times.sort((a, c) => a - c);
      const F = (await import("/src/ui/figures.js")).figureStats;
      return { frames: times.length, median: +times[Math.floor(times.length / 2)].toFixed(1), p90: +times[Math.floor(times.length * 0.9)].toFixed(1), figuresPainted: F.painted, figureMs: +F.ms.toFixed(0) };
    });
    console.log("frame:", JSON.stringify(perf));
    await browser.close();
    if (errs.length) console.log(`Page errors:\n${errs.join("\n")}`);
  } finally { srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
