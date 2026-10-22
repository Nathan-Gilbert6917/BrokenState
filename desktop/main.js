// Broken State desktop window (Electron main process).
//
// The game is plain ES modules, which Chromium refuses to load from file://. Instead of a local HTTP server
// on a random port (a new origin every launch, so localStorage would be lost) the game folder is served on a
// custom standard scheme, app://brokenstate/. The origin never changes, so settings saved by the game stay.
//
//   npm start            run from source: serves ../prototype live (Ctrl+R picks up game changes)
//   packaged build       serves the copy in resources/prototype
//   --perf               hidden performance test (perf/driver.js), prints JSON and quits
// The installed build updates itself (updater.js).
const { app, BrowserWindow, Menu, protocol, screen, session, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const updates = require("./updater");

const SCHEME = "app";
const HOST = "brokenstate";
const ORIGIN = `${SCHEME}://${HOST}`;
const BACKGROUND = "#121417"; // --bg in the game's styles.css: no white flash while loading
const TITLE = "Broken State";

const argv = process.argv.slice(1);
const flag = (name) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "1";
};
const PERF = flag("perf") || process.env.BROKENSTATE_PERF || null;

// The live game folder when run from source, the bundled copy in a packaged build.
const GAME_ROOT = app.isPackaged ? path.join(process.resourcesPath, "prototype") : path.resolve(__dirname, "..", "prototype");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json", // index.html links the web app's; served right, though nothing here reads it
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

// Must run before the app is ready. "standard" gives the scheme a real origin (relative URLs, ES modules,
// localStorage); "secure" makes it count as a secure context like https.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

app.setName(TITLE); // userData = %APPDATA%\Broken State for both the source and the packaged run
if (PERF) {
  // The test never touches the player's settings and can run while the game is open.
  app.setPath("userData", path.join(app.getPath("temp"), "broken-state-perf"));
  // The numbers must not depend on whether another window covers the test window.
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
}
// Hardware acceleration is Electron's default and is left on (the map is a 2D canvas, composited by the GPU).
// Background throttling is left at Chromium's default too: the frame loop stops while the window is minimized
// or fully covered, which for this game is a pause (the loop caps the time step, so nothing fast-forwards
// afterwards). Losing the focus alone does not throttle anything.

const PRIMARY = PERF || app.requestSingleInstanceLock();
if (!PRIMARY) app.quit(); // already running: the first instance comes to the front (second-instance below)

