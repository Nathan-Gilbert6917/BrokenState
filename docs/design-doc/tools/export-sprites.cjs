// Exports every sprite of the Broken State prototype as PNG for the design document, plus in-game screenshots.
//
//   cd C:\Dev\BrokenState
//   desktop\node_modules\electron\dist\electron.exe docs\design-doc\tools\export-sprites.cjs [--sprites] [--shots] [--port=5191]
//
// No flag: both. Serves the repo root over http on a free port (5191 up; never 5173, which the dev server uses),
// loads docs/design-doc/tools/sprites.html (catalogue.js paints every sprite with the game's own modules) in a hidden
// window, and writes docs/design-doc/sprites/<category>/<key>.png and sprites/manifest.json. --shots drives the real
// game (prototype/index.html) through its dev tools and autopilot and saves screenshots to sprites/shot/, and copies
// the existing screenshots in docs/base-defence and docs/map-layers there too. Nothing in the game is changed; the
// browser profile is a temp folder, so the game's saved settings are not touched.
const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..", "..");
const OUT = path.resolve(__dirname, "..", "sprites");
const MANIFEST = path.join(OUT, "manifest.json");
const argv = process.argv.slice(1);
const has = (f) => argv.includes(`--${f}`);
const opt = (f, d) => { const a = argv.find((x) => x.startsWith(`--${f}=`)); return a ? a.slice(f.length + 3) : d; };
const DO_SPRITES = has("sprites") || !has("shots");
const DO_SHOTS = has("shots") || !has("sprites");

app.setPath("userData", path.join(os.tmpdir(), "broken-state-sprite-export"));
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("force-device-scale-factor", "1");

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
function serve() {
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(req.url.split("?")[0]); } catch { res.writeHead(400); return res.end(); }
    const file = path.normalize(path.join(REPO, rel));
    if (!file.startsWith(REPO)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end("Not found"); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    let port = Number(opt("port", 5191));
    const tryPort = () => {
      if (port === 5173) port++;
      server.once("error", (e) => { if (e.code === "EADDRINUSE" && port < 5260) { port++; tryPort(); } else reject(e); });
      server.listen(port, "127.0.0.1", () => resolve({ server, port }));
    };
    tryPort();
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// live: the game needs animation frames, which a hidden window does not get (and offscreen rendering fails to load
// the game here), so the window is shown, without focus or a taskbar button, off the edge of the screen.
function window_(w, h, live) {
  const win = new BrowserWindow({ width: w, height: h, show: false, useContentSize: true, paintWhenInitiallyHidden: true,
    ...(live ? { x: -6000, y: 0, focusable: false, skipTaskbar: true } : {}),
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true } });
  if (live) win.showInactive();
  win.webContents.on("console-message", (e) => { const lvl = e.level ?? ""; if (lvl === "error" || lvl === 3) console.error(`[page] ${e.message}`); });
  return win;
}
async function until(win, expr, what, ms = 60000) {
  const t0 = Date.now();
  for (;;) {
    const v = await win.webContents.executeJavaScript(expr, true).catch((e) => { throw new Error(`${what}: ${e.message}`); });
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await wait(150);
  }
}

