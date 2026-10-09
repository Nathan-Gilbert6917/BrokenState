// Renders the dead's voices to WAV for listening, old and new side by side, and measures them (peak, RMS, clipping,
// loudness range, spectral centroid and flatness, duration, how much the seeds differ). Electron, a hidden window,
// an OfflineAudioContext: no speakers. The old sounds come from audio.js as it was where this branch left dev.
// Usage (from prototype/): ..\..\..\..\desktop\node_modules\.bin\electron.cmd tools/zombiesfxpreview.cjs
//   (or any electron) → <worktree>/sfx-preview/*.wav and analysis.json (the folder is not committed).
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const { pathToFileURL } = require("url");

const proto = path.resolve(__dirname, "..");
const outDir = path.resolve(proto, "..", "sfx-preview");
fs.mkdirSync(outDir, { recursive: true });

// The old audio.js (at the merge base with dev), its imports pointed back at this checkout.
const base = execSync("git merge-base HEAD dev", { cwd: proto }).toString().trim();
let old = execSync(`git show ${base}:prototype/src/ui/audio.js`, { cwd: proto, maxBuffer: 1 << 24 }).toString();
const ui = pathToFileURL(path.join(proto, "src", "ui")).href, sim = pathToFileURL(path.join(proto, "src", "sim")).href;
old = old.replace(/from "\.\/([^"]+)"/g, `from "${ui}/$1"`).replace(/from "\.\.\/sim\/([^"]+)"/g, `from "${sim}/$1"`);
const oldFile = path.join(outDir, "old_audio.mjs");
fs.writeFileSync(oldFile, old);

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { webSecurity: false, backgroundThrottling: false } });
  win.webContents.on("console-message", (e, level, msg) => { if (level >= 2) console.log("page:", msg); });
  try {
    await win.loadFile(path.join(__dirname, "zombiesfxpreview.html"));
    for (let i = 0; i < 100 && !(await win.webContents.executeJavaScript("!!window.ready")); i++) await new Promise((r) => setTimeout(r, 100));
    const res = await win.webContents.executeJavaScript(`window.renderAll(${JSON.stringify(pathToFileURL(oldFile).href)})`, true);
    for (const f of fs.readdirSync(outDir)) if (f.endsWith(".wav")) fs.unlinkSync(path.join(outDir, f));
    for (const f of res.files) fs.writeFileSync(path.join(outDir, f.name), Buffer.from(f.wav, "base64"));
    const S = res.stats;
    // How alike two spectra are (cosine of the average power spectra, 0–1).
    const cos = (a, b) => { let ab = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; } return Math.round(ab / Math.sqrt(aa * bb) * 1000) / 1000; };
    const pairs = (names) => { const out = []; for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) out.push(cos(S[names[i]].spectrum, S[names[j]].spectrum)); return out; };
    const seeds = pairs(["walker_idle_seed1_new", "walker_idle_seed2_new", "walker_idle_seed3_new", "walker_idle_seed4_new"]);
    const takes = pairs(["walker_idle_take1", "walker_idle_take2", "walker_idle_take3", "walker_idle_take4"]);
    const shrieks = pairs(["screamer_shriek_seed1_new", "screamer_shriek_seed2_new", "screamer_shriek_seed3_new"]);
    const table = Object.entries(S).map(([n, s]) => ({ name: n, secs: s.active, peak: s.peak, peakDb: s.peakDb, rmsDb: s.rmsDb, crestDb: s.crestDb, lra: s.lra, loudDb: s.loudDb, clip: s.clip, nan: s.nan, centroid: s.centroid, flatness: s.flatness, periodicity: s.periodicity }));
    const report = { base, table, similarity: { seeds, takes, shrieks }, gainReduction: res.gr };
    fs.writeFileSync(path.join(outDir, "analysis.json"), JSON.stringify(report, null, 1));
    const pad = (v, n) => String(v).padStart(n);
    console.log(`${"name".padEnd(32)} ${pad("secs", 5)} ${pad("peak", 6)} ${pad("rmsDb", 6)} ${pad("crest", 6)} ${pad("lra", 5)} ${pad("loud", 6)} ${pad("clip", 4)} ${pad("cent", 5)} ${pad("flat", 6)} ${pad("period", 6)}`);
    for (const r of table) console.log(`${r.name.padEnd(32)} ${pad(r.secs, 5)} ${pad(r.peak, 6)} ${pad(r.rmsDb, 6)} ${pad(r.crestDb, 6)} ${pad(r.lra, 5)} ${pad(r.loudDb, 6)} ${pad(r.clip, 4)} ${pad(r.centroid, 5)} ${pad(r.flatness, 6)} ${pad(r.periodicity, 6)}`);
    console.log(`spectral similarity, walker idle by 4 seeds: ${seeds.join(" ")}`);
    console.log(`spectral similarity, one walker's idle, 4 takes: ${takes.join(" ")}`);
    console.log(`spectral similarity, screamer shriek by 3 seeds: ${shrieks.join(" ")}`);
    for (const [k, v] of Object.entries(res.gr || {})) console.log(`limiters (effects bus + zombie bus), ${k}: deepest ${v.deepestDb} dB, windows touched by more than 1 dB ${v.windowsOver1dB}`);
    console.log(`${res.files.length} WAVs in ${outDir}`);
  } catch (e) {
    console.error("preview failed:", e && e.stack || e);
    process.exitCode = 1;
  }
  app.quit();
});
