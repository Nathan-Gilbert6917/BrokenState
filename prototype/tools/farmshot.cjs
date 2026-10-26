// Renders of a farm or a ranch (issue #62: sim/farmstead.js), and its frame time: a raid on a farm site with its layout
// pinned (tile.loc.farm; a ranch: tile.loc.type set to ranch), the fog lifted. Shots: the whole place from above (its
// ground-floor plan, the buildings named, the ways out green), the farmyard zoomed out with roofs on, a building's
// rooms with roofs off. The frame time as tools/campusshot.cjs.
// Usage: node tools/farmshot.cjs [outdir] [farm | ranch] [layout id] [dead]. Prints one JSON line a shot.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "docs", "shots", "issue-62"));
const kind = process.argv[3] || "farm";
const lay = process.argv[4] || "dairy";
const dead = Number(process.argv[5] || 0);
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
    const r = await page.evaluate(async ({ kind, lay, dead }) => {
      const P = await import("/src/sim/parties.js"), W = await import("/src/sim/world.js");
      const st = game.state, hub = W.hub(st);
      st.hour = Math.floor(st.hour / 24) * 24 + 12;
      const t = st.tiles.find((x) => x.loc && x.loc.type === "farm");
      t.loc.type = kind; t.loc.farm = lay;
      hub.stock.ammo = 400; hub.stock.food = 100; hub.stock.water = 100;
      const crew = W.atBase(st, hub.id).filter((s) => s.alive && !s.away).slice(0, 4);
      const res = P.launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: t.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2, ammo: 10, meds: 0 } });
      if (!res.party) return { err: "launch " + JSON.stringify(res).slice(0, 120) };
      const p = res.party;
      p.path = [t.id]; p.idx = 0; p.phase = "engaged";
      game.ui.speed = 0;
      const t0 = performance.now();
      game.combat.start({ mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "zombies", count: dead, power: 2, name: "the dead", groups: dead ? [{ kind: "zombies", count: dead, power: 2 }] : [] }, raid: { heat0: 0 }, context: {} });
      const b = st.combat;
      return b ? { w: b.w, h: b.h, ms: Math.round(performance.now() - t0), buildings: b.raid.plan.houses.map((h) => h.name), layout: b.raid.plan.layoutName, dead: b.units.filter((u) => u.kind === "zombie").length } : { err: "no battle" };
    }, { kind, lay, dead });
    console.log(JSON.stringify({ kind, lay, ...r }));
    if (r.err) throw new Error(r.err);
    await page.waitForTimeout(400);
    await page.evaluate(() => { const el = document.querySelector('[data-action="cb-plan"][data-v="enter"]:not([disabled])'); if (el) el.click(); });
    await page.waitForTimeout(800);
    // The frame time at the battle's own zoom: cold (the first refresh after the caches are cleared), then warm.
    const frame = await page.evaluate(async () => {
      const I = await import("/src/ui/isoview.js"), b = game.state.combat;
      I.clearIsoCache();
      let t0 = performance.now();
      game.refresh();
      const cold = performance.now() - t0;
      const ts = [];
      for (let i = 0; i < 10; i++) { b.rev = (b.rev || 0); t0 = performance.now(); game.refresh(); ts.push(performance.now() - t0); }
      return { cold: Math.round(cold), warm: +(ts.reduce((a, v) => a + v, 0) / ts.length).toFixed(1), worst: +Math.max(...ts).toFixed(1), zoom: I.iso.zoom };
    });
    console.log(JSON.stringify({ frame }));
    const hide = async () => {
      for (let i = 0; i < 3; i++) await page.keyboard.press("Escape");
      await page.evaluate(() => {
        for (const el of document.querySelectorAll(".tipcard, .coachmark, .newtip, .floatwin, .rplanbox, .tipbox, .coach, .gdtip, .gd-note")) el.style.display = "none";
        // The opening notes and the log window over the map (their own classes vary): by what they say.
        for (const el of document.querySelectorAll("div")) if (el.offsetWidth && el.offsetWidth < 700 && /^(Before you|Show or hide the log|\d+ locked containers|Squad|Log)/.test((el.textContent || "").trim()) && !el.querySelector("canvas")) el.style.display = "none";
      });
    };
    // A shot: the floor f, the view centred on (x, y) at zoom steps in from all the way out, roofs on or off, revealed.
    const shot = async (name, o) => {
      const info = await page.evaluate(async (o) => {
        const I = await import("/src/ui/isoview.js"), C = await import("/src/sim/combat.js"), U = await import("/src/ui/combat.js");
        const b = game.state.combat;
        if (b.floors) C.setFloor(b, o.f || 0);
        for (const u of b.units) if (u.side === "player") { u.f = o.f || 0; u.away = false; }
        if (o.team) b.units.filter((u) => u.side === "player").forEach((u, i) => { u.x = o.team[0] + i; u.y = o.team[1]; });
        I.setRoofs(o.roofs);
        if (b.losCache) b.losCache.fill(0);
        b.rev = (b.rev || 0) + 1;
        for (let i = 0; i < 14; i++) I.isoZoom(b, -1);
        for (let i = 0; i < (o.zoom || 0); i++) I.isoZoom(b, 1);
        I.isoCenterOn(b, o.x, o.y, false);
        game.refresh();
        const v = U.cui.cache; if (v && v.vis) v.vis.fill(1); if (v && v.known && v.known.cells) v.known.cells.fill(1);
        game.refresh();
        return { zoom: I.iso.zoom, f: o.f || 0 };
      }, o);
      await hide();
      await page.waitForTimeout(600);
      const f = path.join(outDir, `${kind}-${lay}-${name}.png`);
      await page.screenshot({ path: f });
      console.log(JSON.stringify({ shot: f, ...info, note: o.note || "" }));
    };
    const plan = await page.evaluate(() => { const P = game.state.combat.raid.plan; return { w: P.w, h: P.h, houses: P.houses, grounds: P.grounds }; });
    const top = await page.evaluate(() => {
      const b = game.state.combat, cells = b.floors ? b.floors[0].cells : b.cells, P = b.raid.plan, S = Math.max(1, Math.floor(Math.min(1440 / b.w, 900 / b.h)));
      const cv = document.createElement("canvas");
      cv.width = b.w * S; cv.height = b.h * S;
      Object.assign(cv.style, { position: "fixed", left: "20px", top: "20px", zIndex: 99999, background: "#111", imageRendering: "pixelated" });
      const g = cv.getContext("2d");
      const F = { grass: "#4a6a34", field: "#8a7a40", gravel: "#8a867c", road: "#3a3c40", dirt: "#7a6448", floor: "#c8bca4", air: "#111" };
      const K = { wall: "#5a3a2a", window: "#6fa0c8", idoor: "#e08a30", odoor: "#e8a050", door: "#d04030", tree: "#1f4a1c", fence: "#d0c090", wirefence: "#a0a0a0", fieldgate: "#ffffff", gate: "#ffffff", car: "#b84040", vehicle: "#3a7ad8", stairs: "#f0e060", water: "#4a5a30", silo: "#e0d8c0", grainbin: "#c0c8d0", hay: "#e8c050", stocktank: "#5fa0c8", chute: "#606060", calfhutch: "#ffffff", trellis: "#3a6a2a", beehive: "#f0e0a0", lamp: "#f0f0a0", bush: "#3a5a2a", bleachers: "#9a9a9a" };
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
        const c = cells[y * b.w + x];
        g.fillStyle = K[c.k] || (c.k !== "open" && c.f === "floor" ? "#8a6a48" : F[c.f] || "#4a6a34");
        g.fillRect(x * S, y * S, S, S);
      }
      for (const z of b.raid.zones) { g.strokeStyle = "#5ad06a"; g.lineWidth = 2; g.strokeRect(z.x0 * S, z.y0 * S, z.w * S, z.h * S); }
      g.font = "11px sans-serif";
      for (const h of P.houses) { g.fillStyle = "rgba(0,0,0,0.65)"; g.fillRect(h.x0 * S, h.y0 * S, g.measureText(h.name).width + 4, 13); g.fillStyle = "#fff"; g.fillText(h.name, h.x0 * S + 2, h.y0 * S + 10); }
      for (const q of P.grounds || []) { g.fillStyle = "rgba(0,0,0,0.65)"; g.fillRect(q.x0 * S + 4, q.y0 * S + 4, g.measureText(q.name).width + 4, 13); g.fillStyle = "#ffe080"; g.fillText(q.name, q.x0 * S + 6, q.y0 * S + 14); }
      document.body.appendChild(cv);
      return { S, w: b.w, h: b.h };
    });
    await page.waitForTimeout(300);
    const wholeShot = path.join(outDir, `${kind}-${lay}-whole.png`);
    await page.screenshot({ path: wholeShot });
    console.log(JSON.stringify({ shot: wholeShot, ...top, note: "the whole place from above: its ground-floor plan, the buildings and the plots named, the ways out green" }));
    await page.evaluate(() => { const cv = [...document.querySelectorAll("canvas")].find((c) => c.style.zIndex === "99999"); if (cv) cv.remove(); });
    const yard = plan.houses.find((h) => h.row === 1) || plan.houses[0];
    await shot("yard", { x: yard.x0 + Math.floor(yard.w / 2), y: yard.y0 + yard.h + 8, zoom: 2, roofs: true, note: `the farmyard by ${yard.name}, roofs on` });
    for (const h of plan.houses.slice(0, 3)) await shot(`bldg${h.k}`, { x: h.x0 + Math.floor(h.w / 2), y: h.y0 + Math.floor(h.h / 2), zoom: 4, roofs: false, team: [h.x0 + 1, h.y0 + h.h + 2], note: `${h.name}, roofs off` });
    const near = await page.evaluate(() => { const b = game.state.combat, cells = b.floors ? b.floors[0].cells : b.cells; const i = cells.findIndex((c) => ["silo", "grainbin", "calfhutch", "stocktank", "beehive", "chute", "trellis"].includes(c.k)); return i < 0 ? null : [i % b.w, Math.floor(i / b.w), cells[i].k]; });
    if (near) await shot("pieces", { x: near[0], y: near[1], zoom: 5, roofs: true, note: `the yard's pieces by a ${near[2]}` });
    const back = (plan.grounds || [])[0];
    if (back) await shot("back", { x: back.x0 + Math.floor(back.w / 2), y: back.y0 + Math.floor(back.h / 2), zoom: 2, roofs: true, note: back.name });
    if (errs.length) console.log(JSON.stringify({ errors: errs.slice(0, 5) }));
    await browser.close();
  } finally { srv.kill(); }
})();
