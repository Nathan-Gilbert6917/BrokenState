// Renders of a golf course, a campground and an RV park (issue #61: sim/outdoors.js), and their frame time: a raid on
// the place with its variant pinned, the fog lifted (ui/combat.js cui.cache.vis and .known.cells filled after a
// refresh). Shots a place: its whole ground-floor plan from above (the ways out green), the grounds in the iso view
// (roofs on), the main building with its roofs off. The frame time: game.refresh() timed warm at the battle's own zoom
// (the mean of 10) and cold (the first).
// Usage: node tools/outdoorshot.cjs [outdir] [golfcourse/country campground/statepark rvpark/highway ...]. Prints one
// JSON line a shot.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "docs", "shots", "issue-61"));
const places = process.argv.slice(3).length ? process.argv.slice(3) : ["golfcourse/country", "campground/statepark", "rvpark/highway"];
const port = 5300 + Math.floor(Math.random() * 600);

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.cjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 700));
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    for (const place of places) {
      const [key, layout] = place.split("/");
      const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
      const errs = [];
      page.on("pageerror", (e) => errs.push(String(e)));
      page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
      await page.goto(`http://localhost:${port}/?notitle`);
      await page.waitForFunction(() => window.game && document.querySelector('[data-action="begin"]'), null, { timeout: 30000 });
      await page.click('[data-action="begin"]');
      await page.waitForFunction(() => window.game.state.started, null, { timeout: 30000 });
      const r = await page.evaluate(async ({ key, layout }) => {
        const P = await import("/src/sim/parties.js"), W = await import("/src/sim/world.js");
        const st = game.state, hub = W.hub(st);
        st.hour = Math.floor(st.hour / 24) * 24 + 12;
        const t = st.tiles.find((x) => x.loc && x.loc.type === "campground") || st.tiles.find((x) => x.loc && x.id !== hub.tile);
        hub.stock.ammo = 400; hub.stock.food = 100; hub.stock.water = 100;
        const crew = W.atBase(st, hub.id).filter((s) => s.alive && !s.away).slice(0, 4);
        const res = P.launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: t.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2, ammo: 10, meds: 0 } });
        if (!res.party) return { err: "launch " + JSON.stringify(res).slice(0, 120) };
        const p = res.party;
        p.path = [t.id]; p.idx = 0; p.phase = "engaged";
        game.ui.speed = 0;
        const t0 = performance.now();
        game.combat.start({ mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "zombies", count: 0, power: 2, name: "the dead", groups: [] }, raid: { heat0: 5, place: { id: `shot:${key}`, key, name: key, layout } }, context: {} });
        const b = st.combat;
        return b ? { w: b.w, h: b.h, ms: Math.round(performance.now() - t0), vname: b.raid.plan.vname, buildings: b.raid.plan.houses.map((h) => h.name) } : { err: "no battle" };
      }, { key, layout });
      console.log(JSON.stringify({ place, ...r }));
      if (r.err) throw new Error(r.err);
      await page.waitForTimeout(400);
      await page.evaluate(() => { const el = document.querySelector('[data-action="cb-plan"][data-v="enter"]:not([disabled])'); if (el) el.click(); });
      await page.waitForTimeout(800);
      const frame = await page.evaluate(async () => {
        const I = await import("/src/ui/isoview.js");
        I.clearIsoCache();
        let t0 = performance.now();
        game.refresh();
        const cold = performance.now() - t0;
        const ts = [];
        for (let i = 0; i < 10; i++) { t0 = performance.now(); game.refresh(); ts.push(performance.now() - t0); }
        return { cold: Math.round(cold), warm: +(ts.reduce((a, v) => a + v, 0) / ts.length).toFixed(1), worst: +Math.max(...ts).toFixed(1), zoom: I.iso.zoom };
      });
      console.log(JSON.stringify({ frame }));
      const hide = async () => {
        for (let i = 0; i < 3; i++) await page.keyboard.press("Escape");
        await page.evaluate(() => {
          for (const el of document.querySelectorAll(".tipcard, .coachmark, .newtip, .floatwin, .rplanbox, .tipbox, .coach, .gdtip, .gd-note")) el.style.display = "none";
          for (const el of document.querySelectorAll("div")) if (el.offsetWidth && el.offsetWidth < 700 && /^(Before you|Show or hide the log|\d+ locked containers|Squad|Log)/.test((el.textContent || "").trim()) && !el.querySelector("canvas")) el.style.display = "none";
        });
      };
      const shot = async (name, o) => {
        const info = await page.evaluate(async (o) => {
          const I = await import("/src/ui/isoview.js"), C = await import("/src/sim/combat.js"), U = await import("/src/ui/combat.js");
          const b = game.state.combat;
          if (b.floors) C.setFloor(b, o.f || 0);
          for (const u of b.units) if (u.side === "player") { u.f = o.f || 0; u.away = false; }
          I.setRoofs(o.roofs);
          if (b.losCache) b.losCache.fill(0);
          b.rev = (b.rev || 0) + 1;
          for (let i = 0; i < 14; i++) I.isoZoom(b, -1);
          for (let i = 0; i < (o.zoom || 0); i++) I.isoZoom(b, 1);
          I.isoCenterOn(b, o.x, o.y, false);
          game.refresh();
          const v = U.cui.cache; if (v && v.vis) v.vis.fill(1); if (v && v.known && v.known.cells) v.known.cells.fill(1);
          game.refresh();
          return { zoom: I.iso.zoom };
        }, o);
        await hide();
        await page.waitForTimeout(600);
        const f = path.join(outDir, `${key}-${layout}-${name}.png`);
        await page.screenshot({ path: f });
        console.log(JSON.stringify({ shot: f, ...info, note: o.note || "" }));
      };
      const plan = await page.evaluate(() => { const P = game.state.combat.raid.plan; return { w: P.w, h: P.h, houses: P.houses, grounds: P.grounds }; });
      // The whole place from above: the ground floor's plan.
      const top = await page.evaluate(() => {
        const b = game.state.combat, cells = b.floors ? b.floors[0].cells : b.cells, P = b.raid.plan, S = Math.max(1, Math.floor(Math.min(1440 / b.w, 900 / b.h)));
        const cv = document.createElement("canvas");
        cv.width = b.w * S; cv.height = b.h * S;
        Object.assign(cv.style, { position: "fixed", left: "20px", top: "20px", zIndex: 99999, background: "#111", imageRendering: "pixelated" });
        const g = cv.getContext("2d");
        const F = { grass: "#4a6a34", field: "#7a7040", fairway: "#5f8a3c", green: "#7ab04a", sand: "#c8b484", gravel: "#8a867c", road: "#3a3c40", dirt: "#7a6448", paving: "#a8a49a", pool: "#5a90c0", court: "#4a7a8a", floor: "#c8bca4", air: "#111" };
        const K = { wall: "#5a3a2a", window: "#6fa0c8", idoor: "#e08a30", odoor: "#e8a050", door: "#d04030", tree: "#1f4a1c", bush: "#3a6a2a", fence: "#2f5a2a", rail: "#6a6a6a", car: "#d8d0c0", vehicle: "#3a7ad8", stairs: "#f0e060", water: "#2c5a8a", tent: "#e07b2a", firepit: "#a03020", patiotable: "#6a4a2a", lamp: "#f0f0a0" };
        for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
          const c = cells[y * b.w + x];
          g.fillStyle = K[c.k] || (c.k !== "open" && c.f === "floor" ? "#8a6a48" : c.canopy ? "#b0a070" : F[c.f] || "#4a6a34");
          g.fillRect(x * S, y * S, S, S);
        }
        for (const z of b.raid.zones) { g.strokeStyle = "#5ad06a"; g.lineWidth = 2; g.strokeRect(z.x0 * S, z.y0 * S, z.w * S, z.h * S); }
        g.font = "11px sans-serif";
        for (const h of P.houses) { g.fillStyle = "rgba(0,0,0,0.65)"; g.fillRect(h.x0 * S, h.y0 * S, Math.min(h.w * S + 40, g.measureText(h.name).width + 4), 13); g.fillStyle = "#fff"; g.fillText(h.name, h.x0 * S + 2, h.y0 * S + 10); }
        document.body.appendChild(cv);
        return { S, w: b.w, h: b.h };
      });
      await page.waitForTimeout(300);
      const whole = path.join(outDir, `${key}-${layout}-whole.png`);
      await page.screenshot({ path: whole });
      console.log(JSON.stringify({ shot: whole, ...top, note: "the whole place from above: its ground-floor plan, the ways out green" }));
      await page.evaluate(() => { const cv = [...document.querySelectorAll("canvas")].find((c) => c.style.zIndex === "99999"); if (cv) cv.remove(); });
      const g0 = plan.grounds.find((q) => q.kind !== "lot") || { x0: plan.w / 2, y0: plan.h / 2, w: 0, h: 0 };
      await shot("grounds", { x: Math.floor(g0.x0 + g0.w / 2), y: Math.floor(g0.y0 + g0.h / 2), zoom: 2, roofs: true, note: `the ${g0.name || "grounds"}` });
      const main = plan.houses[0];
      await shot("main-open", { x: main.x0 + Math.floor(main.w / 2), y: main.y0 + Math.floor(main.h / 2), zoom: 4, roofs: false, note: `${main.name}, roofs off` });
      if (errs.length) console.log(JSON.stringify({ errors: errs.slice(0, 5) }));
      await page.close();
    }
    await browser.close();
  } finally { srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
