// The office buildings of every kind (issue #27, sim/officeplans.js, officelayout.js) rendered in the real game, fully
// revealed, one PNG a floor (a tower: its ground, a middle and its top floor): each loaded straight into a raid as a
// place (setup.raid.place = { id, key, name, variant }), the roofs off, the dead sent away, every cell seen (ui/combat.js
// cui.cache.vis and .known.cells filled after a refresh). Prints one JSON line a shot and the page's errors.
// Usage: NODE_PATH=$(npm root -g) node tools/officeshot.cjs [outdir] [key:firm[:plan] ...] (plan: one of the kind's twelve
// named plans by its index, officeplans.js OFFICE_VARIANTS; else by the building's dice)
// e.g. officeshot.cjs /tmp/offices offices:caldertrust courthouse:district station:channel9
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "docs", "shots", "offices"));
const WANT = process.argv.slice(3).length ? process.argv.slice(3) : ["storefront:caldermutual", "storefront:brightsmile", "storefront:mercerpractice", "bizpark:lakeview", "offices:caldertrust",
  "cityhall:cityhall", "courthouse:district", "callcenter:teleserve", "techoffice:granitesys", "station:channel9", "station:radiocalder", "station:caldercourier"];
const port = 5300 + Math.floor(Math.random() * 600);

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.cjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 700));
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    const errs = [];
    for (const want of WANT) {
      const [key, variant, planNo] = want.split(":");
      const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
      page.on("pageerror", (e) => errs.push(`${want}: ${e}`));
      page.on("console", (m) => { if (m.type() === "error") errs.push(`${want}: ${m.text()}`); });
      await page.goto(`http://localhost:${port}/?notitle`);
      await page.waitForFunction(() => window.game && document.querySelector('[data-action="begin"]'), null, { timeout: 30000 });
      await page.click('[data-action="begin"]');
      await page.waitForFunction(() => window.game.state.started, null, { timeout: 30000 });
      const setup = await page.evaluate(async ({ key, variant, planNo }) => {
        const P = await import("/src/sim/parties.js"), W = await import("/src/sim/world.js"), B = await import("/src/sim/buildingmaps.js");
        const st = game.state, hub = W.hub(st);
        st.hour = Math.floor(st.hour / 24) * 24 + 12; // noon
        hub.stock.ammo = 400; hub.stock.food = 100; hub.stock.water = 100; hub.stock.meds = 10;
        const crew = W.atBase(st, hub.id).filter((s) => s.alive).slice(0, 4);
        const tiles = st.tiles.filter((x) => x.id !== hub.tile && x.terrain !== "water" && !st.bases.some((b) => b.tile === x.id)).sort((a, c) => (c.terrain === "city") - (a.terrain === "city"));
        let r = null, t = null;
        for (const x of tiles.slice(0, 40)) { t = x; r = P.launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: t.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 40, meds: 2 } }); if (r && r.party) break; }
        if (!r || !r.party) return { error: JSON.stringify(r).slice(0, 300), crew: crew.length };
        const p = r.party;
        p.path = [t.id]; p.idx = 0; p.phase = "engaged";
        game.ui.speed = 0;
        const place = { id: `shot-${key}-${variant}`, key, name: B.BUILDINGS[key].name, variant, ...(key === "offices" ? { kind: "office" } : {}), ...(planNo != null ? { plan: Number(planNo) } : {}) };
        game.combat.start({ mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "mixed", count: 1, power: 1, name: "the dead", groups: [{ kind: "zombie", count: 1, power: 1 }] }, raid: { heat0: 0, choose: true, poi: null, kind: null, place, building: null }, plan: true, context: {} });
        const b = st.combat;
        return b ? { w: b.w, h: b.h } : null;
      }, { key, variant, planNo });
      if (!setup || setup.error) { console.log(JSON.stringify({ want, error: "no raid", setup })); await page.close(); continue; }
      await page.waitForTimeout(500);
      await page.evaluate(() => { const e = document.querySelector('[data-action="cb-plan"][data-v="enter"]:not([disabled])'); if (e) e.click(); });
      await page.waitForTimeout(1000);
      const n = await page.evaluate(() => { const b = game.state.combat; return b.floors ? b.floors.length : 1; });
      const floors = n <= 3 ? [...Array(n).keys()] : [0, Math.floor((n - 1) / 2), n - 1];
      for (const f of floors) {
        const info = await page.evaluate(async (f) => {
          const C = await import("/src/sim/combat.js"), I = await import("/src/ui/isoview.js"), U = await import("/src/ui/combat.js"), b = game.state.combat;
          C.setFloor(b, f);
          for (const u of b.units) if (u.side === "enemy") u.x = -50;
          const rooms = b.raid.areas.filter((r) => !r.outdoor && (r.f || 0) === f);
          b.units.filter((u) => u.side === "player").forEach((u, i) => {
            const r = rooms[i % Math.max(1, rooms.length)];
            if (!r) return;
            for (let y = r.y0 + 1; y < r.y0 + r.h - 1; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) if (b.cells[y * b.w + x].k === "open" && !b.units.some((q) => q !== u && (q.f || 0) === f && q.x === x && q.y === y)) { u.x = x; u.y = y; u.f = f; u.away = false; return; }
          });
          for (const a of b.raid.areas) if (!a.outdoor && a.sw) a.on = true;
          I.setRoofs(false);
          const B = b.raid.plan.building;
          I.isoCenterOn(b, B.x0 + Math.floor(B.w / 2), B.y0 + Math.floor(B.h / 2), false);
          for (let i = 0; i < 12; i++) I.isoZoom(b, -1);
          for (let i = 0; i < 4; i++) I.isoZoom(b, 1);
          document.querySelectorAll(".tipbox, .coach, [data-action='coach-close'], [class*='coach'], [class*='hint']").forEach((e) => e.remove && e.remove());
          if (b.losCache) b.losCache.fill(0);
          b.rev = (b.rev || 0) + 1;
          game.refresh();
          // Every cell seen: the view's cache filled after the refresh (the next refresh keeps it: the same key).
          const cache = U.cui.cache;
          if (cache && cache.vis) cache.vis.fill(1);
          if (cache && cache.known && cache.known.cells) cache.known.cells.fill(1);
          game.refresh();
          return { f, plan: b.raid.plan && b.raid.plan.variant, name: b.floors ? b.floors[f].name : "Ground floor", rooms: rooms.map((r) => r.name).filter((x, i, a) => a.indexOf(x) === i).slice(0, 14), pieces: [...new Set(b.cells.filter((c) => c.f === "floor" && !["open", "wall", "window", "idoor", "odoor", "door", "stairs", "void"].includes(c.k)).map((c) => c.k))].slice(0, 30) };
        }, f);
        await page.waitForTimeout(500);
        const shot = path.join(outDir, `${key}-${variant}${planNo != null ? `-p${planNo}` : ""}-f${f}.png`);
        await page.screenshot({ path: shot });
        console.log(JSON.stringify({ shot, ...info }));
      }
      await page.close();
    }
    console.log("page errors:", JSON.stringify(errs.slice(0, 8)));
    await browser.close();
  } finally { srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
