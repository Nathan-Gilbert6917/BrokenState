// WAV previews of the ambience (weather and wildlife), scene by scene, and the old ambience next to the new at the
// same settings, rendered by a real WebAudio OfflineAudioContext in a hidden Electron window (no speakers), through the
// game's chain at the default sliders (ambience 50%, master 70%, the master compressor). Prints loudness per scene
// (RMS of the whole and per 5 s, the peak, clipping) and the cost (render time, nodes, bake time).
// Usage (from the repo's prototype folder):
//   <electron> tools/ambiencepreview/main.cjs [out dir] [name filter]
//   e.g. ../desktop/node_modules/electron/dist/electron.exe tools/ambiencepreview/main.cjs ../amb-preview
// Writes <out>/<name>.wav (16-bit stereo, 48 kHz, +12 dB of listening makeup, the same for old and new) and
// <out>/stats.json. Not part of the test suite.
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.resolve(process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : path.join(ROOT, "..", "amb-preview"));
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
  await win.loadURL(`http://127.0.0.1:${srv.address().port}/tools/ambiencepreview/page.html`);
  let names = null;
  for (let i = 0; i < 200 && !names; i++) {
    const s = await win.webContents.executeJavaScript("window.AMB ? (window.AMB.error ? { error: window.AMB.error } : window.AMB.names) : null");
    if (s && s.error) { console.error(s.error); app.exit(1); return; }
    names = s;
    if (!names) await new Promise((r) => setTimeout(r, 100));
  }
  fs.mkdirSync(OUT, { recursive: true });
  const all = {};
  for (const name of names) {
    if (FILTER && !FILTER.test(name)) continue;
    const r = await win.webContents.executeJavaScript(`window.AMB.render(${JSON.stringify(name)})`);
    const buf = Buffer.from(r.data, "base64");
    fs.writeFileSync(path.join(OUT, `${name}.wav`), wav(new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2), r.sr));
    all[name] = r.stats;
    const s = r.stats;
    console.log(`${name.padEnd(24)} ${String(s.secs).padStart(3)}s  RMS ${String(s.rmsDb).padStart(6)} dB  peak ${String(s.peakDb).padStart(6)} dB  wav peak ${String(s.wavPeakDb).padStart(6)} dB  clip ${s.wavClip}  per 5 s [${s.seg.join(" ")}]  render ${s.renderMs} ms  frames ${s.frameMs} ms  bed nodes max ${s.bedMax}  calls ${s.calls}${s.nan ? "  NaN!" : ""}`);
  }
  const cost = await win.webContents.executeJavaScript("window.AMB.cost()");
  console.log("cost:", JSON.stringify(cost));
  fs.writeFileSync(path.join(OUT, "stats.json"), JSON.stringify({ renders: all, cost }, null, 1));
  srv.close();
  app.exit(0);
});
