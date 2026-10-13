// Screenshot a design page with the pre-installed Chromium:  node design/hd/shoot-gunbuilder.cjs [page path] [out.png]
// (default: design/hd/gunbuilder.html -> docs/sprite-designs/gunbuilder-panel.png)
// Starts the prototype's static server on a free port, loads the page at 2 device px per CSS px, saves a full-page PNG.
const { spawn } = require("node:child_process");
const path = require("node:path");
const net = require("node:net");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..", "..");
const pagePath = process.argv[2] || "design/hd/gunbuilder.html";
const out = process.argv[3] || path.join(ROOT, "..", "docs", "sprite-designs", "gunbuilder-panel.png");
(async () => {
  const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
  const srv = spawn(process.execPath, [path.join(ROOT, "server.cjs")], { env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }).catch(() => chromium.launch({ args: ["--no-sandbox"] }));
  const page = await browser.newPage({ viewport: { width: 1180, height: 1000 }, deviceScaleFactor: 2 });
  page.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") console.log("[page]", m.text()); });
  await page.goto(`http://127.0.0.1:${port}/${pagePath}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: out, fullPage: true });
  console.log(out);
  await browser.close();
  srv.kill();
})().catch((e) => { console.error(e); process.exit(1); });
