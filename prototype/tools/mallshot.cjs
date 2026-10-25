// Shopping malls in the real game (issue #30): renders and the frame time. A raid on a strip mall, a regional mall and
// an outlet centre (loaded directly with setup.raid.place), the whole map revealed (ui/combat.js cui.cache vis and known
// filled), shot zoomed out, then the views the issue asks for: a concourse with shops, the food court, an anchor store,
// the strip mall, the outlet centre. The frame: ui/combat.js drawCombat timed over 40 frames on a 1500 × 950 view.
// Usage: NODE_PATH=$(npm root -g) node tools/mallshot.cjs [outdir] [kinds, comma-separated]   (prints one JSON line a shot)
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "docs", "shots", "malls"));
const port = 5300 + Math.floor(Math.random() * 600);

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.cjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  let browser;
  try {
    await new Promise((r) => setTimeout(r, 700));
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await page.goto(`http://localhost:${port}/?notitle`);
    await page.waitForFunction(() => window.game && document.querySelector('[data-action="begin"]'), null, { timeout: 30000 });
    await page.click('[data-action="begin"]');
    await page.waitForFunction(() => window.game.state.started, null, { timeout: 30000 });
    const shot = async (name, info) => { await page.waitForTimeout(400); const f = path.join(outDir, `${name}.png`); await page.screenshot({ path: f }); console.log(JSON.stringify({ shot: f, ...info })); };
    for (const key of (process.argv[3] ? process.argv[3].split(",") : ["regionalmall", "stripmall", "outlet"])) {
      const setup = await page.evaluate(async (key) => {
        const P = await import("/src/sim/parties.js"), W = await import("/src/sim/world.js");
        const st = game.state, hub = W.hub(st);
        if (st.combat) { st.combat = null; game.refresh(); }
        st.hour = Math.floor(st.hour / 24) * 24 + 12; // noon: the inside in daylight
        const t = st.tiles.find((x) => x.id !== hub.tile && x.terrain === "suburb" && !st.bases.some((b) => b.tile === x.id)) || st.tiles.find((x) => x.id !== hub.tile && x.terrain !== "water");
        hub.stock.ammo = 400; hub.stock.food = 100; hub.stock.water = 100;
        const crew = W.atBase(st, hub.id).filter((s) => s.alive).slice(0, 2);
        const r = P.launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: t.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2, ammo: 10 } });
        if (!r.party) throw new Error("launch: " + JSON.stringify(r).slice(0, 200));
        const p = r.party;
        p.path = [t.id]; p.idx = 0; p.phase = "engaged";
        game.ui.speed = 0;
        const groups = [{ kind: "zombies", count: 20, power: 3 }, { kind: "zombies", count: 7, power: 3 }];
        game.combat.start({ mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "zombies", count: 27, power: 3, name: "the dead", groups }, raid: { heat0: 5, poi: null, kind: null, place: { id: key, key, name: { regionalmall: "Calder Mall", stripmall: "Pinewood Plaza", outlet: "Highway Outlets" }[key] } }, plan: true, context: {} });
        const b = st.combat;
        return b ? { w: b.w, h: b.h, levels: b.raid.storeys, buildings: b.raid.plan.houses.length, dead: b.units.filter((u) => u.side === "enemy").length } : null;
      }, key);
      if (!setup) throw new Error(`no raid on ${key}`);
      await page.waitForTimeout(500);
      await page.evaluate(() => { const e = document.querySelector('[data-action="cb-plan"][data-v="enter"]:not([disabled])'); if (e) e.click(); });
      await page.waitForTimeout(800);
      // The team moved to the spot (what they see there drawn), the rest revealed; centred, zoomed; the frame timed.
      // what: { x, y, f, zoom, roofs }
      await page.addStyleTag({ content: ".gdtip, #cblogwin, .tipbox, #cbcards { display: none !important; }" });
      const view = async (what) => page.evaluate(async (what) => {
        const C = await import("/src/sim/combat.js"), I = await import("/src/ui/isoview.js"), U = await import("/src/ui/combat.js");
        const st = game.state, b = st.combat, f = what.f || 0;
        if (b.floors && (b.floor || 0) !== f) C.setFloor(b, f);
        const cells = b.floors ? b.floors[f].cells : b.cells, taken = new Set();
        const spots = [];
        for (let r = 0; r < 12 && spots.length < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = what.x + dx, y = what.y + dy; if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue; const c = cells[y * b.w + x]; if (c && c.k === "open" && !taken.has(y * b.w + x)) { taken.add(y * b.w + x); spots.push([x, y]); } }
        b.units.filter((u) => u.side === "player").forEach((u, i) => { const sp = spots[i * 2] || spots[0]; if (sp) { u.x = sp[0]; u.y = sp[1]; u.f = f; u.away = false; } });
        if (b.losCache && b.losCache.fill) b.losCache.fill(0); else if (b.losCache && b.losCache.clear) b.losCache.clear();
        I.setRoofs(!!what.roofs);
        I.isoCenterOn(b, what.x, what.y, false);
        for (let i = 0; i < 16; i++) I.isoZoom(b, -1);
        for (let i = 0; i < what.zoom; i++) I.isoZoom(b, 1);
        b.rev = (b.rev || 0) + 1;
        game.refresh();
        const c = U.cui.cache;
        if (c && c.vis) c.vis.fill(1);
        if (c && c.known && c.known.cells) c.known.cells.fill(1);
        U.drawCombat(st, performance.now());
        const t0 = performance.now();
        for (let i = 0; i < 40; i++) U.drawCombat(st, performance.now());
        return { frameMs: +((performance.now() - t0) / 40).toFixed(1), zoom: I.iso.zoom, floor: b.floor || 0 };
      }, what);
      const big = async (name, what, info) => { await page.setViewportSize({ width: 3600, height: 2300 }); await view(what); await shot(name, info); await page.setViewportSize({ width: 1500, height: 950 }); };
      const P = await page.evaluate(() => { const b = game.state.combat, P = b.raid.plan; const room = (role) => b.raid.areas.find((a) => a.role === role || a.mall === role); const fc = room("foodcourt"), cc = room("concourse"), an = P.houses.find((h) => h.anchor); return { w: b.w, h: b.h, levels: b.raid.storeys, food: fc ? { x: fc.x0 + (fc.w >> 1), y: fc.y0 + (fc.h >> 1), f: fc.f } : null, conc: cc ? { x: cc.x0 + (cc.w >> 2), y: cc.y0 + (cc.h >> 1) } : null, anchor: an ? { x: an.x0 + (an.w >> 1), y: an.y0 + (an.h >> 1), name: an.name } : null }; });
      const whole = await view({ x: P.w >> 1, y: P.h >> 1, zoom: 0, roofs: true }); // the frame at the widest zoom on a 1500 × 950 view
      await big(`${key}-whole`, { x: P.w >> 1, y: P.h >> 1, zoom: 0, roofs: true }, { ...setup, frameMsWhole: whole.frameMs });
      if (key === "regionalmall") {
        if (P.conc) await shot("regionalmall-concourse", await view({ ...P.conc, zoom: 4 }));
        if (P.food) await shot("regionalmall-foodcourt", await view({ ...P.food, zoom: 5 }));
        if (P.anchor) await shot("regionalmall-anchor", { anchor: P.anchor.name, ...(await view({ ...P.anchor, zoom: 4 })) });
        if (P.levels > 1) await shot("regionalmall-upper", await view({ x: P.w >> 1, y: P.h >> 1, f: 1, zoom: 3 }));
      } else await shot(`${key}-close`, await view({ x: P.w >> 1, y: Math.floor(P.h * 0.3), zoom: 3 }));
    }
    console.log(JSON.stringify({ errors: errs.slice(0, 5) }));
  } finally {
    if (browser) await browser.close();
    srv.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
