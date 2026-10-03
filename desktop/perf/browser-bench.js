// The same performance test as `npm run perf`, in a normal browser (Chrome or Edge, already installed), for
// comparison. No downloads: a tiny local server hands out ../prototype and adds perf/driver.js to index.html
// on the way out (the game's files are not changed); the page posts its result back. The browser runs as a
// real window (not headless, so it has the real GPU and vsync) on a throwaway profile, and is closed afterwards.
//   node perf/browser-bench.js [--seconds=60] [--sizes=1080p,maximized,maximized-dpr1] [--browser=C:\path\to\chrome.exe] [--out=file.json]
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const arg = (name, dflt) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : dflt; };
const SECONDS = Number(arg("seconds", 60));
const SIZES = arg("sizes", "1080p,maximized,maximized-dpr1").split(",");
const ROOT = path.resolve(__dirname, "..", "..", "prototype");
const DRIVER = fs.readFileSync(path.join(__dirname, "driver.js"), "utf8");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };

function findBrowser() {
  const given = arg("browser", null);
  if (given) return given;
  const pf = [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean);
  const rel = ["Google\\Chrome\\Application\\chrome.exe", "Microsoft\\Edge\\Application\\msedge.exe"];
  for (const r of rel) for (const p of pf) { const f = path.join(p, r); if (fs.existsSync(f)) return f; }
  return null;
}

const inject = (opts) => `<script>${DRIVER}
window.addEventListener("load", () => {
  const post = (r) => fetch("/__perf_result", { method: "POST", body: JSON.stringify(r) });
  window.__bsPerf.run(${JSON.stringify(opts)}).then(post, (e) => post({ error: String(e && e.message ? e.message : e) }));
});
</script>`;

let onResult = null;
const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/__perf_result") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { res.writeHead(204); res.end(); if (onResult) onResult(JSON.parse(body)); });
    return;
  }
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const file = path.normalize(path.join(ROOT, urlPath === "/" ? "index.html" : urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    if (path.basename(file) === "index.html") data = Buffer.from(data.toString("utf8").replace("</body>", `${inject({ seed: 42, speed: 200, seconds: SECONDS, warmup: 3 })}</body>`));
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
});

// Working set and private memory of every process of the throwaway profile (browser, GPU, renderer, utilities).
function processMemory(profile) {
  try {
    const ps = `$p = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${path.basename(profile)}*' -and $_.Name -match 'chrome|msedge' }; ` +
      `'{0} {1} {2}' -f $p.Count, (($p | Measure-Object WorkingSetSize -Sum).Sum), (($p | Measure-Object PrivatePageCount -Sum).Sum)`;
    const [n, ws, priv] = execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { encoding: "utf8" }).trim().split(/\s+/).map(Number);
    return { processes: n, workingSetMB: Math.round(ws / 1048576), privateMB: Math.round(priv / 1048576) };
  } catch (e) {
    return { error: String(e.message).slice(0, 200) };
  }
}

async function main() {
  const browser = findBrowser();
  if (!browser) { console.error("No Chrome or Edge found; pass --browser=path"); process.exit(2); }
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const runs = [];
  for (const label of SIZES) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "broken-state-bench-"));
    const flags = [
      `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync",
      "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-features=CalculateNativeWinOcclusion",
      ...(label === "1080p" || label.endsWith("-dpr1") ? ["--force-device-scale-factor=1"] : []),
      ...(label.startsWith("maximized") ? ["--start-maximized"] : ["--window-size=1920,1080", "--window-position=0,0"]),
      `--app=${url}`,
    ];
    const result = new Promise((resolve) => {
      onResult = resolve;
      setTimeout(() => resolve({ error: "timed out" }), (SECONDS + 45) * 1000);
    });
    const child = spawn(browser, flags, { stdio: "ignore" });
    const r = await result;
    onResult = null;
    runs.push({ label, ...r, processMemory: processMemory(profile) });
    try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* already gone */ }
    await new Promise((res) => setTimeout(res, 1500));
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* files still locked: left in the temp folder */ }
  }
  server.close();
  const json = JSON.stringify({ host: "browser", browser, seconds: SECONDS, runs }, null, 2);
  const out = arg("out", null);
  if (out) fs.writeFileSync(path.resolve(out), json);
  console.log(json);
  process.exit(runs.every((r) => !r.error) ? 0 : 1);
}
main();
