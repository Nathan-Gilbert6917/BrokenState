// Restaurants by kind of food, format and size (issue #33, sim/eaterylayout.js): a raid into each of a list of
// variants in the real game, the building loaded directly (setup.raid.place = { id, key, name, variant }), roofs off,
// everything revealed (ui/combat.js cui.cache.vis and .known.cells filled after a refresh), zoomed to the building and
// saved as a JPEG a variant. Usage: node tools/eatshot.cjs [outdir] [kind:id ...] (default: twelve across the formats
// and cuisines). Starts the prototype's server on a free port and drives headless Chromium; prints one JSON line a shot.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "docs", "shots", "issue-33"));
const DEFAULT = ["restaurant:burgerbarn", "restaurant:tajpalace", "restaurant:goldenwok", "restaurant:sakura", "pizza:tonys", "restaurant:smokypete", "restaurant:villatoscana", "restaurant:emperorsbuffet", "bar:copperkettle", "restaurant:polarswirl", "restaurant:elcamion", "diner:starlite", "restaurant:crystalballroom", "restaurant:beanthere", "restaurant:seoulgrill", "restaurant:wingit"];
const list = process.argv.length > 3 ? process.argv.slice(3) : DEFAULT;
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
    for (const [n, item] of list.entries()) {
      const [key, id] = item.split(":");
      const r = await page.evaluate(async ({ key, id, n }) => {
        const P = await import("/src/sim/parties.js"), W = await import("/src/sim/world.js");
        const st = game.state, hub = W.hub(st);
        st.hour = Math.floor(st.hour / 24) * 24 + 12; // at noon: the big rooms in daylight
        if (st.combat) { st.combat = null; }
        for (const p of st.parties || []) if (p.phase === "engaged") p.phase = "done";
        let t = st.tiles.find((x) => x.id !== hub.tile && x.terrain === "suburb" && !x.loc && !st.bases.some((b) => b.tile === x.id)) || st.tiles.find((x) => x.id !== hub.tile && x.terrain !== "water" && !x.loc);
        const crew = W.atBase(st, hub.id).filter((s) => s.alive && !s.away).slice(0, 2);
        const res = P.launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: t.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2, ammo: 10, meds: 0 } });
        const p = res.party || (st.parties || []).find((q) => q.dest === t.id);
        if (!p) return { err: "launch" };
        p.path = [t.id]; p.idx = 0; p.phase = "engaged";
        game.ui.speed = 0;
        game.combat.start({ mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "mixed", count: 0, power: 1, name: "the dead", groups: [] }, raid: { heat0: 0, choose: false, poi: null, kind: key, place: { id: `eat${n}`, key, name: ((await import("/src/sim/shops.js")).franchiseName(key, id)), variant: id, kind: key }, building: null }, plan: false, context: {} });
        const b = st.combat;
        return b ? { w: b.w, h: b.h } : { err: "no battle" };
      }, { key, id, n });
      if (r.err) { console.log(JSON.stringify({ id, ...r })); continue; }
      await page.waitForTimeout(500);
      await page.evaluate(() => { const e = document.querySelector('[data-action="cb-plan"][data-v="enter"]:not([disabled])'); if (e) e.click(); });
      await page.waitForTimeout(800);
      const info = await page.evaluate(async () => {
        const I = await import("/src/ui/isoview.js"), CU = await import("/src/ui/combat.js"), b = game.state.combat, B = b.raid && b.raid.plan && b.raid.plan.building;
        I.setRoofs(false);
        for (const a of b.raid.areas) if (!a.outdoor) { a.on = true; a.dark = false; } // the lights on (sim/indoorlight.js)
        for (const u of b.units) if (u.side === "enemy") { u.hp = 0; u.dead = true; u.off = true; }
        // The team in the biggest rooms (what they see is drawn), the rest revealed below.
        const rooms = b.raid.areas.filter((r) => !r.outdoor && (r.f || 0) === 0).sort((p, q) => q.w * q.h - p.w * p.h);
        b.units.filter((u) => u.side === "player").forEach((u, i) => {
          const r = rooms[i % Math.max(1, rooms.length)];
          if (!r) return;
          for (let y = r.y0 + 1; y < r.y0 + r.h - 1; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) if (b.cells[y * b.w + x].k === "open" && !b.units.some((q) => q !== u && q.x === x && q.y === y)) { u.x = x; u.y = y; return; }
        });
        if (b.losCache) b.losCache.fill(0);
        b.rev = (b.rev || 0) + 1;
        game.refresh();
        const fillAll = () => { const c = CU.cui.cache; if (c && c.vis) c.vis.fill(1); if (c && c.known && c.known.cells) c.known.cells.fill(1); };
        fillAll();
        for (let g = 0; g < 8 && (I.iso.rot !== 0 || I.iso.straight); g++) I.isoRotate(b, 1);
        const big = B ? Math.max(B.w, B.h) : 20;
        for (let i = 0; i < 12; i++) I.isoZoom(b, -1);
        const steps = big > 36 ? 2 : big > 22 ? 3 : 5;
        for (let i = 0; i < steps; i++) I.isoZoom(b, 1);
        if (B) I.isoCenterOn(b, B.x0 + Math.floor(B.w / 2), B.y0 + Math.floor(B.h / 2), false);
        if (!document.getElementById("eatshot-css")) { const st = document.createElement("style"); st.id = "eatshot-css"; st.textContent = "* { visibility: hidden !important; } canvas { visibility: visible !important; }"; document.head.appendChild(st); } // the battle's canvas only
        I.clearIsoCache();
        game.refresh(); fillAll(); game.refresh();
        const spec = b.raid.plan;
        return { name: spec && spec.name, building: B, rooms: b.raid.areas.filter((a) => !a.outdoor).map((a) => a.name), containers: b.raid.containers.length };
      });
      await page.waitForTimeout(500);
      const f = path.join(outDir, `${String(n + 1).padStart(2, "0")}-${id}.jpg`);
      await page.screenshot({ path: f, type: "jpeg", quality: 78 });
      console.log(JSON.stringify({ id, file: f, ...info }));
    }
    console.log("errors:", errs.length ? errs.slice(0, 5).join(" | ") : "none");
    await browser.close();
  } finally {
    srv.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
