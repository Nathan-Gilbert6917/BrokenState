// WAV previews of the vehicle and door sounds (ui/sfx-vehicles.js, ui/sfx-doors.js), rendered by a real WebAudio
// OfflineAudioContext in a hidden Electron window (no speakers), with numbers for each (peak, loudness, clipping,
// spectral centroid, length) and the nodes each costs.
// Usage (from the repo's prototype folder):
//   <electron> tools/vdpreview/main.cjs [out dir] [name filter]
//   e.g. ../desktop/node_modules/.bin/electron tools/vdpreview/main.cjs ../vd-preview
// Writes <out>/<name>.wav (16-bit stereo, 48 kHz) and <out>/stats.json; prints a table. Not part of the test suite.
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.resolve(process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : path.join(ROOT, "..", "vd-preview"));
const FILTER = process.argv[3] ? new RegExp(process.argv[3]) : null;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css" };

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const p = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split("?")[0])));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream", "Cache-Control": "no-store" });
      fs.createReadStream(p).pipe(rsp);
    }).listen(0, "127.0.0.1", () => res(srv));
  });
}
function wav(i16, sr) {
  const data = Buffer.from(i16.buffer, i16.byteOffset, i16.byteLength), h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const srv = await serve();
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  win.webContents.on("console-message", (e, level, msg) => { if (level >= 2) console.log("page:", msg); });
  await win.loadURL(`http://127.0.0.1:${srv.address().port}/tools/vdpreview/page.html`);
  let names = null;
  for (let i = 0; i < 100 && !names; i++) {
    const s = await win.webContents.executeJavaScript("window.SFX ? (window.SFX.error ? { error: window.SFX.error } : window.SFX.names) : null");
    if (s && s.error) { console.error(s.error); app.exit(1); return; }
    names = s;
    if (!names) await new Promise((r) => setTimeout(r, 100));
  }
  fs.mkdirSync(OUT, { recursive: true });
  const all = {};
  for (const name of names) {
    if (FILTER && !FILTER.test(name)) continue;
    const r = await win.webContents.executeJavaScript(`window.SFX.render(${JSON.stringify(name)})`);
    const buf = Buffer.from(r.data, "base64");
    fs.writeFileSync(path.join(OUT, `${name}.wav`), wav(new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2), r.sr));
    all[name] = r.stats;
    const s = r.stats;
    console.log(`${name.padEnd(28)} peak ${String(s.peakDb).padStart(6)} dB  loud(50ms) ${String(s.rms50Db).padStart(6)} dB  clip ${String(s.clip).padStart(4)}  centroid ${String(s.centroid).padStart(5)} Hz  len ${s.len}s${s.nan ? "  NaN!" : ""}${s.reduction ? `  limiter max ${s.reduction.limiter.max} mean ${s.reduction.limiter.mean} (active ${s.reduction.limiter.active}% at ${s.reduction.limiter.meanActive}) dB; master comp max ${s.reduction.master.max} mean ${s.reduction.master.mean} dB` : ""}`);
  }
  const nodes = await win.webContents.executeJavaScript("window.SFX.nodeCount()");
  console.log("nodes:", JSON.stringify(nodes));
  fs.writeFileSync(path.join(OUT, "stats.json"), JSON.stringify({ renders: all, nodes }, null, 1));
  srv.close();
  app.exit(0);
});
