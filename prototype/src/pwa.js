// @ts-check
// The web app's service worker (../sw.js): registered so the game added to a phone's home screen opens offline.
// Loaded by index.html as its own module, apart from main.js, and does nothing at all unless every one holds:
//   - the browser has service workers;
//   - https (GitHub Pages), or http on this machine (node server.cjs: a secure context too, so it can be tried);
//   - not the desktop app. Electron serves the game on app://brokenstate/, which fails the line above already, and
//     its user agent says Electron (ui/settings.js inDesktopApp reads the same); both are checked so a change to
//     either still leaves the desktop app without a worker.
// The worker is network-first (sw.js says why), so a reload still shows the files as they are on the server.
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;
const wanted = typeof navigator !== "undefined" && "serviceWorker" in navigator &&
  (location.protocol === "https:" || (location.protocol === "http:" && LOCAL.test(location.hostname))) &&
  !/Electron/i.test(navigator.userAgent || "");

if (wanted) {
  // The browser lists only 250 loaded files by default and the game is about 500: room for all of them, set before
  // most have arrived (this module runs before main.js), so the worker can be told every one (keep() below).
  try { performance.setResourceTimingBufferSize(4000); } catch { /* old browser: the cache fills on the next visit */ }
  if (document.readyState === "complete") register();
  else addEventListener("load", register, { once: true }); // after the game has loaded: never in its way
}

async function register() {
  try {
    const controlled = !!navigator.serviceWorker.controller; // loaded through the worker: it has seen every file
    await navigator.serviceWorker.register(new URL("../sw.js", import.meta.url)); // scope: the game's folder
    if (!controlled) keep((await navigator.serviceWorker.ready).active);
  } catch { /* refused (private mode, storage off): the game runs as before, online only */ }
}

// This page was loaded before the worker controlled it: tell it what was loaded (the page, its styles and modules,
// as resource timing lists them) so it keeps a copy of each now, rather than after the next visit.
function keep(worker) {
  if (!worker) return;
  const urls = [location.href, ...performance.getEntriesByType("resource").map((e) => e.name)];
  worker.postMessage({ keep: urls });
}
