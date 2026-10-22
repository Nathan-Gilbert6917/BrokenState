// The web app's service worker: the game opens with no connection once it has been played once (on a phone added to
// the home screen, mostly). Registered by src/pwa.js on https (GitHub Pages) and http://localhost only; never in the
// desktop app, whose app:// scheme has no service workers. Scope: this folder, so /BrokenState/ on Pages.
//
// Network first, the cache only as the fallback, for every same-origin GET in scope. Not a precache list: the game is
// some 480 small modules that change with nearly every commit, and a hand-kept (or generated) list goes stale the
// first time someone adds a module and forgets it, which breaks the game offline in a way nobody sees online. Served
// from the network, a reload always shows what is deployed, as before, and server.cjs's no-cache + ETag revalidation
// keeps working on localhost (the request goes out as the page made it; a 304 comes back as the HTTP cache's copy).
// What fills the cache: every answer that passes through, and, the first time, the files the page had already loaded
// before this worker took over (src/pwa.js sends their URLs: the "keep" message), so one visit is enough.
// A slow network (a weak signal) falls back to the cached copy after SLOW_MS; the network's answer still refreshes the
// cache for next time. build.json (the error screen's build stamp, src/ui/crash.js) is never touched: offline its
// fetch fails, and crash.js already shows "no build" for that.
const CACHE = "broken-state"; // one cache, overwritten in place: nothing is versioned, so nothing needs a new name
const SLOW_MS = 4000;

self.addEventListener("install", () => self.skipWaiting()); // no precache to wait for: take over straight away
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k); // a cache from a later rename
  await self.clients.claim(); // the page that registered it too, so what it loads from now on is kept
})()));

const inScope = (url) => url.startsWith(self.registration.scope) && !new URL(url).pathname.endsWith("/build.json");

// Kept: complete same-origin answers (no errors, no partial or opaque ones; Cache.put refuses a 206 anyway).
const keepable = (res) => res && res.status === 200 && res.type === "basic";
// What says which version of a file an answer is: its ETag, else Last-Modified (none: kept every time).
const tagOf = (res) => res.headers.get("ETag") || res.headers.get("Last-Modified") || null;
// URL → the tag of the copy kept, read from the cache once per start of the worker. An answer with the same tag is
// not copied or written again: without this every reload rewrote all 480 files, which on localhost (a reload after
// each edit) made a reload about a third slower; with it the difference is within the noise.
let index = null;
const known = () => index || (index = caches.open(CACHE).then((c) => c.matchAll()).then((all) => new Map(all.map((r) => [r.url, tagOf(r)]))).catch(() => new Map()));
async function store(url, res) {
  const tags = await known();
  try { await (await caches.open(CACHE)).put(url, res); } catch { tags.delete(url); } // full or refused: try again next time
}
// The kept copy of a request; a page (a navigation) also matches its URL with another query (?notitle) and then the
// start page itself (index.html), so the game opens offline however it was opened.
async function cached(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit || req.mode !== "navigate") return hit;
  return (await cache.match(req, { ignoreSearch: true })) || (await cache.match(self.registration.scope));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || !inScope(req.url) || req.headers.has("Range")) return; // the browser handles it as usual
  // One fetch: its answer goes to the page (unless the cache wins the race below) and, cloned, into the cache when it
  // is not the version kept already. (The clone happens before the page gets the answer: got resolves after it.)
  const got = fetch(req).then(async (res) => {
    if (!keepable(res)) return { res, copy: null };
    const tags = await known(), tag = tagOf(res);
    if (tag && tags.get(req.url) === tag) return { res, copy: null };
    tags.set(req.url, tag);
    return { res, copy: res.clone() };
  });
  e.waitUntil(got.then(({ copy }) => copy && store(req.url, copy)).catch(() => {}));
  e.respondWith((async () => {
    const network = got.then(({ res }) => res);
    let settled = false; // the network answered (or failed) first: the timer looks nothing up
    network.then(() => { settled = true; }, () => { settled = true; });
    const slow = new Promise((r) => setTimeout(r, SLOW_MS)).then(() => (settled ? network : cached(req).then((hit) => hit || network)));
    try {
      const res = await Promise.race([network, slow]);
      if (res.status >= 500) return (await cached(req)) || res; // the host is down, not the file gone
      return res;
    } catch {
      return (await cached(req)) || Response.error(); // offline and never kept: the same failure as with no worker
    }
  })());
});

// The files the page loaded before this worker controlled it (src/pwa.js): fetched again (from the HTTP cache, as a
// rule) and kept, unless already kept.
self.addEventListener("message", (e) => {
  const urls = e.data && Array.isArray(e.data.keep) ? e.data.keep : null;
  if (!urls) return;
  e.waitUntil((async () => {
    const tags = await known();
    const want = [...new Set([self.registration.scope, ...urls.map(String)])].filter((u) => { try { return inScope(new URL(u).href); } catch { return false; } });
    await Promise.allSettled(want.map(async (u) => {
      const url = new URL(u); url.hash = "";
      if (tags.has(url.href)) return;
      const res = await fetch(url.href);
      if (!keepable(res) || tags.has(url.href)) return; // fetched meanwhile through the worker: kept there
      tags.set(url.href, tagOf(res));
      await store(url.href, res);
    }));
  })());
});
