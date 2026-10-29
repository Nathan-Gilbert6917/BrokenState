// The pixel studio (board/src/studio.js, with src/formats.js and src/art.js) driven in headless Chromium at a phone's
// size (390 × 844, touch) and a desktop's (1280 × 900). Usage: NODE_PATH=$(npm root -g) node board/tools/studio-smoke.cjs [--shots dir]
// Builds the board (node board/build.js), serves board/dist on a free port and opens /#art at each size, then checks:
// no page error and no console error at any point; the studio mounted with a template and the board's palette; a stroke
// (a finger on the phone, the mouse on the desktop) changes the document's cel; a two-finger pinch changes the zoom and
// draws nothing (the desktop: the wheel zooms); add frame, switch frame, undo; a colour from the editor's hex field;
// every panel opens (the tabs on the phone, the sections on the desktop) with its controls and the sheet leaves the
// strips under it reachable; full screen fixes the studio to the viewport and Escape leaves it; api.exportBytes()
// reads back through AseFormats.decodeAseprite with the same size and frame count; a palette import by setting a
// small .gpl on the file input; the drawing and the palette survive a reload (the autosave); api.openDoc and
// newFromTemplate; "Open a new studio" puts a fresh full-screen studio over the page with the start screen, whose Create
// makes a sprite of the typed width (x) and height (y), whose import takes a PNG, and whose Close removes it with the
// page's own studio untouched (the keyboard goes only to the fresh one); the desktop's keyboard (E, B, Ctrl+Z); nothing
// overflows the viewport sideways, the strips never overlap the canvas, and the page's sections below the studio still
// render. With --shots dir, a screenshot of each
// state at both sizes, in light and dark, goes into dir. Prints ok / FAIL lines, a count, and exits 1 on any FAIL.
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path");

