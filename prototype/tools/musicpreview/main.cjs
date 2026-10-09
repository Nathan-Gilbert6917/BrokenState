// WAV previews of the music (ui/music.js), rendered by a real WebAudio OfflineAudioContext in a hidden Electron window
// (no speakers) through the game's chain at the default sliders, with numbers for each: peak, loudness (RMS, the
// loudest 50 ms, per section), clipping, the engine's peak node count, notes, drops and its scheduling time.
// Usage (from the repo's prototype folder):
//   <electron> tools/musicpreview/main.cjs [out dir] [name filter]
//   e.g. C:/Dev/BrokenState/desktop/node_modules/electron/dist/electron.exe tools/musicpreview/main.cjs ../music-preview
// Writes <out>/<name>.wav (16-bit stereo, 48 kHz) and <out>/stats.json; prints a table. Not part of the test suite.
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.resolve(process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : path.join(ROOT, "..", "music-preview"));
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
  await win.loadURL(`http://127.0.0.1:${srv.address().port}/tools/musicpreview/page.html`);
  let names = null;
  for (let i = 0; i < 100 && !names; i++) {
    const s = await win.webContents.executeJavaScript("window.MUS ? (window.MUS.error ? { error: window.MUS.error } : window.MUS.names) : null");
    if (s && s.error) { console.error(s.error); app.exit(1); return; }
    names = s;
    if (!names) await new Promise((r) => setTimeout(r, 100));
  }
  fs.mkdirSync(OUT, { recursive: true });
  const all = {};
  for (const name of names) {
    if (FILTER && !FILTER.test(name)) continue;
    const t0 = Date.now();
    const r = await win.webContents.executeJavaScript(`window.MUS.render(${JSON.stringify(name)}, { raw: ${!!process.env.MUSIC_RAW} })`); // MUSIC_RAW=1: the engine's own mix, no bus (for setting the levels)
    const buf = Buffer.from(r.data, "base64");
    fs.writeFileSync(path.join(OUT, `${name}.wav`), wav(new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2), r.sr));
    all[name] = r.stats;
    const s = r.stats, e = s.engine;
    console.log(`${name.padEnd(14)} ${String(s.secs).padStart(3)}s peak ${String(s.peakDb).padStart(6)} dB  RMS ${String(s.rmsDb).padStart(6)} dB  loud50 ${String(s.rms50Db).padStart(6)}  clip ${s.clip}${s.nan ? " NaN!" : ""}  nodes ≤${e.peakNodes} (voices ≤${e.peakVoices})  notes ${e.notes} dropped ${e.dropped} ${JSON.stringify(e.droppedBy)} stolen ${e.stolen} ${JSON.stringify(e.stolenBy)} late ${e.late}  tick ${e.tickAvgMs} ms avg, ${e.tickMaxMs} max  baked ${e.baked} in ${e.bakeMs} ms (${e.bakeMB} MB)  [${Date.now() - t0} ms]`);
    if (s.fxOnly) console.log(`    effects alone: peak ${s.fxOnly.peakDb} dB, loudest 50 ms ${s.fxOnly.rms50Db} dB, loudest 0.4 s ${s.fxOnly.loud} dB; the mix's loudest 0.4 s ${s.musicLoud} dB`);
    for (const sec of s.sections || []) console.log(`    ${sec.label.padEnd(26)} RMS ${String(sec.rmsDb).padStart(6)} dB  peak ${String(sec.peakDb).padStart(6)} dB${sec.fx != null ? `  effects RMS ${sec.fx} dB` : ""}`);
  }
  fs.writeFileSync(path.join(OUT, "stats.json"), JSON.stringify(all, null, 1));
  srv.close();
  app.exit(0);
});
