// Seasonal weather in play in the real game (sim/seasonfx.js; the user's request 2026-10-23), saved as PNGs: a winter
// fight with snow underfoot and ice (the hover on an ice cell, then on the snow with the move preview), a spring fight
// in rain fog by day (the conditions line) and one in fog at night (Night fog: sight 3).
// Usage: NODE_PATH=$(npm root -g) node tools/seasonfxshot.cjs [outdir] [seed]
// Starts the prototype's server on a free port and drives headless Chromium; prints the files it saved.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "docs", "shots"));
const seed = Number(process.argv[3] || 8);
const port = 5300 + Math.floor(Math.random() * 600);

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.cjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 700));
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await page.goto(`http://localhost:${port}/?notitle&seed=${seed}`);
    await page.waitForFunction(() => window.game && document.querySelector('[data-action="begin"]'), null, { timeout: 30000 });
    await page.click('[data-action="begin"]');
    await page.waitForFunction(() => window.game.state.started, null, { timeout: 30000 });
    const files = [];
    const shot = async (name) => {
      for (let i = 0; i < 4; i++) { const ok = await page.evaluate(() => { const x = document.querySelector('[data-action="gd-tip-ok"], [data-action="gd-note-ok"]'); if (x) x.click(); return !!x; }); if (!ok) break; await page.waitForTimeout(200); }
      await page.evaluate(() => { for (const el of document.querySelectorAll(".tipcard, .newtip, [class*='coach']")) el.remove(); });
      const f = path.join(outDir, name); await page.screenshot({ path: f }); files.push(f);
      console.log(name, JSON.stringify(await page.evaluate(() => ((document.getElementById("cbprev") || {}).textContent || "").slice(0, 300))));
      console.log("  conditions:", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll(".cbwx span, .cbsupply span")].map((e) => e.textContent).filter((t) => /Snow|Ice|fog|Rain|Storm/.test(t)))));
    };
    // A fight on the hub's road tile (or the hub's own) at an hour picked by `want` (the sim's weather), your people
    // placed by `place`; the hover set on a cell.
    const setup = (want) => page.evaluate(async (want) => {
      const W = await import("/src/sim/world.js"), C = await import("/src/sim/combat.js"), WX = await import("/src/sim/weather.js"), I = await import("/src/ui/isoview.js"), UC = await import("/src/ui/combat.js");
      const st = game.state, hub = W.hub(st);
      game.ui.speed = 0;
      st.combat = null;
      C.registerCombatHandler("sfxshot", () => {});
      const ids = W.atBase(st, hub.id).filter((s) => s.alive).slice(0, 3).map((s) => s.id);
      const tiles = [hub.tile, ...st.tiles.filter((t) => t.road && t.terrain === "plains").slice(0, 6).map((t) => t.id)];
      for (let d = 2; d < 400; d++) for (const hr of want.hours) {
        const hour = d * 24 + hr;
        if (WX.season(st, hour).key !== want.season) continue;
        for (const tile of tiles) {
          const w = WX.weatherAt(st, tile, hour);
          if (want.fog && !(w.key === "rain" || w.key === "storm") ) continue;
          if (want.fog && !WX.rainFog(st, tile, hour)) continue;
          st.hour = hour;
          const b = C.createBattle(st, { tile, baseId: hub.id, fighterIds: ids, enemy: { kind: "zombies", count: 4, power: 3, name: "the dead" }, ambush: null, canRetreat: true, handler: "sfxshot", context: {} });
          if (!b.sfx || (want.ice && !(b.sfx.ice >= 6)) || (want.fog && !b.sfx.fog) || (want.night != null && !!b.night !== want.night)) continue;
          b.phase = "player";
          st.combat = b;
          const me = b.units.find((u) => u.side === "player");
          let tx = me.x + 2, ty = me.y;
          if (want.ice) { // the nearest ice cell to your first person, them next to it
            let best = null;
            for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) { const c = b.cells[y * b.w + x]; if ((c.ice || c.wet === "ice") && C.CELL[c.k].walk) { const dd = Math.hypot(x - me.x, y - me.y); if (!best || dd < best.d) best = { x, y, d: dd }; } }
            const free = [[-1, 0], [0, -1], [0, 1], [1, 0], [-2, 0]].map(([dx, dy]) => [best.x + dx, best.y + dy]).find(([x, y]) => C.CELL[b.cells[y * b.w + x].k].walk && !b.cells[y * b.w + x].ice && !C.unitAt(b, x, y));
            if (free) { me.x = free[0]; me.y = free[1]; }
            tx = best.x; ty = best.y;
          }
          if (want.snow) { // an open snowy cell a few steps off by a clean path (no ice, no vault)
            const r = C.reachable(b, me, 6);
            let best = null;
            for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
              const d = r.dist[y * b.w + x], c = b.cells[y * b.w + x];
              if (!(d >= 3 && d <= 5) || c.ice || c.wet || !(c.f === "grass" || c.f === "dirt" || c.f === "field") || C.unitAt(b, x, y)) continue;
              if (C.pathTo(r, x, y).some(([px, py]) => b.cells[py * b.w + px].ice || !C.CELL[b.cells[py * b.w + px].k].walk)) continue;
              if (!best || d < best.d) best = { x, y, d };
            }
            if (best) { tx = best.x; ty = best.y; }
          }
          UC.cui.sel = me.id;
          UC.cui.mode = "move";
          UC.cui.hover = { x: tx, y: ty };
          game.refresh();
          I.isoCenterOn(b, me.x, me.y, false);
          I.isoZoom(b, 1);
          game.refresh();
          return { day: d + 1, hour: hr, tile, sfx: b.sfx, night: !!b.night, wx: w.key, me: [me.x, me.y], hover: [tx, ty] };
        }
      }
      return null;
    }, want);
    const keepHover = async (xy) => page.evaluate(async (xy) => { const UC = await import("/src/ui/combat.js"); UC.cui.hover = { x: xy[0], y: xy[1] }; game.refresh(); }, xy);
    let s = await setup({ season: "winter", hours: [7, 9, 11], ice: true });
    console.log("winter:", JSON.stringify(s));
    if (s) {
      await page.waitForTimeout(700); await keepHover(s.hover); await page.waitForTimeout(300);
      await shot("season-winter-ice.png");
      s = await setup({ season: "winter", hours: [7, 9, 11], ice: true, snow: true });
      await page.waitForTimeout(700); await keepHover(s.hover); await page.waitForTimeout(300);
      await shot("season-winter-snow.png");
    }
    s = await setup({ season: "spring", hours: [7, 8, 10, 13], fog: true, night: false });
    console.log("spring fog:", JSON.stringify(s));
    if (s) { await page.waitForTimeout(700); await keepHover(s.hover); await page.waitForTimeout(300); await shot("season-spring-rainfog.png"); }
    s = await setup({ season: "spring", hours: [4, 5, 22, 23], fog: true, night: true });
    console.log("night fog:", JSON.stringify(s));
    if (s) { await page.waitForTimeout(700); await keepHover(s.hover); await page.waitForTimeout(300); await shot("season-night-fog.png"); }
    console.log(files.join("\n"));
    console.log("page errors:", JSON.stringify(errs.slice(0, 5)));
    await browser.close();
  } finally { srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
