// Screenshot design/hd/index.html with the pre-installed Chromium:  node design/hd/shoot.cjs [out.png]
// Starts the prototype's static server on a free port, loads the page at 2 device px per CSS px, saves a full-page PNG.
const { spawn } = require("node:child_process");
const path = require("node:path");
const net = require("node:net");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..", "..");
const out = process.argv[2] || path.join(ROOT, "..", "docs", "sprite-designs", "in-game-scale.png");
(async () => {
  const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
  const srv = spawn(process.execPath, [path.join(ROOT, "server.cjs")], { env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }).catch(() => chromium.launch({ args: ["--no-sandbox"] }));
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  page.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") console.log("[page]", m.text()); });
  await page.goto(`http://127.0.0.1:${port}/design/hd/index.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: out, fullPage: true });
  console.log(out);
  await browser.close();
  srv.kill();
})().catch((e) => { console.error(e); process.exit(1); });
