// Renders of the buildings' layout variants (issue #32: sim/buildvariants.js), roofs off and fully revealed: each
// building loaded straight onto a raid's map (setup.raid.place = { id, key, name, layout }: the variant pinned), the
// team in its entry zone, the fog lifted (ui/combat.js cui.cache.vis and .known.cells filled after a refresh), the
// view zoomed to fit the building (a map of several buildings: the whole map). After tools/milshot.cjs (#25).
// Usage: node tools/variantshot.cjs [outdir] [key:layout ...]   (default: every motel layout and three each of the
// house, barn, apartment block, gas station and warehouse). Prints one JSON line a shot.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "docs", "shots", "issue-32"));
const want = process.argv.slice(3).length ? process.argv.slice(3) : ["motel:court", "motel:strip", "motel:chain", "motel:cabins", "motel:extended", "house:ranch", "house:mobile", "house:duplex", "barn:dairy", "barn:horse", "barn:bank",
  "apartments:walkup", "apartments:garden", "apartments:lofts", "gasstation:kiosk", "gasstation:carwash", "gasstation:service", "warehouse:distribution", "warehouse:cold", "warehouse:storage"];
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
    await page.goto(`http://localhost:${port}/?notitle`);
    await page.waitForFunction(() => window.game && document.querySelector('[data-action="begin"]'), null, { timeout: 30000 });
    await page.click('[data-action="begin"]');
    await page.waitForFunction(() => window.game.state.started, null, { timeout: 30000 });
    for (const w of want) {
      const [key, layout] = w.split(":"), site = "town";
      const r = await page.evaluate(async ({ key, site, layout }) => {
        const P = await import("/src/sim/parties.js"), W = await import("/src/sim/world.js"), BM = await import("/src/sim/buildingmaps.js");
        const st = game.state, hub = W.hub(st);
        if (st.combat) { st.combat = null; }
        st.hour = Math.floor(st.hour / 24) * 24 + 12;
        let t = st.tiles.find((x) => x.id !== hub.tile && x.loc && x.loc.type === site && !st.bases.some((b) => b.tile === x.id));
        if (!t) { t = st.tiles.find((x) => x.id !== hub.tile && x.terrain !== "water" && !x.loc && !st.bases.some((b) => b.tile === x.id)); st.tiles[t.id] = { ...t, loc: { type: site, name: site }, road: false }; t = st.tiles[t.id]; }
        hub.stock.ammo = 400; hub.stock.food = 100; hub.stock.water = 100; hub.stock.meds = 10;
        let p = window.__milParty ? st.parties.find((q) => q.id === window.__milParty) : null; // one party for every shot
        if (!p) {
          const crew = W.atBase(st, hub.id).filter((s) => s.alive && !s.away).slice(0, 2);
          const res = P.launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: t.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2, ammo: 10, meds: 0 } });
          if (!res.party) return { err: "launch " + JSON.stringify(res).slice(0, 120) };
          p = res.party; window.__milParty = p.id;
        }
        p.tile = t.id;
        p.path = [t.id]; p.idx = 0; p.phase = "engaged";
        game.ui.speed = 0;
        game.combat.start({ mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "zombies", count: 0, power: 1, name: "nobody" }, raid: { heat0: 0, place: { id: `vs-${key}-${layout}`, key, name: BM.BUILDINGS[key].name, layout } }, context: {} });
        const b = st.combat;
        if (!b) return { err: "no battle" };
        for (const u of b.units) if (u.side !== "player") { u.dead = true; u.off = true; }
        return { w: b.w, h: b.h, plan: !!b.setup.plan, variant: b.raid.plan && b.raid.plan.variant ? b.raid.plan.variant.name : null };
      }, { key, site, layout });
      if (r.err) { console.log(JSON.stringify({ key, layout, ...r })); continue; }
      await page.waitForTimeout(400);
      await page.evaluate(() => { const el = document.querySelector('[data-action="cb-plan"][data-v="enter"]:not([disabled])'); if (el) el.click(); });
      await page.waitForTimeout(800);
      const floors = await page.evaluate(() => { const b = game.state.combat; return b.floors ? b.floors.length : 1; });
      for (const f of [...new Set([0, floors - 1])]) {
        const info = await page.evaluate(async (f) => {
          const I = await import("/src/ui/isoview.js"), C = await import("/src/sim/combat.js"), U = await import("/src/ui/combat.js");
          const b = game.state.combat, B = b.raid.plan.street ? { x0: 0, y0: 0, w: b.w, h: b.h } : b.raid.plan.building; // several buildings: the whole map
          if (b.floors) C.setFloor(b, f);
          I.setRoofs(false);
          if (b.losCache) b.losCache.fill(0);
          b.rev = (b.rev || 0) + 1;
          // Fit the whole map in the view.
          I.isoCenterOn(b, B.x0 + Math.floor(B.w / 2), B.y0 + Math.floor(B.h / 2), false);
          for (let i = 0; i < 14; i++) I.isoZoom(b, -1);
          const fitZ = Math.max(B.w, B.h) < 30 ? 3 : Math.max(B.w, B.h) < 60 ? 1 : 0;
          for (let i = 0; i < fitZ; i++) I.isoZoom(b, 1);
          game.refresh();
          const v = U.cui.cache; if (v && v.vis) v.vis.fill(1); if (v && v.known && v.known.cells) v.known.cells.fill(1);
          game.refresh();
          const names = b.raid.areas.filter((a) => !a.outdoor && (a.f || 0) === f).map((a) => a.name);
          return { f, zoom: I.iso.zoom, rooms: [...new Set(names)].slice(0, 16) };
        }, f);
        for (let i = 0; i < 3; i++) await page.keyboard.press("Escape"); // the tips and the log closed
        await page.evaluate(() => { for (const el of document.querySelectorAll(".tipcard, .coachmark, .newtip, .floatwin, .rplanbox")) el.style.display = "none"; });
        await page.waitForTimeout(600);
        const shot = path.join(outDir, `${key}-${layout}-f${f}.png`);
        await page.screenshot({ path: shot });
        console.log(JSON.stringify({ shot, key, layout, variant: r.variant, ...info }));
      }
      await page.evaluate(() => { game.state.combat = null; });
    }
    console.log(JSON.stringify({ errors: errs.slice(0, 5) }));
    await browser.close();
  } finally { srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
