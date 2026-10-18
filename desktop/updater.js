// Automatic updates for the installed game (the Setup.exe build), from the releases named by "updates" in
// package.json (npm run release publishes them). Shortly after launch, and every few hours while it runs, the
// game looks for a newer version, downloads it in the background and installs it when the player quits; the
// player can also restart into it straight away. No internet, or no release yet: nothing happens (updater.log
// in %APPDATA%\Broken State says why).
//
// Off when run from source, in the --perf test and in the portable exe (one file, nothing to update in place).
//   BROKENSTATE_UPDATE_URL=<url>   use a plain folder of release files (latest.yml + Setup.exe) instead, for testing
const { app, dialog, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const TITLE = "Broken State";
const FIRST_CHECK_MS = 10 * 1000;
const EVERY_MS = 4 * 60 * 60 * 1000;

let updater = null; // electron-updater's autoUpdater, loaded only when updates are on
let ready = null; // the version downloaded and waiting to install
let asked = null; // the version the player was already told about
let manual = false; // the current check came from the menu: say what it found

const logFile = () => path.join(app.getPath("userData"), "updater.log");
function log(msg) {
  try {
    const f = logFile();
    if (fs.existsSync(f) && fs.statSync(f).size > 200 * 1024) fs.renameSync(f, f + ".old");
    fs.appendFileSync(f, `${new Date().toISOString()} ${msg}\n`);
  } catch { /* a read-only profile: no log */ }
}

const window = () => BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
const tell = (opts) => { const w = window(); return w ? dialog.showMessageBox(w, { title: TITLE, ...opts }) : dialog.showMessageBox({ title: TITLE, ...opts }); };

function enabled(perf) {
  if (perf) return false;
  if (process.env.BROKENSTATE_UPDATE_URL) return app.isPackaged;
  return app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR;
}

function start({ perf } = {}) {
  if (!enabled(perf)) return;
  ({ autoUpdater: updater } = require("electron-updater"));
  const testUrl = process.env.BROKENSTATE_UPDATE_URL;
  updater.setFeedURL(testUrl ? { provider: "generic", url: testUrl } : require("./package.json").updates);
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.logger = { info: (m) => log(`info ${m}`), warn: (m) => log(`warn ${m}`), error: (m) => log(`error ${m}`), debug: () => {} };

  updater.on("update-not-available", (info) => {
    if (manual) { manual = false; tell({ type: "info", message: "Broken State is up to date.", detail: `You have version ${app.getVersion()}${info && info.version && info.version !== app.getVersion() ? ` (latest: ${info.version})` : ""}.` }); }
  });
  updater.on("update-available", (info) => {
    if (manual) { manual = false; tell({ type: "info", message: `Downloading version ${info.version}.`, detail: "It downloads in the background while you play. You will be asked when it is ready." }); }
  });
  updater.on("error", (e) => {
    log(`error ${e && e.stack ? e.stack : e}`);
    if (manual) { manual = false; tell({ type: "warning", message: "Could not check for updates.", detail: `${e && e.message ? e.message.split("\n")[0] : e}\n\nCheck the internet connection and try again later.` }); }
  });
  updater.on("update-downloaded", (info) => {
    ready = info.version;
    if (asked === info.version) return;
    asked = info.version;
    tell({
      type: "info",
      message: `Broken State ${info.version} is ready to install.`,
      detail: `You have ${app.getVersion()}. It installs by itself the next time you quit the game.\n\nRestart now closes the game straight away: anything since your last save or autosave is lost.`,
      buttons: ["Install when I quit", "Restart now"],
      defaultId: 0,
      cancelId: 0,
    }).then((r) => { if (r.response === 1) updater.quitAndInstall(true, true); });
  });

  const check = () => updater.checkForUpdates().catch(() => { /* reported by the error event */ });
  setTimeout(check, FIRST_CHECK_MS);
  setInterval(check, EVERY_MS);
}

// Game > Check for Updates.
function checkNow() {
  if (!updater) {
    tell({ type: "info", message: "Updates are only for the installed game.", detail: app.isPackaged ? "This is the portable version: download the new Broken State Portable.exe to update it, or use the installer to get updates by itself." : "This copy runs from the source files, which are always the current version." });
    return;
  }
  if (ready) {
    tell({ type: "info", message: `Broken State ${ready} is ready to install.`, detail: "It installs the next time you quit the game. Restart now closes the game straight away: anything since your last save or autosave is lost.", buttons: ["Install when I quit", "Restart now"], defaultId: 0, cancelId: 0 })
      .then((r) => { if (r.response === 1) updater.quitAndInstall(true, true); });
    return;
  }
  manual = true;
  updater.checkForUpdates().catch(() => { /* reported by the error event */ });
}

module.exports = { start, checkNow };
