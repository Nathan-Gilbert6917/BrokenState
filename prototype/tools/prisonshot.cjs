// Prison renders and the frame time (issue #31): a raid on a prison (or a county jail) in the real game, saved as PNGs:
// the whole complex zoomed out, a cell block's two tiers (the lower with the roofs off, the upper floor as PageUp shows
// it), the exercise yard, central control, and the frame time at that size (the iso view redrawn after a camera move,
// the first frame and the steady ones). Usage: NODE_PATH=$(npm root -g) node tools/prisonshot.cjs [outdir] [prison|jail]
// Starts the prototype's server on a free port and drives headless Chromium; prints one line a shot.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "docs", "shots"));
const want = process.argv[3] || "prison"; // prison | jail | max (a maximum-security penitentiary: the biggest map)
const site = want === "max" ? "prison" : want;
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
    const setup = await page.evaluate(async ({ site, want }) => {
      const P = await import("/src/sim/parties.js"), W = await import("/src/sim/world.js"), S = await import("/src/sim/scavenge.js"), PR = await import("/src/sim/prison.js");
      const st = game.state, hub = W.hub(st);
      let t = st.tiles.find((x) => x.id !== hub.tile && x.loc && x.loc.type === site && !st.bases.some((b) => b.tile === x.id) && (want !== "max" || PR.prisonKind(st, x.id, { key: "prison" }) === "max"));
      if (!t && want === "max") { const q = st.tiles.find((x) => x.id !== hub.tile && x.terrain !== "water" && !x.loc && !st.bases.some((b) => b.tile === x.id) && PR.prisonKind(st, x.id, { key: "prison" }) === "max"); st.tiles[q.id] = { ...q, loc: { type: "prison", name: "Penitentiary" }, road: false }; t = st.tiles[q.id]; }
      if (!t) { t = st.tiles.find((x) => x.id !== hub.tile && x.terrain !== "water" && !x.loc && !st.bases.some((b) => b.tile === x.id)); st.tiles[t.id] = { ...t, loc: { type: site, name: site === "jail" ? "County jail" : "State prison" }, road: false }; t = st.tiles[t.id]; }
      st.hour = Math.floor(st.hour / 24) * 24 + 12; // noon: the inside in daylight
      hub.stock.ammo = 400; hub.stock.food = 100; hub.stock.water = 100; hub.stock.meds = 10;
      const crew = W.atBase(st, hub.id).filter((s) => s.alive).slice(0, 4);
      const r = P.launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: t.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 40, meds: 2 } });
      const p = r.party;
      p.path = [t.id]; p.idx = 0; p.phase = "engaged";
      game.ui.speed = 0;
      const groups = S.raidEnemies(st, t.id);
      game.combat.start({ mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "mixed", count: 1, power: 3, name: "the dead", groups }, raid: { heat0: 5, choose: true, poi: null, kind: null, place: null, building: null }, plan: true, context: {} });
      const b = st.combat;
      return b ? { w: b.w, h: b.h, kind: b.raid.plan && b.raid.plan.prisonKind, buildings: b.raid.plan && b.raid.plan.houses.length, dead: b.units.filter((u) => u.kind === "zombie" && !u.dead).length } : null;
    }, { site, want });
    console.log("raid:", JSON.stringify(setup));
    if (!setup) throw new Error("no raid started");
    await page.waitForTimeout(600);
    // The whole complex: the Before you go in window's map of it (every building, the fences, the zones).
    { const f = path.join(outDir, `prison-${want}-plan.png`); await page.screenshot({ path: f }); console.log(f); }
    const go = await page.evaluate(() => { const e = document.querySelector('[data-action="cb-plan"][data-v="enter"]:not([disabled])'); if (e) e.click(); return !!e; });
    await page.waitForTimeout(1200);
    await page.addStyleTag({ content: ".gd-note, [class*='gd-'], #cblogwin, .tipbox { display: none !important; }" }); // the guide's notes, the log and the tips off the shots
    const shot = async (name) => { await page.waitForTimeout(500); const f = path.join(outDir, `prison-${want}-${name}.png`); await page.screenshot({ path: f }); console.log(f); };
    // A view: the team set on these cells (they see what is drawn), the floor, the roofs, the zoom, centred on (cx, cy).
    const view = (o) => page.evaluate(async (o) => {
      const C = await import("/src/sim/combat.js"), I = await import("/src/ui/isoview.js"), b = game.state.combat;
      if (b.floors) C.setFloor(b, o.f || 0);
      const mine = b.units.filter((u) => u.side === "player");
      (o.at || []).forEach(([x, y], i) => { const u = mine[i]; if (!u) return; u.x = x; u.y = y; u.f = o.f || 0; u.away = false; });
      I.setRoofs(!!o.roofs);
      if (b.losCache) b.losCache.fill(0);
      if (b.floors) for (const F of b.floors) if (F.losCache) F.losCache.fill(0);
      document.querySelectorAll(".tipbox, .coach, [data-action='coach-close']").forEach((e) => e.remove && e.remove());
      for (let i = 0; i < 30 && I.iso.zoom > o.zoom; i++) I.isoZoom(b, -1); // as far as the view goes
      for (let i = 0; i < 30 && I.iso.zoom < o.zoom; i++) I.isoZoom(b, 1);
      I.isoCenterOn(b, o.cx, o.cy, false);
      b.rev = (b.rev || 0) + 1;
      game.refresh();
      return { zoom: I.iso.zoom, floor: b.floor || 0 };
    }, o);
    // Where things are.
    const where = await page.evaluate(() => {
      const b = game.state.combat, P = b.raid.plan, A = b.raid.areas;
      const open = (a, f = 0) => { const out = []; const cells = b.floors ? b.floors[f].cells : b.cells; for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) if (cells[y * b.w + x].k === "open") out.push([x, y]); return out; };
      const unit = P.units.find((u) => !u.dorm) || P.units[0];
      const day = A.find((a) => a.prison === "dayroom" && a.unitId === unit.unitId && !(a.f > 0));
      const tierUp = A.filter((a) => a.prison === "tier" && a.unitId === unit.unitId && a.f === 1);
      const ctl = A.find((a) => a.prison === "control");
      const yard = A.find((a) => a.role === "yard");
      const H = P.houses.find((h) => h.k === unit.house);
      return {
        all: [Math.floor(b.w / 2), Math.floor(b.h / 2)],
        block: H ? [H.x0 + Math.floor(H.w / 2), H.y0 + Math.floor(H.h / 2)] : null, day: day ? open(day).filter((_, i) => i % 9 === 0).slice(0, 4) : [],
        up: tierUp.flatMap((a) => open(a, 1)).filter((_, i) => i % 7 === 0).slice(0, 4),
        ctl: ctl ? { c: [ctl.x0 + Math.floor(ctl.w / 2), ctl.y0 + Math.floor(ctl.h / 2)], f: ctl.f || 0, at: open(ctl, ctl.f || 0).slice(0, 3) } : null,
        yard: yard ? { c: [yard.x0 + Math.floor(yard.w / 2), yard.y0 + Math.floor(yard.h / 2)], at: [[yard.x0 + 3, yard.y0 + 3], [yard.x0 + yard.w - 4, yard.y0 + 3], [yard.x0 + 3, yard.y0 + yard.h - 4], [yard.x0 + yard.w - 4, yard.y0 + yard.h - 4]] } : null,
      };
    });
    console.log("where:", JSON.stringify(where));
    // The whole complex from above (the ground floor, a few pixels a cell, over the page): the buildings, the fences and
    // the wall, the wire between, the towers, the gates, the yard's track and court, the cars, the ways out.
    await page.evaluate(() => {
      const b = game.state.combat, cells = b.floors ? b.floors[0].cells : b.cells, px = Math.max(2, Math.floor(900 / Math.max(b.w, b.h)));
      const cv = document.createElement("canvas"); cv.width = b.w * px; cv.height = b.h * px;
      const g = cv.getContext("2d");
      const col = (c) => {
        switch (c.k) {
          case "wall": case "window": return c.t === 2 && c.f === "floor" && !c.fl ? "#202024" : "#2b2b30";
          case "pfence": return "#c8ccc8"; case "wire": return "#8a6a5a"; case "gate": return "#5ad06a"; case "tower": return "#e0c040";
          case "idoor": case "odoor": case "door": return "#a07040"; case "bars": return "#7a8088"; case "car": case "truck": return "#6a7a90";
          case "rail": return "#9aa"; case "lamp": return "#ffe080";
        }
        if (c.hole) return "#ff5050";
        if (c.f === "floor") return c.k === "open" ? "#b8ac94" : "#8c806c";
        return { road: "#4b4b4f", gravel: "#6a6450", dirt: "#7a5a3a", grass: "#3f5a33", conc: "#8a8a84" }[c.f] || "#3f5a33";
      };
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) { g.fillStyle = col(cells[y * b.w + x]); g.fillRect(x * px, y * px, px, px); }
      for (const z of b.raid.zones) { g.strokeStyle = "#7dff8a"; g.lineWidth = 2; g.strokeRect(z.x0 * px, z.y0 * px, z.w * px, z.h * px); }
      g.font = `${Math.max(10, px * 4)}px sans-serif`; g.fillStyle = "#fff";
      for (const h of b.raid.plan.houses) g.fillText(h.name, h.x0 * px, (h.y0 - 1) * px);
      const div = document.createElement("div"); div.id = "pshot";
      div.style.cssText = "position:fixed;inset:0;background:#111;z-index:99999;display:flex;align-items:center;justify-content:center";
      const img = document.createElement("img"); img.src = cv.toDataURL(); img.style.cssText = "max-width:100%;max-height:100%;image-rendering:pixelated";
      div.appendChild(img); document.body.appendChild(div);
    });
    await shot("whole-map");
    await page.evaluate(() => { const e = document.getElementById("pshot"); if (e) e.remove(); });
    console.log("view:", JSON.stringify(await view({ zoom: -20, cx: where.all[0], cy: where.all[1], roofs: true, at: [] })));
    await shot("whole");
    if (where.block) { console.log("view:", JSON.stringify(await view({ zoom: 4, cx: where.block[0], cy: where.block[1], roofs: false, at: where.day }))); await shot("block-lower"); }
    if (where.block && where.up.length) { console.log("view:", JSON.stringify(await view({ zoom: 4, f: 1, cx: where.block[0], cy: where.block[1], roofs: false, at: where.up }))); await shot("block-upper"); }
    if (where.yard) { console.log("view:", JSON.stringify(await view({ zoom: 2, cx: where.yard.c[0], cy: where.yard.c[1], roofs: false, at: where.yard.at }))); await shot("yard"); }
    if (where.ctl) { console.log("view:", JSON.stringify(await view({ zoom: 6, f: where.ctl.f, cx: where.ctl.c[0], cy: where.ctl.c[1], roofs: false, at: where.ctl.at }))); await shot("control"); }
    // The frame time: the view at play zoom over the block, redrawn after a small camera move, 30 times.
    const frames = await page.evaluate(async (c) => {
      const C = await import("/src/sim/combat.js"), I = await import("/src/ui/isoview.js"), b = game.state.combat;
      if (b.floors) C.setFloor(b, 0);
      for (let i = 0; i < 30 && I.iso.zoom > 2; i++) I.isoZoom(b, -1);
      for (let i = 0; i < 30 && I.iso.zoom < 2; i++) I.isoZoom(b, 1);
      const times = [];
      for (let i = 0; i < 31; i++) {
        I.isoCenterOn(b, c[0] + (i % 2 ? 2 : -2), c[1], false);
        b.rev = (b.rev || 0) + 1;
        const t0 = performance.now();
        game.refresh();
        times.push(performance.now() - t0);
      }
      const steady = times.slice(1).sort((p, q) => p - q);
      return { first: Math.round(times[0]), median: Math.round(steady[steady.length >> 1] * 10) / 10, p90: Math.round(steady[Math.floor(steady.length * 0.9)] * 10) / 10 };
    }, where.block || where.all);
    console.log("frame ms:", JSON.stringify(frames));
    console.log("errors:", errs.length ? errs.slice(0, 5).join(" | ") : "none");
    await browser.close();
  } finally {
    srv.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
