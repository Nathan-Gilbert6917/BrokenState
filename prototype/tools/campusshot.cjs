// Renders of a college campus (issue #28: sim/campus.js), and its frame time: a raid on a university with the campus
// kind set (tile.loc.campus), the fog lifted (ui/combat.js cui.cache.vis and .known.cells filled after a refresh).
// Shots: the whole campus from above (zoomed out, roofs on), a quad with joined buildings (roofs on and off), a dorm's
// upper floor, a lecture hall and a teaching lab, fully revealed (roofs off). The frame time: game.refresh() timed
// warm at the battle's own zoom (the mean of 10) and cold (the first, its ground and sprites made).
// Usage: node tools/campusshot.cjs [outdir] [state | liberal | community] [dead]. Prints one JSON line a shot.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "docs", "shots", "issue-28"));
const kind = process.argv[3] || "state";
const dead = Number(process.argv[4] || 0);
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
    const r = await page.evaluate(async ({ kind, dead }) => {
      const P = await import("/src/sim/parties.js"), W = await import("/src/sim/world.js");
      const st = game.state, hub = W.hub(st);
      st.hour = Math.floor(st.hour / 24) * 24 + 12;
      const t = st.tiles.find((x) => x.loc && x.loc.type === "univ");
      t.loc.campus = kind;
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
      return b ? { w: b.w, h: b.h, ms: Math.round(performance.now() - t0), buildings: b.raid.plan.houses.length, links: b.raid.plan.links.map((L) => L.type), dead: b.units.filter((u) => u.kind === "zombie").length } : { err: "no battle" };
    }, { kind, dead });
    console.log(JSON.stringify({ kind, ...r }));
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
      const f = path.join(outDir, `campus-${kind}-${name}.png`);
      await page.screenshot({ path: f });
      console.log(JSON.stringify({ shot: f, ...info, note: o.note || "" }));
    };
    const plan = await page.evaluate(() => { const P = game.state.combat.raid.plan; return { w: P.w, h: P.h, houses: P.houses, links: P.links, rooms: P.rooms }; });
    await shot("overview", { x: Math.floor(plan.w / 2), y: Math.floor(plan.h / 2), zoom: 0, roofs: true, note: "zoomed all the way out over the middle of the campus" });
    // The whole campus from above: the ground floor's plan, three px a cell (the iso view's farthest zoom shows a part).
    const top = await page.evaluate(() => {
      const b = game.state.combat, cells = b.floors ? b.floors[0].cells : b.cells, P = b.raid.plan, S = Math.max(1, Math.floor(Math.min(1440 / b.w, 900 / b.h)));
      const cv = document.createElement("canvas");
      cv.width = b.w * S; cv.height = b.h * S;
      Object.assign(cv.style, { position: "fixed", left: "20px", top: "20px", zIndex: 99999, background: "#111", imageRendering: "pixelated" });
      const g = cv.getContext("2d");
      const F = { grass: "#4a6a34", gravel: "#8a867c", road: "#3a3c40", track: "#a0503c", dirt: "#7a6448", floor: "#c8bca4", air: "#111" };
      const K = { wall: "#5a3a2a", window: "#6fa0c8", idoor: "#e08a30", odoor: "#e8a050", door: "#d04030", tree: "#1f4a1c", fence: "#2f5a2a", car: "#b84040", vehicle: "#3a7ad8", stairs: "#f0e060", fountain: "#5fa0c8", statue: "#d8d0b8", campusbench: "#6a4a2a", bleachers: "#9a9a9a", tent: "#e8e0c0", lamp: "#f0f0a0" };
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
        const c = cells[y * b.w + x];
        g.fillStyle = K[c.k] || (c.k !== "open" && c.f === "floor" ? "#8a6a48" : c.canopy ? "#b0a070" : F[c.f] || "#4a6a34");
        g.fillRect(x * S, y * S, S, S);
      }
      for (const z of b.raid.zones) { g.strokeStyle = "#5ad06a"; g.lineWidth = 2; g.strokeRect(z.x0 * S, z.y0 * S, z.w * S, z.h * S); }
      for (const L of P.links) { g.strokeStyle = L.type === "bridge" ? "#ff40ff" : "#ffd040"; g.lineWidth = 2; g.strokeRect(L.x0 * S, L.y0 * S, L.w * S, L.h * S); }
      g.font = "11px sans-serif"; g.fillStyle = "#000";
      for (const h of P.houses) { g.fillStyle = "rgba(0,0,0,0.65)"; g.fillRect(h.x0 * S, h.y0 * S, Math.min(h.w * S, g.measureText(h.name).width + 4), 13); g.fillStyle = "#fff"; g.fillText(h.name, h.x0 * S + 2, h.y0 * S + 10); }
      document.body.appendChild(cv);
      return { S, w: b.w, h: b.h };
    });
    await page.waitForTimeout(300);
    const wholeShot = path.join(outDir, `campus-${kind}-whole.png`);
    await page.screenshot({ path: wholeShot });
    console.log(JSON.stringify({ shot: wholeShot, ...top, note: "the whole campus from above: its ground-floor plan, the links outlined (yellow: walkways and corridors, magenta: bridges), the ways out green" }));
    await page.evaluate(() => { const cv = [...document.querySelectorAll("canvas")].find((c) => c.style.zIndex === "99999"); if (cv) cv.remove(); });
    const L = plan.links[0];
    if (L) {
      const a = plan.houses[L.a], c = plan.houses[L.b];
      const mx = Math.floor((a.x0 + c.x0 + c.w) / 2), my = Math.floor(L.y0 + L.h / 2) + 6;
      await shot("link-roofs", { x: mx, y: my, zoom: 3, roofs: true, f: 0, team: [mx, my + 14], note: `${L.type} joining ${a.name} and ${c.name}` });
      await shot("link-open", { x: mx, y: my, zoom: 3, roofs: false, f: 0, team: [mx, my + 14], note: `${L.type}, roofs off` });
      if (L.f > 0) await shot("bridge-floor", { x: mx, y: my - 6, zoom: 3, roofs: false, f: L.f, team: [L.x0 + 1, L.y0 + 1], note: `the bridge on floor ${L.f + 1}` });
    }
    const dorm = plan.houses.find((h) => h.key === "dorm");
    if (dorm) await shot("dorm-floor", { x: dorm.x0 + Math.floor(dorm.w / 2), y: dorm.y0 + Math.floor(dorm.h / 2), zoom: 4, roofs: false, f: Math.min(1, dorm.storeys - 1), note: `${dorm.name}, floor ${Math.min(2, dorm.storeys)}` });
    const room = (style) => plan.rooms.find((q) => q.campus === style && (q.f || 0) === 0);
    for (const [name, style] of [["lecture-hall", "lecture"], ["lab", "teachlab"]]) {
      const q = room(style);
      if (q) await shot(name, { x: q.x0 + Math.floor(q.w / 2), y: q.y0 + Math.floor(q.h / 2), zoom: 5, roofs: false, f: 0, note: q.name });
    }
    console.log(JSON.stringify({ errors: errs.slice(0, 5) }));
    await browser.close();
  } finally { srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
