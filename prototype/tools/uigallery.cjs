// A captioned gallery of every screen: each panel, menu, window and map of the game, at a desktop's size and the
// main ones at a phone's, with a line saying what it is and where it lives. The user's request 2026-10-24 ("provide a
// screenshot of every panel, menu, window map etc UI with a subtitle of what/where it is").
// Usage: NODE_PATH=$(npm root -g) node tools/uigallery.cjs [outdir] [--views desktop,portrait,landscape]
// Writes <outdir>/<view>-<scene>.png and <outdir>/gallery.json ([{ file, view, title, where }]); a scene that cannot be
// set up is listed with its error instead of a file. Starts the prototype's server on a free port, as tools/uishot.cjs.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const views = (opt("--views", "desktop,portrait,landscape") || "").split(",").filter(Boolean);
const outDir = path.resolve(args[0] || path.join(__dirname, "..", "..", "docs", "ui-gallery"));
const port = 5300 + Math.floor(Math.random() * 600);
const VIEWS = {
  desktop: { viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 },
  portrait: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true },
  landscape: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true },
};
const SIDE = { desktop: "a desktop", portrait: "a phone held upright", landscape: "a phone on its side" };

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.cjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  const manifest = [], errs = [];
  let browser = null;
  try {
    await new Promise((r) => setTimeout(r, 700));
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    for (const v of views) {
      const ctx = await browser.newContext(VIEWS[v]);
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errs.push(`${v}: ${String(e)}`));
      page.on("console", (m) => { if (m.type() === "error") errs.push(`${v}: ${m.text()}`); });
      const settle = (ms = 400) => page.waitForTimeout(ms);
      const act = (action, data = {}) => page.evaluate(([a, d]) => { const b = document.createElement("button"); b.hidden = true; b.dataset.action = a; for (const [k, val] of Object.entries(d)) b.dataset[k] = val; document.body.appendChild(b); b.click(); b.remove(); }, [action, data]);
      // Esc while something is on top (a window, the tile menu, the search box): on a bare map Esc would open the Menu.
      const onTop = () => page.evaluate(async () => { const U = await import("/src/ui/ui.js"), C = await import("/src/ui/cmdpalette.js"); const ctx = document.getElementById("ctxmenu"); return U.modalKind(game.state, game.ui) || (ctx && !ctx.classList.contains("hidden") ? "ctx" : "") || (C.paletteOpen() ? "palette" : "") || (game.ui.ask ? "ask" : ""); });
      const esc = async (n = 4) => { for (let i = 0; i < n; i++) { if (!(await onTop())) break; await page.keyboard.press("Escape"); await settle(250); } };
      const hub = () => page.evaluate(async () => { const hb = (await import("/src/sim/world.js")).hub(game.state); return { id: hb.id, tile: hb.tile, name: hb.name }; });
      // A scene: set it up, shoot it (the whole screen, or one element), note what and where it is.
      const scene = async (name, title, where, setup, { clip = null, wait = 450 } = {}) => {
        const file = `${v}-${name}.png`;
        try {
          if (setup) await setup();
          await settle(wait);
          await page.evaluate(() => { for (const id of ["tip", "tooltip"]) { const t = document.getElementById(id); if (t) t.classList.add("hidden"); } }); // no hover text from where the mouse rests
          const out = path.join(outDir, file);
          if (clip) {
            const el = await page.$(clip);
            const box = el ? await el.boundingBox() : null;
            if (!box || !box.width || !box.height) throw new Error(`nothing to clip at ${clip}`);
            const pad = 6, vp = VIEWS[v].viewport;
            await page.screenshot({ path: out, clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(vp.width, box.width + pad * 2), height: Math.min(vp.height - Math.max(0, box.y - pad), box.height + pad * 2) } });
          } else await page.screenshot({ path: out });
          manifest.push({ file, view: v, title, where: `${where} · ${SIDE[v]}` });
          console.log(out);
        } catch (e) {
          manifest.push({ file: null, view: v, title, where, error: String(e && e.message || e).slice(0, 200) });
          console.log(`skipped ${file}: ${String(e && e.message || e).slice(0, 160)}`);
        }
      };
      const phone = v !== "desktop";

      // ---------- the title and the new run ----------
      await page.goto(`http://localhost:${port}/`);
      await page.waitForFunction(() => window.game && document.querySelector("#tt-menu .tt-item"), null, { timeout: 30000 });
      await scene("title", "Title screen", "What the game opens on: Continue, New game, Load game, Settings, How to play", null, { wait: 900 });
      await page.click('[data-action="title-new"]');
      await page.waitForFunction(() => document.querySelector('[data-action="begin"]'), null, { timeout: 30000 });
      await scene("newrun", "New run screen", "Title → New game: mode and people, the world, the crew; ▶ Start at the top right");
      await scene("newrun-custom", "New run screen with Customize on", "New run → Customize ticked: points, backgrounds, gear and traits per colonist", async () => { await page.evaluate(() => { const c = document.querySelector('[data-action="nr-free"]'); if (c && !c.checked) c.click(); }); });
      if (!phone) {
        await scene("newrun-traits", "A colonist's trait picker", "New run → Customize → a card's Traits ▸", async () => { await page.evaluate(() => { const b = document.querySelector('[data-action="nr-fold"]'); if (b) b.click(); }); });
        await scene("backgrounds", "Backgrounds… window", "New run → Customize → Backgrounds…: your own backgrounds (skills, traits, kit)", async () => act("bg-open"));
        await esc();
        await scene("gear-editor", "Gear… window", "New run → Customize → a card's Gear…: what they wear, hold and carry, placed by hand", async () => act("sg-open", { id: await page.evaluate(() => game.state.survivors[0].id) }));
        await esc();
      }
      await page.evaluate(() => { const c = document.querySelector('[data-action="nr-free"]'); if (c && c.checked) c.click(); });
      await settle();
      if (!phone) {
        await scene("worldcfg", "World… window", "New run → World…: the run's dials (weather, groups, loot, bases, raids, fuel) and presets", async () => act("wc-open"));
        await esc();
        await scene("fleet-editor", "A starting vehicle's back", "New run → Starting vehicles → Edit…: what is loaded in the vehicle's back", async () => act("fleet-edit", { i: 0 }));
        await esc();
        await scene("zombie-look", "Zombie look… window", "New run → Zombie look…: palette, gore and variants of the dead", async () => act("zlook-open"));
        await esc();
        await scene("newrun-viewmap", "The map behind the new run", "New run → 🗺 View map: the world with the Setting up banner (New start position, Pick start, Back to setup)", async () => act("nr-map"));
        await act("nr-map");
        await settle();
      }

      // ---------- the State Map ----------
      await page.click('[data-action="begin"]');
      await page.waitForFunction(() => window.game.state.started, null, { timeout: 30000 });
      await page.evaluate(async () => {
        const P = await import("/src/sim/parties.js"), W = await import("/src/sim/world.js"), R = await import("/src/ui/render.js");
        const st = game.state, g = st.grid, hb = W.hub(st);
        const people = W.atBase(st, hb.id).filter((s) => s.alive);
        const far = st.tiles.filter((t) => g.distance(t.id, hb.tile) === 4 && t.terrain !== "water" && !t.loc && !st.bases.some((b) => b.tile === t.id)).map((t) => t.id);
        if (people.length > 2 && far.length) P.launchExpedition(st, { memberIds: [people[0].id, people[1].id], dest: far[0], mission: "scavenge", stance: "normal", vehicle: false, supplies: { food: 2, water: 2, ammo: 0 } });
        for (let i = 0; i < 3; i++) game.tickHour();
        st.cards.length = 0;
        if (st.guide) st.guide.seen = Object.fromEntries(Object.keys((await import("/src/ui/guide.js")).POPUP_TIPS).map((k) => [k, 0]));
        game.ui.speed = 0;
        R.centerOn(st, hb.tile);
        game.refresh();
      });
      const H = await hub();
      await scene("map", "The State Map as a game starts", "After Start: the top bar, the left panel (Bases), the map with the paused banner, the alerts and Layers folded, the minimap, the right panel, the log", null, { wait: 700 });
      if (phone) {
        await scene("hud-alerts", "The alerts sheet", "The strip over the map → 🔔 Alerts: what needs you now, one sheet at a time", async () => page.click('.rs-hc[data-hud="alerts"]'));
        await scene("hud-layers", "The Layers sheet", "The strip over the map → 🗺 Layers: the map's layers on or off", async () => page.click('.rs-hc[data-hud="legend"]'));
        await scene("hud-minimap", "The minimap sheet", "The strip over the map → ▣ Minimap: the whole state as far as you know it", async () => page.click('.rs-hc[data-hud="minimap"]'));
        await scene("hud-guide", "The first-week guide sheet", "The strip over the map → 🧭 First week: the steps for a new holdout", async () => page.click('.rs-hc[data-hud="guide"]'));
        await page.click('.rs-hc[data-hud="guide"]'); await settle();
        await scene("more", "The ⋯ drop-down", "Top bar → ⋯: the threat forecast, the head count, Ledger, Diary, Roster, Codex, Search, Help, Next team and the camera spots", async () => page.click("#rs-morebtn"));
        await page.click("#rs-morebtn"); await settle();
        await scene("needs", "The Needs drop-down", "Top bar → Needs: every supply at the base and how long it lasts", async () => page.click(".nb-btn"));
        await page.click(".nb-btn"); await settle();
        await scene("lists-bases", "Lists drawer · Bases tab", "The dock → ☰ Lists: your hub and outposts", async () => { await act("tab", { tab: "bases" }); await act("panel-toggle", { p: "left", v: "0" }); });
        await scene("lists-people", "Lists drawer · People tab", "The dock → ☰ Lists → People: everyone, their roles and health", async () => act("tab", { tab: "people" }));
        await scene("lists-groups", "Lists drawer · Groups tab", "The dock → ☰ Lists → Groups: the other survivor groups", async () => act("tab", { tab: "groups" }));
        await scene("lists-teams", "Lists drawer · Teams tab", "The dock → ☰ Lists → Teams: teams in the field and their orders", async () => act("tab", { tab: "teams" }));
        await scene("lists-orders", "Lists drawer · Orders tab", "The dock → ☰ Lists → Orders: every team out, its current order and progress (once a box over the map)", async () => act("tab", { tab: "orders" }));
        await act("panel-toggle", { p: "left", v: "1" }); await act("tab", { tab: "bases" }); await settle();
        await scene("info-tile", "Info sheet · the hub's tile", "A tap on the hub's tile → the dock's ℹ Info: the tile, its base, Manage, Base map, Form a team", async () => { await page.evaluate((t) => { game.ui.selected = t; game.refresh(); }, H.tile); await act("center", { tile: H.tile }); });
        await scene("info-team", "Info sheet · a team's panel", "A tap on a team (or Orders → its row) → ℹ Info: its people, supplies, vehicle, orders and queue", async () => act("xp-open", { id: await page.evaluate(() => (game.state.parties.find((p) => p.owner === "player") || {}).id) }));
        await act("panel-toggle", { p: "right", v: "1" }); await settle();
        await scene("log", "The log sheet", "The dock → 📜 Log: what happened, with filters and links", async () => act("panel-toggle", { p: "log", v: "0" }));
        await act("panel-toggle", { p: "log", v: "1" }); await settle();
        await scene("ctxmenu", "The tile menu", "A long press on a tile: what a team can do there, from the dock's edge", async () => page.evaluate(() => { const c = document.getElementById("map"), r = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent("contextmenu", { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true })); }));
        await esc();
      } else {
        await scene("map-all", "Every box over the map open", "The map with the alerts, Watching, Layers and the minimap open; each moves by its header bar", async () => { await act("wl-pin", { kind: "base", id: H.id, name: H.name }); await act("panel-toggle", { p: "alerts", v: "0" }); await act("panel-toggle", { p: "legend", v: "0" }); });
        await act("panel-toggle", { p: "alerts", v: "1" }); await act("panel-toggle", { p: "legend", v: "1" }); await act("wl-collapse", { v: "1" }); await settle();
        await scene("topbar", "The top bar", "Across the top: the clock and weather, the speeds, Needs and the threat forecast, the head count, Ledger · Diary · Roster · Codex · Search · Help · Menu, the panel buttons", null, { clip: "#topbar" });
        await scene("needs", "The Needs drop-down", "Top bar → Needs: every supply at the base, how long it lasts, the base picked", async () => page.click(".nb-btn"), { clip: "#topbar .nb-panel" });
        await page.click(".nb-btn"); await settle();
        await scene("threat", "The threat forecast", "Top bar → the 7-day forecast meter: the days ahead and their causes", async () => page.click(".tf-btn"), { clip: "#topbar .tf-panel" });
        await page.click(".tf-btn"); await settle();
        await scene("left-bases", "Left panel · Bases tab", "The left panel's first tab: idle colonists, your hub and outposts (Manage, Locate, Rename)", async () => act("tab", { tab: "bases" }), { clip: "#left" });
        await scene("left-people", "Left panel · People tab", "The left panel → People: everyone, their roles, needs and traits; Find, Idle, Compact", async () => act("tab", { tab: "people" }), { clip: "#left" });
        await scene("left-groups", "Left panel · Groups tab", "The left panel → Groups: the other survivor groups, their stance and trade", async () => act("tab", { tab: "groups" }), { clip: "#left" });
        await scene("left-teams", "Left panel · Teams tab", "The left panel → Teams: each team in the field, its status, Orders, Move, Return home", async () => act("tab", { tab: "teams" }), { clip: "#left" });
        await scene("left-orders", "Left panel · Orders tab", "The left panel → Orders (Shift+[): every team out, its current order, time left and progress; a click opens its panel", async () => act("tab", { tab: "orders" }), { clip: "#left" });
        await act("tab", { tab: "bases" });
        await scene("right-idle", "Right panel with nothing picked", "The right panel before a click: how the map works", null, { clip: "#right" });
        await scene("right-tile", "Right panel · the hub's tile", "A click on the hub's tile: the tile's intel, dangers, land and places, then the base's card (Manage, Form a team, Base map) and its buildings", async () => { await page.evaluate((t) => { game.ui.selected = t; game.refresh(); }, H.tile); await act("center", { tile: H.tile }); }, { clip: "#right" });
        await scene("right-team", "Right panel · a team's panel", "A click on a team on the map, in Teams or in Orders: its people, supplies, vehicle, orders and the queue", async () => act("xp-open", { id: await page.evaluate(() => (game.state.parties.find((p) => p.owner === "player") || {}).id) }), { clip: "#right" });
        await page.evaluate(() => { game.ui.expedition = null; game.ui.selected = -1; game.refresh(); });
        await scene("log", "The log under the map", "Under the map: every line as it happens, filters by kind and base, names and places as links, Diary", null, { clip: "#log" });
        await scene("ctxmenu", "The tile's right-click menu", "A right-click on a tile: what a team can do there, with the hours", async () => page.evaluate(() => { const c = document.getElementById("map"), r = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent("contextmenu", { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true })); }));
        await esc();
        await scene("planner", "The planner window", "Right-click a tile → an action (here Scavenge / raid from the hub): who goes, the vehicle, supplies, the trip's estimate, Launch", async () => act("plan", { tile: await page.evaluate(async (ht) => { const st = game.state, g = st.grid; return st.tiles.find((t) => g.distance(t.id, ht) === 2 && t.terrain !== "water" && !st.bases.some((b) => b.tile === t.id)).id; }, H.tile), mission: "scavenge" }));
        await esc();
        await scene("palette", "Search (Ctrl+K)", "Top bar → 🔍 Search: people, bases, teams, groups, places, buildings, the menu and help", async () => act("pal-open"));
        await esc();
      }

      // ---------- windows ----------
      const baseTabs = phone ? [["overview", "Overview"]] : [["overview", "Overview"], ["food", "Food"], ["work", "Work"], ["defence", "Defence"], ["buildings", "Buildings"], ["construction", "Construction"], ["storage", "Storage"], ["armory", "Armory"], ["crafting", "Crafting"], ["vehicles", "Vehicles"], ["medical", "Medical"]];
      for (const [tab, label] of baseTabs) {
        await scene(`base-${tab}`, `Base window · ${label} tab`, `${phone ? "Info → " : "The left panel's "}Manage (or the tile's card): the base's ${label} tab`, async () => { await act("openbase", { id: H.id }); await act("basetab", { tab }); });
      }
      await esc();
      await scene("buildmap", "The base's build map", "Base window → Base map tab, or the tile's card → 🗺 Base map (U): lay out buildings, fires and defences on the base's own land", async () => act("buildmap", { baseId: H.id, tab: "none" }), { wait: 1200 });
      await page.evaluate(() => { const b = document.querySelector('[data-action="cb-deploy"][data-v="endLayout"]'); if (b) b.click(); }); // Close the map
      await settle(600);
      await page.evaluate(() => { if (game.state.combat) { game.state.combat = null; game.refresh(); } }); // whatever is left of it: the map must be back
      await esc();
      const sid = await page.evaluate(() => game.state.survivors.find((s) => s.alive && s.location.kind === "base").id);
      await scene("survivor", "Survivor window", "A name anywhere (People, the base's roster, the roster table): health and needs, work, skills, traits, gear, service record, people", async () => act("survivor", { id: sid }));
      if (!phone) {
        await scene("inventory", "Inventory window", "Survivor window → Inventory: the paper doll, pockets, pack and the armory", async () => act("inv-open", { id: sid }));
        await esc();
        await scene("skilltree", "Skills and perks", "Survivor window → the perk points button: the skill tree", async () => act("skilltree", { id: sid }));
        await esc();
      }
      await esc();
      const menuTabs = phone ? [["game", "Game"], ["options", "Options"]] : [["game", "Game"], ["options", "Options"], ["controls", "Controls"], ["help", "Help"], ["about", "About"]];
      for (const [tab, label] of menuTabs) {
        await scene(`menu-${tab}`, `Menu · ${label} tab`, `⚙ Menu (Esc on the map): ${label}`, async () => { await act("set-open"); await act("set-tab", { tab }); });
      }
      await esc();
      if (!phone) {
        // A day on the clock first, so the Ledger has a midnight's line and the Diary a day of lines (cards and a fight put aside).
        await page.evaluate(() => { const n = 24 - (game.state.hour % 24) + 1; for (let i = 0; i < n; i++) { game.tickHour(); game.state.cards.length = 0; } game.ui.tileView = null; if (game.state.combat) game.state.combat = null; game.ui.speed = 0; game.refresh(); });
        await esc();
        await scene("ledger", "Ledger window", "Top bar → 📈 Ledger (E): every resource day by day per base, the run summary", async () => act("ld-open"));
        await esc();
        await scene("diary", "Diary window", "Top bar → 📖 Diary: the run day by day with filters, search and links", async () => act("dy-open"));
        await esc();
        await scene("roster", "Roster window", "Top bar → 👥 Roster (R): everyone in one table, sortable, roles for many at once", async () => act("ro-toggle"));
        await esc();
        await scene("codex", "Codex window", "Top bar → 📚 Codex (C): the dead, items, buildings, illnesses and groups you have met", async () => act("cx-open"));
        await esc();
      }

      // ---------- what the clock brings: a card or the tile view ----------
      // The clock run on until it stops for something: a card, the tile view (which place to search) or the raid plan.
      const came = await page.evaluate(async () => { const U = await import("/src/ui/ui.js"); for (let i = 0; i < 16; i++) { game.tickHour(); game.refresh(); const k = U.modalKind(game.state, game.ui); if (k === "card" || k === "tileview" || k === "raidplan") return k; } return U.modalKind(game.state, game.ui); });
      const STOP = { card: ["An event card", "The clock stops for a card (a team's orders on arrival, a visitor, a warning): its choices with their hints"], tileview: ["The tile view", "A team arriving to scavenge a tile with places: which place to go into, the walk to it on the tile's own map"], raidplan: ["Before you go in", "A team at a site: the raid plan over the battle screen (a scout first, wait for night, the kit, which side to enter, leave)"] };
      if (STOP[came]) await scene("clock-stop", STOP[came][0], STOP[came][1], null, { wait: 700 });
      else manifest.push({ file: null, view: v, title: "An event card", where: "the clock brought none in 16 hours", error: String(came) });
      await page.evaluate(() => { game.state.cards.length = 0; game.ui.tileView = null; if (game.state.combat) game.state.combat = null; game.refresh(); });
      await esc();

      // ---------- a raid: the plan, the deploy step, the map ----------
      if (!phone || v === "portrait") {
        const raidOk = await page.evaluate(async () => {
          try {
            const P = await import("/src/sim/parties.js"), W = await import("/src/sim/world.js"), S = await import("/src/sim/scavenge.js");
            const st = game.state, hub = W.hub(st);
            let t = st.tiles.find((x) => x.id !== hub.tile && x.loc && x.loc.type === "farm" && !st.bases.some((b) => b.tile === x.id));
            if (!t) t = st.tiles.find((x) => x.id !== hub.tile && x.loc && !st.bases.some((b) => b.tile === x.id));
            if (!t) return "no site";
            hub.stock.ammo = 400; hub.stock.food = 100; hub.stock.water = 100; hub.stock.meds = 10;
            const crew = W.atBase(st, hub.id).filter((s) => s.alive).slice(0, 3);
            if (crew.length < 2) return "nobody home";
            const r = P.launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: t.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 40, meds: 2 } });
            if (!r.party) return "launch: " + JSON.stringify(r).slice(0, 100);
            const p = r.party;
            p.path = [t.id]; p.idx = 0; p.phase = "engaged";
            game.ui.speed = 0;
            const groups = S.raidEnemies(st, t.id);
            const total = groups.reduce((a, g) => a + g.count, 0);
            game.combat.start({ mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "mixed", count: total, power: 3, name: "the dead", groups }, raid: { heat0: 5, choose: true, poi: null, kind: null, place: null, building: null }, plan: true, context: {} });
            game.refresh();
            return st.combat ? "" : "no battle";
          } catch (e) { return String(e); }
        });
        if (raidOk) manifest.push({ file: null, view: v, title: "A raid", where: "could not be set up", error: raidOk });
        else {
          await scene("raid-plan", "Before you go in", "A scavenge team at a site: the raid plan over the battle screen (a scout first, wait for night, the kit, which side to enter, leave)", null, { wait: 800 });
          await page.evaluate(() => { const b = document.querySelector('[data-action="cb-plan"][data-v="enter"]'); if (b) b.click(); });
          await scene("raid-choose", "Where do you go in?", "Going in: the site's buildings, each with its own map, or the street; the kit warning's Proceed", null, { wait: 1000 });
          await page.evaluate(() => { const street = [...document.querySelectorAll("#cbcards button, #modal button")].find((b) => /The street/.test(b.textContent)); if (street) street.click(); });
          await settle(600);
          await page.evaluate(() => { const b = document.querySelector('[data-action="cb-act"][data-v="kitok"]'); if (b) b.click(); });
          await settle(400);
          await scene("raid-map", "The raid map", "The fight: the isometric map, the squad strip, the strip across the top (Heat, the floor, the view, Menu, Log), the orders bar and End turn", null, { wait: 1200 });
          await scene("raid-log", "The raid's log window", "The raid's Log button: the fight's lines in a window over the map", async () => page.evaluate(() => { const b = document.querySelector('#cbtop [data-action="cb-log"]'); if (b) b.click(); }), { wait: 600 });
        }
      }
      await ctx.close();
    }
  } finally {
    if (browser) await browser.close();
    srv.kill();
  }
  fs.writeFileSync(path.join(outDir, "gallery.json"), JSON.stringify(manifest, null, 1));
  console.log(`${manifest.filter((m) => m.file).length} shots, ${manifest.filter((m) => !m.file).length} skipped → ${path.join(outDir, "gallery.json")}`);
  if (errs.length) console.log(`Page errors:\n${errs.join("\n")}`);
})().catch((e) => { console.error(e); process.exit(1); });