// ---------------------------------------------------------------- sprites
async function exportSprites(port) {
  const win = window_(1200, 900, false);
  let pageError = null;
  win.webContents.on("console-message", (e) => { if (e.level === "error" || e.level === 3) pageError = e.message; });
  await win.loadURL(`http://127.0.0.1:${port}/docs/design-doc/tools/sprites.html`);
  const t0 = Date.now();
  while (!(await win.webContents.executeJavaScript("!!window.__spritesDone", true))) {
    if (pageError) throw new Error(`catalogue failed: ${pageError}`);
    if (Date.now() - t0 > 120000) throw new Error("catalogue timed out");
    await wait(200);
  }
  const list = await win.webContents.executeJavaScript("window.__sprites", true);
  const notDrawn = await win.webContents.executeJavaScript("window.__gearNotDrawn", true);
  win.destroy();
  // Fresh category folders (screenshots in shot/ are kept).
  if (fs.existsSync(OUT)) for (const d of fs.readdirSync(OUT)) {
    const p = path.join(OUT, d);
    if (d !== "shot" && fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true });
  }
  const manifest = [];
  for (const e of list) {
    const dir = path.join(OUT, e.category);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${e.key}.png`), Buffer.from(e.dataURL.split(",")[1], "base64"));
    manifest.push({ id: e.id, category: e.category, key: e.key, label: e.label, file: `sprites/${e.category}/${e.key}.png`, w: e.w, h: e.h, nativeW: e.nw, nativeH: e.nh, scale: e.scale, source: e.source });
  }
  console.log(`sprites: ${manifest.length} images; weapons not drawn on the survivor sprite: ${notDrawn.join(", ")}`);
  return manifest;
}

// ---------------------------------------------------------------- screenshots
// The real game in an offscreen window: the new-game screen, then seed 4242 run by the autopilot at the top dev speed
// for --days (default 40) days, paused, and shown through the game's own view state (camera, dev Reveal, the base,
// diplomacy, radio and trade windows, a battle started through window.game.combat).
const SHOT_W = 1600, SHOT_H = 900;
async function exportShots(port) {
  const dir = path.join(OUT, "shot");
  fs.mkdirSync(dir, { recursive: true });
  const shots = [];
  const win = window_(SHOT_W, SHOT_H, true);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const save = async (key, label, source) => {
    await wait(700);
    const img = await win.webContents.capturePage();
    const sz = img.getSize();
    fs.writeFileSync(path.join(dir, `${key}.jpg`), img.toJPEG(88));
    shots.push({ id: `shot/${key}`, category: "shot", key, label, file: `sprites/shot/${key}.jpg`, w: sz.width, h: sz.height, source });
    console.log(`shot: ${key} ${sz.width}x${sz.height}`);
  };
  // Camera and view (ui/render.js) from the page: the same module instance the game uses.
  const camera = (tileExpr, zoom, reveal) => js(`(async () => {
    const R = await import("/prototype/src/ui/render.js");
    const s = window.game.state;
    R.view.devReveal = ${!!reveal}; R.camera.zoom = ${zoom}; R.centerOn(s, ${tileExpr}); R.redrawMap(true); window.game.refresh();
  })()`);
  // Map shots hide a card or window the autopilot may have left up; windows shots show it again.
  const modal = (show) => js(`(() => { const m = document.getElementById("modal"); m.style.visibility = ${show ? "''" : "'hidden'"}; })()`);
  const closeAll = () => js(`(() => { const g = window.game, u = g.ui; u.baseView = null; u.diplo = null; u.radioWith = null; u.dev = false; g.refresh(); })()`);

  await win.loadURL(`http://127.0.0.1:${port}/prototype/index.html`);
  await until(win, "!!(window.game && window.game.state && document.querySelector('[data-action=\"begin\"]'))", "the new-game screen");
  await wait(1000);
  await save("new-game", "The new-game screen: seed, map size, groups and the starting survivors", "prototype/index.html before Start");

  // Start on a fixed seed through the new-run screen's own Seed box and Start button (as desktop/perf/driver.js does).
  await js(`(() => { const el = document.querySelector('input[data-action="seed"]'); el.value = "4242"; el.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await until(win, "window.game.state.seed === 4242", "the seed");
  await js(`document.querySelector('[data-action="begin"]').click()`);
  await until(win, "window.game.ui.started", "the game to start");
  await wait(1000);
  await modal(false);
  await camera("window.game.state.bases[0].tile", 1.6, false);
  await save("day-1-hub", "Day 1: the hub and its surroundings on the State Map, fog of war around what you know", "seed 4242, day 1, zoom 1.6");
  await modal(true);

  // The autopilot plays at the top dev speed (dev panel buttons) until the target day.
  await js(`(() => { const g = window.game; g.ui.dev = true; g.refresh(); })()`);
  await until(win, "!!document.querySelector('#devpanel input[data-action=\"dev-autopilot\"]')", "the dev panel");
  await js(`(() => { if (!window.game.state.autopilot) document.querySelector('#devpanel input[data-action="dev-autopilot"]').click(); })()`);
  const fastest = await js("Math.max(...window.game.devSpeeds)");
  await js(`document.querySelector('#devpanel button[data-action="speed"][data-speed="${fastest}"]').click()`);
  const targetDay = Number(opt("days", 40));
  const t0 = Date.now();
  let st = null;
  for (;;) {
    st = await js(`(() => { const s = window.game.state; return { day: s.hour / 24, over: !!s.gameOver, combat: !!s.combat }; })()`);
    if ((st.day >= targetDay && !st.combat) || st.over || Date.now() - t0 > 300000) break;
    await wait(1000);
  }
  await js(`(async () => { const A = await import("/prototype/src/sim/autopilot.js"); const g = window.game; g.ui.speed = 0; A.setAutopilot(g.state, false); g.refresh(); })()`);
  await closeAll();
  await wait(600);
  const info = await js(`(() => { const s = window.game.state; return { day: Math.floor(s.hour / 24) + 1, bases: s.bases.length, combat: !!s.combat, over: !!s.gameOver, hive: (s.hives || []).map((h) => h.tile).find((t) => t != null) ?? null, parties: s.parties.filter((p) => p.owner === "player").length }; })()`);
  console.log("game:", JSON.stringify(info));

  await modal(false);
  await camera("window.game.state.bases[0].tile", 1.3, false);
  await save("state-map-hub", `The State Map around the hub on day ${info.day} (autopilot game, seed 4242)`, `autopilot to day ${info.day}, zoom 1.3`);
  await camera("window.game.state.bases[0].tile", 0.7, true);
  await save("state-map-revealed", `The State Map zoomed out with the fog lifted (dev Reveal): other groups' land, bases and parties, hordes and hives, day ${info.day}`, "dev Reveal map, zoom 0.7");
  if (info.hive != null) {
    await camera(String(info.hive), 2.0, true);
    await save("hive-closeup", "A hive with its growths and the red-skull ring on the State Map (dev Reveal)", "dev Reveal, camera on a hive, zoom 2");
  }
  await camera("window.game.state.bases[0].tile", 1.3, false);
  await modal(true);

  // Windows: the hub, diplomacy (world affairs, market board), the radio panel and a trade.
  await js(`(() => { const g = window.game; g.ui.baseView = { id: g.state.bases[0].id, tab: "overview" }; g.refresh(); })()`);
  await save("base-view", "The hub window (overview): buildings, people, stores", "ui.baseView overview");
  await closeAll();
  for (const [tab, label] of [["affairs", "Diplomacy: world affairs (wars, pacts, how the groups feel)"], ["market", "Diplomacy: the market board"], ["jobs", "Diplomacy: jobs offered by other groups"]]) {
    await js(`(() => { const g = window.game; g.ui.diplo = { tab: "${tab}" }; g.refresh(); })()`);
    await save(`diplomacy-${tab}`, label, `ui.diplo = { tab: "${tab}" }`);
  }
  await closeAll();
  const fid = await js(`(() => { const s = window.game.state; const f = s.factions.find((x) => x.alive && x.known) || s.factions.find((x) => x.alive); return f ? f.id : null; })()`);
  if (fid != null) {
    await js(`(() => { const g = window.game; g.ui.radioWith = ${fid}; g.refresh(); })()`);
    await save("radio", "The radio panel with another group: greet, news, deals, caravans", "ui.radioWith = a group");
    await closeAll();
  }
  // A trade: one of your teams at a group's gates (sim/trade.js openTrade), a small deal on the table.
  const traded = await js(`(async () => {
    const T = await import("/prototype/src/sim/trade.js");
    const g = window.game, s = g.state;
    let p = s.parties.find((q) => q.owner === "player" && q.kind !== "convoy");
    if (!p) { // no team out: send two people from the hub one tile out (sim/parties.js launchExpedition)
      const W = await import("/prototype/src/sim/world.js"), P = await import("/prototype/src/sim/parties.js");
      const h = s.bases[0], ids = W.atBase(s, h.id).slice(0, 2).map((x) => x.id);
      for (const d of [1, -1, 64, -64, 2, -2, 65, 63]) {
        const t = s.tiles[h.tile + d];
        if (!t || t.terrain === "water") continue;
        const r = P.launchExpedition(s, { memberIds: ids, dest: t.id, mission: "move", stance: "normal", supplies: { food: 4, water: 4, ammo: 20 } });
        if (r && !r.error) break;
      }
      p = s.parties.find((q) => q.owner === "player" && q.kind !== "convoy");
    }
    const f = s.factions.find((x) => x.alive && x.type === "traders") || s.factions.find((x) => x.alive);
    if (!p || !f) return false;
    if (!T.openTrade(s, p, f)) return false;
    try { T.setQty(s, "mine", "ammo", 20); T.setQty(s, "theirs", "food", 10); } catch {}
    g.refresh();
    return !!document.querySelector(".tradebox");
  })()`).catch((e) => { console.error("trade:", e.message); return false; });
  if (traded) await save("trade", "The trade window: a team at another group's gates, a deal on the table", "sim/trade.js openTrade with a team in the field");
  else console.log("trade: no team in the field to open a trade with; skipped");
  await js(`(async () => { const T = await import("/prototype/src/sim/trade.js"); const s = window.game.state; if (s.trade) T.endTrade(s); window.game.refresh(); })()`).catch(() => {});
  await closeAll();

  // A battle at the hub against the dead, two rounds in (window.game.combat).
  await js(`(() => {
    const g = window.game, s = g.state, h = s.bases[0];
    if (!s.combat) g.combat.start({ tile: h.tile, baseId: h.id, enemy: { kind: "zombies", count: 8, power: 2, name: "a pack of the dead" }, ambush: null, canRetreat: true, handler: null });
  })()`);
  await until(win, "!!window.game.state.combat", "the battle");
  await modal(false);
  await wait(1200);
  for (let i = 0; i < 2; i++) {
    await js(`(() => { const g = window.game, b = g.state.combat; if (b && !b.over && b.phase === "player") { g.combat.act({ type: "end" }); if (b.phase !== "player") g.combat.enemyPhase(); } })()`).catch(() => {});
    await wait(900);
  }
  await save("battle", "A battle on the tactical map: your people (blue rings) against the dead (green rings), fog where nobody sees", "window.game.combat.start at the hub");

  win.destroy();
  return shots;
}

function copyOld() {
  const dir = path.join(OUT, "shot");
  fs.mkdirSync(dir, { recursive: true });
  const shots = [];
  const SRC = [
    ["docs/base-defence/1-wall-map-towers-fog-night.jpg", "base-defence-walls-night", "Base defence, tier 1: the wall map at night, towers and fog"],
    ["docs/base-defence/2-gate-battered-open.jpg", "base-defence-gate", "Base defence: the gate battered open"],
    ["docs/base-defence/3-yard-map-redeploy.jpg", "base-defence-yard-redeploy", "Base defence, tier 2: redeploying in the yard"],
    ["docs/base-defence/4-yard-map-units-in-buildings.jpg", "base-defence-yard-buildings", "Base defence: units inside the buildings (last stand)"],
    ["docs/map-layers/01-ruins.png", "map-ruins", "Map layer: ruins of razed bases"],
    ["docs/map-layers/02-ruin-panel.png", "map-ruin-panel", "Map layer: a ruin's panel"],
    ["docs/map-layers/03-known-area.png", "map-known-area", "Map layer: the known (searched) area"],
    ["docs/map-layers/05-coalition.png", "map-coalition", "Map layer: coalition land"],
  ];
  for (const [rel, key, label] of SRC) {
    const from = path.join(REPO, rel);
    if (!fs.existsSync(from)) continue;
    const ext = path.extname(rel);
    fs.copyFileSync(from, path.join(dir, key + ext));
    const buf = fs.readFileSync(from);
    let w = 0, h = 0;
    if (ext === ".png") { w = buf.readUInt32BE(16); h = buf.readUInt32BE(20); }
    else for (let i = 2; i < buf.length - 9;) { // JPEG: find the SOF0/SOF2 marker
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (m === 0xc0 || m === 0xc2) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break; }
      i += 2 + len;
    }
    shots.push({ id: `shot/${key}`, category: "shot", key, label, file: `sprites/shot/${key}${ext}`, w, h, source: `copied from ${rel}` });
  }
  return shots;
}

app.on("window-all-closed", () => {}); // the sprite window closes before the screenshot one opens: do not quit then
app.whenReady().then(async () => {
  let srv = null, code = 0;
  try {
    srv = await serve();
    console.log(`serving ${REPO} on http://127.0.0.1:${srv.port}/`);
    let old = [];
    try { old = JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { /* first run */ }
    let sprites = old.filter((e) => e.category !== "shot"), shots = old.filter((e) => e.category === "shot");
    if (DO_SPRITES) sprites = await exportSprites(srv.port);
    if (DO_SHOTS) {
      fs.rmSync(path.join(OUT, "shot"), { recursive: true, force: true });
      shots = [...await exportShots(srv.port).catch((e) => { console.error("screenshots failed:", e.message); code = 1; return []; }), ...copyOld()];
    }
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(MANIFEST, JSON.stringify([...sprites, ...shots], null, 1));
    const byCat = {};
    for (const e of [...sprites, ...shots]) byCat[e.category] = (byCat[e.category] || 0) + 1;
    console.log("per category:", JSON.stringify(byCat));
  } catch (e) {
    console.error("export failed:", e && e.stack ? e.stack : e);
    code = 1;
  } finally {
    if (srv) srv.server.close();
    app.exit(code);
  }
});
