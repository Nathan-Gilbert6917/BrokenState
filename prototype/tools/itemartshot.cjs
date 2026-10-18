// A screenshot of the item icons' preview page (tools/itemartpreview.html), for looking at the drawings.
// Usage: NODE_PATH=$(npm root -g) node tools/itemartshot.cjs [family|all] [out.png]
// Starts the prototype's server on a free port, opens the page in headless Chromium, saves a full-page PNG.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");

const family = process.argv[2] && process.argv[2] !== "all" ? process.argv[2] : "";
const out = path.resolve(process.argv[3] || `itemart-${family || "all"}.png`);
const port = 5300 + Math.floor(Math.random() * 600);

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.cjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 700));
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await page.goto(`http://localhost:${port}/tools/itemartpreview.html${family ? `?family=${family}` : ""}`);
    await page.waitForSelector("body[data-ready]", { timeout: 20000 }).catch(() => errs.push("page never got ready"));
    await page.screenshot({ path: out, fullPage: true });
    await browser.close();
    if (errs.length) console.log(`Page errors:\n${errs.join("\n")}`);
    console.log(out);
  } finally { srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
