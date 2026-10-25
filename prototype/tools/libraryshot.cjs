// Renders of the library variants (issue #34, src/sim/librarylayout.js): each variant's plans loaded straight into a
// raid (setup.raid.place = { id, key: "library", name, variant: "<variant>/<plan>" }), fully revealed (ui/combat.js
// cui.cache.vis and .known.cells filled after a refresh), roofs off, one image a floor: <variant>-<plan>-f<n>.png.
// Usage: NODE_PATH=$(npm root -g) node tools/libraryshot.cjs [outdir] [variant/plan ...]  (default: every plan)
// Starts the prototype's server on a free port and drives headless Chromium; prints one line a shot.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "docs", "shots", "libraries"));
const ALL = ["rural/storefront", "rural/house", "carnegie/lr", "carnegie/fb", "modern/left", "modern/right", "county/corridor", "county/hall",
  "central/centre", "central/side", "historic/centre", "historic/side", "bookmobile/side", "bookmobile/back", "strip/deep", "strip/split"];
const want = process.argv.slice(3).length ? process.argv.slice(3) : ALL;
const port = 5900 + Math.floor(Math.random() * 600);

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.cjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  let bad = 0;
  try {
    await new Promise((r) => setTimeout(r, 700));
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    for (const variant of want) {
      const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
      const errs = [];
      page.on("pageerror", (e) => errs.push(String(e)));
      page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
      await page.goto(`http://localhost:${port}/?notitle`);
      await page.waitForFunction(() => window.game && document.querySelector('[data-action="begin"]'), null, { timeout: 30000 });
      await page.click('[data-action="begin"]');
      await page.waitForFunction(() => window.game.state.started, null, { timeout: 30000 });
      const set = await page.evaluate(async ({ variant }) => {
        const P = await import("/src/sim/parties.js"), W = await import("/src/sim/world.js");
        const st = game.state, hub = W.hub(st);
        st.hour = Math.floor(st.hour / 24) * 24 + 12; // midday: the inside in daylight
        let t = st.tiles.find((x) => x.id !== hub.tile && x.terrain === "suburb" && !st.bases.some((b) => b.tile === x.id)) || st.tiles.find((x) => x.id !== hub.tile && x.terrain !== "water" && !st.bases.some((b) => b.tile === x.id));
        hub.stock.ammo = 400; hub.stock.food = 100; hub.stock.water = 100; hub.stock.meds = 10;
        const crew = W.atBase(st, hub.id).filter((s) => s.alive).slice(0, 4);
        const r = P.launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: t.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 40, meds: 2 } });
        if (!r.party) return { err: "launch" };
        const p = r.party;
        p.path = [t.id]; p.idx = 0; p.phase = "engaged";
        game.ui.speed = 0;
        const place = { id: `libshot-${variant}`, key: "library", name: `Library (${variant})`, variant };
        game.combat.start({ mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "zombies", count: 0, power: 1, name: "nobody", groups: [] }, raid: { heat0: 0, choose: false, poi: null, kind: null, place, building: null }, plan: true, context: {} });
        const b = st.combat;
        return b ? { floors: b.floors ? b.floors.length : 1, w: b.w, h: b.h, B: b.raid.plan.building } : { err: "no battle" };
      }, { variant });
      if (set.err) { console.log(variant, "ERROR", set.err); bad++; await page.close(); continue; }
      await page.waitForTimeout(500);
      await page.evaluate(() => { const e = document.querySelector('[data-action="cb-plan"][data-v="enter"]:not([disabled])'); if (e) e.click(); });
      await page.waitForTimeout(900);
      for (let f = 0; f < set.floors; f++) {
        const info = await page.evaluate(async ({ f }) => {
          const C = await import("/src/sim/combat.js"), I = await import("/src/ui/isoview.js"), U = await import("/src/ui/combat.js"), b = game.state.combat, B = b.raid.plan.building;
          // Nobody to fight: everyone else off the map, the team on this floor's stairs.
          for (const u of b.units) if (u.side !== "player") u.x = -50;
          C.setFloor(b, f);
          // The team in the floor's biggest rooms (what they see is drawn; the rest is filled in below).
          const rooms = b.raid.areas.filter((r) => !r.outdoor && (r.f || 0) === f).sort((p, q) => q.w * q.h - p.w * p.h);
          b.units.filter((u) => u.side === "player").forEach((u, i) => {
            const r = rooms[i % Math.max(1, rooms.length)];
            if (!r) return;
            for (let y = r.y0 + 1; y < r.y0 + r.h - 1; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) if (b.cells[y * b.w + x].k === "open" && !b.units.some((q) => q !== u && (q.f || 0) === f && q.x === x && q.y === y)) { u.x = x; u.y = y; u.f = f; u.away = false; return; }
          });
          if (b.losCache) b.losCache.fill(0);
          I.setRoofs(false);
          for (const a of b.raid.areas) if (!a.outdoor && a.sw) a.on = true;
          document.querySelectorAll(".tipbox, .coach, [data-action='coach-close']").forEach((e) => e.remove && e.remove());
          b.rev = (b.rev || 0) + 1;
          game.refresh();
          // Fully revealed: every cell seen and known (the view's cache, kept as long as the battle's revision is).
          const fill = (a) => { if (a && a.fill) a.fill(1); else if (a && typeof a === "object") for (const k of Object.keys(a)) a[k] = 1; };
          fill(U.cui.cache.vis);
          if (U.cui.cache.known) fill(U.cui.cache.known.cells || U.cui.cache.known);
          // The camera: the building's middle, zoomed to fit it.
          while (I.iso.zoom > 0) I.isoZoom(b, -1);
          const big = Math.max(B.w, B.h);
          const steps = big > 48 ? 1 : big > 30 ? 2 : big > 20 ? 3 : 4;
          for (let i = 0; i < steps; i++) I.isoZoom(b, 1);
          I.isoCenterOn(b, B.x0 + Math.floor(B.w / 2), B.y0 + Math.floor(B.h / 2), false);
          game.refresh();
          return { zoom: I.iso.zoom, name: (b.floors && b.floors[f] && b.floors[f].name) || "Ground floor", rooms: b.raid.areas.filter((a) => !a.outdoor && (a.f || 0) === f).length };
        }, { f });
        await page.waitForTimeout(600);
        const file = path.join(outDir, `${variant.replace("/", "-")}-f${f}.png`);
        await page.screenshot({ path: file });
        console.log(file, JSON.stringify(info));
      }
      if (errs.length) { bad++; console.log(variant, "page errors:", errs.slice(0, 3).join(" | ")); }
      await page.close();
    }
    await browser.close();
  } finally {
    srv.kill();
  }
  process.exit(bad ? 1 : 0);
})();