// ---------- serving the game ----------
async function serve(request) {
  let url;
  try { url = new URL(request.url); } catch { return new Response("Bad request", { status: 400 }); }
  if (url.host !== HOST) return new Response("Not found", { status: 404 });
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return new Response("Bad request", { status: 400 }); }
  if (rel === "/" || rel === "") rel = "/index.html";
  const file = path.normalize(path.join(GAME_ROOT, rel));
  if (file !== GAME_ROOT && !file.startsWith(GAME_ROOT + path.sep)) return new Response("Forbidden", { status: 403 });
  // build.json (the error screen's report, src/ui/crash.js): a packaged build has the stamp npm run dist wrote; run
  // from source, the commit of the checkout.
  if (rel === "/build.json" && !fs.existsSync(file)) return new Response(sourceBuild(), { status: 200, headers: { "Content-Type": TYPES[".json"], "Cache-Control": "no-store" } });
  try {
    const data = await fs.promises.readFile(file);
    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store", // Reload always shows the files as they are on disk
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

let sourceStamp = null;
function sourceBuild() {
  if (!sourceStamp) {
    try {
      const git = (...a) => require("child_process").execFileSync("git", ["-C", GAME_ROOT, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
      sourceStamp = { commit: git("rev-parse", "--short", "HEAD"), date: git("log", "-1", "--format=%cd", "--date=short"), source: true };
    } catch { sourceStamp = { source: true }; }
  }
  return JSON.stringify(sourceStamp);
}

// ---------- window size, position, fullscreen and zoom, remembered between launches ----------
// The game opens fullscreen the first time; after that it opens the way it was left (F11 toggles). fsChosen marks a
// file written since then: an older one (from before the title screen) gets the fullscreen start once too.
const stateFile = () => path.join(app.getPath("userData"), "window-state.json");
const DEFAULT_STATE = { bounds: null, maximized: true, fullscreen: true, zoom: 1 };

function loadWindowState() {
  try {
    const s = { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(stateFile(), "utf8")) };
    if (!s.fsChosen) s.fullscreen = true;
    const b = s.bounds;
    const ok = b && [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width >= 400 && b.height >= 300 &&
      // still on a connected screen (the TV may have been unplugged or the resolution changed)
      screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        return b.x < a.x + a.width - 100 && b.x + b.width > a.x + 100 && b.y >= a.y - 10 && b.y < a.y + a.height - 100;
      });
    if (!ok) s.bounds = null;
    if (!(s.zoom >= 0.25 && s.zoom <= 5)) s.zoom = 1;
    return s;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveWindowState(win) {
  if (PERF || win.isDestroyed()) return;
  try {
    const s = {
      bounds: win.getNormalBounds(), // the size to go back to when not maximized or fullscreen
      maximized: win.isMaximized(),
      fullscreen: win.isFullScreen(),
      zoom: win.webContents.getZoomFactor(),
      fsChosen: true,
    };
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2));
  } catch { /* a read-only profile must not stop the game from closing */ }
}

// ---------- menu ----------
function buildMenu() {
  const focused = () => BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const zoomBy = (d) => { const w = focused(); if (w) w.webContents.setZoomLevel(Math.max(-3, Math.min(5, w.webContents.getZoomLevel() + d))); };
  return Menu.buildFromTemplate([
    {
      label: "&Game",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => { const w = focused(); if (w) w.webContents.reloadIgnoringCache(); } },
        { type: "separator" },
        { label: "Check for Updates…", click: () => updates.checkNow() },
        { label: `Version ${app.getVersion()}`, enabled: false },
        { type: "separator" },
        { label: "Quit", accelerator: "CmdOrCtrl+Q", role: "quit" },
      ],
    },
    {
      label: "&View",
      submenu: [
        { label: "Toggle Fullscreen", accelerator: "F11", click: () => { const w = focused(); if (w) w.setFullScreen(!w.isFullScreen()); } },
        { type: "separator" },
        { label: "Zoom In", accelerator: "CmdOrCtrl+=", click: () => zoomBy(0.5) },
        { label: "Zoom In (numpad)", accelerator: "CmdOrCtrl+numadd", visible: false, acceleratorWorksWhenHidden: true, click: () => zoomBy(0.5) },
        { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: () => zoomBy(-0.5) },
        { label: "Zoom Out (numpad)", accelerator: "CmdOrCtrl+numsub", visible: false, acceleratorWorksWhenHidden: true, click: () => zoomBy(-0.5) },
        { label: "Reset Zoom", accelerator: "CmdOrCtrl+0", click: () => { const w = focused(); if (w) w.webContents.setZoomLevel(0); } },
        { type: "separator" },
        { label: "Toggle DevTools", accelerator: "CmdOrCtrl+Shift+I", click: () => { const w = focused(); if (w) w.webContents.toggleDevTools(); } },
      ],
    },
  ]);
}

