// A controller in the windows, menus and panels (src/ui/padnav.js, on src/ui/gamepad.js), checked in the real game:
// headless Chromium with a made-up Xbox pad (navigator.getGamepads is replaced; a button is pressed by setting it for
// a few frames). Usage: NODE_PATH=$(npm root -g) node tools/padnavtest.cjs [--phone] [--shots dir]
// Starts the prototype's server on a free port, begins a run and, by the pad alone: a first press makes the mode "pad"
// and puts the map cursor up; X opens the tile menu with the ring on its first button, ▼ moves it, B closes it; ⧉
// goes into the side panels (a desktop: the left one, then the right one, the top bar, the map; a phone: the drawers
// in turn), ▼ walks a panel, A on the hub's Manage opens its window, which takes the ring on its row of tabs, LB / RB
// change the tab, ▼ ▲ walk its buttons, B closes it and the ring is back on Manage, B again leaves the panels; ☰ held
// opens the menu, A on a drop-down opens the pad's own list and sets a choice, a slider steps with ◀ ▶; a raid: A on
// the plan window's side goes in, Y starts the fight from the deploy screen, X takes the orders bar with the ring on
// the order in use, ◀ ▶ move it, A gives one and comes back, ⧉ the battle panel, Y End turn asks and B keeps
// fighting, Y Y ends it; the mouse moved takes the ring away, the pad unplugged the mode. With --phone the same at a
// phone's size, plus the ⋯ menu. No page error anywhere.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const args = process.argv.slice(2);
const phone = args.includes("--phone");
const shotsAt = args.indexOf("--shots");
const shots = shotsAt >= 0 ? path.resolve(args[shotsAt + 1]) : null;
const port = 5300 + Math.floor(Math.random() * 600);
let pass = 0, fail = 0;
const check = (ok, what, extra = "") => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${!ok && extra ? `  (${extra})` : ""}`); return ok; };
const section = (t) => console.log(`\n${t}`);

// The made-up pad: 17 buttons in the standard mapping, four axes; __press(name, ms) holds a button for ms, __axis sets
// a stick. document.hasFocus is true (headless Chromium would say no: gamepad.js ignores the pad then).
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
  window.__frames = frames;
  window.__set = (name, on, v) => { const i = BTN.indexOf(name); pad.buttons[i] = { pressed: !!on, touched: !!on, value: on ? (v == null ? 1 : v) : 0 }; pad.timestamp = performance.now(); };
  window.__press = async (name, ms = 50) => { window.__set(name, true); await wait(ms); await frames(1); window.__set(name, false); await frames(3); };
  window.__axis = (i, v) => { pad.axes[i] = v; pad.timestamp = performance.now(); };
  window.__connect = () => { window.__padOn = true; window.dispatchEvent(new Event("gamepadconnected")); };
  window.__disconnect = () => { window.__padOn = false; window.dispatchEvent(new Event("gamepaddisconnected")); };
})();`;

