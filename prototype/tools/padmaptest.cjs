// The whole game by pad (the user's request 2026-10-23: "Extend the controller navigation for the map view. I want the
// whole game to be playable via controller so make other UI and maps like the POI one work with controllers"), checked
// in the real game: headless Chromium with a made-up Xbox pad, as tools/padnavtest.cjs (which keeps the windows, the
// panels, the State Map's tile menu and a raid). Usage: NODE_PATH=$(npm root -g) node tools/padmaptest.cjs [--shots dir]
// By the pad alone, every press a button on the made-up pad (the setups, a team on a tile, stores, are made in the page):
//   1. the title screen's menu takes the ring; New game opens the new-run screen, its World… window and Customize in
//      reach of the ring
//   2. Pick start on map: the map's cursor (not the ring), Y turns picking on, the cursor walked to a town, A starts
//      there; B back to the setup
//   3. the State Map's orders: X on a tile, the hub's mission in its menu, A opens the plan, Y sends the team; the team
//      picked, X on another tile, Move team here: the team on its way there
//   4. the Ledger's chart: A puts the pointer in it, ◀ moves it and the day read out changes, B gives the ring back
//   5. the POI map: the ring on a place drawn on the map (SVG), its route lit and its hover text, A picks it, the walk's
//      button, A: the walk (the tile view)
//   6. the camp-site picker: the cursor's 5 × 5 on the ground, its hover line in the panel, A picks the spot, Y sets up
//      camp there
//   7. the base build map: ⧉ the panel, A on a building in the Build list hands the pad back to the cursor with its
//      ghost, Y turns it, the cursor walked to where it fits, A builds it there (queued and placed), B lets it go;
//      LB RB turn the view
// No page error anywhere. --shots: a picture of each with the cursor and the ring in sight.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const args = process.argv.slice(2);
const shotsAt = args.indexOf("--shots");
const shots = shotsAt >= 0 ? path.resolve(args[shotsAt + 1]) : null;
const port = 5900 + Math.floor(Math.random() * 600);
let pass = 0, fail = 0;
const check = (ok, what, extra = "") => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${!ok && extra ? `  (${extra})` : ""}`); return ok; };
const section = (t) => console.log(`\n${t}`);

// The made-up pad (as tools/padnavtest.cjs); __press2 holds two buttons at once (a D-pad diagonal).
const FAKE_PAD = `
(() => {
  const BTN = ["A","B","X","Y","LB","RB","LT","RT","View","Menu","LS","RS","Up","Down","Left","Right","Home"];
  const pad = { id: "Xbox Wireless Controller (STANDARD GAMEPAD)", index: 0, connected: true, mapping: "standard", timestamp: 0,
    buttons: BTN.map(() => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0], hapticActuators: [], vibrationActuator: null };
  window.__pad = pad;
  window.__padOn = false;
  navigator.getGamepads = () => (window.__padOn ? [pad, null, null, null] : [null, null, null, null]);
  document.hasFocus = () => true;
  const frames = (n) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__set = (name, on, v) => { const i = BTN.indexOf(name); pad.buttons[i] = { pressed: !!on, touched: !!on, value: on ? (v == null ? 1 : v) : 0 }; pad.timestamp = performance.now(); };
  window.__press = async (name, ms = 50) => { window.__set(name, true); await wait(ms); await frames(1); window.__set(name, false); await frames(3); };
  window.__press2 = async (a, b, ms = 50) => { window.__set(a, true); window.__set(b, true); await wait(ms); await frames(1); window.__set(a, false); window.__set(b, false); await frames(3); };
  window.__connect = () => { window.__padOn = true; window.dispatchEvent(new Event("gamepadconnected")); };
})();`;

(async () => {
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.cjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  let browser = null;
  try {
    await new Promise((r) => setTimeout(r, 700));
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(FAKE_PAD);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
    const press = async (n, ms) => { await page.evaluate(([n, ms]) => window.__press(n, ms), [n, ms || 50]); await page.waitForTimeout(60); };
    const press2 = async (a, b) => { await page.evaluate(([a, b]) => window.__press2(a, b), [a, b]); await page.waitForTimeout(60); };
    const dirPress = async (dx, dy) => { const h = dx > 0 ? "Right" : dx < 0 ? "Left" : "", v = dy > 0 ? "Down" : dy < 0 ? "Up" : ""; if (h && v) await press2(h, v); else await press(h || v); };

    // What the page says: the mode, the ring and the button under it, the cursors, the legend.
    const look = () => page.evaluate(async () => {
      const N = await import("/src/ui/padnav.js"), R = await import("/src/ui/render.js"), I = await import("/src/ui/inputmode.js"), C = await import("/src/ui/combat.js");
      const ring = document.getElementById("padring"), rr = ring && !ring.hidden ? ring.getBoundingClientRect() : null;
      const el = document.querySelector(".pad-focus");
      const legend = document.getElementById("padhints"), tip = document.getElementById("tooltip");
      const b = game.state.combat;
      return {
        mode: I.inputMode(), nav: N.navState(), cursor: R.view.cursor, cb: C.padCur.on ? { x: C.padCur.x, y: C.padCur.y } : null,
        ring: rr ? { x: Math.round(rr.left), y: Math.round(rr.top), w: Math.round(rr.width), h: Math.round(rr.height) } : null,
        el: el ? { tag: el.tagName, action: el.dataset.action || "", v: el.dataset.v || "", poi: el.dataset.poi || "", text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50), html: el.outerHTML.slice(0, 140) } : null,
        legend: legend && !legend.hidden ? legend.textContent : "",
        tip: tip && !tip.classList.contains("hidden") ? tip.textContent.slice(0, 120) : "",
        modalUp: !!document.getElementById("modal") && !document.getElementById("modal").classList.contains("hidden") && document.getElementById("modal").children.length > 0,
        ctxUp: !!document.getElementById("ctxmenu") && !document.getElementById("ctxmenu").classList.contains("hidden"),
        title: !!game.ui.title, started: !!game.ui.started, nrMap: !!game.ui.nrMap, nrPick: !!game.ui.nrPick, nrMsg: game.ui.nrMsg || "", wc: !!game.ui.wcOpen,
        combat: !!b, site: !!(b && b.site), layout: b && b.layout ? { pickType: b.layout.pickType, pick: b.layout.pick, sel: b.layout.sel, rot: b.layout.rot, msg: b.layout.msg } : null,
        cbprev: (document.getElementById("cbprev") || {}).textContent || "",
        htmlPad: document.documentElement.classList.contains("input-pad"),
      };
    });
    const ringOn = (L) => !!(L.ring && L.el && L.htmlPad);
    const targets = () => page.evaluate(async () => (await import("/src/ui/padnav.js")).navTargets());
    // The ring moved that way until test(el) holds, at most n steps.
    const walkTo = async (test, n = 40, dir = "Down") => { let L = await look(); for (let i = 0; i < n && !(L.el && test(L.el)); i++) { await press(dir); L = await look(); } return L; };
    // Up, Down, Left, Right in turn until test(el) holds (a window laid out in rows and columns).
    const seek = async (test, n = 30) => { let L = await look(); for (const d of ["Up", "Down", "Right", "Left", "Down", "Up"]) { if (L.el && test(L.el)) break; L = await walkTo(test, n, d); } return L; };
    // The ring steered to the first element in sight that sel matches: each press the way it lies (the longer way first,
    // the other when that does not move the ring), as a player would.
    const goTo = async (sel, n = 60) => {
      const tried = new Set(); // "where|which way" already pressed: never the same press from the same place twice (no going round in a loop)
      for (let i = 0; i < n; i++) {
        const d = await page.evaluate((sel) => {
          const cur = document.querySelector(".pad-focus"), all = [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length);
          if (!all.length) return { none: true };
          if (cur && all.some((e) => e === cur || e.contains(cur))) return { done: true };
          if (!cur) return { dir: "Down" };
          const a = cur.getBoundingClientRect(), mid = (r) => [(r.left + r.right) / 2, (r.top + r.bottom) / 2], [ax, ay] = mid(a);
          const t = all.map((e) => e.getBoundingClientRect()).sort((p, q) => Math.hypot(mid(p)[0] - ax, mid(p)[1] - ay) - Math.hypot(mid(q)[0] - ax, mid(q)[1] - ay))[0];
          const [bx, by] = mid(t), dx = bx - ax, dy = by - ay;
          const v = dy > a.height / 2 ? "Down" : dy < -a.height / 2 ? "Up" : "", h = dx > 2 ? "Right" : dx < -2 ? "Left" : "";
          return { first: Math.abs(dy) * 2 >= Math.abs(dx) ? v || h : h || v, second: Math.abs(dy) * 2 >= Math.abs(dx) ? h : v, key: cur.outerHTML.slice(0, 80) };
        }, sel);
        if (d.done) break;
        if (d.none) { if (process.env.GOTO_DEBUG) console.log("   goTo none", sel, JSON.stringify(await look()).slice(0, 400)); return look(); }
        const dir = [d.first, d.second, "Right", "Down", "Left", "Up"].find((x) => x && !tried.has(`${d.key}|${x}`)) || d.first;
        tried.add(`${d.key}|${dir}`);
        if (process.env.GOTO_DEBUG) console.log("   goTo", sel, dir, d.key.slice(0, 60));
        await press(dir);
      }
      return look();
    };

    // ---------- 1. the title and the new-run screen ----------
    section("The title screen, New game, the new-run screen, World…, Customize");
    await page.goto(`http://localhost:${port}/`);
    await page.waitForFunction(() => window.game && game.ui.title && document.querySelector('[data-action="title-new"]'), null, { timeout: 30000 });
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__connect());
    await page.waitForTimeout(150);
    let L = await look();
    for (let i = 0; i < 8 && !ringOn(L); i++) { await press("Down", 120); L = await look(); } // headless draws the title's town slowly: a frame over 400 ms is a gap the pad ignores (gamepad.js)
    check(L.mode === "pad" && L.nav.scope === "title" && ringOn(L), "the title's menu takes the ring", JSON.stringify({ mode: L.mode, nav: L.nav, el: L.el }));
    await shot("title");
    L = await seek((el) => el.action === "title-new", 8);
    check(L.el && L.el.action === "title-new", "the ring reaches New game", JSON.stringify(L.el));
    for (let i = 0; i < 6 && (await page.evaluate(() => game.ui.title)); i++) { await press("A", 120); await page.waitForTimeout(300); } // slow frames (above)
    await page.waitForTimeout(400);
    L = await look();
    check(!L.title && !L.started && /newrun|panels/.test(L.nav.scope) && ringOn(L), "A: the new-run screen, the ring in it", JSON.stringify({ title: L.title, nav: L.nav, el: L.el }));
    const nr = await targets();
    const has = (a) => nr.some((t) => t.action === a);
    check(has("wc-open") && has("nr-pick") && has("nr-map") && has("begin"), "World…, Pick start on map, View map and Begin are in reach of the ring", nr.map((t) => t.action).filter(Boolean).slice(0, 60).join(" "));
    check(nr.some((t) => /Customize/i.test(t.text)), "Customize is in reach of the ring", nr.filter((t) => t.tag === "LABEL").map((t) => t.text).join(" | ").slice(0, 300));
    L = await goTo('[data-action="wc-open"]');
    check(L.el && L.el.action === "wc-open", "the ring reaches World…", JSON.stringify(L.el));
    await press("A");
    L = await look();
    check(L.wc && L.modalUp && ringOn(L), "A opens the World… window with the ring in it", JSON.stringify({ wc: L.wc, el: L.el }));
    await shot("worldcfg");
    await press("B");
    L = await look();
    check(!L.wc && /newrun|panels/.test(L.nav.scope), "B closes it, back on the new-run screen", JSON.stringify({ wc: L.wc, nav: L.nav }));

    // ---------- 2. Pick start on map ----------
    section("Pick start on map: the map's cursor");
    // A town that can be a start, not the one picked now: the camera put on it before the map opens, so the cursor
    // starts near it.
    const goal = await page.evaluate(async () => {
      const SP = await import("/src/sim/startpick.js"), H = await import("/src/sim/hardcore-start.js"), R = await import("/src/ui/render.js");
      const st = game.state, here = H.playerTile(st);
      const t = st.tiles.filter((x) => x.id !== here && !SP.startWhyNot(st, x.id)).sort((a, b) => st.grid.distance(a.id, here) - st.grid.distance(b.id, here))[0];
      if (!t) return null;
      R.centerOn(st, here);
      return { id: t.id, here };
    });
    check(!!goal, "a tile that can be a start", JSON.stringify(goal));
    L = await goTo('[data-action="nr-map"]');
    await press("A");
    await page.waitForTimeout(150);
    L = await look();
    check(L.nrMap && !L.nrPick && L.nav.scope === "" && !L.ring, "View map: the ring goes, the map has the pad", JSON.stringify({ nrMap: L.nrMap, nav: L.nav, ring: L.ring }));
    await press("Right");
    L = await look();
    check(L.cursor >= 0, "the map's cursor is up", String(L.cursor));
    check(/Pick start/.test(L.legend) && /Back to setup/.test(L.legend), "the legend: Y Pick start, B Back to setup", L.legend);
    await press("Y");
    L = await look();
    check(L.nrPick && /Start here/.test(L.legend), "Y turns picking on; the legend says A Start here", JSON.stringify({ nrPick: L.nrPick, legend: L.legend }));
    // The cursor walked to the town, a tile at a time.
    const cursorTo = async (id, n = 80) => {
      for (let i = 0; i < n; i++) {
        const d = await page.evaluate(async (id) => { const R = await import("/src/ui/render.js"); const g = game.state.grid, c = R.view.cursor; if (c === id || c < 0) return { at: c }; const [ax, ay] = g.toPixel(c, 1), [bx, by] = g.toPixel(id, 1), dx = bx - ax, dy = by - ay; return { at: c, dx: Math.abs(dx) > 0.4 ? Math.sign(dx) : 0, dy: Math.abs(dy) > 0.4 ? Math.sign(dy) : 0 }; }, id);
        if (d.at === id) return true;
        if (!d.dx && !d.dy) return false;
        await dirPress(d.dx, d.dy);
      }
      return false;
    };
    check(await cursorTo(goal.id), "the cursor walked to it", String((await look()).cursor));
    L = await look();
    check(/start/i.test(L.tip), "its start line beside the cursor, as under the mouse", L.tip);
    await shot("pickstart");
    await press("A");
    await page.waitForTimeout(600);
    const startNow = await page.evaluate(async () => (await import("/src/sim/hardcore-start.js")).playerTile(game.state));
    L = await look();
    check(startNow === goal.id && L.nrMap, "A starts there (the world made again with its start on that tile)", JSON.stringify({ start: startNow, goal: goal.id, msg: L.nrMsg }));
    await press("View");
    L = await look();
    check(L.nav.mode === "panels" && ringOn(L) && L.el && /^nr-/.test(L.el.action), "⧉ the banner's buttons", JSON.stringify({ nav: L.nav, el: L.el }));
    await press("B");
    await press("B");
    L = await look();
    check(!L.nrMap && /newrun|panels/.test(L.nav.scope) && ringOn(L), "B back to the setup, the ring on it", JSON.stringify({ nrMap: L.nrMap, nav: L.nav }));
    L = await goTo('[data-action="begin"]');
    check(L.el && L.el.action === "begin", "the ring reaches Begin", JSON.stringify(L.el));
    await press("A");
    await page.waitForFunction(() => game.ui.started, null, { timeout: 30000 });
    await page.waitForTimeout(400);
    L = await look();
    check(L.started, "A begins the run");

    // ---------- 3. the State Map's orders ----------
    section("The State Map: a team sent from the hub, then moved, by the tile menu");
    const dest = await page.evaluate(async () => {
      const W = await import("/src/sim/world.js"), P = await import("/src/sim/parties.js"), R = await import("/src/ui/render.js");
      const st = game.state, h = W.hub(st);
      h.stock.food = 200; h.stock.water = 200; h.stock.ammo = 200;
      for (const c of st.cards.splice(0)) void c; // no card in the way
      game.ui.speed = 0;
      const near = st.grid.neighbors(h.tile).map((n) => st.tiles[n]).filter((t) => t.terrain !== "water" && !st.bases.some((b) => b.tile === t.id) && P.planPath(st, h.tile, t.id, false));
      const t = near[0];
      R.view.selected = h.tile; game.ui.selected = h.tile; R.centerOn(st, h.tile);
      game.refresh();
      return t ? { id: t.id, hub: h.tile, other: near[1] ? near[1].id : null } : null;
    });
    check(!!dest, "a tile beside the hub", JSON.stringify(dest));
    await press("Down"); await press("Up");
    check(await cursorTo(dest.id), "the cursor on it");
    await press("X");
    L = await look();
    check(L.ctxUp && ringOn(L), "X: its menu, the ring in it", JSON.stringify({ ctx: L.ctxUp, el: L.el }));
    L = await walkTo((el) => el.action === "plan", 20);
    check(L.el && L.el.action === "plan", `the ring on a mission from the hub (${L.el && L.el.text})`, JSON.stringify(L.el));
    await press("A");
    L = await look();
    check(L.modalUp && ringOn(L), "A opens the plan window", JSON.stringify({ modal: L.modalUp, el: L.el }));
    await shot("planner");
    const parties0 = await page.evaluate(() => game.state.parties.length);
    L = await goTo('label:has([data-action="pl-crew"])');
    check(L.el && L.el.tag === "LABEL", `the ring on a person to take (${L.el && L.el.text})`, JSON.stringify(L.el));
    await press("A");
    const crewN = await page.evaluate(() => game.ui.planner ? game.ui.planner.crew.size : -1);
    check(crewN === 1, "A takes them", String(crewN));
    await press("Y");
    await page.waitForTimeout(200);
    let parties1 = await page.evaluate(() => game.state.parties.length);
    if (parties1 === parties0) { // no one main button: the ring to Send
      L = await seek((el) => /^(plan-send|plan-go|send)/.test(el.action) || /^Send|^Launch|^Go\b/.test(el.text), 40);
      await press("A");
      await page.waitForTimeout(200);
      parties1 = await page.evaluate(() => game.state.parties.length);
    }
    if (parties1 === parties0) console.log(await page.evaluate(() => JSON.stringify({ pl: { crew: game.ui.planner && [...(game.ui.planner.crew || [])], mission: game.ui.planner && game.ui.planner.mission }, err: game.ui.plannerError, btn: (document.querySelector('[data-action="pl-launch"]') || {}).outerHTML })));
    check(parties1 === parties0 + 1, "the team is sent (Y, the plan's main button)", `${parties0} → ${parties1}; ${JSON.stringify((await look()).el)}`);
    // The team picked (its panel), X on another tile, Move team here.
    const team = await page.evaluate(() => { const p = game.state.parties[game.state.parties.length - 1]; game.ui.speed = 0; return { id: p.id, dest: p.dest }; });
    if (dest.other != null) {
      L = await look();
      if (L.modalUp) { await press("B"); }
      check(await cursorTo(dest.other), "the cursor on another tile");
      await press("X");
      L = await goTo(`#ctxmenu [data-action="ctxmove"][data-id="${team.id}"], #ctxmenu [data-action="tc-do"][data-key="move"]`);
      if (!(L.el && /Move/.test(L.el.text))) console.log(await page.evaluate(() => [...document.querySelectorAll("#ctxmenu button")].map((b) => `${b.dataset.action}:${b.textContent.trim().slice(0, 40)}`).join(" | ")));
      check(L.el && /Move/.test(L.el.text), `the ring on ${L.el && L.el.text}`, JSON.stringify(L.el));
      await shot("ctxmove");
      await press("A");
      await page.waitForTimeout(200);
      const now = await page.evaluate((id) => { const p = game.state.parties.find((x) => x.id === id); return p ? { dest: p.dest, path: (p.path || []).slice(-1)[0], orders: (p.orders || []).length } : null; }, team.id);
      check(now && (now.dest === dest.other || now.path === dest.other), "A: the team is on its way there", JSON.stringify({ now, other: dest.other }));
    }

    // ---------- 4. the Ledger's chart: the pointer ----------
    section("A chart only the mouse reads: the pointer");
    const ticked = await page.evaluate(() => { const t0 = performance.now(), st = game.state; for (let i = 0; i < 100 && performance.now() - t0 < 60000; i++) { game.tickHour(); st.cards.length = 0; st.combat = null; st.engagement = null; } game.ui.ledger = true; game.refresh(); return Math.round(performance.now() - t0); });
    console.log(`  (four days run for the Ledger's rows: ${ticked} ms)`);
    await page.waitForTimeout(400);
    const charts = await page.evaluate(() => document.querySelectorAll("#modal canvas[data-chart]").length);
    if (charts) {
      L = await goTo("#modal canvas[data-chart]");
      check(L.el && L.el.tag === "CANVAS", "the ring on a chart", JSON.stringify(L.el));
      await press("A");
      L = await look();
      check(!!L.nav.ptr && /Point/.test(L.legend), "A: the pointer in it", JSON.stringify({ ptr: L.nav.ptr, legend: L.legend }));
      const read0 = await page.evaluate(() => { const c = document.querySelector("canvas.pad-focus"); const r = c && document.querySelector(`[data-read="${c.dataset.chart}"]`); return r ? r.textContent : ""; });
      for (let i = 0; i < 8; i++) await press("Left");
      const read1 = await page.evaluate(() => { const c = document.querySelector("canvas.pad-focus"); const r = c && document.querySelector(`[data-read="${c.dataset.chart}"]`); return r ? r.textContent : ""; });
      check(read1 && read1 !== read0, "◀ moves it: the day read out changes, as under the mouse", `${read0.slice(0, 50)} → ${read1.slice(0, 50)}`);
      await shot("ledger-pointer");
      await press("B");
      L = await look();
      check(!L.nav.ptr && L.el && L.el.tag === "CANVAS", "B: the ring has it again", JSON.stringify(L.nav));
      await press("B");
    } else check(false, "a chart in the Ledger", await page.evaluate(() => { const w = document.querySelector("#modal .win, #modal .box"); return w ? w.outerHTML.slice(0, 200) : "no window"; }));
    await page.evaluate(() => { game.ui.ledger = null; game.state.cards.length = 0; game.refresh(); });

    // ---------- 5. the POI map ----------
    section("The POI map: a place picked on the map, the walk");
    const poi = await page.evaluate(async () => {
      const W = await import("/src/sim/world.js"), P = await import("/src/sim/parties.js"), O = await import("/src/sim/orders.js"), PO = await import("/src/sim/pois.js");
      const st = game.state, h = W.hub(st);
      const ok = (t) => t.terrain !== "water" && !t.loc && !st.bases.some((b) => b.tile === t.id) && PO.poisOf(t).length >= 2 && PO.knownPois(st, t).length >= 2 && P.planPath(st, h.tile, t.id, false);
      const t = st.tiles.filter(ok).sort((a, b) => st.grid.distance(a.id, h.tile) - st.grid.distance(b.id, h.tile))[0];
      if (!t) return { error: "no tile with two known places" };
      const crew = W.atBase(st, h.id).filter((s) => s.alive && !st.parties.some((p) => (p.members || []).includes(s.id))).slice(0, 2);
      const r = P.launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: t.id, mission: "move", stance: "normal", supplies: { food: 10, water: 10 } });
      if (r.error) return { error: r.error };
      const p = r.party;
      p.path = [t.id]; p.idx = 0; p.progress = 0; p.dest = t.id; p.phase = "waiting"; p.plan = null; p.orders = [];
      st.cards.length = 0;
      st.poiPickAlways = true;
      O.startOrder(st, p, { type: "mission", mission: "scavenge" });
      st.poiPickAlways = false;
      game.ui.speed = 0;
      game.refresh();
      return { tile: t.id, party: p.id, card: !!st.cards.find((c) => c.poiPick) };
    });
    check(!poi.error && poi.card, "a team on a tile with places, the POI dialogue up", JSON.stringify(poi));
    await page.waitForTimeout(300);
    L = await look();
    check(L.modalUp && ringOn(L), "the dialogue takes the ring", JSON.stringify({ modal: L.modalUp, el: L.el }));
    const svgT = (await targets()).filter((t) => t.tag === "g");
    check(svgT.some((t) => t.action === "poisel"), `the places drawn on the map are in reach of the ring (${svgT.length} on the map)`, JSON.stringify(svgT).slice(0, 200));
    L = await goTo('#modal .pm-map [data-action="poisel"]');
    check(L.el && L.el.tag === "g" && L.el.action === "poisel", `the ring on a place on the map (${L.el && L.el.text})`, JSON.stringify(L.el));
    const lit = await page.evaluate((i) => { const r = document.querySelector(`.pm-route[data-poi="${i}"]`); return r ? getComputedStyle(r).strokeOpacity : "no route"; }, L.el && L.el.poi);
    check(lit === "1" || lit === "no route", "its route is lit, as under the mouse", lit);
    await page.waitForTimeout(900);
    L = await look();
    const tipUp = await page.evaluate(() => { const t = document.getElementById("tip"); return t && !t.classList.contains("hidden") ? t.textContent.slice(0, 80) : ""; });
    check(!!tipUp, "its hover text shows once the ring rests on it", tipUp);
    await shot("poimap");
    const picked = L.el && Number(L.el.poi);
    await press("A");
    const sel = await page.evaluate(() => { const c = game.state.cards[0]; return c && c.poiPick ? c.poiPick.sel : "no card"; });
    check(sel === picked, "A picks it (as a click on it)", `${sel} / ${picked}`);
    await page.waitForFunction(() => [...document.querySelectorAll("#modal .pm-go")].some((e) => e.getClientRects().length), null, { timeout: 5000 }).catch(() => {}); // the card drawn again with its buttons after the pick
    L = await goTo("#modal .pm-go");
    if (!(L.el && L.el.action === "choice")) console.log(await page.evaluate(async () => [...document.querySelectorAll(".pad-focus")].map((e) => e.outerHTML.slice(0, 80)).join(" || ") + " NAV " + JSON.stringify((await import("/src/ui/padnav.js")).navState())));
    check(L.el && L.el.action === "choice", `the ring on its button (${L.el && L.el.text})`, JSON.stringify(L.el));
    await shot("poimap-picked");
    await press("A");
    await page.waitForTimeout(300);
    const walk = await page.evaluate((id) => { const p = game.state.parties.find((x) => x.id === id); return { task: p && p.task ? p.task.type : null, view: !!game.ui.tileView, combat: !!game.state.combat }; }, poi.party);
    check(walk.task === "poiwalk" || walk.combat, "A: the team walks there (the tile view), or goes straight in", JSON.stringify(walk));
    L = await look();
    if (walk.view) {
      check(L.modalUp && ringOn(L), "the tile view takes the ring (Run, Stop, Close)", JSON.stringify(L.el));
      await shot("tileview");
      await press("B");
    }
    if (walk.combat) await page.evaluate(() => { game.state.combat = null; game.refresh(); });
    await page.evaluate((id) => { const st = game.state, p = st.parties.find((x) => x.id === id); if (p) { p.phase = "waiting"; p.task = null; p.mission = null; } st.cards.length = 0; game.ui.tileView = null; game.refresh(); }, poi.party);

    // ---------- 6. the camp-site picker ----------
    section("The camp-site picker: the cursor's 5 × 5, A picks, Y sets up camp");
    const site = await page.evaluate(async (pid) => {
      const P = await import("/src/sim/parties.js"), S = await import("/src/sim/staging.js"), BM = await import("/src/sim/basemap.js");
      const st = game.state, p = st.parties.find((x) => x.id === pid);
      if (!p) return { error: "no team" };
      const POIS = await import("/src/sim/pois.js"), W = await import("/src/sim/world.js");
      POIS.poiKnowledge(st, P.partyTile(p), true).surveyed = W.day(st); // scouted (sim/campscout.js): an unscouted tile sets up blind, with no spot to pick
      Object.assign(p.supplies, { wood: 20, stone: 8 }); // the camp fire's wood and stone (buildings.js CAMP.fireCost, 2026-10-23)
      P.giveOrder(st, p, "camp");
      if (S.pendingSite(st) !== p) return { error: `no spot asked: ${JSON.stringify(p.task || p.phase)}` };
      const err = BM.openSiteView(st, p);
      game.refresh();
      return { error: err, site: !!(st.combat && st.combat.site), sel: st.combat && st.combat.site.sel };
    }, poi.party);
    check(!site.error && site.site, "the camp's spot view is up", JSON.stringify(site));
    await page.waitForTimeout(300);
    await press("Right");
    L = await look();
    check(!!L.cb && !L.ring && L.nav.scope === "", "the cursor is up on the map (not the ring)", JSON.stringify({ cb: L.cb, nav: L.nav }));
    check(/Pick spot/.test(L.legend) && /Set up camp/.test(L.legend) && /Turn view/.test(L.legend), "the legend: A Pick spot, Y Set up camp, LB RB Turn view", L.legend);
    // A spot that takes the camp, near the cursor: walked to, a cell at a time.
    const cellTo = async (want, n = 60) => {
      for (let i = 0; i < n; i++) {
        const d = await page.evaluate(async (w) => {
          const C = await import("/src/ui/combat.js"), V = await import("/src/ui/isoview.js");
          const c = C.padCur; if (c.x === w.x && c.y === w.y) return { done: true };
          const [ax, ay] = V.project(c.x + 0.5, c.y + 0.5, 0), [bx, by] = V.project(w.x + 0.5, w.y + 0.5, 0), dx = bx - ax, dy = by - ay, m = Math.max(Math.abs(dx), Math.abs(dy)) || 1;
          return { dx: Math.abs(dx) / m > 0.38 ? Math.sign(dx) : 0, dy: Math.abs(dy) / m > 0.38 ? Math.sign(dy) : 0 };
        }, want);
        if (d.done) return true;
        await dirPress(d.dx, d.dy);
      }
      return false;
    };
    const spot = await page.evaluate(async () => {
      const C = await import("/src/ui/combat.js"), BM = await import("/src/sim/basemap.js");
      const st = game.state, b = st.combat, c = C.padCur;
      for (let r = 3; r < 30; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const g = BM.siteGhostAt(st, b, c.x + dx, c.y + dy);
        if (g && g.ok && g.cells.length === 25) return { x: c.x + dx, y: c.y + dy, from: { x: c.x, y: c.y } };
      }
      return null;
    });
    check(!!spot, "a spot that takes the camp near the cursor", JSON.stringify(spot));
    check(await cellTo(spot), "the cursor walked to it");
    L = await look();
    check(/Here:/.test(L.cbprev), "the hover line for the 5 × 5 under the cursor (how long, what it gives)", L.cbprev.slice(0, 120));
    await shot("campsite");
    await press("A");
    const pickedAt = await page.evaluate(() => { const b = game.state.combat; const F = b.deployPlan.fort; return b.site.sel ? [b.site.sel[0] + F.ox, b.site.sel[1] + F.oy] : null; });
    check(pickedAt && pickedAt[0] === spot.x && pickedAt[1] === spot.y, "A picks the 5 × 5 there", JSON.stringify({ pickedAt, spot }));
    await press("Y");
    await page.waitForTimeout(200);
    const camped = await page.evaluate((pid) => { const p = game.state.parties.find((x) => x.id === pid); return { combat: !!game.state.combat, campAt: p && p.campAt }; }, poi.party);
    check(!camped.combat && camped.campAt, "Y sets up camp there (the view closes)", JSON.stringify(camped));

    // ---------- 7. the base build map ----------
    section("The base build map: the Build list, the ghost, rotate, build, let go");
    const bm = await page.evaluate(async () => {
      const W = await import("/src/sim/world.js");
      const st = game.state, h = W.hub(st);
      for (const k of ["scrap", "wood", "parts", "tools", "metalsheet", "cloth", "rope", "nails"]) h.stock[k] = 500;
      game.ui.baseView = null;
      document.querySelector("body").dispatchEvent(new Event("noop"));
      return { base: h.id };
    });
    await page.evaluate((id) => { const a = document.createElement("button"); a.dataset.action = "bm-open"; a.dataset.base = String(id); a.style.display = "none"; document.body.appendChild(a); a.click(); a.remove(); }, bm.base);
    await page.waitForTimeout(500);
    L = await look();
    check(!!L.layout, "the base map is open", JSON.stringify(L.layout));
    await press("Right");
    L = await look();
    check(!!L.cb && /Select/.test(L.legend) && /Build list/.test(L.legend), "the cursor up; the legend: A Select, ⧉ Build list", JSON.stringify({ cb: L.cb, legend: L.legend }));
    await press("View");
    L = await look();
    check(L.nav.cb === "cbui" && ringOn(L), "⧉ the panel, the ring in it", JSON.stringify({ nav: L.nav, el: L.el }));
    // A building in the Build list: the first pickType button on the panel (the groups fold: A opens a closed one).
    const pt = await page.evaluate(() => { const b = [...document.querySelectorAll('#combat [data-action="cb-deploy"][data-v="pickType"]:not([disabled])')].find((e) => e.offsetParent !== null); return b ? b.dataset.bt : null; });
    let L2 = L;
    if (!pt) { // the groups folded: open one with the ring
      L2 = await seek((el) => el.tag === "SUMMARY" || /Build/.test(el.text), 40);
      await press("A");
    }
    L = await seek((el) => el.action === "cb-deploy" && el.v === "pickType", 80);
    check(L.el && L.el.v === "pickType", `the ring on a building in the Build list (${L.el && L.el.text})`, JSON.stringify({ el: L.el, pt, L2: L2.el }));
    await shot("basemap-list");
    await press("A");
    L = await look();
    check(L.layout && L.layout.pickType && L.nav.cb === "" && !L.ring, `A picks it (${L.layout && L.layout.pickType}) and hands the pad back to the cursor`, JSON.stringify({ layout: L.layout, nav: L.nav }));
    check(/Build here/.test(L.legend) && /Rotate/.test(L.legend), "the legend: A Build here, Y Rotate", L.legend);
    const rot0 = L.layout && L.layout.rot;
    await press("Y");
    L = await look();
    check(L.layout && L.layout.rot === ((rot0 + 1) & 3), "Y turns it (R)", `${rot0} → ${L.layout && L.layout.rot}`);
    const fit = await page.evaluate(async () => {
      const C = await import("/src/ui/combat.js"), BM = await import("/src/sim/basemap.js");
      const st = game.state, b = st.combat, c = C.padCur;
      for (let r = 2; r < 40; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const g = BM.ghostAt(st, b, c.x + dx, c.y + dy);
        if (g && g.ok) return { x: c.x + dx, y: c.y + dy };
      }
      return null;
    });
    check(!!fit, "a place it fits near the cursor", JSON.stringify(fit));
    check(await cellTo(fit), "the cursor walked to it, the ghost with it");
    L = await look();
    await shot("basemap-ghost");
    const jobs0 = await page.evaluate((id) => game.state.bases.find((b) => b.id === id).construction.length, bm.base);
    await press("A");
    await page.waitForTimeout(200);
    L = await look();
    const jobs1 = await page.evaluate((id) => game.state.bases.find((b) => b.id === id).construction.length, bm.base);
    check(jobs1 === jobs0 + 1 && L.layout && /queued and placed|pitched|set/i.test(L.layout.msg || ""), "A builds it there (queued and placed)", JSON.stringify({ jobs0, jobs1, layout: L.layout }));
    await shot("basemap-placed");
    if (L.layout && L.layout.pickType) { await press("B"); L = await look(); }
    check(L.layout && !L.layout.pickType && !L.layout.pick, "B puts the pick back", JSON.stringify(L.layout));
    if (L.layout && L.layout.sel) { await press("B"); L = await look(); check(!L.layout.sel, "B again lets the selection go", JSON.stringify(L.layout)); }
    const rv0 = await page.evaluate(async () => (await import("/src/ui/isoview.js")).iso.rot);
    await press("RB");
    const rv1 = await page.evaluate(async () => (await import("/src/ui/isoview.js")).iso.rot);
    check(rv1 !== rv0, "RB turns the view", `${rv0} → ${rv1}`);
    await press("LB");
    await page.evaluate(() => { game.state.combat = null; game.refresh(); });

    section("Errors");
    check(errs.length === 0, "no page errors", errs.slice(0, 3).join(" || ").slice(0, 400));
    const fe = await page.evaluate(() => [...game.frameErrors.entries()]);
    check(fe.length === 0, "no frame errors", JSON.stringify(fe).slice(0, 300));
  } finally {
    if (browser) await browser.close();
    srv.kill();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
