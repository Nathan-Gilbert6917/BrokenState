// The survivor sprite mock sheets (tools/spritemock.html), saved as PNGs for the brief
// (docs/design-doc/sprites/survivor-sprites.md). Usage: NODE_PATH=$(npm root -g) node tools/spritemockshot.cjs [outdir]
// Starts the prototype's server on a free port, opens the page in headless Chromium, saves one PNG a section.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const outDir = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "docs", "design-doc", "sprites", "survivors"));
const port = 5300 + Math.floor(Math.random() * 600);

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.cjs")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 700));
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await page.goto(`http://localhost:${port}/tools/spritemock.html`);
    await page.waitForSelector("body[data-ready]", { timeout: 20000 }).catch(() => errs.push("page never got ready"));
    for (const id of ["holds", "helmets", "armour"]) {
      const out = path.join(outDir, `${id}.png`);
      await page.locator(`#${id}`).screenshot({ path: out });
      console.log(out);
    }
    await browser.close();
    if (errs.length) console.log(`Page errors:\n${errs.join("\n")}`);
  } finally { srv.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