(async () => {
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.cjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  let browser = null;
  try {
    await new Promise((r) => setTimeout(r, 700));
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true } : { viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(FAKE_PAD);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, `${phone ? "phone-" : ""}${name}.png`) }); };
    await page.goto(`http://localhost:${port}/?notitle`);
    await page.waitForFunction(() => window.game && document.querySelector('[data-action="begin"]'), null, { timeout: 30000 });
    await page.click('[data-action="begin"]');
    await page.waitForFunction(() => window.game.state.started, null, { timeout: 30000 });
    await page.mouse.move(10, 10); // the mouse used last: mouse mode
    await page.waitForTimeout(300);

    // What the page says: the mode, the nav layer, the ring and the button under it.
    const look = () => page.evaluate(async () => {
      const N = await import("/src/ui/padnav.js"), R = await import("/src/ui/render.js"), I = await import("/src/ui/inputmode.js");
      const ring = document.getElementById("padring"), rr = ring && !ring.hidden ? ring.getBoundingClientRect() : null;
      const el = document.querySelector(".pad-focus");
      const at = (id) => { const e = document.getElementById(id); return !!(e && el && e.contains(el)); };
      const legend = document.getElementById("padhints");
      const b = game.state.combat;
      return {
        mode: I.inputMode(), nav: N.navState(), cursor: R.view.cursor, ring: rr ? { x: Math.round(rr.left), y: Math.round(rr.top), w: Math.round(rr.width), h: Math.round(rr.height) } : null,
        el: el ? { tag: el.tagName, action: el.dataset.action || "", v: el.dataset.v || "", tab: el.dataset.tab || "", text: (el.textContent || "").trim().slice(0, 40), html: el.outerHTML.slice(0, 120) } : null,
        inModal: at("modal"), inCtx: at("ctxmenu"), inLeft: at("left"), inRight: at("right"), inTop: at("topbar"), inBar: at("cbbar"), inCombat: at("combat"), inMore: at("rs-more"),
        ctxUp: !!document.getElementById("ctxmenu") && !document.getElementById("ctxmenu").classList.contains("hidden"),
        modalUp: !!document.getElementById("modal") && !document.getElementById("modal").classList.contains("hidden") && document.getElementById("modal").children.length > 0,
        win: (() => { const w = document.querySelector("#modal .win"); return w ? w.dataset.win : ""; })(),
        activeTab: (() => { const t = document.querySelector("#modal [data-action][data-tab].active"); return t ? t.dataset.tab : ""; })(),
        pick: !!document.getElementById("padpick"),
        legend: legend && !legend.hidden ? legend.textContent : "",
        settings: !!game.ui.settings, combat: !!b, deploy: !!(b && b.phase === "deploy"), turn: b ? b.turn : 0, phase: b ? b.phase : "", ask: !!game.ui.ask,
        cbconfirm: !!document.querySelector("#combat .cbconfirm"), cbMode: game.combat.ui.mode || "",
        drawers: ["left", "right", "log"].filter((p) => !document.body.classList.contains(`fold-${p}`)),
        htmlPad: document.documentElement.classList.contains("input-pad"),
      };
    });
    const ringOn = (L) => !!(L.ring && L.el && L.htmlPad);
    const press = async (n, ms) => { await page.evaluate(([n, ms]) => window.__press(n, ms), [n, ms || 50]); await page.waitForTimeout(60); };
    // ▼ (or another direction) until the ring is on a button test(el) says, at most n steps.
    const walkTo = async (test, n = 40, dir = "Down") => { let L = await look(); for (let i = 0; i < n && !(L.el && test(L.el)); i++) { await press(dir); L = await look(); } return L; };

    section("No pad: nothing of it on the page");
    let L = await look();
    check(L.mode === "mouse" && !L.htmlPad, "mouse mode after the mouse moved", L.mode);
    check(!L.ring && !(await page.content()).includes('id="padring"'), "no ring element before a pad is used");

    section("A pad connected: the first press sets the mode and shows the map's cursor");
    await page.evaluate(() => window.__connect());
    await page.waitForTimeout(200);
    L = await look();
    check(L.mode === "mouse", "a connected pad with nothing pressed changes nothing", L.mode);
    await press("Right");
    L = await look();
    check(L.mode === "pad" && L.htmlPad, "a D-pad press makes the mode pad", L.mode);
    check(L.cursor >= 0, "the map cursor is up", String(L.cursor));
    check(!L.ring, "no ring on the bare map", JSON.stringify(L.ring));
    await shot("map");

    section("X: the tile menu, with the ring in it");
    await press("X");
    L = await look();
    check(L.ctxUp, "the tile menu is open");
    check(L.nav.scope === "ctx" && ringOn(L) && L.inCtx, "the ring is on a button of the menu", JSON.stringify({ scope: L.nav.scope, el: L.el, ring: L.ring }));
    const first = L.el && L.el.text;
    await press("Down");
    L = await look();
    check(L.inCtx && L.el && L.el.text !== first, "▼ moves it to the next button", JSON.stringify(L.el));
    await press("Up");
    L = await look();
    check(L.inCtx && L.el && L.el.text === first, "▲ brings it back", JSON.stringify(L.el));
    check(/Select/.test(L.legend) && /Back/.test(L.legend), "the legend says A Select, B Back", L.legend);
    await shot("ctxmenu");
    await press("B");
    L = await look();
    check(!L.ctxUp && !L.ring && L.nav.scope === "", "B closes the menu and the ring goes", JSON.stringify({ ctx: L.ctxUp, ring: L.ring, scope: L.nav.scope }));
    check(L.mode === "pad", "the mode stays pad (B's Esc is not a key press)", L.mode);

    // The hub selected: its card with Manage is in the right panel (a phone: the Info drawer).
    await page.evaluate(async () => { const W = await import("/src/sim/world.js"); const t = W.hub(game.state).tile; game.ui.selected = t; const R = await import("/src/ui/render.js"); R.centerOn(game.state, t); game.refresh(); });
    // A phone opens the Info drawer on a selection: shut it (by its dock button), so ⧉ starts from the map.
    if (phone) { await page.evaluate(() => { for (const b of document.querySelectorAll('.rs-db[data-action="panel-toggle"][aria-expanded="true"]')) b.click(); }); await page.waitForTimeout(150); }
    if (!phone) {
      section("⧉: the side panels, the top bar, the map");
      await press("View");
      L = await look();
      check(L.nav.mode === "panels" && ringOn(L) && L.inLeft, "⧉ puts the ring in the left panel", JSON.stringify({ nav: L.nav, el: L.el }));
      check(/Next panel/.test(L.legend) && /Map/.test(L.legend), "the legend offers Next panel and B Map", L.legend);
      const leftEl = L.el && L.el.html;
      await press("Down");
      L = await look();
      check(L.inLeft && L.el && L.el.html !== leftEl, "▼ moves within it", JSON.stringify(L.el));
      await press("View");
      L = await look();
      check(L.nav.mode === "panels" && L.inRight, "⧉ again: the right panel", JSON.stringify({ nav: L.nav, el: L.el }));
      await shot("panels");
      await press("View");
      L = await look();
      check(L.nav.mode === "panels" && L.inTop, "⧉ again: the top bar", JSON.stringify({ nav: L.nav, el: L.el }));
      await press("View");
      L = await look();
      check(L.nav.mode === "" && !L.ring, "⧉ again: back to the map", JSON.stringify({ nav: L.nav, ring: L.ring }));
      await press("View");
      L = await look();
      check(L.nav.mode === "panels" && ringOn(L) && (L.inLeft || L.inRight || L.inTop), "⧉ puts the ring back in the panels where it was", JSON.stringify(L.el));
      await press("B");
      L = await look();
      check(L.nav.mode === "" && !L.ring, "B leaves the panels for the map", JSON.stringify(L.nav));
      check(L.cursor >= 0, "the map's cursor is still there", String(L.cursor));
      // How the frames keep up with the panels redrawn under the ring: the game running at 3× in panels mode.
      await press("View");
      const fps = await page.evaluate(async () => { game.ui.speed = 3; const t0 = performance.now(); let n = 0; await new Promise((r) => { const f = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); }); game.ui.speed = 0; return Math.round(n / ((performance.now() - t0) / 1000)); });
      console.log(`  (frames a second at 3× with the ring in the panels: ${fps})`);
      check(fps >= 20, "the frame rate holds with the ring in the panels", String(fps));
      await press("B");
    } else {
      section("⧉ on a phone: the drawers in turn");
      await press("View");
      L = await look();
      check(L.nav.mode === "panels" && L.drawers.join() === "left" && ringOn(L) && L.inLeft, "⧉ opens Lists with the ring in it", JSON.stringify({ nav: L.nav, drawers: L.drawers, el: L.el }));
      await press("View");
      L = await look();
      check(L.drawers.join() === "right" && L.inRight, "⧉ again: Info", JSON.stringify({ drawers: L.drawers, el: L.el }));
      await press("View");
      L = await look();
      check(L.drawers.join() === "log", "⧉ again: the Log", JSON.stringify({ drawers: L.drawers, el: L.el }));
      await shot("drawers");
      await press("View");
      L = await look();
      check(L.nav.mode === "" && !L.drawers.length && !L.ring, "⧉ again: the map, every drawer shut", JSON.stringify({ nav: L.nav, drawers: L.drawers }));
      section("The ⋯ menu takes the ring");
      const more = await page.evaluate(() => { const b = document.getElementById("rs-morebtn"); if (b) b.click(); return !!b; });
      await page.waitForTimeout(100);
      L = await look();
      check(!more || (L.nav.scope === "rsmore" && L.inMore && ringOn(L)), "the ⋯ drop-down's buttons", JSON.stringify({ more, nav: L.nav, el: L.el }));
      if (more) { await press("B"); L = await look(); check(L.nav.scope === "" && !L.ring, "B closes it", JSON.stringify(L.nav)); }
    }

    section("A window: the hub's, by its Manage button in the panels");
    await press("View");
    if (!phone) await press("View"); // the right panel (a phone: the Lists drawer first, then Info)
    else await press("View");
    L = await look();
    check(L.nav.mode === "panels" && L.inRight, "the ring is in the right panel", JSON.stringify({ nav: L.nav, el: L.el }));
    // To the top of the panel (▲ while a button of the panel stands higher: one more ▲ from the top row would leave
    // the panel for the bar beside it and the top bar, from where ▼ lands past the hub's card), ◀ along the top row
    // to Manage (the hub's card's first button), then ▼ to it: the hub's card's one button with no tab (the Buildings
    // card's quick tabs open the window too).
    const higher = () => page.evaluate(() => { const el = document.querySelector(".pad-focus"); if (!el) return false; const r = el.getBoundingClientRect(); return [...document.querySelectorAll("#right button:not([disabled])")].some((b) => b.offsetParent && b.getBoundingClientRect().top < r.top - 4); });
    for (let i = 0; i < 30 && (await higher()); i++) { const before = (await look()).el; await press("Up"); const now = (await look()).el; if (!now || !before || now.html === before.html) break; }
    for (let i = 0; i < 6; i++) { const L0 = await look(); if (!L0.el || (L0.el.action === "openbase" && !L0.el.tab)) break; await press("Left"); const L1 = await look(); if (!L1.el || !L1.inRight || L1.el.html === L0.el.html) { if (!L1.inRight) await press("Right"); break; } }
    L = await walkTo((el) => el.action === "openbase" && !el.tab, 60);
    check(L.el && L.el.action === "openbase" && !L.el.tab, "▼ reaches the hub's Manage", JSON.stringify(L.el));
    await press("A");
    L = await look();
    check(L.modalUp, "A opens the base window", JSON.stringify({ modal: L.modalUp, win: L.win }));
    check(ringOn(L) && L.inModal, "the ring is in the window", JSON.stringify({ el: L.el, scope: L.nav.scope }));
    check(L.el && L.el.tab !== "" && L.el.tab === L.activeTab, "it starts on the lit tab", JSON.stringify({ el: L.el, active: L.activeTab }));
    const tab0 = L.activeTab;
    await press("RB");
    L = await look();
    check(L.activeTab && L.activeTab !== tab0 && L.el && L.el.tab === L.activeTab, "RB changes the tab and the ring follows", JSON.stringify({ was: tab0, now: L.activeTab, el: L.el }));
    await press("LB");
    L = await look();
    check(L.activeTab === tab0, "LB changes it back", L.activeTab);
    const tabEl = L.el && L.el.html;
    await press("Down");
    L = await look();
    check(L.inModal && L.el && L.el.html !== tabEl, "▼ moves below (the next row of tabs, or the window's first button)", JSON.stringify(L.el));
    L = await walkTo((el) => el.tab === "", 6);
    check(L.inModal && L.el && L.el.tab === "", "▼ reaches the window's buttons", JSON.stringify(L.el));
    const below = L.el && L.el.html;
    await press("Down");
    L = await look();
    check(L.inModal && L.el && L.el.html !== below, "▼ again moves on", JSON.stringify(L.el));
    L = await walkTo((el) => el.tab !== "", 12, "Up");
    check(L.el && L.el.tab !== "" && L.el.action === L.el.action, "▲ is back on the row of tabs", JSON.stringify(L.el));
    await shot("window");
    check(/Select/.test(L.legend) && /Back/.test(L.legend) && /Tabs/.test(L.legend), "the legend says A Select, B Back, LB RB Tabs", L.legend);
    await press("B");
    L = await look();
    check(!L.modalUp, "B closes the window", JSON.stringify({ modal: L.modalUp, settings: L.settings }));
    check(!L.settings, "the game menu did not open over it", String(L.settings));
    check(L.nav.mode === "panels" && ringOn(L) && L.el && L.el.action === "openbase", "the ring is back on Manage in the panel", JSON.stringify({ nav: L.nav, el: L.el }));
    await press("B");
    L = await look();
    check(L.nav.mode === "" && !L.ring, "B again leaves the panels", JSON.stringify(L.nav));

    section("☰ held: the game menu, its drop-downs and sliders");
    await press("Menu", 700);
    L = await look();
    check(L.settings && L.modalUp, "☰ held opens the menu", JSON.stringify({ settings: L.settings, modal: L.modalUp }));
    check(ringOn(L) && L.inModal, "the ring is in it", JSON.stringify(L.el));
    const tabs = await page.evaluate(() => [...document.querySelectorAll("#modal [data-action][data-tab]")].map((t) => t.dataset.tab));
    // A tab with a drop-down: RB round the tabs until one shows (the ring on the tabs first).
    L = await walkTo((el) => el.tab !== "", 10, "Up");
    const hasSel = () => page.evaluate(() => { const s = document.querySelector("#modal select:not([disabled])"); return s ? s.options.length : 0; });
    for (let i = 0; i < tabs.length && !(await hasSel()); i++) await press("RB");
    const nSel = await hasSel();
    if (nSel > 1) {
      L = await walkTo((el) => el.tag === "SELECT", 60);
      check(L.el && L.el.tag === "SELECT", "▼ reaches a drop-down", JSON.stringify(L.el));
      if (L.el && L.el.tag === "SELECT") {
        check(/Choose/.test(L.legend), "the legend says A Choose…", L.legend);
        const before = await page.evaluate(() => document.querySelector("#modal select.pad-focus").selectedIndex);
        await press("A");
        L = await look();
        check(L.pick && L.nav.scope === "pick" && ringOn(L), "A opens the pad's list of its choices", JSON.stringify({ pick: L.pick, scope: L.nav.scope, el: L.el }));
        await shot("pick");
        await press("B");
        L = await look();
        check(!L.pick && L.el && L.el.tag === "SELECT", "B leaves it as it was, the ring back on the drop-down", JSON.stringify({ pick: L.pick, el: L.el }));
        await press("A");
        await press(before + 1 < nSel ? "Down" : "Up");
        L = await look();
        const chosen = L.el && L.el.text;
        await press("A");
        L = await look();
        const after = await page.evaluate(() => { const s = document.querySelector("#modal select.pad-focus"); return s ? s.selectedIndex : -1; });
        check(!L.pick && after !== before && after >= 0, `A sets the choice (${chosen})`, JSON.stringify({ before, after }));
        check(L.modalUp && L.settings, "the menu is still open", JSON.stringify({ modal: L.modalUp }));
      }
    } else check(true, "no drop-down in the menu to try (skipped)");
    const hasRange = () => page.evaluate(() => !!document.querySelector('#modal input[type="range"]:not([disabled])'));
    L = await walkTo((el) => el.tab !== "", 80, "Up");
    for (let i = 0; i < tabs.length && !(await hasRange()); i++) await press("RB");
    if (await hasRange()) {
      L = await walkTo((el) => el.tag === "INPUT" && /range/.test(el.html), 80);
      check(L.el && /range/.test(L.el.html), "▼ reaches a slider", JSON.stringify(L.el));
      if (L.el && /range/.test(L.el.html)) {
        const v0 = await page.evaluate(() => { const s = document.querySelector("#modal input.pad-focus"); return { v: Number(s.value), max: Number(s.max) }; });
        await press(v0.max > v0.v ? "Right" : "Left");
        const v1 = await page.evaluate(() => { const s = document.querySelector("#modal input.pad-focus"); return s ? Number(s.value) : NaN; });
        check(v1 !== v0.v && !Number.isNaN(v1), "◀ ▶ step the slider", `${v0.v} → ${v1}`);
        L = await look();
        check(/Change/.test(L.legend), "the legend says ◀ ▶ Change", L.legend);
      }
    } else check(true, "no slider in the menu to try (skipped)");
    await press("B");
    L = await look();
    check(!L.settings && !L.modalUp, "B closes the menu", JSON.stringify({ settings: L.settings, modal: L.modalUp }));

    section("A raid: the plan window, the deploy screen, the orders bar, the battle panel, End turn's question");
    const setup = await page.evaluate(async () => {
      const P = await import("/src/sim/parties.js"), W = await import("/src/sim/world.js"), S = await import("/src/sim/scavenge.js");
      const st = game.state, hub = W.hub(st);
      const t = st.tiles.find((x) => x.id !== hub.tile && x.loc && !st.bases.some((b) => b.tile === x.id)) || st.tiles.find((x) => x.id !== hub.tile && x.terrain !== "water" && !st.bases.some((b) => b.tile === x.id));
      hub.stock.ammo = 400; hub.stock.food = 100; hub.stock.water = 100; hub.stock.meds = 10;
      const crew = W.atBase(st, hub.id).filter((s) => s.alive).slice(0, 4);
      const r = P.launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: t.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 40, meds: 2 } });
      if (!r.party) return { error: JSON.stringify(r).slice(0, 200) };
      const p = r.party;
      p.path = [t.id]; p.idx = 0; p.phase = "engaged";
      game.ui.speed = 0;
      const groups = S.raidEnemies(st, t.id);
      const total = groups.reduce((a, g) => a + g.count, 0);
      game.combat.start({ mode: "raid", tile: t.id, partyId: p.id, canRetreat: true, ambush: null, handler: "scavenge", enemy: { kind: "mixed", count: total, power: 3, name: "the dead", groups }, raid: { heat0: 5, choose: true, poi: null, kind: null, place: null, building: null }, plan: true, context: {} });
      const b = st.combat;
      return b ? { w: b.w, h: b.h, plan: !!(b.setup && b.setup.plan) } : { error: "no combat" };
    });
    check(!setup.error, "a raid starts", setup.error || "");
    await page.waitForTimeout(300);
    L = await look();
    if (L.modalUp) {
      check(ringOn(L) && L.inModal && L.el && L.el.action === "cb-plan", "the plan window takes the ring, on a side to go in from", JSON.stringify({ win: L.win, el: L.el }));
      await shot("raidplan");
      await press("A");
      await page.waitForTimeout(300);
      L = await look();
      check(!L.modalUp && L.combat, "A goes in", JSON.stringify({ modal: L.modalUp, combat: L.combat }));
    } else check(L.combat, "straight into the fight (no plan window)", JSON.stringify(L));
    L = await look();
    check(!L.ring && L.nav.scope === "", "a note with nothing to press (Before you go in) does not take the pad", JSON.stringify({ ring: L.ring, nav: L.nav, cbconfirm: L.cbconfirm }));
    if (L.deploy) {
      await press("Y");
      await page.waitForTimeout(400);
      L = await look();
      check(!L.deploy && L.combat, "Y starts the fight from the deploy screen", JSON.stringify({ deploy: L.deploy, combat: L.combat }));
    } else check(L.combat && L.phase === "player", "the fight is on, the team placed at the side picked", JSON.stringify({ phase: L.phase, turn: L.turn }));
    check(!L.ring, "no ring on the bare battle map", JSON.stringify({ ring: L.ring, nav: L.nav }));
    await press("Right");
    const barButtons = await page.evaluate(() => [...document.querySelectorAll("#cbbar button:not([disabled])")].filter((el) => el.offsetParent !== null).map((b) => ({ a: b.dataset.action, v: b.dataset.v, t: b.textContent.trim().slice(0, 16) })));
    check(barButtons.length > 1, "the orders bar has buttons", JSON.stringify(barButtons).slice(0, 200));
    await press("X");
    L = await look();
    check(L.nav.cb === "cbbar" && L.nav.scope === "cbbar" && ringOn(L) && L.inBar, "X takes the orders bar", JSON.stringify({ nav: L.nav, el: L.el }));
    check(L.el && L.el.action === "cb-act", "the ring starts on an order", JSON.stringify(L.el));
    const o0 = L.el && L.el.html;
    await press("Right");
    L = await look();
    check(L.inBar && L.el && L.el.html !== o0, "▶ moves along the bar", JSON.stringify(L.el));
    await press("Left");
    L = await look();
    check(L.inBar && L.el && L.el.html === o0, "◀ back", JSON.stringify(L.el));
    await shot("bar");
    await press("B");
    L = await look();
    check(L.nav.cb === "" && !L.ring, "B gives the pad back to the map", JSON.stringify(L.nav));
    await press("X");
    L = await walkTo((el) => el.action === "cb-act" && el.v && el.v !== (L.cbMode || ""), 8, "Right");
    const order = L.el && L.el.v;
    const lit = () => page.evaluate((v) => { const b = document.querySelector(`#cbbar [data-action="cb-act"][data-v="${v}"]`); return b ? b.className : ""; }, order);
    const lit0 = await lit();
    await press("A");
    L = await look();
    check(L.nav.cb === "" && !L.ring, `A gives the order (${order}) and comes back to the map`, JSON.stringify(L.nav));
    check(!order || L.cbMode === order || (await lit()) !== lit0, "the order is the mode now, or its button lit", `${L.cbMode} / ${order} / ${lit0} → ${await lit()}`);
    await press("B"); // drop the mode
    await press("View");
    L = await look();
    check(L.nav.cb === "cbui" && ringOn(L) && L.inCombat, "⧉ takes the battle panel", JSON.stringify({ nav: L.nav, el: L.el }));
    await shot("battlepanel");
    await press("View");
    L = await look();
    check(L.nav.cb === "" && !L.ring, "⧉ again: back to the map", JSON.stringify(L.nav));
    // Y ends the turn: it asks while anyone has actions, and the question takes the ring; B keeps fighting.
    const turn0 = L.turn;
    await press("Y");
    await page.waitForTimeout(200);
    L = await look();
    if (L.cbconfirm) {
      check(L.nav.scope === "cbask" && ringOn(L), "End turn's question takes the ring", JSON.stringify({ nav: L.nav, el: L.el }));
      await shot("endask");
      await press("B");
      L = await look();
      check(!L.cbconfirm && L.nav.scope === "" && L.combat, "B keeps fighting", JSON.stringify({ still: L.cbconfirm, nav: L.nav }));
      await press("Y"); await page.waitForTimeout(100); await press("Y");
      await page.waitForTimeout(1500);
      L = await look();
      check(L.turn > turn0 || L.phase !== "player" || !L.combat, "Y Y ends the turn", JSON.stringify({ turn0, turn: L.turn, phase: L.phase }));
    } else check(true, "End turn did not ask (nobody with actions left; skipped)");
    await page.evaluate(() => { game.ui.speed = 0; });

    section(phone ? "A finger takes it all away" : "The mouse takes it all away");
    if (phone) await page.touchscreen.tap(200, 300);
    else { await page.mouse.move(400, 400); await page.mouse.move(700, 600); }
    await page.waitForTimeout(150);
    L = await look();
    check(L.mode === (phone ? "touch" : "mouse") && !L.htmlPad && !L.ring, `${phone ? "touch" : "mouse"} mode: no ring`, JSON.stringify({ mode: L.mode, ring: L.ring }));
    const ringHidden = await page.evaluate(() => { const r = document.getElementById("padring"); return !r || r.hidden || getComputedStyle(r).display === "none"; });
    check(ringHidden, "the ring element is hidden");
    await press("Down");
    L = await look();
    check(L.mode === "pad", "a press brings the pad back", L.mode);
    await page.evaluate(() => window.__disconnect());
    await page.waitForTimeout(200);
    L = await look();
    check(L.mode !== "pad" && !L.ring, "the pad unplugged: the screen's own mode, no ring", JSON.stringify({ mode: L.mode, ring: L.ring }));

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