// ---------- window ----------
function createWindow() {
  const st = PERF ? { ...DEFAULT_STATE, maximized: false } : loadWindowState();
  const area = screen.getPrimaryDisplay().workAreaSize; // first launch: 80% of the screen when not maximized
  const win = new BrowserWindow({
    title: TITLE,
    width: st.bounds ? st.bounds.width : Math.max(1024, Math.round(area.width * 0.8)),
    height: st.bounds ? st.bounds.height : Math.max(640, Math.round(area.height * 0.8)),
    ...(st.bounds ? { x: st.bounds.x, y: st.bounds.y } : {}),
    ...(PERF ? {} : { minWidth: 1024, minHeight: 640 }),
    show: !!PERF,
    backgroundColor: BACKGROUND,
    autoHideMenuBar: true, // the menu stays out of the way; Alt shows it, the shortcuts always work
    icon: path.join(__dirname, "icons", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: !PERF,
    },
  });

  win.on("page-title-updated", (e) => e.preventDefault()); // keep "Broken State", not the page's <title>
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" })); // the game never opens other windows
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(ORIGIN + "/")) e.preventDefault(); });
  win.webContents.on("did-finish-load", () => { if (!PERF && st.zoom !== 1) win.webContents.setZoomFactor(st.zoom); });

  // The game's own errors open its error screen (src/ui/crash.js). What the page cannot catch itself: its process
  // dying (out of memory, a GPU fault) or hanging. Each asks before reloading; the game opens on its title screen
  // again, and the last autosave (and a crash save, if one was written) are in the save list.
  if (!PERF) {
    // The GPU process dying (a driver reset, a fault) takes every kept picture with it: the game drops them and draws
    // them again when its canvases come back (src/ui/pictures.js). Noted here so a report can say it happened.
    app.on("child-process-gone", (_e, d) => { if (d && d.type === "GPU" && d.reason !== "clean-exit") console.error(`Broken State: the GPU process went (${d.reason}, code ${d.exitCode}); the game redraws its pictures when the canvas comes back.`); });
    win.webContents.on("render-process-gone", (_e, d) => {
      if (!d || d.reason === "clean-exit" || win.isDestroyed()) return;
      dialog.showMessageBox(win, { type: "error", title: TITLE, message: "The game stopped unexpectedly.", detail: `Its page closed (${d.reason}, code ${d.exitCode}). Reload opens the title screen again: your autosaves and saves are in Load game.`, buttons: ["Reload", "Quit"], defaultId: 0, cancelId: 1 })
        .then((r) => { if (win.isDestroyed()) return; if (r.response === 0) win.webContents.reload(); else app.quit(); });
    });
    let asking = null; // the question on screen; it closes by itself (as Wait) if the game comes back
    win.on("responsive", () => { if (asking) asking.abort(); });
    win.on("unresponsive", () => {
      if (asking || win.isDestroyed()) return;
      asking = new AbortController();
      dialog.showMessageBox(win, { signal: asking.signal, type: "warning", title: TITLE, message: "The game is not responding.", detail: "It may be busy (a big map at a high speed) or stuck. Wait gives it more time; Reload opens the title screen again (your autosaves are in Load game).", buttons: ["Wait", "Reload"], defaultId: 0, cancelId: 0 })
        .then((r) => { asking = null; if (r.response === 1 && !win.isDestroyed()) win.webContents.reload(); });
    });
  }

  win.once("ready-to-show", () => {
    if (PERF) return;
    if (st.maximized) win.maximize();
    win.show();
    if (st.fullscreen) win.setFullScreen(true);
  });

  let saveTimer = null;
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveWindowState(win), 500); };
  for (const ev of ["resize", "move", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) win.on(ev, saveSoon);
  win.on("close", () => { clearTimeout(saveTimer); saveWindowState(win); });

  return win;
}

