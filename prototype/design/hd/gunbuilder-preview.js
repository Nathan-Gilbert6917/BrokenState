// The gun builder mock (design preview only): the proposed panel with the HD art (design/hd/guns.js paintGunHD at 4×,
// anchorsHD for the leader lines, partIcon for the slot boxes) and, under it, today's builder drawn by the game's own
// code (ui/gunart.js gunURL at 8×, ui/gunbuilder.js slotLayout / VIEW) for the same gun and parts. Static: nothing
// here is wired to a game state. Screenshot: node design/hd/shoot-gunbuilder.cjs
import { toCanvas, outline, painter } from "./hdcore.js";
import { paintGunHD, anchorHD, partIcon, HD_UP } from "./guns.js";

// ---------- the gun on show ----------
const GUN = { key: "carbine", name: "Police AR carbine", finish: "black" };
const FITTED = { // slot -> { key, name, look, delta }
  optic: { key: "aimpoint", name: "Military red dot", look: "reddot", delta: "+5", dtitle: "+5 aim" },
  muzzle: { key: "can556pro", name: "Premium 5.56 suppressor", look: "can_l", delta: "−55%", dtitle: "−55% noise" },
  under: { key: "vgrippro", name: "BCM grip", look: "vgrip", delta: "+2", dtitle: "+2 aim" },
  tactical: { key: "surefire", name: "SureFire light", look: "light", delta: "+10", dtitle: "+10 night sight" },
};
const OWN = { stock: { name: "collapsible stock", look: "collapsible" }, mag: { name: "30-round magazine", look: "stick30" } };
const SLOT_NAMES = { optic: "Sight", magnifier: "Magnifier", mount: "Mount", muzzle: "Muzzle", mag: "Magazine", under: "Underbarrel", stock: "Stock", grip: "Foregrip", pgrip: "Pistol grip", rail: "Rail", tactical: "Light/laser", bipod: "Bipod", sling: "Sling", receiver: "Receiver", cuff: "Buttstock carrier" };
const SLOTS = ["optic", "magnifier", "muzzle", "mag", "stock", "rail", "under", "pgrip", "tactical", "bipod", "sling", "receiver"]; // the AR-15's (data-gunmods.js PLATFORMS.ar15) plus the magnifier the red dot opens
const TOP = new Set(["optic", "mount", "tactical", "rail", "magnifier"]);
const REACH = { rail: 2, magnifier: 1, pgrip: 1 }; // empty sockets with parts within reach
const OPEN = "under"; // the socket whose list is open
const PARENT = { magnifier: "optic" };
const FINISHES = [["black", "black", "#3a3e44"], ["fde", "tan (FDE)", "#86693f"], ["od", "OD green", "#444c36"]];

