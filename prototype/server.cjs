// Tiny zero-dependency static file server for the prototype.
// Usage: node server.cjs  → http://localhost:5173
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 5173;
// build.json: the commit these files come from (the error screen's report, src/ui/crash.js), read from git once.
let build = null;
const buildJson = () => {
  if (!build) {
    try {
      const git = (...a) => require("child_process").execFileSync("git", ["-C", __dirname, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      build = { commit: git("rev-parse", "--short", "HEAD"), date: git("log", "-1", "--format=%cd", "--date=short"), source: true };
    } catch { build = { source: true }; }
  }
  return JSON.stringify(build);
};
const ROOT = __dirname;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    if (urlPath === "/build.json" && !fs.existsSync(path.join(ROOT, "build.json"))) {
      res.writeHead(200, { "Content-Type": TYPES[".json"], "Cache-Control": "no-store" });
      return res.end(buildJson());
    }
    let file = path.normalize(path.join(ROOT, urlPath === "/" ? "index.html" : urlPath));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end("Not found");
      }
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`Broken State prototype running at http://localhost:${PORT}`));