const args = process.argv.slice(2);
const shotsAt = args.indexOf("--shots");
const shots = shotsAt >= 0 && args[shotsAt + 1] ? path.resolve(args[shotsAt + 1]) : null;
const board = path.join(__dirname, ".."), dist = path.join(board, "dist");
let pass = 0, fail = 0;
const check = (ok, what, extra = "") => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${!ok && extra ? `  (${extra})` : ""}`); return ok; };
const section = t => console.log(`\n${t}`);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };
const GPL = "GIMP Palette\nName: smoke\nColumns: 0\n#\n255 0 0 red\n0 255 0 green\n0 0 255 blue\n";

function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/") p = "/index.html";
    const f = path.join(dist, p);
    if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, "127.0.0.1", () => r(srv)));
}
// in-page helpers: the first cel (layer 0, frame 0, where the strokes land) as a cheap hash; the sprite's centre on screen
const HASH = `(() => { const c = PixelStudio.api.getDoc().cels[0][0]; if (!c) return 0; let h = 7; for (let i = 0; i < c.data.length; i++) h = (h * 31 + c.data[i]) >>> 0; return h; })()`;
const CENTRE = `(() => { const r = document.querySelector(".pxs-cv").getBoundingClientRect(), v = PixelStudio.api.getView(), d = PixelStudio.api.getDoc(); return { x: r.left + v.panX + d.w / 2 * v.zoom, y: r.top + v.panY + d.h / 2 * v.zoom, cell: v.zoom, zoom: v.zoom, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })()`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(browser, base, phone, tmp) {
  const size = phone ? "phone" : "desktop";
  section(`${size} (${phone ? "390 × 844, touch" : "1280 × 900"})`);
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text()); });
  const cdp = phone ? await ctx.newCDPSession(page) : null;
  const shot = async name => { if (shots) await page.screenshot({ path: path.join(shots, `${size}-${name}.png`) }); };
  const touchPath = async pts => { // one finger along pts
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
    for (const [x, y] of pts.slice(1)) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const pinch = async (cx, cy, r0, r1) => { // a finger down, a second one joins, both spread
    const pts = r => [{ x: cx - r, y: cy }, { x: cx + r, y: cy }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pts(r0)[0]] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(r0) });
    for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(r0 + (r1 - r0) * i / 8) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [pts(r1)[0]] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const stroke = async (from, to) => {
    if (phone) { await touchPath([from, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], to]); return; }
    await page.mouse.move(from[0], from[1]); await page.mouse.down(); await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2); await page.mouse.move(to[0], to[1]); await page.mouse.up();
  };
  const scrollToStudio = async () => { await page.evaluate(() => { const h = document.querySelector(".pxs"), hdr = document.querySelector("header.top"); const off = /sticky|fixed/.test(getComputedStyle(hdr).position) ? hdr.offsetHeight : 0; window.scrollTo(0, window.scrollY + h.getBoundingClientRect().top - off - 4); }); await sleep(150); };
  const ready = async () => { await page.waitForSelector('.pxs[data-ready="1"]', { timeout: 20000 }); await sleep(300); await scrollToStudio(); };
  const openPanel = async k => {
    if (phone) { const tab = page.locator(`.pxs-tabs button[aria-controls="pxs-panel-${k}"]`); if ((await tab.getAttribute("aria-pressed")) !== "true") await tab.click(); }
    else { const sec = page.locator(`.pxs-panel[data-panel="${k}"]`); if ((await sec.getAttribute("class")).includes("pxs-closed")) await sec.locator(".pxs-collapse").click(); }
    await sleep(250);
  };
  const closePanel = async k => { if (phone) { const tab = page.locator(`.pxs-tabs button[aria-controls="pxs-panel-${k}"]`); if ((await tab.getAttribute("aria-pressed")) === "true") await tab.click(); await sleep(150); } };
  const view = () => page.evaluate(() => PixelStudio.api.getView());
  const docInfo = () => page.evaluate(() => { const d = PixelStudio.api.getDoc(); return { w: d.w, h: d.h, frames: d.frames.length, layers: d.layers.length, palette: d.palette.length, name: d.name }; });

  await page.goto(base + "/#art");
  await ready();
  const v0 = await view(), d0 = await docInfo();
  check(!!v0.template && d0.w > 0 && d0.h > 0, `the studio mounted with a template (${v0.template}, ${d0.w} × ${d0.h}, ${d0.palette} colours)`);
  check(v0.phone === phone, `the ${size} layout is in use`);
  await shot("studio-light");
  await page.emulateMedia({ colorScheme: "dark" }); await sleep(250); await shot("studio-dark"); await page.emulateMedia({ colorScheme: "light" }); await sleep(100);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, "nothing overflows the viewport sideways", "scrollWidth exceeds innerWidth by " + overflow);
  const rects = await page.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(); return { view: r(".pxs-view"), colours: r(".pxs-colours"), top: r(".pxs-top"), tools: r(".pxs-tools"), cam: r("#camtool") }; });
  check(rects.view.bottom <= rects.colours.top + 1 && rects.top.bottom <= rects.view.top + 1, "the strips do not overlap the canvas view");
  check(rects.cam.height > 100, "the Art school's sections below the studio still render (the 3D camera is " + Math.round(rects.cam.height) + " px tall)");

  // a stroke with a colour that is not under the pointer yet
  await page.locator(".pxs-pal .pxs-sw").nth(11).click(); await sleep(100);
  const c = await page.evaluate(CENTRE);
  const h0 = await page.evaluate(HASH);
  await stroke([c.x, c.y], [c.x + c.cell * 3, c.y + c.cell * 2]); await sleep(200);
  const h1 = await page.evaluate(HASH);
  check(h1 !== h0, "a stroke on the canvas changes the document");
  await shot("stroke");

  // zoom without drawing
  const z0 = (await view()).zoom;
  if (phone) await pinch(c.x, c.y, 30, 90); else { await page.mouse.move(c.x, c.y); await page.mouse.wheel(0, -300); }
  await sleep(250);
  const z1 = (await view()).zoom, h2 = await page.evaluate(HASH);
  check(z1 > z0, (phone ? "a two-finger pinch" : "the mouse wheel") + ` changes the zoom (${Math.round(z0 * 100)}% to ${Math.round(z1 * 100)}%)`);
  check(h2 === h1, (phone ? "the pinch" : "the wheel") + " draws nothing");
  await page.locator('.pxs-zoom [aria-label="Fit the sprite in the view"]').click(); await sleep(150);

  // frames, undo
  await page.locator('.pxs-time [aria-label="Add frame"]').click(); await sleep(200);
  let d = await docInfo(), v = await view();
  check(d.frames === 2 && v.frame === 1, "add frame makes a second frame and shows it");
  await page.locator(".pxs-frs .pxs-fr").nth(0).click(); await sleep(150);
  v = await view(); check(v.frame === 0, "tapping a frame thumbnail switches to it");
  await page.locator('.pxs-top [aria-label="Undo"]').click(); await sleep(200);
  d = await docInfo(); check(d.frames === 1, "undo takes the added frame back");
  await page.locator('.pxs-top [aria-label="Redo"]').click(); await sleep(200);
  d = await docInfo(); check(d.frames === 2, "redo brings it back");
  await shot("frames");

  // the colour editor
  await page.locator(".pxs-fgbg .pxs-sw").nth(0).click(); await sleep(250);
  const colourVisible = await page.locator('.pxs-panel[data-panel="colour"]').isVisible();
  check(colourVisible, "tapping the foreground swatch opens the colour editor");
  const hex = page.locator('.pxs-panel[data-panel="colour"] input[type="text"]');
  await hex.fill("#ff00ff"); await hex.press("Enter"); await hex.dispatchEvent("change"); await sleep(150);
  const fgNow = await page.evaluate(() => getComputedStyle(document.querySelector(".pxs-fgbg .pxs-sw i")).backgroundColor);
  check(/rgba?\(255,\s*0,\s*255/.test(fgNow), "the hex field sets the foreground colour", fgNow);
  await shot("colour");
  await page.locator('.pxs-panel[data-panel="colour"] .pxs-close').click(); await sleep(150);

  // every panel
  for (const k of ["layers", "palette", "frames", "preview", "canvas", "file"]) {
    await openPanel(k);
    const sec = page.locator(`.pxs-panel[data-panel="${k}"]`);
    const visible = await sec.isVisible(), controls = await sec.locator("button, input, select").count();
    check(visible && controls > 0, `the ${k} panel opens with its controls (${controls})`);
    if (phone) {
      const ok = await page.evaluate(() => { const p = document.querySelector(".pxs-panels").getBoundingClientRect(), s = document.querySelector(".pxs-colours").getBoundingClientRect(), r = document.querySelector(".pxs").getBoundingClientRect(); return p.bottom <= s.top + 1 && p.height <= r.height * .46 + 1; });
      check(ok, `the ${k} sheet sits above the strips and takes at most 45 % of the studio`);
    }
    await shot("panel-" + k);
    if (phone) await page.emulateMedia({ colorScheme: "dark" }); if (phone) { await sleep(150); await shot("panel-" + k + "-dark"); await page.emulateMedia({ colorScheme: "light" }); }
    await closePanel(k);
  }

  // full screen
  await page.locator('.pxs-top [aria-label="Full screen"]').click(); await sleep(400);
  const full = await page.evaluate(() => { const r = document.querySelector(".pxs").getBoundingClientRect(); return { cls: document.querySelector(".pxs").className, w: r.width, h: r.height, x: r.left, y: r.top, iw: innerWidth, ih: innerHeight, body: getComputedStyle(document.body).overflow }; });
  check(full.cls.includes("pxs-full") && Math.abs(full.w - full.iw) < 2 && Math.abs(full.h - full.ih) < 2 && full.x < 1 && full.y < 1 && full.body === "hidden", "full screen fixes the studio over the whole viewport and locks the page's scroll", JSON.stringify(full));
  await shot("full");
  await page.keyboard.press("Escape"); await sleep(300);
  check(!(await page.evaluate(() => document.querySelector(".pxs").className.includes("pxs-full"))), "Escape leaves full screen");
  await scrollToStudio();

  // export round trip
  const rt = await page.evaluate(async () => { const d = PixelStudio.api.getDoc(), b = await PixelStudio.api.exportBytes(), back = await AseFormats.decodeAseprite(b); return { bytes: b.length, w: back.w, h: back.h, frames: back.frames.length, dw: d.w, dh: d.h, df: d.frames.length }; });
  check(rt.bytes > 128 && rt.w === rt.dw && rt.h === rt.dh && rt.frames === rt.df, `exportBytes() gives .aseprite bytes (${rt.bytes}) that decode to the same size and frames`);

  // a palette import
  await openPanel("palette");
  const gpl = path.join(tmp, "smoke.gpl"); fs.writeFileSync(gpl, GPL);
  await page.locator('.pxs-panel[data-panel="palette"] input[type="file"]').setInputFiles(gpl); await sleep(400);
  d = await docInfo(); check(d.palette === 3, "a .gpl set on the palette input replaces the palette (" + d.palette + " colours)");
  await shot("palette-import");
  await closePanel("palette");

  // autosave and reload
  const hBefore = await page.evaluate(HASH);
  await page.waitForFunction(() => document.querySelector(".pxs-saved").textContent.startsWith("Saved"), null, { timeout: 5000 }).catch(() => {});
  const savedText = await page.locator(".pxs-saved").textContent();
  check(savedText.startsWith("Saved"), "the autosave reports Saved (" + savedText + ")");
  await page.reload(); await ready();
  const hAfter = await page.evaluate(HASH), dAfter = await docInfo();
  check(hAfter === hBefore && dAfter.frames === 2 && dAfter.palette === 3, "a reload brings the drawing, its frames and its palette back");
  await shot("after-reload");

  // the api from the page's side
  const od = await page.evaluate(() => { const d = AseFormats.newDoc({ w: 20, h: 10, name: "sheet", palette: ["#ff0000"] }); PixelStudio.api.openDoc(d, { template: null }); const g = PixelStudio.api.getDoc(); return { same: g === d, w: g.w, h: g.h, name: document.querySelector(".pxs-nm").textContent }; });
  check(od.same && od.w === 20 && od.h === 10 && od.name === "sheet", "api.openDoc shows the given doc as the live one");
  const nt = await page.evaluate(() => { PixelStudio.api.newFromTemplate("char", { frames: 4 }); const g = PixelStudio.api.getDoc(); return { w: g.w, h: g.h, frames: g.frames.length, template: PixelStudio.api.getView().template }; });
  check(nt.w === 48 && nt.h === 52 && nt.frames === 4 && nt.template === "char", "api.newFromTemplate('char', { frames: 4 }) opens a 48 × 52 sprite with 4 frames");
  await sleep(200); await shot("char-template");

  // a fresh studio over the page: the start screen makes a sprite of the typed width (x) and height (y), or imports one
  await page.evaluate(() => { window.__pageStudio = PixelStudio.api; });
  await scrollToStudio();
  await page.locator('#studio .tool-h button:has-text("Open a new studio")').click(); await sleep(500);
  const st = await page.evaluate(() => { const o = document.querySelector(".pxs-overlay .pxs"), s = o && o.querySelector(".pxs-start"); const r = s && s.getBoundingClientRect(); return { overlay: !!o, full: !!o && o.className.includes("pxs-full"), start: !!s && !s.hidden && r.height > 100, fresh: !!o && PixelStudio.api.root === o && PixelStudio.active === PixelStudio.api, cards: s ? s.querySelectorAll(".pxs-card").length : 0 }; });
  check(st.overlay && st.full && st.start && st.fresh && st.cards === 3, "Open a new studio puts a fresh full-screen studio over the page with the start screen (create, import, saved)", JSON.stringify(st));
  await shot("start");
  if (phone) { await page.emulateMedia({ colorScheme: "dark" }); await sleep(150); await shot("start-dark"); await page.emulateMedia({ colorScheme: "light" }); }
  const startEl = page.locator(".pxs-overlay .pxs-start");
  await startEl.locator('input[aria-label="Name of the new sprite"]').fill("smoke");
  await startEl.locator('input[aria-label^="Width of the new sprite"]').fill("24");
  await startEl.locator('input[aria-label^="Height of the new sprite"]').fill("40");
  await startEl.locator('button:has-text("Create")').click(); await sleep(300);
  const nd = await page.evaluate(() => { const d = PixelStudio.api.getDoc(); return { w: d.w, h: d.h, name: d.name, start: PixelStudio.api.isStart(), pageW: window.__pageStudio.getDoc().w }; });
  check(nd.w === 24 && nd.h === 40 && nd.name === "smoke" && !nd.start && nd.pageW === 48, "Create makes a 24 × 40 sprite named smoke in the fresh studio, leaves the start screen, and the page's studio keeps its own sprite", JSON.stringify(nd));
  await shot("new-studio");
  const toolBefore = await page.evaluate(() => window.__pageStudio.getView().tool);
  if (!phone) {
    await page.locator(".pxs-overlay .pxs-cv").click({ position: { x: 5, y: 5 } }); await sleep(100);
    await page.keyboard.press("e"); await sleep(80);
    const kb = await page.evaluate(() => ({ fresh: PixelStudio.api.getView().tool, page: window.__pageStudio.getView().tool }));
    check(kb.fresh === "eraser" && kb.page === toolBefore, "a key goes to the fresh studio only", JSON.stringify(kb));
  }
  await page.locator('.pxs-overlay .pxs-top [aria-label^="Start screen"]').click(); await sleep(300);
  check(await page.evaluate(() => PixelStudio.api.isStart()), "the home button brings the start screen back");
  const dataUrl = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 12; c.height = 7; const x = c.getContext("2d"); x.fillStyle = "#ff0000"; x.fillRect(0, 0, 6, 7); x.fillStyle = "#0000ff"; x.fillRect(6, 0, 6, 7); return c.toDataURL("image/png"); });
  const png = path.join(tmp, "smoke.png"); fs.writeFileSync(png, Buffer.from(dataUrl.split(",")[1], "base64"));
  await page.locator('.pxs-overlay .pxs-start input[type="file"]').setInputFiles(png); await sleep(600);
  const imp = await page.evaluate(() => { const d = PixelStudio.api.getDoc(); return { w: d.w, h: d.h, name: d.name, start: PixelStudio.api.isStart(), palette: d.palette.length }; });
  check(imp.w === 12 && imp.h === 7 && imp.name === "smoke" && !imp.start && imp.palette === 2, "a PNG set on the start screen's import opens as a 12 × 7 sprite with its two colours", JSON.stringify(imp));
  await page.locator('.pxs-overlay .pxs-top [aria-label="Close this studio"]').click(); await sleep(400);
  const closed = await page.evaluate(() => ({ overlay: !!document.querySelector(".pxs-overlay"), back: PixelStudio.api === window.__pageStudio && PixelStudio.active === window.__pageStudio, body: getComputedStyle(document.body).overflow, pageTool: window.__pageStudio.getView().tool, pageW: window.__pageStudio.getDoc().w }));
  check(!closed.overlay && closed.back && closed.body !== "hidden" && closed.pageTool === toolBefore && closed.pageW === 48, "Close removes the fresh studio and the page's studio carries on where it was", JSON.stringify(closed));
  await scrollToStudio();

  if (!phone) {
    await page.locator(".pxs-cv").click({ position: { x: 5, y: 5 } }); await sleep(100);
    await page.keyboard.press("e"); await sleep(50); const te = (await view()).tool;
    await page.keyboard.press("b"); await sleep(50); const tb = (await view()).tool;
    check(te === "eraser" && tb === "pencil", "E and B pick the eraser and the pencil");
    await page.locator(".pxs-frs .pxs-fr").nth(0).click(); await sleep(100);
    const c2 = await page.evaluate(CENTRE), hh0 = await page.evaluate(HASH);
    await stroke([c2.x, c2.y], [c2.x + c2.cell * 4, c2.y]); await sleep(150);
    const hh1 = await page.evaluate(HASH);
    await page.keyboard.press("Control+z"); await sleep(200);
    const hh2 = await page.evaluate(HASH);
    check(hh1 !== hh0 && hh2 === hh0, "Ctrl+Z undoes a stroke");
    await page.keyboard.press("m"); await sleep(50);
    await stroke([c2.x - c2.cell * 3, c2.y - c2.cell * 3], [c2.x + c2.cell * 3, c2.y + c2.cell * 3]); await sleep(150);
    const sel = (await view()).sel;
    check(!!sel && sel.w >= 5 && sel.h >= 5, "the Select tool makes a selection by dragging");
    await shot("selection");
  }
  check(errs.length === 0, "no page error and no console error", errs.join(" | "));
  await ctx.close();
}

(async () => {
  console.log("building the board");
  execFileSync(process.execPath, [path.join(board, "build.js")], { stdio: "inherit" });
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "studio-smoke-"));
  const srv = await serve(); const base = "http://127.0.0.1:" + srv.address().port;
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    await run(browser, base, true, tmp);
    await run(browser, base, false, tmp);
  } catch (e) { fail++; console.log("  FAIL the run crashed: " + (e && e.stack || e)); }
  finally { if (browser) await browser.close(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(`\n${pass} ok, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
