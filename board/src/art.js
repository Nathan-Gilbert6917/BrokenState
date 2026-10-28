// Art school: lessons from DATA.art and three hands-on tools (pixel studio, sheet player, 3D-to-sprite camera).
window.renderArt = function (H) {
  const { el, docs, bullets, store } = H;
  const A = DATA.art || {};
  const page = document.getElementById("art-page");
  const PRESETS = DATA.artPresets;
  const PALETTE = DATA.artPalette;

  // ---------- lessons ----------
  const tracks = A.tracks || [];
  let track = store.get("bs-art-track", tracks[0] ? tracks[0].id : "");
  const trackPane = el("div", { class: "trackpane" });
  const trackBtns = el("div", { class: "seg wide", role: "tablist", "aria-label": "Art tracks" });
  function renderTrack() {
    trackBtns.querySelectorAll("button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.t === track)));
    trackBtns.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.t === track)));
    trackPane.textContent = "";
    const t = tracks.find(x => x.id === track) || tracks[0]; if (!t) return;
    const doneKey = "bs-art-done";
    const done = store.get(doneKey, {});
    trackPane.append(
      el("div", { class: "track-h" }, el("h3", { text: t.title }), t.for ? el("p", { text: t.for }) : null,
        el("button", { type: "button", class: "btn primary", onclick: () => practise(t.id), text: t.id === "models3d" ? "Try the 3D camera" : "Practise in the pixel studio" })),
      el("div", { class: "cols2" },
        t.spec && t.spec.length ? el("div", { class: "box" }, el("h4", { class: "bx", text: "Spec for Broken State" }),
          el("dl", { class: "spec" }, t.spec.map(r => el("div", {}, el("dt", { text: r.k }), el("dd", { text: r.v }))))) : null,
        el("div", { class: "box" }, el("h4", { class: "bx", text: "Practice" }),
          el("div", { class: "practice" }, (t.practice || []).map((p, i) => { const k = t.id + "|" + i; return el("label", {},
            el("input", { type: "checkbox", id: "pr-" + t.id + i, checked: done[k] ? true : null, onchange: e => { const d = store.get(doneKey, {}); if (e.target.checked) d[k] = 1; else delete d[k]; store.set(doneKey, d); } }), el("span", { text: p })); })),
          t.mistakes && t.mistakes.length ? el("h4", { class: "bx", text: "Beginner mistakes" }) : null, bullets(t.mistakes, "pits"))),
      el("div", { class: "lessons" }, (t.lessons || []).map((l, i) => el("details", { open: i === 0 ? true : null },
        el("summary", {}, el("span", { class: "mono", text: String(i + 1).padStart(2, "0") }), el("span", { text: l.t })),
        el("div", { class: "lesson-b" }, el("ol", {}, (l.steps || []).map(s => el("li", { text: s }))), l.tip ? el("p", { class: "tipline", text: l.tip }) : null, docs(l.links))))),
      t.engine ? el("div", { class: "eng" },
        el("div", { class: "g only-godot" }, el("h4", { text: "Into Godot" }), el("p", { text: t.engine.godot || "" })),
        el("div", { class: "u only-unity" }, el("h4", { text: "Into Unity" }), el("p", { text: t.engine.unity || "" }))) : null);
  }
  for (const t of tracks) trackBtns.append(el("button", { type: "button", role: "tab", "data-t": t.id, onclick: () => { track = t.id; store.set("bs-art-track", track); renderTrack(); }, text: t.title }));

  // ---------- pixel studio ----------
  const S = { preset: "icon16", w: 16, h: 16, frames: [], cur: 0, color: PALETTE[2], tool: "pen", mirror: false, onion: true, grid: true, guide: true, fps: 8, playing: true, view: "anim" };
  const undo = [];
  function blank() { return new Array(S.w * S.h).fill(""); }
  function loadDraft() {
    const d = store.get("bs-art-studio", null);
    if (d && d.w && d.frames && d.frames.length && PRESETS[d.preset]) { Object.assign(S, { preset: d.preset, w: d.w, h: d.h, frames: d.frames, fps: d.fps || 8 }); S.cur = 0; }
    else setPreset("icon16", false);
  }
  let saveT = 0;
  function saveDraft() { clearTimeout(saveT); saveT = setTimeout(() => store.set("bs-art-studio", { preset: S.preset, w: S.w, h: S.h, frames: S.frames, fps: S.fps }), 300); }
  function setPreset(key, keep) {
    const P = PRESETS[key]; S.preset = key; S.w = P.w; S.h = P.h;
    S.frames = [blank()]; S.cur = 0; undo.length = 0;
    if (P.seed) seed(P.seed);
    saveDraft();
  }
  // a starting drawing so the tool opens doing something
  function seed(kind) {
    const f = S.frames[0], put = (x, y, c) => { if (x >= 0 && y >= 0 && x < S.w && y < S.h) f[y * S.w + x] = c; };
    const inM = (x, y) => mask(S.preset, x + .5, y + .5);
    if (kind === "hexgrass" || kind === "isofloor" || kind === "isoblock") {
      for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) if (inM(x, y)) {
        const n = (x * 7 + y * 13 + ((x * y) % 5)) % 11;
        const h2 = ((x * 73856093) ^ (y * 19349663)) >>> 0, r = h2 % 23;
        let c = kind === "isoblock" ? "#8a6a48" : (r === 0 ? "#7a8f4e" : r === 1 ? "#3c4734" : "#5d6b4f");
        if (kind === "isoblock") { const top = topFace(x + .5, y + .5); c = top ? (n < 3 ? "#c9cfc9" : "#8b938c") : (x < S.w / 2 ? "#6b4f35" : "#8a6a48"); }
        if (kind === "isofloor") c = n < 3 ? "#8b938c" : "#c9cfc9";
        f[y * S.w + x] = c;
      }
    } else if (kind === "beans") {
      for (let y = 3; y < 14; y++) for (let x = 4; x < 12; x++) put(x, y, x === 4 || x === 11 ? "#2c3832" : y < 6 || y > 11 ? "#8b938c" : "#b8332b");
      for (let x = 5; x < 11; x++) { put(x, 3, "#c9cfc9"); put(x, 8, "#e0b44a"); put(x, 9, "#e0b44a"); }
      for (let x = 4; x < 12; x++) { put(x, 2, "#2c3832"); put(x, 14, "#2c3832"); }
    } else if (kind === "survivor") {
      const cx = Math.floor(S.w / 2), base = (PRESETS[S.preset].pivotY != null ? PRESETS[S.preset].pivotY : S.h - 4) + 1;
      const rect = (x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, c); };
      rect(cx - 3, base - 10, 2, 10, "#2c3832"); rect(cx + 1, base - 10, 2, 10, "#2c3832");
      rect(cx - 4, base - 22, 8, 12, "#2f6fb3"); rect(cx - 5, base - 21, 1, 9, "#d9a37a"); rect(cx + 4, base - 21, 1, 9, "#d9a37a");
      rect(cx - 3, base - 29, 6, 7, "#d9a37a"); rect(cx - 3, base - 30, 6, 2, "#6b4f35"); put(cx - 2, base - 26, "#17201c"); put(cx + 1, base - 26, "#17201c");
      rect(cx - 4, base - 1, 3, 1, "#17201c"); rect(cx + 1, base - 1, 3, 1, "#17201c");
    }
  }
  function topFace(x, y) { const w = S.w, t = w / 2; return Math.abs(x - w / 2) / (w / 2) + Math.abs(y - t / 2) / (t / 2) <= 1; }
  // template masks: where the tile's pixels belong
  function mask(key, x, y) {
    const P = PRESETS[key], w = P.w, h = P.h;
    if (P.shape === "hexpointy") { const dx = Math.abs(x - w / 2), dy = Math.abs(y - h / 2); return dx <= w / 2 && dy <= h / 2 && dy <= h / 2 - (dx / (w / 2)) * (h / 4); }
    if (P.shape === "hexflat") { const dx = Math.abs(x - w / 2), dy = Math.abs(y - h / 2); return dy <= h / 2 && dx <= w / 2 && dx <= w / 2 - (dy / (h / 2)) * (w / 4); }
    if (P.shape === "diamond") return Math.abs(x - w / 2) / (w / 2) + Math.abs(y - h / 2) / (h / 2) <= 1;
    if (P.shape === "block") { const t = w / 2, dx = Math.abs(x - w / 2); return y >= (t / 2) * (dx / (w / 2)) - .01 && y <= h - (t / 2) * (dx / (w / 2)) + .01; }
    return true;
  }

  const cv = el("canvas", { class: "studio-cv", "aria-label": "Pixel canvas: draw with the mouse or a finger" });
  const ctx = cv.getContext("2d");
  let cell = 20;
  function fit() {
    const maxW = Math.min(520, (cv.parentElement ? cv.parentElement.clientWidth : 520) - 4), maxH = 520;
    cell = Math.max(3, Math.floor(Math.min(maxW / S.w, maxH / S.h)));
    cv.width = S.w * cell; cv.height = S.h * cell; cv.style.width = cv.width + "px"; cv.style.height = cv.height + "px";
  }
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#888"; }
  function drawStudio() {
    const f = S.frames[S.cur], P = PRESETS[S.preset];
    const a = css("--sunk"), b = css("--panel");
    for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) {
      ctx.fillStyle = ((x >> 1) + (y >> 1)) % 2 ? a : b; ctx.fillRect(x * cell, y * cell, cell, cell);
    }
    if (S.onion && S.cur > 0) { ctx.globalAlpha = .28; paint(S.frames[S.cur - 1]); ctx.globalAlpha = 1; }
    paint(f);
    if (S.guide) {
      ctx.fillStyle = "rgba(120,30,25,.22)";
      for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) if (!mask(S.preset, x + .5, y + .5)) ctx.fillRect(x * cell, y * cell, cell, cell);
      ctx.strokeStyle = css("--accent"); ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.beginPath();
      const W = S.w * cell, Hh = S.h * cell;
      if (P.shape === "hexpointy") poly([[W / 2, 0], [W, Hh / 4], [W, 3 * Hh / 4], [W / 2, Hh], [0, 3 * Hh / 4], [0, Hh / 4]]);
      else if (P.shape === "hexflat") poly([[W / 4, 0], [3 * W / 4, 0], [W, Hh / 2], [3 * W / 4, Hh], [W / 4, Hh], [0, Hh / 2]]);
      else if (P.shape === "diamond") poly([[W / 2, 0], [W, Hh / 2], [W / 2, Hh], [0, Hh / 2]]);
      else if (P.shape === "block") { const t = W / 2; poly([[W / 2, 0], [W, t / 2], [W, Hh - t / 2], [W / 2, Hh], [0, Hh - t / 2], [0, t / 2]]); ctx.moveTo(0, t / 2); ctx.lineTo(W / 2, t); ctx.lineTo(W, t / 2); ctx.moveTo(W / 2, t); ctx.lineTo(W / 2, Hh); }
      else if (P.shape === "char") { const gy = (P.pivotY != null ? P.pivotY : S.h - 2) * cell; ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, Hh); ctx.stroke(); ctx.beginPath(); ctx.setLineDash([]); ctx.ellipse(W / 2, gy, W * .32, W * .16, 0, 0, Math.PI * 2); ctx.moveTo(W / 2 - 8, gy); ctx.lineTo(W / 2 + 8, gy); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (S.grid && cell >= 6) {
      ctx.strokeStyle = "rgba(128,140,132,.28)"; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 1; x < S.w; x++) { ctx.moveTo(x * cell + .5, 0); ctx.lineTo(x * cell + .5, S.h * cell); }
      for (let y = 1; y < S.h; y++) { ctx.moveTo(0, y * cell + .5); ctx.lineTo(S.w * cell, y * cell + .5); }
      ctx.stroke();
    }
  }
  function poly(pts) { ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]); ctx.closePath(); }
  function paint(f) { for (let i = 0; i < f.length; i++) if (f[i]) { ctx.fillStyle = f[i]; ctx.fillRect((i % S.w) * cell, Math.floor(i / S.w) * cell, cell, cell); } }

  function frameCanvas(f) {
    const c = document.createElement("canvas"); c.width = S.w; c.height = S.h; const x = c.getContext("2d");
    for (let i = 0; i < f.length; i++) if (f[i]) { x.fillStyle = f[i]; x.fillRect(i % S.w, Math.floor(i / S.w), 1, 1); }
    return c;
  }
  // stroke handling
  let drawing = false, last = null, strokeColor = null;
  function cellAt(e) { const r = cv.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / (r.width / S.w)), Math.floor((e.clientY - r.top) / (r.height / S.h))]; }
  function setPx(x, y, c) {
    if (x < 0 || y < 0 || x >= S.w || y >= S.h) return;
    const f = S.frames[S.cur]; f[y * S.w + x] = c;
    if (S.mirror) f[y * S.w + (S.w - 1 - x)] = c;
  }
  function line(x0, y0, x1, y1, c) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy;
    for (;;) { setPx(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
  }
  function fill(x, y, c) {
    const f = S.frames[S.cur], t = f[y * S.w + x]; if (t === c) return;
    const st = [[x, y]];
    while (st.length) { const [a, b] = st.pop(); if (a < 0 || b < 0 || a >= S.w || b >= S.h || f[b * S.w + a] !== t) continue; f[b * S.w + a] = c; st.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]); }
  }
  function pushUndo() { undo.push({ cur: S.cur, f: S.frames[S.cur].slice() }); if (undo.length > 60) undo.shift(); }
  cv.addEventListener("pointerdown", e => {
    e.preventDefault(); const [x, y] = cellAt(e);
    if (S.tool === "pick") { const c = S.frames[S.cur][y * S.w + x]; if (c) { S.color = c; renderPalette(); } return; }
    pushUndo();
    if (S.tool === "fill") { fill(x, y, S.color); changed(); return; }
    drawing = true; strokeColor = S.tool === "erase" || e.button === 2 ? "" : S.color; last = [x, y];
    cv.setPointerCapture(e.pointerId); setPx(x, y, strokeColor); changed();
  });
  cv.addEventListener("pointermove", e => { if (!drawing) return; const [x, y] = cellAt(e); line(last[0], last[1], x, y, strokeColor); last = [x, y]; changed(); });
  const end = () => { drawing = false; };
  cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
  cv.addEventListener("contextmenu", e => e.preventDefault());
  function changed() { drawStudio(); renderFrames(); saveDraft(); }

  // controls
  const presetSel = el("select", { id: "st-preset", "aria-label": "Template" }, Object.entries(PRESETS).map(([k, p]) => el("option", { value: k, text: p.label })));
  const presetNote = el("p", { class: "note" });
  presetSel.addEventListener("change", () => { setPreset(presetSel.value); refreshAll(); });
  const toolSeg = el("div", { class: "seg", role: "group", "aria-label": "Drawing tool" },
    [["pen", "Pencil"], ["erase", "Eraser"], ["fill", "Fill"], ["pick", "Pick colour"]].map(([k, t]) => el("button", { type: "button", "data-tool": k, onclick: () => { S.tool = k; renderTools(); }, text: t })));
  function renderTools() { toolSeg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tool === S.tool))); }
  const toggles = el("div", { class: "toggles" },
    [["mirror", "Mirror"], ["onion", "Onion skin"], ["grid", "Grid"], ["guide", "Template guide"]].map(([k, t]) => el("label", {}, el("input", { type: "checkbox", id: "st-" + k, checked: S[k] ? true : null, onchange: e => { S[k] = e.target.checked; drawStudio(); } }), t)));
  const pal = el("div", { class: "palette", role: "group", "aria-label": "Palette" });
  const custom = el("input", { type: "color", id: "st-custom", "aria-label": "Custom colour", value: "#2f6fb3", oninput: e => { S.color = e.target.value; renderPalette(); } });
  function renderPalette() {
    pal.textContent = "";
    for (const c of PALETTE) pal.append(el("button", { type: "button", class: "sw", style: "background:" + c, title: c, "aria-label": "Colour " + c, "aria-pressed": String(c === S.color), onclick: () => { S.color = c; if (S.tool === "erase" || S.tool === "pick") S.tool = "pen"; renderTools(); renderPalette(); } }));
    pal.append(custom);
  }
  const framesBox = el("div", { class: "frames" });
  function renderFrames() {
    framesBox.textContent = "";
    S.frames.forEach((f, i) => {
      const c = frameCanvas(f); c.className = "thumb";
      framesBox.append(el("button", { type: "button", class: "fr", "aria-pressed": String(i === S.cur), "aria-label": "Frame " + (i + 1), onclick: () => { S.cur = i; drawStudio(); renderFrames(); } }, c, el("span", { text: String(i + 1) })));
    });
  }
  const frameBtns = el("div", { class: "row-btns" },
    el("button", { type: "button", class: "btn", onclick: () => { S.frames.splice(S.cur + 1, 0, blank()); S.cur++; changed(); }, text: "+ Frame" }),
    el("button", { type: "button", class: "btn", onclick: () => { S.frames.splice(S.cur + 1, 0, S.frames[S.cur].slice()); S.cur++; changed(); }, text: "Duplicate" }),
    el("button", { type: "button", class: "btn", onclick: () => { if (S.frames.length > 1) { S.frames.splice(S.cur, 1); S.cur = Math.max(0, S.cur - 1); changed(); } }, text: "Delete frame" }),
    el("button", { type: "button", class: "btn", onclick: () => { const u = undo.pop(); if (u) { S.frames[u.cur] = u.f; S.cur = Math.min(u.cur, S.frames.length - 1); changed(); } }, text: "Undo" }),
    el("button", { type: "button", class: "btn", onclick: () => { pushUndo(); const f = S.frames[S.cur]; for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) if (!mask(S.preset, x + .5, y + .5)) f[y * S.w + x] = ""; changed(); }, text: "Clip to template" }),
    el("button", { type: "button", class: "btn", onclick: () => { pushUndo(); S.frames[S.cur] = blank(); changed(); }, text: "Clear" }));
  document.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key === "z" && location.hash === "#art" && document.activeElement && document.activeElement.tagName !== "INPUT") { e.preventDefault(); const u = undo.pop(); if (u) { S.frames[u.cur] = u.f; changed(); } } });

  // previews
  const pvA = el("canvas", { class: "pv", width: 220, height: 220, "aria-label": "Animation preview" });
  const pvT = el("canvas", { class: "pv wide", width: 420, height: 260, "aria-label": "Tiled preview to check seams" });
  const fpsIn = el("input", { type: "range", id: "st-fps", min: 1, max: 24, value: S.fps, "aria-label": "Frames per second" });
  const fpsOut = el("span", { class: "mono" });
  fpsIn.addEventListener("input", () => { S.fps = +fpsIn.value; fpsOut.textContent = S.fps + " fps · " + Math.round(1000 / S.fps) + " ms a frame"; saveDraft(); });
  let tick = 0, lastT = 0;
  function drawPreviews(now) {
    if (location.hash !== "#art") { requestAnimationFrame(drawPreviews); return; }
    if (now - lastT > 1000 / S.fps) { tick++; lastT = now; }
    const fi = tick % S.frames.length, fc = frameCanvas(S.frames[fi]);
    const a = pvA.getContext("2d"); a.imageSmoothingEnabled = false; a.fillStyle = css("--sunk"); a.fillRect(0, 0, pvA.width, pvA.height);
    const sc = Math.max(1, Math.floor(Math.min(200 / S.w, 200 / S.h)));
    a.drawImage(fc, (pvA.width - S.w * sc) / 2, (pvA.height - S.h * sc) / 2, S.w * sc, S.h * sc);
    a.fillStyle = css("--muted"); a.font = "11px " + css("--mono"); a.fillText("frame " + (fi + 1) + "/" + S.frames.length + " · " + sc + "×", 6, pvA.height - 6);
    drawTiled(fc);
    requestAnimationFrame(drawPreviews);
  }
  function drawTiled(fc) {
    const t = pvT.getContext("2d"), P = PRESETS[S.preset], W = pvT.width, Hh = pvT.height; t.imageSmoothingEnabled = false;
    t.fillStyle = css("--sunk"); t.fillRect(0, 0, W, Hh);
    const sc = P.tileScale || 2, w = S.w * sc, h = S.h * sc;
    const blit = (x, y) => t.drawImage(fc, Math.round(x), Math.round(y), w, h);
    if (P.shape === "hexpointy") { for (let r = -1; r < Hh / (h * .75) + 1; r++) for (let q = -1; q < W / w + 1; q++) blit(q * w + (r & 1 ? w / 2 : 0), r * h * .75); }
    else if (P.shape === "hexflat") { for (let q = -1; q < W / (w * .75) + 1; q++) for (let r = -1; r < Hh / h + 1; r++) blit(q * w * .75, r * h + (q & 1 ? h / 2 : 0)); }
    else if (P.shape === "diamond" || P.shape === "block") {
      const th = w / 2, ox = W / 2 - w / 2, oy = P.shape === "block" ? h - th - 10 : 0, N = Math.ceil(Math.max(W / w, Hh / th)) + 2;
      if (P.shape === "diamond") { for (let s = 0; s < 2 * N; s++) for (let i = 0; i <= s; i++) blit(ox + (i - s + i) * w / 2, (s) * th / 2); }
      else {
        // a floor of plain diamonds, then an L-shaped wall drawn back to front so nearer blocks cover farther ones (y-sort)
        for (let s = 0; s < 2 * N; s++) for (let i = 0; i <= s; i++) { const j = s - i, x = ox + (i - j) * w / 2, y = oy + h - th + (i + j) * th / 2;
          t.fillStyle = (i + j) % 2 ? css("--panel") : css("--bg"); t.beginPath(); t.moveTo(x + w / 2, y); t.lineTo(x + w, y + th / 2); t.lineTo(x + w / 2, y + th); t.lineTo(x, y + th / 2); t.closePath(); t.fill(); }
        const wall = []; for (let k = 1; k < 6; k++) wall.push([k, 2]); for (let k = 3; k < 6; k++) wall.push([1, k]);
        wall.sort((p, q) => (p[0] + p[1]) - (q[0] + q[1])).forEach(([i, j]) => blit(ox + (i - j) * w / 2, oy + (i + j) * th / 2));
      }
    } else if (P.shape === "char") {
      const tw = 32 * sc, th = 16 * sc, ox = W / 2 - tw / 2; t.strokeStyle = css("--rule");
      for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) { const x = ox + (i - j) * tw / 2, y = (i + j) * th / 2 - 40; t.fillStyle = (i + j) % 2 ? css("--panel") : css("--bg"); t.beginPath(); t.moveTo(x + tw / 2, y); t.lineTo(x + tw, y + th / 2); t.lineTo(x + tw / 2, y + th); t.lineTo(x, y + th / 2); t.closePath(); t.fill(); t.stroke(); }
      for (const [i, j] of [[3, 3], [4, 2], [2, 5]]) { const cx = ox + (i - j) * tw / 2 + tw / 2, cy = (i + j) * th / 2 - 40 + th / 2; t.drawImage(fc, Math.round(cx - w / 2), Math.round(cy - (P.pivotY != null ? P.pivotY : S.h - 2) * sc), w, h); }
    } else { for (let y = 0; y < Hh; y += h + 6) for (let x = 0; x < W; x += w + 6) blit(x, y); }
  }

  // export
  const sheetImg = el("img", { class: "sheet", alt: "Your sprite sheet", hidden: true });
  const exportNote = el("p", { class: "note" });
  async function exportSheet(scale) {
    const c = document.createElement("canvas"); c.width = S.w * S.frames.length * scale; c.height = S.h * scale;
    const x = c.getContext("2d"); x.imageSmoothingEnabled = false;
    S.frames.forEach((f, i) => x.drawImage(frameCanvas(f), i * S.w * scale, 0, S.w * scale, S.h * scale));
    const name = (PRESETS[S.preset].key || "sprite") + (S.frames.length > 1 ? "_sheet" : "") + (scale > 1 ? "@" + scale + "x" : "") + ".png";
    sheetImg.src = c.toDataURL("image/png"); sheetImg.hidden = false;
    try {
      if (!(window.claude && window.claude.use)) {
        // the installed app or a plain browser: an ordinary download
        const link = document.createElement("a"); link.href = sheetImg.src; link.download = name; document.body.append(link); link.click(); link.remove();
        exportNote.textContent = "Saved " + name + "."; return;
      }
      const dl = await window.claude.use("downloads");
      if (!dl) { exportNote.textContent = "Saving files is not available here. Right-click or long-press the sheet below to save it."; return; }
      const blob = await new Promise(r => c.toBlob(r, "image/png"));
      await dl.save({ filename: name, data: blob }); exportNote.textContent = "Saved " + name + ".";
    } catch (e) { exportNote.textContent = e && e.code === "declined" ? "Not saved." : "Could not save the file here. Right-click or long-press the sheet below to save it."; }
  }
  const exportBtns = el("div", { class: "row-btns" },
    el("button", { type: "button", class: "btn primary", onclick: () => exportSheet(1), text: "Save PNG (1×, for the engine)" }),
    el("button", { type: "button", class: "btn", onclick: () => exportSheet(4), text: "Save PNG (4×, to share)" }));

  function refreshAll() {
    presetSel.value = S.preset; const P = PRESETS[S.preset];
    presetNote.textContent = P.note + " Canvas " + S.w + " × " + S.h + " px. Art key: " + (P.key || "") + ".";
    fit(); drawStudio(); renderFrames(); renderTools(); renderPalette();
    fpsIn.value = S.fps; fpsOut.textContent = S.fps + " fps · " + Math.round(1000 / S.fps) + " ms a frame";
  }

  // ---------- sheet player ----------
  const spCv = el("canvas", { class: "pv", width: 260, height: 260, "aria-label": "Sprite sheet playback" });
  const spSheet = el("canvas", { class: "pv sheetcv", width: 10, height: 10, "aria-label": "The sheet with its frame grid" });
  const spIn = { fw: el("input", { type: "number", id: "sp-fw", min: 1, value: 32 }), fh: el("input", { type: "number", id: "sp-fh", min: 1, value: 32 }),
    n: el("input", { type: "number", id: "sp-n", min: 0, value: 0 }), row: el("input", { type: "number", id: "sp-row", min: 0, value: 0 }), fps: el("input", { type: "number", id: "sp-fps", min: 1, max: 60, value: 8 }) };
  let spImg = null, spT = 0, spLast = 0;
  const spFile = el("input", { type: "file", id: "sp-file", accept: "image/png,image/gif,image/webp" });
  const spNote = el("p", { class: "note", text: "Load a sheet exported from Aseprite, Krita, Blender or the studio. Frames run left to right; set the frame size." });
  spFile.addEventListener("change", () => {
    const f = spFile.files && spFile.files[0]; if (!f) return;
    const img = new Image(); img.onload = () => { spImg = img; spNote.textContent = f.name + ": " + img.width + " × " + img.height + " px."; drawSheet(); }; img.src = URL.createObjectURL(f);
  });
  Object.values(spIn).forEach(i => i.addEventListener("input", drawSheet));
  const spToStudio = el("button", { type: "button", class: "btn", onclick: () => {
    if (!spImg) return; const fw = +spIn.fw.value, fh = +spIn.fh.value;
    if (fw > 96 || fh > 128) { spNote.textContent = "The studio takes frames up to 96 × 128 px."; return; }
    const c = document.createElement("canvas"); c.width = spImg.width; c.height = spImg.height; const x = c.getContext("2d"); x.drawImage(spImg, 0, 0);
    const n = +spIn.n.value || Math.floor(spImg.width / fw), row = +spIn.row.value; const frames = [];
    for (let k = 0; k < n; k++) { const d = x.getImageData(k * fw, row * fh, fw, fh).data, f = [];
      for (let i = 0; i < fw * fh; i++) f.push(d[i * 4 + 3] < 128 ? "" : "#" + [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]].map(v => v.toString(16).padStart(2, "0")).join("")); frames.push(f); }
    PRESETS.custom = { label: "Imported sheet", w: fw, h: fh, shape: "free", note: "Frames loaded from your sheet.", key: "imported" };
    if (!presetSel.querySelector('option[value="custom"]')) presetSel.append(el("option", { value: "custom", text: "Imported sheet" }));
    Object.assign(S, { preset: "custom", w: fw, h: fh, frames, cur: 0 }); undo.length = 0; refreshAll(); saveDraft();
    document.getElementById("studio").scrollIntoView({ behavior: "smooth", block: "start" });
  }, text: "Open frames in the studio" });
  function drawSheet() {
    if (!spImg) return; const fw = +spIn.fw.value || 1, fh = +spIn.fh.value || 1, sc = Math.max(1, Math.min(4, Math.floor(560 / spImg.width)));
    spSheet.width = spImg.width * sc; spSheet.height = spImg.height * sc; const x = spSheet.getContext("2d"); x.imageSmoothingEnabled = false;
    x.drawImage(spImg, 0, 0, spSheet.width, spSheet.height); x.strokeStyle = css("--hive"); x.lineWidth = 1;
    for (let gx = 0; gx <= spImg.width; gx += fw) { x.beginPath(); x.moveTo(gx * sc + .5, 0); x.lineTo(gx * sc + .5, spSheet.height); x.stroke(); }
    for (let gy = 0; gy <= spImg.height; gy += fh) { x.beginPath(); x.moveTo(0, gy * sc + .5); x.lineTo(spSheet.width, gy * sc + .5); x.stroke(); }
  }
  function spLoop(now) {
    if (location.hash === "#art" && spImg) {
      const fw = +spIn.fw.value || 1, fh = +spIn.fh.value || 1, n = +spIn.n.value || Math.max(1, Math.floor(spImg.width / fw)), fps = +spIn.fps.value || 8;
      if (now - spLast > 1000 / fps) { spT++; spLast = now; }
      const x = spCv.getContext("2d"); x.imageSmoothingEnabled = false; x.fillStyle = css("--sunk"); x.fillRect(0, 0, 260, 260);
      const sc = Math.max(1, Math.floor(Math.min(240 / fw, 240 / fh))), k = spT % n;
      x.drawImage(spImg, k * fw, (+spIn.row.value || 0) * fh, fw, fh, (260 - fw * sc) / 2, (260 - fh * sc) / 2, fw * sc, fh * sc);
      x.fillStyle = css("--muted"); x.font = "11px " + css("--mono"); x.fillText("frame " + (k + 1) + "/" + n, 6, 252);
    }
    requestAnimationFrame(spLoop);
  }

  // ---------- 3D to sprite camera ----------
  const camCv = el("canvas", { class: "pv wide", width: 640, height: 330, "aria-label": "A low-poly survivor rendered from eight directions" });
  const cam = { elev: 30, walk: true, px: 0, frames: 8 };
  const camSel = el("select", { id: "cam-elev", "aria-label": "Camera angle" },
    el("option", { value: "30", text: "2:1 pixel isometric (30°)" }), el("option", { value: "35.264", text: "True isometric (35.26°)" }), el("option", { value: "45", text: "Three-quarter (45°)" }), el("option", { value: "60", text: "Steep top-down (60°)" }));
  const camPx = el("select", { id: "cam-px", "aria-label": "Sprite size" }, el("option", { value: "0", text: "Smooth render" }), el("option", { value: "64", text: "Downscaled to 64 px tall" }), el("option", { value: "40", text: "Downscaled to 40 px tall" }));
  const camFr = el("select", { id: "cam-fr", "aria-label": "Walk frames" }, el("option", { value: "8", text: "8-frame walk" }), el("option", { value: "6", text: "6-frame walk" }), el("option", { value: "4", text: "4-frame walk" }));
  const camWalk = el("label", {}, el("input", { type: "checkbox", id: "cam-walk", checked: true, onchange: e => cam.walk = e.target.checked }), "Walk cycle");
  const camInfo = el("p", { class: "note mono" });
  camSel.addEventListener("change", () => { cam.elev = +camSel.value; camText(); }); camPx.addEventListener("change", () => cam.px = +camPx.value); camFr.addEventListener("change", () => cam.frames = +camFr.value);
  function camText() { camInfo.textContent = "Blender camera: Orthographic · Rotation X " + (90 - cam.elev).toFixed(2).replace(/\.00$/, "") + "° · Y 0° · Z 45° + 45° per direction (or rotate the model) · light fixed to the camera, not the model."; }
  // boxes: [cx, cy, cz, sx, sy, sz, colour, part]
  const BODY = [[-.11, 0, .42, .12, .14, .84, "#2c3832", "legL"], [.11, 0, .42, .12, .14, .84, "#2c3832", "legR"], [0, 0, 1.1, .4, .22, .56, "#2f6fb3", "torso"],
    [0, -.17, 1.12, .3, .12, .44, "#6b4f35", "pack"], [-.27, 0, 1.08, .1, .12, .5, "#d9a37a", "armL"], [.27, .02, 1.08, .1, .12, .5, "#d9a37a", "armR"],
    [0, 0, 1.53, .24, .24, .28, "#d9a37a", "head"], [0, -.02, 1.69, .26, .26, .07, "#6b4f35", "hair"], [.27, .3, 1.0, .05, .6, .07, "#17201c", "gun"]];
  function boxFaces(b, swing) {
    const [cx, cy, cz, sx, sy, sz, col, part] = b; const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    let v = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map(([a, b2, c]) => [cx + a * hx, cy + b2 * hy, cz + c * hz]);
    const pivotZ = part.startsWith("leg") ? .84 : part.startsWith("arm") ? 1.32 : null;
    if (pivotZ != null) { const ang = (part === "legL" || part === "armR" ? 1 : -1) * swing * (part.startsWith("leg") ? .5 : .35);
      v = v.map(([x, y, z]) => { const dz = z - pivotZ; return [x, y * Math.cos(ang) - dz * Math.sin(ang), pivotZ + y * Math.sin(ang) + dz * Math.cos(ang)]; }); }
    if (part === "gun") { const ang = -swing * .2; v = v.map(([x, y, z]) => { const dz = z - 1.1; return [x, y * Math.cos(ang) - dz * Math.sin(ang), 1.1 + y * Math.sin(ang) + dz * Math.cos(ang)]; }); }
    return [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4]].map(f => ({ v: f.map(i => v[i]), col }));
  }
  function shade(hex, k) { const n = parseInt(hex.slice(1), 16); return "rgb(" + [n >> 16, (n >> 8) & 255, n & 255].map(c => Math.min(255, Math.round(c * k))).join(",") + ")"; }
  function drawFigure(g, ox, oy, scale, yaw, swing, bob) {
    const e = cam.elev * Math.PI / 180, ce = Math.cos(e), se = Math.sin(e);
    const view = ([x, y, z]) => { const c = Math.cos(yaw), s = Math.sin(yaw); const x1 = x * c - y * s, y1 = x * s + y * c, z1 = z + bob; return [x1, y1, z1]; };
    const proj = ([x, y, z]) => [ox + x * scale, oy + (-z * ce - y * se) * scale];
    // ground cell (1 m, on the grid's axes: fixed, the model turns on it)
    g.fillStyle = css("--panel"); g.strokeStyle = css("--rule"); g.beginPath();
    [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([x, y]) => { const c = Math.cos(Math.PI / 4), s = Math.sin(Math.PI / 4); return proj([x * c - y * s, x * s + y * c, 0]); }).forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]));
    g.closePath(); g.fill(); g.stroke();
    const L = [-.45, -.55, .7]; const ln = Math.hypot(...L); const Ln = L.map(x => x / ln);
    const d = [0, -ce, se];
    const faces = [];
    for (const b of BODY) for (const f of boxFaces(b, swing)) {
      const p = f.v.map(view);
      const u = p[1].map((x, i) => x - p[0][i]), w = p[3].map((x, i) => x - p[0][i]);
      let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; const nl = Math.hypot(...n) || 1; n = n.map(x => x / nl);
      const cen = p.reduce((a, q) => a.map((x, i) => x + q[i] / 4), [0, 0, 0]);
      const bc = (b[0]); const out = [cen[0] - 0, cen[1], cen[2]];
      if (n[0] * (out[0] - view([b[0], b[1], b[2]])[0]) + n[1] * (out[1] - view([b[0], b[1], b[2]])[1]) + n[2] * (out[2] - view([b[0], b[1], b[2]])[2] - 0) < 0) n = n.map(x => -x);
      if (n[0] * d[0] + n[1] * d[1] + n[2] * d[2] <= 0) continue;
      faces.push({ p, depth: cen[0] * d[0] + cen[1] * d[1] + cen[2] * d[2], k: .5 + .62 * Math.max(0, n[0] * Ln[0] + n[1] * Ln[1] + n[2] * Ln[2]), col: f.col });
    }
    faces.sort((a, b) => a.depth - b.depth);
    for (const f of faces) { g.fillStyle = shade(f.col, f.k); g.beginPath(); f.p.map(proj).forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.closePath(); g.fill(); }
  }
  const DIRS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];
  const off = document.createElement("canvas");
  let camT0 = 0;
  function camLoop(now) {
    if (location.hash === "#art") {
      const g = camCv.getContext("2d"); const W = camCv.width, Hh = camCv.height; g.fillStyle = css("--sunk"); g.fillRect(0, 0, W, Hh);
      const cols = W < 500 ? 4 : 8, rows = cols === 8 ? 1 : 2, cw = W / cols, ch = (Hh - 20) / rows;
      const fr = Math.floor(now / 100) % cam.frames, swing = cam.walk ? Math.sin(fr / cam.frames * Math.PI * 2) : 0, bob = cam.walk ? Math.abs(Math.cos(fr / cam.frames * Math.PI * 2)) * .03 : 0;
      for (let i = 0; i < 8; i++) {
        const cx = (i % cols) * cw, cy = Math.floor(i / cols) * ch, yaw = Math.PI + i * Math.PI / 4;
        if (cam.px) {
          const scale = cam.px / 1.9; off.width = Math.ceil(scale * 1.7); off.height = cam.px + 6; const o = off.getContext("2d"); o.clearRect(0, 0, off.width, off.height);
          drawFigure(o, off.width / 2, off.height - 4 - scale * .25, scale, yaw, swing, bob);
          g.imageSmoothingEnabled = false; const up = Math.max(1, Math.min(Math.floor((ch - 30) / off.height), Math.floor((cw - 4) / off.width))); g.drawImage(off, Math.round(cx + cw / 2 - off.width * up / 2), Math.round(cy + ch - 24 - off.height * up), off.width * up, off.height * up);
        } else drawFigure(g, cx + cw / 2, cy + ch - 34, (ch - 40) / 1.9, yaw, swing, bob);
        g.fillStyle = css("--muted"); g.font = "600 11px " + css("--mono"); g.textAlign = "center"; g.fillText(DIRS[i] + " · ." + DIRS[i].toLowerCase(), cx + cw / 2, cy + ch - 6); g.textAlign = "left";
      }
      g.fillStyle = css("--muted"); g.font = "11px " + css("--mono"); g.fillText(cam.walk ? "walk frame " + (fr + 1) + "/" + cam.frames + " at 10 fps" : "idle pose", 8, Hh - 6);
    }
    requestAnimationFrame(camLoop);
  }
  function fitCam() { const w = Math.min(640, (camCv.parentElement ? camCv.parentElement.clientWidth : 640) - 2); camCv.width = Math.max(300, w); camCv.height = camCv.width < 500 ? 420 : 300; camCv.style.width = camCv.width + "px"; }

  function practise(id) {
    if (id === "models3d") { document.getElementById("camtool").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    const map = { sprites2d: "char", worldtiles: "hex", raidtiles: "isofloor", animation: "char" };
    setPreset(map[id] || "icon16"); if (id === "animation") { S.frames.push(S.frames[0].slice()); S.frames.push(S.frames[0].slice()); S.frames.push(S.frames[0].slice()); }
    refreshAll(); document.getElementById("studio").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- page ----------
  const tl = (A.tools || []);
  page.append(...[
    el("div", { class: "intro" }, el("div", { class: "kicker", text: "Milestone M8 prep · learn while the game is built with placeholders" }), el("h2", { text: "Art school" }),
      el("p", { text: A.intro || "" })),
    A.styleChoices ? el("section", {}, el("h3", { text: "Pick one style first" }), el("div", { class: "tscroll" }, el("table", { class: "t" },
      el("thead", {}, el("tr", {}, ["Style", "Good at", "Hard part", "For Broken State"].map(h => el("th", { text: h })))),
      el("tbody", {}, A.styleChoices.map(r => el("tr", {}, el("td", { text: r.style }), el("td", { text: r.good }), el("td", { text: r.hard }), el("td", { text: r.fit }))))))) : null,
    el("section", { class: "tracks" }, el("h3", { text: "Five tracks" }), trackBtns, trackPane),
    el("section", { id: "studio", class: "tool" }, el("div", { class: "tool-h" }, el("h3", { text: "Pixel studio" }),
      el("p", { text: "Draw a sprite or tile on a template sized for the game, add frames for animation, and check it tiled the way the engine will lay it out. Your drawing is kept in this browser." })),
      el("div", { class: "studio" },
        el("div", { class: "studio-l" }, el("div", { class: "ctl" }, el("label", { for: "st-preset", text: "Template" }), presetSel), presetNote, toolSeg, toggles, pal,
          el("div", { class: "cv-wrap" }, cv), el("h4", { class: "bx", text: "Frames" }), framesBox, frameBtns),
        el("div", { class: "studio-r" }, el("h4", { class: "bx", text: "Animation" }), pvA, el("div", { class: "ctl" }, el("label", { for: "st-fps", text: "Speed" }), fpsIn, fpsOut),
          el("h4", { class: "bx", text: "Tiled, as the engine lays it out" }), pvT, el("p", { class: "note", text: "Look for seams: lines or colour jumps where copies meet. Fix them at the tile's edges." }),
          el("h4", { class: "bx", text: "Export" }), exportBtns, exportNote, sheetImg))),
    el("section", { class: "tool" }, el("div", { class: "tool-h" }, el("h3", { text: "Sprite sheet player" }), spNote),
      el("div", { class: "studio" },
        el("div", { class: "studio-l" }, el("div", { class: "ctl" }, spFile),
          el("div", { class: "nums" }, ...[["sp-fw", "Frame width", spIn.fw], ["sp-fh", "Frame height", spIn.fh], ["sp-n", "Frames (0 = whole row)", spIn.n], ["sp-row", "Row", spIn.row], ["sp-fps", "fps", spIn.fps]].map(([id, t, inp]) => el("label", { for: id }, t, inp))),
          el("div", { class: "tscroll sheetwrap" }, spSheet), spToStudio),
        el("div", { class: "studio-r" }, spCv))),
    el("section", { id: "camtool", class: "tool" }, el("div", { class: "tool-h" }, el("h3", { text: "From 3D model to iso sprites" }),
      el("p", { text: "A low-poly survivor, as you would build it in Blender, seen by an orthographic camera from the eight directions an iso game needs. Change the angle to see why 2:1 pixel tiles use 30°, and downscale to see what a sprite at game size keeps." })),
      el("div", { class: "ctl wrapctl" }, camSel, camPx, camFr, camWalk), el("div", { class: "cv-wrap" }, camCv), camInfo),
    tl.length ? el("section", {}, el("h3", { text: "Tools to install" }), el("div", { class: "tscroll" }, el("table", { class: "t" },
      el("thead", {}, el("tr", {}, ["Tool", "Cost", "Use it for"].map(h => el("th", { text: h })))),
      el("tbody", {}, tl.map(r => el("tr", {}, el("td", {}, r.u ? el("a", { href: r.u, target: "_blank", rel: "noopener", text: r.name }) : r.name), el("td", { text: r.cost }), el("td", { text: r.for }))))))) : null,
    el("section", { class: "cols2" },
      A.pipeline ? el("div", { class: "box" }, el("h3", { text: "From sketch to the game" }), el("ol", { class: "olist" }, A.pipeline.map(s => el("li", { text: s })))) : null,
      A.commissioning ? el("div", { class: "box" }, el("h3", { text: "If you hire artists" }), bullets(A.commissioning, "tips")) : null),
    A.learnLinks ? el("section", { class: "box" }, el("h3", { text: "Where to keep learning" }), docs(A.learnLinks)) : null].filter(Boolean));

  loadDraft(); renderTrack(); camText();
  const onResize = () => { fit(); drawStudio(); fitCam(); };
  window.addEventListener("resize", onResize); window.addEventListener("hashchange", () => { if (location.hash === "#art") setTimeout(() => { onResize(); refreshAll(); }, 0); });
  setTimeout(() => { refreshAll(); fitCam(); }, 0);
  requestAnimationFrame(drawPreviews); requestAnimationFrame(spLoop); requestAnimationFrame(camLoop);
};
