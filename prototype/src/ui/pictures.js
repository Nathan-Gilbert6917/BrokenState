// Pictures drawn once and kept: the sprites and figures, the battle map's ground, fog and edge skirt, the night's
// light masks, the State Map's chunks and its night shade, the minimap's land, the weather's clouds, the gun art.
// They live in offscreen canvases and ImageBitmaps that the browser keeps on the GPU. When the GPU context is lost
// (the graphics driver resets, the GPU process crashes, a laptop switches graphics cards, the screen changes mode),
// every one of those comes back blank while the page itself keeps running: the game's canvases are drawn again each
// frame and recover, but a picture drawn once is never drawn again, so the units show as rings with no bodies, the
// ground as a flat colour, the walls as outlines, for good. That is what the player sees as "the sprites are gone".
// Each module with such a cache registers how to forget it (onForgetPictures); forgetPictures() drops them all, and
// the next frame draws everything again from the sim's state (every cache is derived; nothing is lost).
// watchCanvas(el): the game's own canvases (the State Map's, the battle's) report the loss and the recovery as the
// "contextlost" / "contextrestored" events (Chromium 99+, so the desktop app; a browser without them changes
// nothing). On a restore the pictures are forgotten once (a burst of restores within GAP ms, one per canvas, counts
// as one), and once more if it happens again later.
// checkPictures(now), from the frame loop: a browser may blank the kept pictures without a word to the game's canvases
// (the small canvases taken off the GPU, a driver reset the page is not told about). A sentinel of the sprites' kind
// (a small canvas painted once and kept) is drawn onto a fresh probe once a second and its pixel read back: found
// blank, the pictures are forgotten (once per gap) and the sentinel made again; blank CHECK.giveUp times running, the
// check stops and says so once (the browser cannot keep a picture at all: forgetting every second would only cost
// frames). Pure UI: nothing here reads or changes the sim.
const forgetters = new Set();
export const PICTURES = { gap: 1000 }; // ms: restores closer together than this forget the pictures once
export const CHECK = { every: 1000, giveUp: 5 }; // the sentinel: checked every ms; blank this many times running, given up
export const pictureStats = { forgotten: 0, lost: 0, restored: 0, checks: 0, blank: 0, gaveUp: false, why: "", at: -1e9 }; // for the tools and the console

// Registers how a module forgets its pictures. Returns a function that unregisters it.
export function onForgetPictures(fn) {
  forgetters.add(fn);
  return () => forgetters.delete(fn);
}
// Drops every kept picture; they are drawn again as they are needed. Returns how many caches were told.
export function forgetPictures(why = "") {
  let n = 0;
  for (const fn of forgetters) {
    try { fn(); n++; } catch (e) { if (typeof console !== "undefined") console.warn("a picture cache could not be dropped", e); }
  }
  pictureStats.forgotten++;
  pictureStats.why = why;
  return n;
}
const nowMs = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());
// Forgets the pictures once for a burst of restores (the map's and the battle's canvases each report their own).
export function picturesRestored(why = "the canvas came back") {
  const t = nowMs();
  pictureStats.restored++;
  if (t - pictureStats.at < PICTURES.gap) return false;
  pictureStats.at = t;
  forgetPictures(why);
  if (typeof console !== "undefined") console.warn(`Broken State: the graphics context was lost and came back (${why}); every kept picture is drawn again.`);
  return true;
}
// Watches one of the game's canvases for the loss of its context. Returns false on a canvas that cannot report it
// (the tools' stubs, an old browser).
export function watchCanvas(el) {
  if (!el || typeof el.addEventListener !== "function") return false;
  el.addEventListener("contextlost", () => { pictureStats.lost++; });
  el.addEventListener("contextrestored", () => { picturesRestored("the canvas came back"); });
  return true;
}
// ---------- the sentinel ----------
let sentinel = null, nextCheck = -1e9, misses = 0;
const SENT = [255, 128, 64]; // the sentinel's colour, read back from the probe
function makeSentinel() {
  const c = document.createElement("canvas");
  c.width = c.height = 8;
  const g = c.getContext("2d");
  g.fillStyle = `rgb(${SENT.join(",")})`;
  g.fillRect(0, 0, 8, 8);
  return c;
}
// Reads the sentinel back through a fresh probe: true intact, false blank, null when it cannot be read here (no DOM,
// the tools' stubs, a hidden page).
export function readSentinel() {
  if (typeof document === "undefined" || !document || typeof document.createElement !== "function") return null;
  if (document.visibilityState === "hidden") return null;
  try {
    if (!sentinel) sentinel = makeSentinel();
    const p = document.createElement("canvas");
    p.width = p.height = 2;
    const g = p.getContext("2d", { willReadFrequently: true });
    g.drawImage(sentinel, 0, 0, 2, 2);
    const d = g.getImageData(0, 0, 1, 1).data;
    if (!d || d.length < 4) return null;
    return d[3] > 200 && Math.abs(d[0] - SENT[0]) < 40 && Math.abs(d[1] - SENT[1]) < 40;
  } catch { return null; }
}
// Once a second from the frame loop. Returns what the sentinel said this time (null: not checked now).
export function checkPictures(now) {
  if (pictureStats.gaveUp || now < nextCheck) return null;
  nextCheck = now + CHECK.every;
  const ok = readSentinel();
  if (ok == null) return null;
  pictureStats.checks++;
  if (ok) { misses = 0; return true; }
  pictureStats.blank++;
  misses++;
  sentinel = null; // made again, so the next check reads the browser as it is now
  if (misses >= CHECK.giveUp) {
    pictureStats.gaveUp = true;
    if (typeof console !== "undefined") console.warn("Broken State: a kept picture came back blank " + misses + " times running; the browser is not keeping pictures. The check stops (the pictures are not forgotten again until the canvas itself reports a restore).");
    return false;
  }
  picturesRestored("a kept picture was found blank");
  return false;
}
// For the tools: the check from the start.
export function resetPictureCheck() { sentinel = null; nextCheck = -1e9; misses = 0; pictureStats.gaveUp = false; }

// Is a context lost right now (Chromium 99+ says; elsewhere never)?
export const contextLost = (ctx) => !!(ctx && typeof ctx.isContextLost === "function" && ctx.isContextLost());