// The layout: the game's VIEW (ui/gunbuilder.js) with the HD image at 4×.
const VIEW = { W: 720, H: 340, IMG_W: 512, IMG_H: 192, IX: 104, IY: 72, BOX_W: 98, BOX_H: 62, TOP_Y: 6, GAP: 5 };
VIEW.BOT_Y = VIEW.IY + VIEW.IMG_H + 8;
function laneXs(list) {
  const n = list.length;
  const bw = n * (VIEW.BOX_W + VIEW.GAP) > VIEW.W - 8 ? (VIEW.W - 8 - VIEW.GAP * (n - 1)) / n : VIEW.BOX_W;
  const max = VIEW.W - bw - 4;
  const xs = list.map((it) => Math.max(4, Math.min(max, it.px - bw / 2)));
  for (let i = 1; i < n; i++) xs[i] = Math.max(xs[i], xs[i - 1] + bw + VIEW.GAP);
  if (n && xs[n - 1] > max) { xs[n - 1] = max; for (let i = n - 2; i >= 0; i--) xs[i] = Math.min(xs[i], xs[i + 1] - bw - VIEW.GAP); }
  return { xs, bw };
}
function layoutHD() {
  const fitted = Object.fromEntries(Object.keys(FITTED).map((s) => [s, true]));
  const pts = SLOTS.map((slot) => { const [gx, gy] = anchorHD(GUN.key, slot, fitted); return { slot, px: VIEW.IX + gx * HD_UP + 2, py: VIEW.IY + gy * HD_UP + 2, top: TOP.has(slot) }; });
  const out = [];
  for (const top of [true, false]) {
    const lane = pts.filter((p) => p.top === top).sort((a, b) => a.px - b.px);
    const { xs, bw } = laneXs(lane);
    lane.forEach((p, i) => out.push({ ...p, x: xs[i], y: top ? VIEW.TOP_Y : VIEW.BOT_Y, w: bw, h: VIEW.BOX_H }));
  }
  return out;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const r1 = (v) => Math.round(v * 10) / 10;

// ---------- the proposed panel ----------
function iconCanvas(look) { return toCanvas(partIcon(look), 1); }
function statsRows(after) {
  // [label, now, max, after, better (+1 higher is better / -1), unit]
  const rows = [["Accuracy", 62, 100, 64, 1, ""], ["Range", 48, 100, 48, 1, " m"], ["Handling", 71, 100, 74, 1, ""], ["Noise", 2, 6, 2, -1, ""], ["Rate of fire", 3, 5, 3, 1, " /turn"], ["Weight", 4.1, 8, 4.3, -1, " kg"], ["Reliability", 97, 100, 97, 1, "%"]];
  return rows.map(([label, now, max, aft, better, unit]) => {
    const changed = after && aft !== now, up = changed && (aft - now) * better > 0;
    const w = (v) => `${(v / max) * 100}%`;
    const lo = Math.min(now, aft), hi = Math.max(now, aft);
    const meter = `<span class="meter"><b style="width:${w(changed ? lo : now)}"></b>${changed ? `<i class="${up ? "up" : "down"}" style="left:${w(lo)};width:${w(hi - lo)}"></i>` : ""}</span>`;
    const fmt = (v) => (unit === " kg" ? v.toFixed(1) : v) + unit;
    return `<tr><td>${label}</td><td class="m">${meter}</td><td class="n">${fmt(now)}</td><td class="n ${changed ? (up ? "up" : "down") : ""}">${changed ? `→ ${fmt(aft)}` : ""}</td></tr>`;
  }).join("");
}
function renderHD(root) {
  const lay = layoutHD();
  const img = toCanvas(paintGunHD(GUN.key, Object.fromEntries(Object.entries(FITTED).map(([s, f]) => [s, f.look])), SLOTS, GUN.finish), HD_UP);
  img.className = "gbimg"; img.style.left = `${VIEW.IX}px`; img.style.top = `${VIEW.IY}px`;
  const wrap = document.createElement("div"); wrap.className = "gbwrap";
  const laneTop = `<div class="lane" style="top:${VIEW.TOP_Y - 4}px;height:${VIEW.BOX_H + 8}px"><span>On top</span></div>`;
  const laneBot = `<div class="lane" style="top:${VIEW.BOT_Y - 4}px;height:${VIEW.BOX_H + 8}px"><span>Under and behind</span></div>`;
  const lines = lay.map((b) => {
    const bx = b.x + b.w / 2, by = b.top ? b.y + b.h : b.y, on = b.slot === OPEN ? " on" : "";
    const par = PARENT[b.slot] && lay.find((x) => x.slot === PARENT[b.slot]);
    if (par) { const px = par.x + par.w / 2, py = par.top ? par.y + par.h : par.y; return `<line class="nest" x1="${r1(px)}" y1="${r1(py)}" x2="${r1(bx)}" y2="${r1(by)}"/><circle cx="${r1(b.px)}" cy="${r1(b.py)}" r="2.5"/>`; }
    return `<line class="${on}" x1="${r1(b.px)}" y1="${r1(b.py)}" x2="${r1(bx)}" y2="${r1(by)}"/><circle cx="${r1(b.px)}" cy="${r1(b.py)}" r="3.5"/>`;
  }).join("");
  wrap.innerHTML = laneTop + laneBot + `<svg viewBox="0 0 ${VIEW.W} ${VIEW.H}" xmlns="http://www.w3.org/2000/svg">${lines}</svg>`;
  wrap.appendChild(img);
  for (const b of lay) {
    const part = FITTED[b.slot], own = OWN[b.slot], reach = REACH[b.slot];
    const el = document.createElement("button");
    el.className = `gbslot${part || own ? "" : " empty"}${reach ? " reach" : ""}${b.slot === OPEN ? " on" : ""}`;
    el.style.cssText = `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px`;
    const name = part ? part.name : own ? own.name : reach ? `${reach} in reach` : "empty socket";
    el.innerHTML = `<span class="cap"><span>${esc(SLOT_NAMES[b.slot] || b.slot)}</span>${part && part.delta ? `<b class="${part.down ? "down" : ""}" title="${esc(part.dtitle || part.delta)}">${esc(part.delta)}</b>` : reach ? `<b class="badge">${reach}</b>` : ""}</span>${part || own ? "" : `<span class="ph">${reach ? "+" : "·"}</span>`}<span class="gbpn">${esc(name)}</span>`;
    if (part || own) el.insertBefore(iconCanvas((part || own).look), el.querySelector(".gbpn"));
    wrap.appendChild(el);
  }
  const fin = `<div class="fin"><span>Finish</span>${FINISHES.map(([k, n, c]) => `<span class="sw${k === GUN.finish ? " cur" : ""}" style="background:${c}" title="${n}"></span>`).join("")}<span class="fname">${FINISHES.find(([k]) => k === GUN.finish)[1]}</span><span>· a found gun keeps the finish it came in</span></div>`;
  const list = `<div><div class="spread"><b>Under the barrel</b><button class="mini">✕</button></div>
    <div class="gbrow"><span class="lead"><span><b>Remove the BCM grip</b><br><span class="gbd">−2 aim, −3 close</span></span></span><button class="mini">Remove</button></div>
    <div class="gbrow hov"><span class="lead"></span><span style="flex:1;min-width:0"><b>Angled foregrip</b> <span class="gbd">Dana's pack</span><br><span class="gbd">+1 aim, +2 close, −0.1 kg</span></span><button class="mini">Fit</button></div>
    <div class="gbrow"><span class="lead"></span><span style="flex:1;min-width:0"><b>Budget vertical grip</b> <span class="gbd">Chinese clone · the armory</span><br><span class="gbd">no change · may work loose</span></span><button class="mini">Fit</button></div>
    <div class="gbrow"><span class="lead"></span><span style="flex:1;min-width:0"><b>Underbarrel grenade launcher</b> <span class="gbd">the armory</span><br><span class="gbd">+0.8 kg · a second trigger</span></span><button class="mini">Fit</button></div></div>`;
  const stats = `<div><div class="spread"><b>Stats</b><span class="small muted">now → with the angled foregrip</span></div>
    <table class="gbstats">${statsRows(true)}</table>
    <div class="row small" style="margin-top:0.4rem;gap:0.4rem"><span class="muted">Ammo</span><select><option>5.56 ball (standard)</option><option>5.56 green tip</option><option>Best to hand</option></select></div></div>`;
  root.innerHTML = `<div class="box">
    <div class="spread"><h1>Gun builder: ${esc(GUN.name)}</h1><span class="muted">Dana's hands · AR-15 · black</span></div>
    <div class="row small"><button class="mini">Repair (max 86 → 92)</button><span class="muted">at the bench: 2 parts, 1 h</span></div>
    <div class="result small">The SOCOM can fits: 5.56 only. Noise down to a whisper at the cost of a little weight.</div>
    <div class="gbwrap-slot"></div>
    ${fin}
    <div class="gbcols"><div>${list}</div>${stats}</div>
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end"><button class="primary">Done</button></div>
  </div>`;
  root.querySelector(".gbwrap-slot").replaceWith(wrap);
  // the candidates' icons
  const leads = root.querySelectorAll(".gbrow .lead");
  [null, "agrip", { kind: "vgrip", col: "grey" }, "m203"].forEach((look, i) => { if (look && leads[i]) leads[i].appendChild(iconCanvas(look)); });
}

// ---------- today's builder, by the game's own code ----------
async function renderCurrent(root) {
  try {
    const GA = await import("../../src/ui/gunart.js");
    const GB = await import("../../src/ui/gunbuilder.js");
    const item = { key: GUN.key, name: GUN.name, mods: Object.fromEntries(Object.entries(FITTED).map(([s, f]) => [s, { key: f.key, name: f.name }])) };
    const V = GB.VIEW, lay = GB.slotLayout(item, SLOTS.filter((s) => s !== "magnifier"));
    const boxes = lay.map((b) => {
      const part = item.mods[b.slot], own = OWN[b.slot];
      return `<button class="gbslot${part ? "" : " empty"}${b.slot === OPEN ? " on" : ""}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"><span class="gbsn">${esc(GB.SLOT_NAMES[b.slot] || b.slot)}</span><span class="gbpn">${part ? esc(part.name) : own ? esc(own.name) : "empty socket"}</span>${part && FITTED[b.slot].delta ? `<span class="gbdl">${esc(FITTED[b.slot].delta)}</span>` : ""}</button>`;
    }).join("");
    const lines = lay.map((b) => { const bx = b.x + b.w / 2, by = b.top ? b.y + b.h : b.y; return `<line x1="${r1(b.px)}" y1="${r1(b.py)}" x2="${r1(bx)}" y2="${r1(by)}"/><circle cx="${r1(b.px)}" cy="${r1(b.py)}" r="3.5"/>`; }).join("");
    const url = GA.gunURL(item, SLOTS);
    root.innerHTML = `<div class="box">
      <div class="spread"><h1>Gun builder: ${esc(GUN.name)}</h1><span class="muted">Dana's hands · AR-15 · black</span></div>
      <div class="gbwrap"><img class="gbimg" src="${url}" style="left:${V.IX}px;top:${V.IY}px;width:${V.IMG_W}px;height:${V.IMG_H}px"><svg viewBox="0 0 ${V.W} ${V.H}" xmlns="http://www.w3.org/2000/svg">${lines}</svg>${boxes}</div>
      <div class="gbcols"><div><div class="spread"><b>Under the barrel</b><button class="mini">✕</button></div>
        <div class="gbrow"><span><b>Remove the BCM grip</b><br><span class="gbd">−2 aim, −3 close</span></span><button class="mini">Remove</button></div>
        <div class="gbrow hov"><span><b>Angled foregrip</b> <span class="gbd">Dana's pack</span><br><span class="gbd">+1 aim, +2 close, −0.1 kg</span></span><button class="mini">Fit</button></div></div>
        <div><div class="spread"><b>Stats</b><span class="small muted">now → with the angled foregrip</span></div><table class="gbstats"><tr><td>Accuracy</td><td class="n">62</td><td class="n up">→ 64</td></tr><tr><td>Range</td><td class="n">48 m</td><td class="n"></td></tr><tr><td>Handling</td><td class="n">71</td><td class="n up">→ 74</td></tr><tr><td>Noise</td><td class="n">2</td><td class="n"></td></tr><tr><td>Weight</td><td class="n">4.1 kg</td><td class="n down">→ 4.3 kg</td></tr><tr><td>Reliability</td><td class="n">97%</td><td class="n"></td></tr></table></div></div>
      <div class="row" style="margin-top:0.8rem;justify-content:flex-end"><button class="primary">Done</button></div>
    </div>`;
  } catch (e) {
    console.warn("current builder", e);
    root.innerHTML = `<div class="box"><div class="err">The game's builder code could not be drawn on this page: ${esc(e.message)}. See docs/sprite-designs/guns-compare.png for the current art next to the HD art.</div></div>`;
  }
}

// ---------- the inventory thumbnail strip: the same gun at ~1.1 rem tall, HD and current ----------
function thumb(p, up) {
  let x0 = p.w, y0 = p.h, x1 = -1, y1 = -1;
  for (const [x, y] of p.pixels()) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const q = painter(x1 - x0 + 3, y1 - y0 + 3);
  for (const [x, y, c] of p.pixels()) q.set(x - x0 + 1, y - y0 + 1, c);
  const cv = toCanvas(q, up); const img = document.createElement("img"); img.src = cv.toDataURL(); return img;
}
async function renderThumbs(root) {
  const looks = Object.fromEntries(Object.entries(FITTED).map(([s, f]) => [s, f.look]));
  const hd = thumb(paintGunHD(GUN.key, looks, SLOTS, GUN.finish), 2);
  const hdBare = thumb(paintGunHD("ak", {}, null, "wood"), 2), hdShot = thumb(paintGunHD("shotgun", {}, null, "wood"), 2), hdPistol = thumb(paintGunHD("pistol", {}, null, null), 2);
  root.innerHTML = `<span>Inventory thumbnails at 1.1 rem (ui/gunart.js gunThumb): </span>`;
  const t1 = document.createElement("span"); t1.className = "tile"; t1.append("HD ", hd, hdBare, hdShot, hdPistol); root.appendChild(t1);
  try {
    const GA = await import("../../src/ui/gunart.js");
    const t2 = document.createElement("span"); t2.className = "tile"; t2.append("current ");
    for (const it of [{ key: GUN.key, mods: Object.fromEntries(Object.entries(FITTED).map(([s, f]) => [s, { key: f.key, name: f.name }])) }, { key: "ak" }, { key: "shotgun" }, { key: "pistol" }]) { const t = GA.gunThumb(it); if (t && t.url) { const img = document.createElement("img"); img.src = t.url; t2.appendChild(img); } }
    root.appendChild(t2);
  } catch (e) { console.warn("thumbs", e); }
}

renderHD(document.getElementById("hd"));
renderCurrent(document.getElementById("cur"));
renderThumbs(document.getElementById("thumbs"));
