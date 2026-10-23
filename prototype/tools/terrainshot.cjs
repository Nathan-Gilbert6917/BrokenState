// The lie of the land in a fight (src/sim/highground.js), saved as PNGs from the real game: a raid in a building with
// storeys, a survivor on a hill a raider below (the hit breakdown's High ground), the raider shooting up (Uphill, Half
// cover: hill: the hover card), and the survivor on a hill looking into the upper floor through a window (the raider's
// marker, the odds across). Usage: NODE_PATH=$(npm root -g) node tools/terrainshot.cjs [outdir]
// Starts the prototype's server on a free port and drives headless Chromium; prints one line a shot.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "docs", "shots"));
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
    // A raid on a building with an upper floor, the ground out from one of its windows made into a hill.
    const setup = await page.evaluate(async () => {
      const P = await import("/src/sim/parties.js"), W = await import("/src/sim/world.js"), S = await import("/src/sim/scavenge.js"), C = await import("/src/sim/combat.js");
      const st = game.state, hub = W.hub(st);
      hub.stock.ammo = 400;
      const types = ["farmhouse", "house", "lodge", "motel", "police", "school", "clinic"];
      const cands = st.tiles.filter((x) => x.id !== hub.tile && x.loc && types.includes(x.loc.type) && !st.bases.some((b) => b.tile === x.id));
      const crew = W.atBase(st, hub.id).filter((s) => s.alive).slice(0, 2);
      const r = cands.length ? P.launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: cands[0].id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 40, meds: 2 } }) : {};
      if (!r.party) return null;
      const p = r.party;
      for (const t of cands) { // the one team, sent to each place in turn until one has the window
        p.path = [t.id]; p.idx = 0; p.phase = "engaged";
        game.ui.speed = 0;
        game.combat.start({ mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "mixed", count: 1, power: 3, name: "the dead", groups: S.raidEnemies(st, t.id) }, raid: { heat0: 0, poi: null, kind: null, place: null, building: null }, context: {} });
        const b = st.combat;
        if (!b || !b.floors || b.floors.length < 2) { st.combat = null; continue; }
        const F1 = b.floors[1].cells, G = b.floors[0].cells, Wd = b.w;
        for (let k = 0; k < F1.length; k++) {
          if (F1[k].k !== "window") continue;
          const wx = k % Wd, wy = (k / Wd) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ix = wx - dx, iy = wy - dy;
            if (ix < 0 || iy < 0 || ix >= Wd || iy >= b.h || !C.CELL[F1[iy * Wd + ix].k].walk) continue;
            let clear = true;
            for (let s = 1; s <= 8 && clear; s++) { const x = wx + dx * s, y = wy + dy * s; if (x < 1 || y < 1 || x >= Wd - 1 || y >= b.h - 1 || F1[y * Wd + x].k !== "void") clear = false; }
            if (!clear) continue;
            b.raid.spawnCap = 0;
            const mine = b.units.filter((u) => u.side === "player");
            const foes = b.units.filter((u) => u.side === "enemy");
            for (const u of foes.slice(2)) u.dead = true;
            if (foes.length < 2) { const c = structuredClone(foes[0]); c.id = b.nextId++; b.units.push(c); foes.push(c); } // a second raider, below the hill
            const [up, low] = foes;
            for (const u of [up, low]) { if (!u) continue; u.kind = "human"; delete u.ztype; u.weapon = "pistol"; u.weaponName = "Pistol"; u.name = u === up ? "Raider at the window" : "Raider below the hill"; u.aware = true; u.surprised = false; u.hp = u.maxHp = 60; }
            // The ground: open, a hill two levels up 4–5 tiles out (its foot a level), the second raider below it.
            for (let s = 1; s <= 8; s++) for (let o = -3; o <= 3; o++) { const x = wx + dx * s + (dy ? o : 0), y = wy + dy * s + (dx ? o : 0); if (x < 0 || y < 0 || x >= Wd || y >= b.h) continue; const c = G[y * Wd + x]; if (c.f === "floor") continue; c.k = "open"; delete c.h; delete c.ter; }
            for (let s = 3; s <= 6; s++) for (let o = -3; o <= 3; o++) { const x = wx + dx * s + (dy ? o : 0), y = wy + dy * s + (dx ? o : 0); if (x < 0 || y < 0 || x >= Wd || y >= b.h) continue; const c = G[y * Wd + x]; if (c.f === "floor") continue; const lv = s >= 4 && s <= 5 && Math.abs(o) <= 2 ? 2 : 1; c.h = lv; c.ter = 1; }
            const at = (s, o) => [wx + dx * s + (dy ? o : 0), wy + dy * s + (dx ? o : 0)];
            const [hx, hy] = at(5, 0);
            mine[0].x = hx; mine[0].y = hy; mine[0].f = 0; mine[0].away = false; mine[0].ap = 2;
            const inMap = ([x, y]) => x >= 1 && y >= 1 && x < Wd - 1 && y < b.h - 1;
            const side = inMap(at(6, 2)) && inMap(at(8, -2)) ? 1 : -1; // the mate off one side of the line, the raider below off the other
            if (mine[1]) { const [x, y] = inMap(at(6, 2 * side)) ? at(6, 2 * side) : at(6, 0); mine[1].x = x; mine[1].y = y; mine[1].f = 0; mine[1].away = false; }
            for (const u of mine.slice(2)) u.dead = true;
            up.f = 1; up.away = true; up.x = ix; up.y = iy;
            if (low) { const [x, y] = inMap(at(8, -2 * side)) ? at(8, -2 * side) : at(8, 0); low.x = x; low.y = y; low.f = 0; low.away = false; }
            b.losCache.fill(0);
            b.phase = "player";
            b.rev++;
            game.refresh();
            return { tile: t.loc.type, w: b.w, h: b.h, window: [wx, wy], hill: [hx, hy], up: up.id, low: low ? low.id : null, me: mine[0].id, mate: mine[1] ? mine[1].id : mine[0].id, sees: C.canSee(b, mine[0], up) };
          }
        }
        st.combat = null;
      }
      return null;
    });
    console.log("setup:", JSON.stringify(setup));
    if (!setup) throw new Error("no raid with a window over open ground");
    await page.waitForTimeout(800);
    for (let i = 0; i < 4; i++) { const ok = await page.evaluate(() => { const x = document.querySelector('[data-action="gd-tip-ok"], [data-action="gd-note-ok"]'); if (x) x.click(); return !!x; }); if (!ok) break; await page.waitForTimeout(200); } // the New: notes, out of the way
    // Select the survivor on the hill (a click on them), center the view on them.
    const at = async (id) => page.evaluate(async (id) => {
      const I = await import("/src/ui/isoview.js");
      const cv = [...document.querySelectorAll("canvas")].sort((a, c) => c.width * c.height - a.width * a.height)[0];
      const r = cv.getBoundingClientRect(), q = I.iso.rects.find((x) => x.id === id);
      return q ? [r.left + (q.x0 + q.x1) / 2, r.top + (q.y0 + q.y1) / 2] : null;
    }, id);
    await page.evaluate(async (id) => { const I = await import("/src/ui/isoview.js"); const u = game.state.combat.units.find((x) => x.id === id); I.isoCenterOn(game.state.combat, u.x, u.y); game.refresh(); }, setup.me);
    await page.waitForTimeout(400);
    const me = await at(setup.me);
    if (me) { await page.mouse.click(me[0], me[1]); await page.waitForTimeout(400); }
    const shots = [["low", setup.low, "terrain-highground.png"], ["up", setup.up, "terrain-window.png"]];
    for (const [what, id, file] of shots) {
      if (id == null) continue;
      const p = await at(id);
      if (!p) { console.log(what, "not on screen", JSON.stringify(await page.evaluate(async () => (await import("/src/ui/isoview.js")).iso.markers))); continue; }
      await page.mouse.move(p[0], p[1]);
      await page.waitForTimeout(500);
      const f = path.join(outDir, file);
      await page.screenshot({ path: f });
      console.log(f, JSON.stringify(await page.evaluate(() => (document.getElementById("cbprev") || {}).textContent || "").then((s) => s.slice(0, 400))));
    }
    // The other way: the raider below shoots up at the hill (select nobody of theirs: the odds are the raider's own, so
    // read them from the sim and draw the card the HUD draws).
    const card = await page.evaluate(async ({ me, low }) => {
      const C = await import("/src/sim/combat.js"), H = await import("/src/ui/battlehud.js");
      const b = game.state.combat, u = b.units.find((x) => x.id === low), t = b.units.find((x) => x.id === me);
      const o = { ...C.shotOdds(b, u, t), ok: true, kind: "shot" };
      const div = document.createElement("div");
      div.id = "terrainshot-card";
      div.style.cssText = "position:fixed;left:40px;top:120px;width:360px;z-index:99999;background:#1b1f24;padding:8px;border:1px solid #556";
      div.innerHTML = `<div class="small muted">${u.name} shooting up at ${t.name} (the hit card your people see, the other way round)</div>` + H.targetCardHtml(b, u, t, o);
      document.body.appendChild(div);
      return { chance: o.chance, cover: o.cover, high: o.high };
    }, { me: setup.mate, low: setup.low });
    await page.waitForTimeout(300);
    const f3 = path.join(outDir, "terrain-uphill.png");
    await page.screenshot({ path: f3 });
    console.log(f3, JSON.stringify(card));
    console.log("page errors:", JSON.stringify(errs.slice(0, 5)));
    await browser.close();
  } finally { srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