// ---------- performance test (npm run perf, or "Broken State.exe" --perf) ----------
// Starts a new game on seed 42, sets the speed, Reveal map and the autopilot through the game's own buttons
// (perf/driver.js runs in the page), and measures frame times at 1920x1080 and at the maximized size.
// --perf-speed=5 (a top-bar speed 0.25-5 or a dev speed 60 / 300 / 1200), --perf-reveal=off, --perf-autopilot=on,
// --perf-dev-panel=off (perf/driver.js says what each does).
async function runPerf(win) {
  const seconds = Number(flag("perf-seconds")) || 60;
  const out = flag("perf-out");
  const driver = fs.readFileSync(path.join(__dirname, "perf", "driver.js"), "utf8");
  const display = screen.getPrimaryDisplay();
  const sf = display.scaleFactor || 1;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const memory = () => {
    const m = app.getAppMetrics();
    const mb = (kb) => Math.round(kb / 1024);
    return {
      processes: m.length,
      workingSetMB: mb(m.reduce((s, p) => s + (p.memory.workingSetSize || 0), 0)),
      privateMB: mb(m.reduce((s, p) => s + (p.memory.privateBytes || 0), 0)),
      cpuPercent: Math.round(m.reduce((s, p) => s + (p.cpu.percentCPUUsage || 0), 0) * 10) / 10,
      byType: Object.fromEntries(m.map((p) => [`${p.type}${p.name ? ":" + p.name : ""}#${p.pid}`, mb(p.memory.workingSetSize || 0)])),
    };
  };
  // 1080p: a 1920x1080 pixel window drawn at 100% (what a 1080p monitor shows). maximized: the window as the
  // player gets it on this display, at Windows display scaling. maximized-dpr1: the same pixels at 100%, so
  // the largest layout and the most map on screen (the heaviest case).
  const sizes = (flag("perf-sizes") || "1080p,maximized,maximized-dpr1").split(",");
  const onOff = (name, dflt) => { const v = flag(name); return v == null ? dflt : /^(on|1|true|yes)$/i.test(String(v)); };
  const perfRun = { seed: 42, speed: Number(flag("perf-speed")) || 5, seconds, warmup: 3, reveal: onOff("perf-reveal", false), autopilot: onOff("perf-autopilot", true), devPanel: onOff("perf-dev-panel", false) };
  const runs = [];
  for (const label of sizes) {
    win.setFullScreen(false);
    const dpr1 = label === "1080p" || label.endsWith("-dpr1");
    if (label.startsWith("maximized")) win.maximize();
    else {
      win.unmaximize();
      win.setContentSize(Math.round(1920 / sf), Math.round(1080 / sf)); // 1920x1080 physical pixels
      win.center();
    }
    await wait(500);
    win.focus();
    const loaded = new Promise((r) => win.webContents.once("did-finish-load", r));
    win.loadURL(`${ORIGIN}/index.html`);
    await loaded;
    win.webContents.setZoomFactor(dpr1 ? 1 / sf : 1);
    await wait(400); // the page gets its resize before the game starts
    app.getAppMetrics(); // resets the CPU counters: the next call reports usage over the run
    let result;
    try {
      result = await win.webContents.executeJavaScript(`${driver}\n;window.__bsPerf.run(${JSON.stringify(perfRun)})`, true);
    } catch (e) {
      result = { error: String(e && e.message ? e.message : e) };
    }
    runs.push({ label, windowContentDip: win.getContentSize(), ...result, processMemory: memory() });
  }
  const summary = {
    host: "electron",
    packaged: app.isPackaged,
    gameRoot: GAME_ROOT,
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    display: { size: display.size, scaleFactor: sf, physical: [Math.round(display.size.width * sf), Math.round(display.size.height * sf)], refreshHz: display.displayFrequency },
    gpu: app.getGPUFeatureStatus(),
    seconds,
    options: perfRun,
    runs,
  };
  const json = JSON.stringify(summary, null, 2);
  if (out) { try { fs.writeFileSync(path.resolve(out), json); } catch (e) { console.error("perf: could not write", out, e.message); } }
  process.stdout.write(json + "\n");
  app.exit(runs.every((r) => !r.error) ? 0 : 1);
}

// ---------- start ----------
app.on("second-instance", () => {
  const w = BrowserWindow.getAllWindows()[0];
  if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
});
app.on("window-all-closed", () => app.quit());

app.whenReady().then(() => {
  if (!PRIMARY) return;
  protocol.handle(SCHEME, serve);
  // No remote content: only the game's own files (plus data:, blob: and the DevTools' own pages) may load.
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    const ok = u.startsWith(ORIGIN + "/") || u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("devtools:") || u.startsWith("chrome-extension:");
    cb({ cancel: !ok });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  Menu.setApplicationMenu(buildMenu());
  const win = createWindow();
  if (PERF) {
    // Page errors (a module that fails to load, an exception) go to stderr, so a failed run says why.
    win.webContents.on("console-message", (e) => { const lvl = e.level ?? ""; if (lvl === "error" || lvl === "warning" || lvl === 3 || lvl === 2) process.stderr.write(`[page ${lvl}] ${e.message} (${e.sourceId || ""}:${e.lineNumber || ""})
`); });
    runPerf(win);
  }
  else win.loadURL(`${ORIGIN}/index.html`);
  updates.start({ perf: PERF });
});
