// Performance driver. Runs inside the game page (injected by main.js in Electron, or by perf/browser-bench.js
// in a normal browser), so both are measured by exactly the same code. It does not change the game: it types
// the seed, clicks Start and sets the speed, Reveal map and the autopilot through the game's real controls.
// Options (run({...})): seed (42), speed (5: a top-bar speed 0.25-5, or a dev fast-forward from window.game.devSpeeds,
// 60 / 300 / 1200), seconds (60), warmup (3), reveal (false: the fog of war as a player has it; true inflates the
// map's figure cache far beyond real play), autopilot (true: it answers the cards, else the clock stops on the
// first one), devPanel (false: the dev panel costs 3-6% of every refresh, which a player pays only with Show dev
// tools on).
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const q = (sel) => document.querySelector(sel);
  async function until(fn, what, ms = 10000) {
    const t0 = performance.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (performance.now() - t0 > ms) throw new Error(`perf driver: timed out waiting for ${what}`);
      await sleep(50);
    }
  }
  const click = async (sel, what) => { (await until(() => q(sel), what || sel)).click(); await frame(); };

  async function setup({ seed, speed, reveal, autopilot, devPanel }) {
    await until(() => window.game && window.game.state, "window.game (the game did not start: a script failed to load or threw; open DevTools)");
    const g = window.game;
    const devSpeeds = g.devSpeeds || [];
    const isDev = speed > 5;
    if (isDev && !devSpeeds.includes(speed)) throw new Error(`perf driver: speed ${speed} is not a top-bar speed (0.25-5) nor a dev speed (${devSpeeds.join(", ")})`);
    // New game on the wanted seed (the new-run screen's Seed box), then Start.
    if (g.ui.started) throw new Error("perf driver: a game is already running; reload first");
    if (g.ui.title) await click('[data-action="title-new"]', "the title screen's New game"); // ui/title.js
    const seedEl = await until(() => q('input[data-action="seed"]'), "the seed box");
    seedEl.value = String(seed);
    seedEl.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => g.state.seed === seed, `seed ${seed}`);
    await click('[data-action="begin"]', "the Start button");
    await until(() => g.ui.started, "the game to start");
    // Dev panel (Reveal map, the autopilot, the dev speeds): window.game.dev() opens it for this session without
    // changing the player's options; it is closed again unless devPanel asks for it.
    if (!g.ui.dev) g.dev(true);
    await until(() => g.ui.dev && q('#devpanel input[data-action="dev-reveal"]'), "the dev panel");
    if (q('#devpanel input[data-action="dev-reveal"]').checked !== !!reveal) await click('#devpanel input[data-action="dev-reveal"]');
    if (!!g.state.autopilot !== !!autopilot) await click('#devpanel input[data-action="dev-autopilot"]');
    if (isDev) await click(`#devpanel button[data-action="speed"][data-speed="${speed}"]`, `the ${speed}x button`);
    if (!devPanel) { g.dev(false); await frame(); }
    if (!isDev) await click(`#tb-speed button[data-action="speed"][data-speed="${speed}"]`, `the ${speed}x button in the top bar`);
    await until(() => g.ui.speed === speed && !!g.state.autopilot === !!autopilot, "speed and autopilot");
  }

  function stats(deltas, seconds) {
    const sorted = Float64Array.from(deltas).sort();
    const n = sorted.length;
    const sum = sorted.reduce((s, v) => s + v, 0);
    const pct = (p) => sorted[Math.min(n - 1, Math.floor(n * p))];
    const worstN = Math.max(1, Math.ceil(n * 0.01));
    let worstSum = 0;
    for (let i = n - worstN; i < n; i++) worstSum += sorted[i];
    const r = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
    return {
      frames: n,
      measuredSeconds: r(sum / 1000),
      fpsAvg: r(1000 * n / sum),
      fps1pctLow: r(1000 / (worstSum / worstN)), // frame rate over the slowest 1% of frames
      frameMsAvg: r(sum / n),
      frameMsMedian: r(pct(0.5)),
      frameMsP99: r(pct(0.99)),
      frameMsWorst: r(sorted[n - 1]),
      longFramesOver33ms: deltas.filter((d) => d > 33).length,
      framesOver20ms: deltas.filter((d) => d > 20).length,
    };
  }

  const clock = () => { const el = q("#tb-clock"); return el ? el.textContent.trim().replace(/\s+/g, " ") : ""; };
  const heap = () => (performance.memory ? { usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10, totalMB: Math.round(performance.memory.totalJSHeapSize / 1048576 * 10) / 10 } : null);

  async function run(opts) {
    const o = { seed: 42, speed: 5, seconds: 60, warmup: 3, reveal: false, autopilot: true, devPanel: false, ...opts };
    await setup(o);
    const g = window.game;
    await sleep(o.warmup * 1000);

    let longTasks = 0, longTaskMs = 0;
    let obs = null;
    try {
      obs = new PerformanceObserver((list) => { for (const e of list.getEntries()) { longTasks++; longTaskMs += e.duration; } });
      obs.observe({ entryTypes: ["longtask"] });
    } catch { /* not supported: left at 0 */ }

    const startClock = clock();
    const heapStart = heap();
    const deltas = [];
    let gameOverAt = null, hiddenFrames = 0;
    await new Promise((done) => {
      let prev = null, t0 = null;
      const tick = (now) => {
        if (prev == null) { prev = now; t0 = now; return requestAnimationFrame(tick); }
        deltas.push(now - prev);
        prev = now;
        if (document.hidden) hiddenFrames++;
        if (gameOverAt == null && g.state.gameOver) gameOverAt = Math.round((now - t0) / 100) / 10;
        if (now - t0 >= o.seconds * 1000) return done();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    if (obs) obs.disconnect();

    const canvas = q("#map");
    return {
      ...stats(deltas, o.seconds),
      longTasksOver50ms: longTasks,
      longTaskMsTotal: Math.round(longTaskMs),
      viewportCss: [innerWidth, innerHeight],
      devicePixelRatio,
      viewportPhysical: [Math.round(innerWidth * devicePixelRatio), Math.round(innerHeight * devicePixelRatio)],
      mapCanvasPixels: canvas ? [canvas.width, canvas.height] : null,
      jsHeapStart: heapStart,
      jsHeapEnd: heap(),
      game: {
        seed: g.state.seed, speed: g.ui.speed, autopilot: !!g.state.autopilot,
        reveal: !!o.reveal, devPanel: !!g.ui.dev,
        clockStart: startClock, clockEnd: clock(), gameOverAtSecond: gameOverAt,
        frameErrors: g.frameErrors ? [...g.frameErrors.keys()] : [],
      },
      hiddenFrames,
      userAgent: navigator.userAgent,
    };
  }

  window.__bsPerf = { run };
})();
