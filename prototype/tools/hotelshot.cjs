// Hotels (issue #29): each kind's building in the real game, fully revealed with the roofs off, saved as PNGs: the
// ground floor, a guest floor and the top floor (hotel-<franchise>-f<n>.png), and the whole map zoomed out with its
// grounds. Usage: NODE_PATH=$(npm root -g) node tools/hotelshot.cjs [outdir] [franchise ids...]
// The building is loaded directly (setup.raid.place = { id, key, name, variant }); revealed by filling ui/combat.js
// cui.cache.vis and .known.cells after a refresh. Prints one line a shot, and any page error.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "docs", "shots", "hotels"));
const wanted = process.argv.slice(3).length ? process.argv.slice(3) : ["willowcreek", "interstate", "pinecrest", "caldergrand"];
const port = 5300 + Math.floor(Math.random() * 600);

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.cjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  let bad = 0;
  try {
    await new Promise((r) => setTimeout(r, 700));
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    for (const v of wanted) {
      const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
      const errs = [];
      page.on("pageerror", (e) => errs.push(String(e)));
      page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
      await page.goto(`http://localhost:${port}/?notitle`);
      await page.waitForFunction(() => window.game && document.querySelector('[data-action="begin"]'), null, { timeout: 30000 });
      await page.click('[data-action="begin"]');
      await page.waitForFunction(() => window.game.state.started, null, { timeout: 30000 });
      const setup = await page.evaluate(async ({ v }) => {
        const P = await import("/src/sim/parties.js"), W = await import("/src/sim/world.js"), S = await import("/src/sim/scavenge.js");
        const st = game.state, hub = W.hub(st);
        const t = st.tiles.find((x) => x.id !== hub.tile && x.loc && x.loc.type === "town" && !st.bases.some((b) => b.tile === x.id)) || st.tiles.find((x) => x.id !== hub.tile && x.terrain !== "water");
        st.hour = Math.floor(st.hour / 24) * 24 + 12;
        hub.stock.ammo = 400; hub.stock.food = 100; hub.stock.water = 100; hub.stock.meds = 10;
        const crew = W.atBase(st, hub.id).filter((s) => s.alive).slice(0, 4);
        const r = P.launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: t.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 40, meds: 2 } });
        if (!r.party) throw new Error("launch: " + JSON.stringify(r).slice(0, 200));
        const p = r.party;
        p.path = [t.id]; p.idx = 0; p.phase = "engaged";
        game.ui.speed = 0;
        const groups = S.raidEnemies(st, t.id).map((g) => ({ ...g, count: 0 })); // nobody about: the building itself
        game.combat.start({ mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "mixed", count: 0, power: 3, name: "the dead", groups }, raid: { heat0: 5, choose: true, poi: null, kind: null, place: { id: `hotelshot-${v}`, key: "hotel", name: "Hotel", variant: v }, building: null }, plan: true, context: {} });
        const b = st.combat;
        return b ? { w: b.w, h: b.h, floors: b.floors ? b.floors.length : 1 } : null;
      }, { v });
      if (!setup) { console.log(v, "no raid"); bad++; await page.close(); continue; }
      await page.waitForTimeout(500);
      await page.evaluate(() => { const e = document.querySelector('[data-action="cb-plan"][data-v="enter"]:not([disabled])'); if (e) e.click(); });
      await page.waitForTimeout(900);
      const floors = [...new Set([0, Math.max(0, setup.floors - 2), setup.floors - 1])];
      for (const f of floors) {
        const info = await page.evaluate(async ({ f }) => {
          const C = await import("/src/sim/combat.js"), I = await import("/src/ui/isoview.js"), U = await import("/src/ui/combat.js"), b = game.state.combat, B = b.raid.plan.building;
          for (const u of b.units) if (u.side === "enemy") u.dead = true;
          if (b.floors) C.setFloor(b, f);
          I.setRoofs(false);
          I.clearIsoCache();
          b.rev = (b.rev || 0) + 1;
          game.refresh();
          const cache = U.cui.cache;
          if (cache.vis) cache.vis.fill(1);
          if (cache.known && cache.known.cells) cache.known.cells.fill(1);
          I.isoCenterOn(b, B.x0 + Math.floor(B.w / 2), B.y0 + Math.floor(B.h / 2), false);
          for (let i = 0; i < 12; i++) I.isoZoom(b, -1);
          const fit = Math.max(B.w, B.h) <= 30 ? 3 : Math.max(B.w, B.h) <= 50 ? 2 : 1;
          for (let i = 0; i < fit; i++) I.isoZoom(b, 1);
          for (const a of b.raid.areas) if (!a.outdoor && a.sw) a.on = true; // the lights on where there is a switch (sim/indoorlight.js)
          document.querySelectorAll(".tipbox, .coach, .gd-note").forEach((e) => e.remove && e.remove());
          game.refresh();
          const reveal = () => { const c = U.cui.cache; if (c.vis) c.vis.fill(1); if (c.known && c.known.cells) c.known.cells.fill(1); };
          reveal();
          U.drawCombat(game.state, performance.now());
          window.__reveal = () => { reveal(); U.drawCombat(game.state, performance.now()); };
          return { floor: f, name: b.floors ? b.floors[f].name : "Ground floor", zoom: I.iso.zoom, rooms: b.raid.areas.filter((a) => !a.outdoor && (a.f || 0) === f).length };
        }, { f });
        await page.waitForTimeout(400);
        await page.evaluate(() => { document.querySelectorAll("[data-action=gd-note-ok]").forEach((e) => e.click()); document.querySelectorAll(".tipbox, .coach, .gd-note").forEach((e) => e.remove && e.remove()); window.__reveal(); });
        const shot = path.join(outDir, `hotel-${v}-f${f}.png`);
        await page.screenshot({ path: shot });
        console.log(shot, JSON.stringify(info));
      }
      if (errs.length) { bad++; console.log(v, "page errors:", errs.slice(0, 3).join(" | ")); }
      await page.close();
    }
    await browser.close();
  } finally { srv.kill(); }
  console.log(bad ? `${bad} with errors` : "no page errors");
  process.exit(bad ? 1 : 0);
})();
