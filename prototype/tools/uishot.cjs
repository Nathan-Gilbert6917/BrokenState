// Screenshots of the game's screens at a desktop's, a phone's upright and a phone's sideways size, for before-and-after
// comparisons of UI work. Usage: NODE_PATH=$(npm root -g) node tools/uishot.cjs [outdir] [--only title,newrun,...] [--views desktop,portrait,landscape]
// Starts the prototype's server on a free port, opens the game in headless Chromium at each size (the phone sizes with
// a touch screen, so responsive.js draws its layouts) and saves one PNG a scene: the title, the new-run screen (as
// rolled, and with Customize on), the State Map a few hours in with its boxes open (Layers, the alerts, the minimap, a
// team out for the Orders tab), the right panel with the hub picked, the base window, a survivor's window, the Menu and the
// People tab. Prints every page error at the end.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const only = (opt("--only", "") || "").split(",").filter(Boolean);
const views = (opt("--views", "desktop,portrait,landscape") || "").split(",").filter(Boolean);
const outDir = path.resolve(args[0] || path.join(__dirname, "..", "..", "docs", "ui-shots"));
const port = 5300 + Math.floor(Math.random() * 600);

const VIEWS = {
  desktop: { viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 },
  portrait: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true },
  landscape: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true },
};

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.cjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  const errs = [];
  let browser = null;
  try {
    await new Promise((r) => setTimeout(r, 700));
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    for (const v of views) {
      const ctx = await browser.newContext(VIEWS[v]);
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errs.push(`${v}: ${String(e)}`));
      page.on("console", (m) => { if (m.type() === "error") errs.push(`${v}: ${m.text()}`); });
      const want = (s) => !only.length || only.includes(s);
      const shot = async (name) => { const out = path.join(outDir, `${v}-${name}.png`); await page.screenshot({ path: out }); console.log(out); };
      const settle = (ms = 350) => page.waitForTimeout(ms);
      const act = (action, data = {}) => page.evaluate(([a, d]) => { const b = document.createElement("button"); b.hidden = true; b.dataset.action = a; for (const [k, val] of Object.entries(d)) b.dataset[k] = val; document.body.appendChild(b); b.click(); b.remove(); }, [action, data]);

      await page.goto(`http://localhost:${port}/`);
      await page.waitForFunction(() => window.game && document.querySelector("#tt-menu .tt-item"), null, { timeout: 30000 });
      await settle(900);
      if (want("title")) await shot("title");
      await page.click('[data-action="title-new"]');
      await page.waitForFunction(() => document.querySelector('[data-action="begin"]'), null, { timeout: 30000 });
      await settle();
      if (want("newrun")) await shot("newrun");
      if (want("newrun-custom")) {
        await page.evaluate(() => { const c = document.querySelector('[data-action="nr-free"]'); if (c && !c.checked) c.click(); });
        await settle();
        await shot("newrun-custom");
        await page.evaluate(() => { const c = document.querySelector('[data-action="nr-free"]'); if (c && c.checked) c.click(); });
        await settle();
      }
      await page.click('[data-action="begin"]');
      await page.waitForFunction(() => window.game.state.started, null, { timeout: 30000 });
      // A few hours in, so alerts and the guide have something to say; a team out, for the Orders tab.
      await page.evaluate(async () => {
        const P = await import("/src/sim/parties.js"), W = await import("/src/sim/world.js"), R = await import("/src/ui/render.js");
        const st = game.state, g = st.grid, hb = W.hub(st);
        const people = W.atBase(st, hb.id).filter((s) => s.alive);
        const far = st.tiles.filter((t) => g.distance(t.id, hb.tile) === 4 && t.terrain !== "water" && !t.loc && !st.bases.some((b) => b.tile === t.id)).map((t) => t.id);
        if (people.length > 2 && far.length) P.launchExpedition(st, { memberIds: [people[0].id, people[1].id], dest: far[0], mission: "scavenge", stance: "normal", vehicle: false, supplies: { food: 2, water: 2, ammo: 0 } });
        for (let i = 0; i < 3; i++) game.tickHour(); // the team still on the road: no card or raid plan over the map
        st.cards.length = 0; // no card over the map: the screens are the subject
        if (st.guide) st.guide.seen = Object.fromEntries(Object.keys((await import("/src/ui/guide.js")).POPUP_TIPS).map((k) => [k, 0])); // no "New:" note over the windows
        game.ui.speed = 0;
        R.centerOn(st, hb.tile);
        game.refresh();
      });
      await settle(600);
      if (want("map")) await shot("map"); // as the game starts: the Layers box folded to its tab
      // Every box over the map open at once (the alerts, Watching, Layers, the minimap).
      const hubInfo = await page.evaluate(async () => { const hb = (await import("/src/sim/world.js")).hub(game.state); return { id: hb.id, name: hb.name }; });
      await act("wl-pin", { kind: "base", id: hubInfo.id, name: hubInfo.name });
      await act("panel-toggle", { p: "alerts", v: "0" });
      await act("panel-toggle", { p: "legend", v: "0" });
      await settle(600);
      if (want("map-all")) await shot("map-all");
      // The hub picked: the right panel (a phone: the Info sheet).
      await page.evaluate(async () => { const W = await import("/src/sim/world.js"); const hb = W.hub(game.state); game.ui.selected = hb.tile; game.refresh(); });
      await act("center", { tile: await page.evaluate(async () => (await import("/src/sim/world.js")).hub(game.state).tile) });
      await settle(600);
      if (want("map-hub")) await shot("map-hub");
      // The base window.
      await act("openbase", { id: await page.evaluate(async () => (await import("/src/sim/world.js")).hub(game.state).id) });
      await settle(600);
      if (want("base")) await shot("base");
      await page.keyboard.press("Escape");
      await settle();
      // A survivor's window.
      await act("survivor", { id: await page.evaluate(() => game.state.survivors.find((s) => s.alive).id) });
      await settle(600);
      if (want("survivor")) await shot("survivor");
      await page.keyboard.press("Escape");
      await settle();
      // The Menu.
      await act("set-open");
      await settle(600);
      if (want("menu")) await shot("menu");
      await page.keyboard.press("Escape");
      await settle();
      // The People tab of the left panel (a phone: the Lists drawer).
      await act("tab", { tab: "people" });
      await act("panel-toggle", { p: "left", v: "0" });
      await settle(600);
      if (want("people")) await shot("people");
      await ctx.close();
    }
  } finally {
    if (browser) await browser.close();
    srv.kill();
  }
  if (errs.length) console.log(`Page errors:\n${errs.join("\n")}`);
})().catch((e) => { console.error(e); process.exit(1); });
