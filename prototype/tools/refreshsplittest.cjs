// The panel refresh split (docs/prompts/performance.md, PERF-7): main.js redraws everything (refresh) only when the
// world or the player changed something, and on a new minute of the clock alone only what counts the minutes
// (refreshClock), as before only on a new minute (a bar of an order under way moves on between minutes, as it always
// did). This plays a game at 5x in headless Chromium and, after every frame that showed a new minute, runs a full
// refresh: if it changes any panel, that panel showed something stale after the game's own redraw. Checked with each
// left-panel tab, a moving team in the right panel, a tile selected and the Ledger window open.
// Usage: NODE_PATH=$(npm root -g) node tools/refreshsplittest.cjs [--ffwd=25] [--seconds=8]   (CHROMIUM_PATH: the browser)
//   ffwd: game-seconds of 300x play first (desktop/perf/driver.js), so there are teams out and a log; seconds: per case.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const FFWD = Number(arg("ffwd", 25)), SECONDS = Number(arg("seconds", 8));
const DRIVER = fs.readFileSync(path.join(__dirname, "..", "..", "desktop", "perf", "driver.js"), "utf8");
const port = 5300 + Math.floor(Math.random() * 600);
// Every panel main.js refresh draws (the minute itself, #tb-min, is written every frame by step and left out).
const IDS = ["left", "right", "log", "alerts", "watchlist", "modal", "legend", "banner", "tb-clock", "tb-speed", "tb-people", "tb-tools", "nb-btn", "nb-head", "nb-list", "tf-btn", "tf-head", "tf-list", "ask", "devpanel"];
// Each case's set-up runs in the page; false: it could not be set up (reported, not a failure).
const CASES = [
  ["the Bases tab", () => true],
  ["the Teams tab", () => { document.querySelector('[data-action="tab"][data-tab="teams"]').click(); return true; }],
  ["the People tab", () => { document.querySelector('[data-action="tab"][data-tab="people"]').click(); return true; }],
  ["the Groups tab", () => { document.querySelector('[data-action="tab"][data-tab="groups"]').click(); return true; }],
  ["a team in the right panel", async () => {
    const g = window.game;
    document.querySelector('[data-action="tab"][data-tab="bases"]').click();
    for (let i = 0; i < 300; i++) {
      const p = g.state.parties.find((x) => x.owner === "player" && x.phase === "moving") || g.state.parties.find((x) => x.owner === "player" && x.phase !== "waiting");
      if (p) { g.ui.expedition = p.id; g.refresh(); return true; }
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }],
  ["a tile selected", () => { const g = window.game; g.ui.expedition = null; g.ui.selected = g.state.bases[0].tile; g.refresh(); return true; }],
  ["the Ledger window", () => { window.game.ui.selected = -1; const b = document.querySelector('[data-action="ld-open"]'); if (b) b.click(); return !!b; }],
];

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.cjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  let failed = 0, passed = 0;
  try {
    await new Promise((r) => setTimeout(r, 700));
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--disable-renderer-backgrounding", "--disable-background-timer-throttling"] });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(`http://localhost:${port}/`);
    await page.waitForFunction(() => window.game, null, { timeout: 30000 });
    await page.addScriptTag({ content: DRIVER });
    await page.evaluate((o) => window.__bsPerf.run(o), { seed: 42, speed: 300, seconds: FFWD, warmup: 0, reveal: false });
    await page.evaluate(() => document.querySelector('#tb-speed button[data-action="speed"][data-speed="5"]').click());
    for (const [name, setup] of CASES) {
      const ok = await page.evaluate(`(${setup.toString()})()`);
      if (!ok) { console.log(`  -    ${name}: could not be set up (skipped)`); continue; }
      // The game's own frame runs first (its requestAnimationFrame was asked for before this one), then the check.
      const r = await page.evaluate(({ ids, secs }) => new Promise((done) => {
        const snap = () => ids.map((id) => { const el = document.getElementById(id); return el ? el.innerHTML.replace(/<span id="tb-min">\d+<\/span>/, "") : null; });
        const minute = () => { const el = document.getElementById("tb-min"); return el ? el.textContent : ""; };
        const stale = {};
        let frames = 0, checked = 0, example = null, shown = minute();
        const t0 = performance.now();
        const tick = () => {
          frames++;
          const m = minute(), fresh = m !== shown;
          shown = m;
          // A flash under the alerts ends 4 s after it came (ui/alerts.js): not checked in the frame it may end in.
          const fl = window.game.ui.flash, ending = !!fl && Math.abs(performance.now() - fl.at - 4000) < 100;
          if (!fresh || ending) {
            if (performance.now() - t0 > secs * 1000) return done({ frames, checked, stale, example, clock: document.querySelector("#tb-clock").textContent.trim().slice(0, 14) });
            return requestAnimationFrame(tick);
          }
          const a = snap(); window.game.refresh(); const b = snap(); checked++;
          a.forEach((x, i) => {
            if (x === b[i]) return;
            stale[ids[i]] = (stale[ids[i]] || 0) + 1;
            if (!example) { let k = 0; while (k < x.length && x[k] === b[i][k]) k++; example = { id: ids[i], was: x.slice(Math.max(0, k - 120), k + 60), now: b[i].slice(Math.max(0, k - 120), k + 60) }; }
          });
          if (performance.now() - t0 > secs * 1000) return done({ frames, checked, stale, example, clock: document.querySelector("#tb-clock").textContent.trim().slice(0, 14) });
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }), { ids: IDS, secs: SECONDS });
      const bad = Object.keys(r.stale).length > 0;
      if (bad) failed++; else passed++;
      console.log(`  ${bad ? "FAIL" : "ok  "} ${name}: ${r.checked} new minutes in ${r.frames} frames to ${r.clock}${bad ? `, stale after the game's refresh: ${JSON.stringify(r.stale)}` : ", nothing stale"}`);
      if (r.example) console.log(`       e.g. #${r.example.id}: ${JSON.stringify(r.example.was)} -> ${JSON.stringify(r.example.now)}`);
    }
    if (errs.length) { failed++; console.log(`  FAIL page errors: ${errs.slice(0, 3).join(" | ")}`); }
    await browser.close();
  } finally {
    srv.kill();
  }
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
